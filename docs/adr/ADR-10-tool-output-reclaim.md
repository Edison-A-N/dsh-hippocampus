# ADR-10: Tool-output reclaim — magic-context's age and dedup lanes, cache-safe

## Status

Accepted (2026-11-11). Extends ADR-9. Extended by ADR-11 (agent drops, pressure tiers).

## Context

ADR-9's engine has one way to shrink the surface: summarize a span and replace it with a checkpoint. Between commits every raw tool output in the unsummarized span stays on the surface verbatim. With a 1M window the unsummarized span plus the protected tail is a few hundred thousand tokens, and about a third of it is tool output. The stock `tool-result-pruner` cannot help: it lives inside the agent preset's isolated compaction group (unreachable from this plugin), runs only when the preset's `compaction-basic` reaches 80% (rarely, on a 1M window), and cuts every result over 8,192 characters to its head and tail regardless of age.

magic-context handles this with separate reclaim lanes (`docs/architecture/reclaim.md` in its repo): age reclaim, dedup of repeated read-only results, superseded edits, the agent's `ctx_reduce`, and emergency tiers. They share one rule: an automatic removal never causes a prompt-cache bust of its own. It rides a pass that rewrites the prefix anyway.

The design assumes the provider has a prompt cache. Editing a node at position p rewrites the cached prefix from p on. At Anthropic prices (write 1.25×, read 0.1×) removing X tokens saves 0.1·X per later step and costs about 1.15·S once, where S is the prefix after p; it pays back after 11.5·S/X steps (69 steps for S = 300K, X = 50K), and only if no other bust lands in between. So reclaim must not originate busts on a warm cache. A route that reports no cache use is a property of that route and does not shape this design.

## Decision

Add `lib/reclaim.js` (pure selection + event writing) and call it from `CompartmentCompaction` at the step boundary.

**What is reclaimed**

