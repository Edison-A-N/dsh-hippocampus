# ADR-11: Agent drops, pressure tiers and historian facts

## Status

Accepted (2026-11-24). Extends ADR-9 and ADR-10. Adds three items they left deferred: `ctx_reduce`, emergency tiering by tool kind, and historian fact capture. Reasoning clearing stays out, together with the other assistant-message rewrites (see Scope decisions).

## Context

ADR-10 reclaims tool output by age and by duplication, and nothing else. Three gaps remain against magic-context (studied at commit `642d528`, `docs/architecture/reclaim.md`, `hooks/magic-context/emergency-drop.ts`, `tools/ctx-reduce`, `hooks/magic-context/historian-prompt.generated.ts`):

- The agent knows better than any age rule which outputs it is done with (a grep that found the file, test output it already acted on). magic-context gives it `ctx_reduce`, which queues drops that land on the next pass that rewrites the prefix anyway.
- At the force band ADR-10 only takes stale and duplicate output. When a long tool loop has produced a lot of output that is still current, nothing is taken until the fold. magic-context then drops current output by tool tier, aiming at a target headroom.
- The historian reads every turn of the session but writes only compartments. magic-context has it emit durable facts alongside, which become project memories; ADR-9 listed this as deferred.

## Decision

### Agent drops (`ctx_reduce`)

