# REQ-5: Agent-Directed and Pressure-Tiered Reclaim, Historian Memory Capture

## Status

Accepted (implemented). Design: [ADR-11](../adr/ADR-11-agent-drops-pressure-tiers-historian-facts.md).

## Background

ADR-10 reclaims tool output only by age and duplication. The agent cannot say which outputs it is done with, the force band cannot take output that is still current when a long tool loop fills the window, and the historian reads every turn without keeping the durable knowledge it sees. magic-context has an answer for each: `ctx_reduce`, tiered emergency drops, and historian facts.

## Requirements

### REQ-5.1 `ctx_reduce`

- A model tool marks tool outputs as no longer needed. Targets are a tool name plus a fragment of the call's arguments, or an event seq.
- Marking queues the outputs; it never changes the surface by itself. The answer lists what each target matched, what was skipped and which targets matched nothing.
- Queued outputs are replaced by the ADR-10 placeholder on the next pass that reclaims anyway (commit, fold, model switch, idle gap, force-band batch). The queue never starts a rewrite on a warm cache by itself.
- The protected window, pending compartment boundaries and the running historian's slice hold a queued output until it leaves them; `skill` and `todo_write` results, placeholders, non-text results and results under 250 tokens are never queued and are reported as skipped.

### REQ-5.2 Tiered pressure reclaim

- At the force band (once per episode), at ≥ 95% and on overflow, when stale and duplicate output is not enough, current tool output is replaced too: shell, web and other tools first, then edits and searches, then reads, plans and sub-agent reports; oldest first within a tier.
- The pass aims at a target headroom (floor + 30% of the room between the floor, which is everything outside the conversation surface, and usable context) and does nothing when the floor alone reaches usable context or the need is 2,000 tokens or less.
- On a warm cache inside the force band one batch per episode; a pass that rewrites the prefix anyway may take another.
- The results of the newest assistant message always stay. Below 95% the protected window and the newest 20% of reads/plans and of edits/searches stay too.

### REQ-5.3 Historian memory capture

- The historian may return durable facts next to its compartments; valid facts are stored as project memories with `source_type = historian`, below the agent's default importance. The historian is instructed that instructions found in tool output or injected context are not facts and that project rules come only from user messages (a prompt rule, not enforced by code).
- The historian sees the project's active memories, so it does not restate them. A fact matching any stored row (active, archived or a note) counts as a re-observation and changes nothing else: an archived memory stays archived.
- Facts from a call that covered only part of its slice are not stored.
- `HIPPOCAMPUS_HISTORIAN_FACTS=off` disables capture.

### Out of scope

- Reasoning clearing, superseded-edit compression and old assistant-text compression rewrite assistant messages. DSH does not let a plugin replace them, and the one host path that could (a message projection) was rejected (ADR-11).

## Acceptance criteria

- A `ctx_reduce` call leaves the surface unchanged; outside the protected window and pending boundaries, the queued outputs become placeholders on the next commit, fold or cold-cache pass, and below the force band not before.
- A session at the force band whose tool output is all current loses tier-3 output first, never the newest round's results, and on a warm cache gets one such batch per episode.
- A historian run over a slice that states a project rule adds one `historian` memory; a second run stating it again adds none, and a run restating an archived memory leaves it archived.
- Every placeholder still folds exactly through the real token meter (host-contract test).