- *Stale*: a completed tool result with ≥ 3 genuine user messages after it (source kind `user` or none; injected context and agent reports do not count), or with newer surface content ≥ 25% of usable context. Sizes here are provider tokens (node prices scaled as in ADR-9's 2026-11-12 amendment).
- *Duplicate*: an older result of a read-only tool (`read`, `grep`, `glob`, `web_fetch`, `ctx_expand`, `ctx_search`, `read_mcp_resource`) whose exact call (name + arguments) appears again later.
- Never: the newest `protected` surface tokens (magic-context's derived `protected_tokens` = clamp(5% usable, min(16K, 8% usable), 64K)), results under 250 tokens, results with non-text blocks (images keep their offload selections), every `skill` result, the newest `todo_write`, already-reclaimed placeholders, pending compartment boundaries, and the running historian's slice.

**How**

- The result's content becomes one text block: a marker line naming the tool, the reason and the original size, the original's first 4 lines (≤ 300 code points), and for longer output its last 2 lines (≤ 200 code points; errors and test failures sit at the end), then `[full text: ctx_expand sessionId=… seq=…]`, where seq is the root of the replacement chain (the original full-text event, also through earlier stock-pruner replacements). Cuts are by code point, so a surrogate pair is never split. The text is a pure function of the original, so replay reproduces it.
- Tool-call arguments are never changed. magic-context found that every synthetic value in the argument position gets copied by models into new calls (truncated paths executed, markers looped on).
- Events: `compaction/prune` (shadowedRange/shadowedSeqs = the node, shadowedTokenCount = its heuristic price) immediately followed by a `tool/result` with the original data, the new message, `surfaceOp: replace` over that node and `sourceEventSeqs: [node]`. This is the stock pruner's protocol, so the token meter subtracts it and session validation accepts it. The original stays in the append-only log.
- A replacement carries a newer seq than its neighbours, so surface seqs stop increasing. The historian labels every transcript line with the replacement chain's root seq (increasing again), formats a reclaimed node from its original text, and snaps the model's compartment bounds onto those labels before mapping them back to surface seqs. Without this a compartment starting at a reclaimed node would be snapped to the end of the slice.
- `ctx_expand` now projects `data.message` for assistant/tool/system events (it previously returned `text: null` for tool results) and renders tool calls, so the pointer leads somewhere.

**When** (one decision per pass)

- Riding a bust that happens anyway: right after a compartment commit; before and after an overflow or emergency fold (before, so a failing fold still leaves the smaller surface for the retried request).
- On its own, only when the cache for this prefix is already lost or the window forces it: the step switches model (the step's `modelSelection` differs from the last request header, the test dsh-agent's model-switch notice uses), no model response for `HIPPOCAMPUS_RECLAIM_IDLE` (defaults to `HIPPOCAMPUS_CACHE_TTL`, 5 minutes, and is never less than it; see Scope decisions), or pressure ≥ the force band (max(85%, threshold + 2%)) with a batch worth ≥ 2% of usable context. A model switch now also opens the commit window, which ADR-9 listed but had not wired.
- Otherwise nothing changes on a warm cache. A run record (`mode = reclaim`, with the reason) is written for each batch.

## Scope decisions

- **Superseded-edit compression: not done.** magic-context compresses an older `edit`/`write` to the same file by clamping its `old_string`/`new_string` arguments to 40 characters (an exception to its own "arguments real or absent" rule, `docs/architecture/reclaim.md`, which it adopted after clamped values were copied into new calls). This ADR keeps the rule without that exception, and DSH could not apply it anyway: an `assistant/message` cannot be a surface replacement (it embeds its source stream and may not carry `sourceEventSeqs`), so its arguments cannot change without replacing the whole turn. Edit results are tiny (in replayed long sessions, a few percent of the size of the edit arguments). The arguments are left for the historian's summary.
- **Request-header changes other than the model are not a trigger.** Tool-set and system-prompt changes are logged in `request/header` after pre-step, so they are not visible when this engine runs; detecting them would mean reclaiming one step late, after the new header's cache has already been written.
- **Routes with no prompt cache get no special case.** ADR-9 already commits on them at once; reclaim keeps the cache-safe timing everywhere.
- **Standalone idle reclaim uses the cache TTL; the TTL is not learned.** Idle reclaim and ADR-9's idle commit use one "cache is cold" test: no model response for `HIPPOCAMPUS_CACHE_TTL` (5 minutes, the default Anthropic ephemeral cache, which magic-context's `cache_ttl` also defaults to). `HIPPOCAMPUS_RECLAIM_IDLE` defaults to it and can only be set longer. The first version waited an hour for routes that keep caches longer; replaying a long session on a route without a cache showed that its turn gaps of a few minutes then never reclaimed anything, so the default was aligned with the commit TTL, and a route with a 1-hour cache sets `HIPPOCAMPUS_CACHE_TTL=1h` for both. Learning the TTL from usage was tried and dropped: a response that reads the prefix from cache after a gap does not show this session's cache survived, because forks, sibling sessions and retried requests refresh the same prefix, so the learned values drift far past any real cache lifetime.

## Rejected alternatives

- **Reclaim every step on routes that report no cache use.** Optimizes one route's quirk; on any cached route it would bust the prefix on most steps.
- **Use the stock tool-result-pruner.** Unreachable from this scope, size-based rather than age-based, and runs only at 80%.
- **Head/tail truncation to 5K instead of a placeholder.** Keeps 5K characters of every large result forever; age, not size, is what makes output useless.
- **Agent-driven `ctx_reduce`.** Needs a tool, nudges and a drop queue; deferred until automatic reclaim has been observed in use. Added by ADR-11 (tool and queue, without nudges).

## Consequences

- Replaying long session logs (1M window; each log loaded into `Session.create`, then `selectReclaim` + `applyReclaim`) into a real `dsh-session` `Session` (which validates every replace) with the real token-meter estimator freed 10–20% of the surface per session (tool output was about a quarter to a third of it). Folding the whole log through the real `contextPressure` projection gave the same reduction as the per-node sum in every case (exact shadow prices). Most of it was `bash`, then `read` and web search.
- When reclaim runs alone it lands on idle gaps past the TTL or model switches. During a long autonomous tool loop without such moments, old output stays until the next commit or the force band. In the Web profile the preset's `compaction-basic` + pruner fire at 80%, before this engine's 85% force band, so the force branch rarely runs there. Both are the accepted cost of not busting a warm cache.
- The panel counts a batch of prunes as one prefix rewrite, folded into the commit it follows, and the bust marker counts any surface replace.
- Lineage (ADR-9) is unaffected: the checkpoint seq and pending boundaries are never replaced; a replaced interior node of a pending span keeps the span contiguous.
- `ctx_expand` returns the original in full; there is no size cap on what it brings back.
- Not configurable today: 3 user turns, 25% distance, 250-token floor, 2% force floor, the placeholder head/tail sizes, the protected-tool list, the read-only tool list.
- Deferred here, settled in ADR-11: emergency tiering by tool kind and `ctx_reduce` are added; reasoning clearing is not done.