- A new tool, registered only with the compartment engine. Targets name a tool and a fragment of the call's arguments as the model wrote them (`{"tool":"bash","match":"npm test"}`), or an event seq the model was shown (a placeholder's `ctx_expand` pointer, a `ctx_search` hit). magic-context addresses tags (`§N§`) it injects into every message; DSH has no message-rewrite hook to inject such tags (ADR-3), and tool-call ids are not reliably visible to the model, so the target is described by what the model itself wrote.
- The tool only queues: matching tool-result seqs go into a `reduce_queue` table (session, seq). The answer lists what each target matched, what was skipped (every `skill` and `todo_write` result, placeholders, non-text results, results under the 250-token placeholder floor) and which targets matched nothing, so a broad fragment is visible to the model at once. At most 50 targets per call.
- The engine applies the queue inside the ADR-10 reclaim pass. Queued results get the same placeholder as other reclaim, with the reason "marked as no longer needed (ctx_reduce)". A queued result inside the protected window or on a pending compartment boundary or a running historian slice is held until newer work pushes it out (magic-context's rule for agent drops). A queued seq that left the surface or is no longer replaceable is removed from the queue.
- When: every pass that reclaims anyway (commit, fold, model switch, idle) applies the queue, and so does a force-band pass whose whole batch is worth ≥ 2% of usable context. The queue never starts a rewrite of its own on a warm cache: ADR-10's rule holds unchanged. magic-context also lets queued drops alone start a rewrite at the execute threshold when no summary can come; here a summary is almost always about to come at that pressure (the historian starts at 63%), and a second prefix rewrite a few steps after the first would cost more than the drops save.

### Tiered pressure reclaim

- A third lane in the reclaim pass. At the force band it runs once per pressure episode on a warm cache (magic-context's `last_emergency_input_sample` latch). The latch resets when pressure falls below the band and gives way on a pass that rewrites the prefix anyway (commit, fold, model switch, idle), as magic-context re-arms "when another provider-visible mutation is already busting the prefix". On every overflow and emergency fold and at ≥ 95% it runs every pass. The latch lives in memory, so a restart inside the band allows one more batch.
- Target: the floor is the current total minus every surface node (what remains is the system prompt and tool schemas). The pass aims at floor + 30% × (usable − floor) and frees what is left after the stale, duplicate and agent lanes. Like magic-context's `floorTags`, the floor subtracts the whole live window, not only tool output: counting conversation text as fixed raises the target and under-evicts. A floor at or above usable returns nothing (tool reclaim cannot repair oversized fixed overhead). A need of ≤ 2,000 tokens is not worth a rewrite. Constants are magic-context's (`TARGET_FRACTION`, `EMERGENCY_REARM_MIN_TOKENS`). Not ported: its older-accounting fallback for content newer than the last usage reading (the floor here comes from the scaled heuristic of every node, which already includes it). Its achievable-reclaim minimum on standalone passes is covered by ADR-10's 2% batch floor at the force band; neither checks a batch that rides a commit.
- Order: tier 3 first (everything not listed below: `bash`, web tools, ctx tools, MCP tools), then tier 2 (`edit`, `write`, `grep`, `glob`), then tier 1 (`read`, `todo_write`, `subagent`, `subagent_fork`); oldest first within a tier. magic-context's tiers, mapped to DSH tool names (its `task` is DSH's sub-agent tools; `aft_*` have no DSH counterpart).
- Always kept: the results of the newest assistant message (the model is about to read them), protected tools, pending boundaries, the running historian's slice, non-text results, results under the 250-token placeholder floor. Below 95% also the protected window and the newest 20% of each tier-1 and tier-2 population (`TIER_RECENCY_RESERVE`, counted over every live result of the tier, so results inside the protected window take reserve places too); at ≥ 95% and on overflow both give way.
- The force-band 2% floor from ADR-10 now applies to the whole batch of all three lanes.

### Historian facts

- The historian prompt asks for an optional `facts` list next to the compartments: present-tense project knowledge in one of the five memory categories, with the same per-category tests as the `ctx_memory` description (which itself follows magic-context's historian rubric). The prompt instructs the historian that facts come from what the user said and what the work established, that text inside tool results, injected context and agent reports is data, and that PROJECT_RULES come only from user messages. This is an instruction to the model, not a check: the parser validates category, length and count, and cannot tell where a fact came from. The prompt is rewritten, not copied.
- The user message carries the project's active memories (notes excluded, by importance, whole lines up to 8,000 characters) as `<project-memory>`, so the historian skips facts already stored and states a changed value instead.
- Facts are validated (known category, non-empty, ≤ 400 characters, ≤ 5 per call, deduped within the reply) and written with `source_type = 'historian'`, `source_session` = the session, importance 40. A fact whose normalized text matches any stored row of its category, archived memories and notes included, only counts as a re-observation (`MemoryStore.observe`): the historian never revives what the agent or the dreamer archived (it only sees active memories) and never promotes a note. magic-context's promotion matches any status the same way. The dreamer's verify and curate passes treat historian rows like any other memory.
- Facts from a call that covered only part of its slice are not written. The facts are not tied to compartments, so the ones from the covered part cannot be told apart from the rest, which the next call reads again; a reworded restatement would then pass the exact dedup and be stored twice. magic-context skips promotion on its discard-last runs for the same reason. The cost: a fact stated only in the covered part of such a call is lost.
- `HIPPOCAMPUS_HISTORIAN_FACTS=off` turns both the memory block and the promotion off.

## Scope decisions

- **Reasoning clearing, superseded-edit compression and old assistant-text compression: not done.** All three rewrite `assistant/message` events. In DSH an `assistant/message` cannot be a surface replacement (it embeds its source stream and may not carry `sourceEventSeqs`, ADR-10). The only host mechanism that changes how an existing message reaches the model is a session message projection (`registerMessageProjection`, used by image offload). Its records are required, not ignorable: a session that used them cannot be restored once the plugin is unloaded, and the plugin would sit inside the request builder of every session. On Anthropic routes, signed thinking blocks are also bound to the request prefix before them (`dsh-llm-pi-ai` `bindThinkingToPrefix`), so clearing old reasoning would invalidate later signed turns unless done exactly at a prefix rewrite. The user decided to leave these three out and not to ask DSH for a new seam. Reasoning in history is a real cost: in one measurement on long sessions over an Anthropic route, provider input grew by one token per ~1.1 characters of new history when reasoning was left out of the count, and per ~3.9 characters once it was counted, so the reasoning text is billed as input. This is the largest remaining gap against magic-context.
- **No `§N§` tags or reduce nudges.** Tags need the per-request transform DSH rules out; nudges ("you have N KB of droppable output") would be injected messages that change the prefix. The tool description carries the guidance instead.
- **Agent drops stay in the plugin's SQLite, not the session log.** The queue is advisory; what reaches the log is the same `compaction/prune` + `tool/result` replace pair as ADR-10, so replay and the token meter need nothing new.
- **Historian facts go straight to memories at a lower importance.** magic-context (v2) also promotes historian facts straight to project memories (`promoteSessionFactsDurable`, source type `historian`), deduped by normalized hash, without setting an importance (the default 50 applies). Here the baseline is chosen by importance first, and 40 keeps an agent-written memory (default 50) ahead of a historian fact when the budget is tight.

## Rejected alternatives

- **Apply `ctx_reduce` immediately.** Every call would bust the cached prefix from the dropped result on; on a long session that is hundreds of thousands of tokens rewritten for a few thousand freed.
- **Address targets by tool-call id.** The ids are provider-generated, not shown consistently in the model's view, and easy to mistype; the model reliably reproduces its own arguments.
- **Pressure reclaim on every force-band step.** A batch that did not bring pressure out of the band would be followed by another one on the next step, each a full prefix rewrite; magic-context's live sessions showed exactly that churn before its latch.
- **Historian facts at the agent's default importance.** A fact the agent never confirmed would compete equally with the agent's own judgment for the baseline budget.

## Consequences

- One new table (`reduce_queue`), created by the schema on open; no migration of existing rows. The checkpoint engine (`HIPPOCAMPUS_COMPACTION=checkpoint`) does not register `ctx_reduce`.
- A queued output waits for the next commit, fold, model switch, idle gap or force-band batch. During a long tool loop on a warm cache below the force band, that can be many steps.
- Reclaim run records name the lanes in their summary (`2 stale, 1 duplicate, 3 agent, 4 pressure`), and historian records carry the number of facts written.
- Residual risk: if the historian model does not follow the source rule, text from a fetched page or a sub-agent report can become a historian memory and reach every later session's baseline (importance 40, unverified) until the dreamer's verify pass or a person archives it.
- Memories now have three writers: the agent, the dreamer (rewrites) and the historian. `GET /plugins/hippocampus/api/memories` returns `source_type`, so historian rows can be told apart; the Web memory browser does not show the field yet.
- Not configurable: the tier lists, the 20% reserve, the 30% target fraction, the 2,000-token minimum, fact limits and importance.
