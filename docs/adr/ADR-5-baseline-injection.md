# ADR-5: One-shot baseline injection instead of a live memory view

## Status

Accepted

## Context

Memories must reach the model. Options:

1. **System prompt section** — magic-context puts its frozen baseline in the (stable) system prompt head. In DSH, the system prompt is assembled per step and any memory change would re-render it — and system-prompt bytes sit at the very head of the prefix, so every memory update would be a full cache bust. Also: baseline rendering changes as memories change, which multiplies the busts.
2. **Inject on every step** (live view) — floods the surface, busts nothing (appends) but bloats every future request with repeated content.
3. **One-shot snapshot at session start, appended as a user message**.

## Decision

Option 3 — at the first step of a session, active memories render (canonical category order, ids, importance) into a single `<project-memory>` user message inserted behind the last claimed message, tagged with a dedicated source kind for dedup. Exactly once per session; nothing when empty; low-importance rows over a character budget are dropped with a count note. Mid-session memory changes are *not* reflected in the baseline — they reach the model through the tools that wrote them (the agent just wrote them; it knows).

## Consequences

- **Good**: the message enters the provider's cached prefix and is never touched again — zero steady-state cache cost.
- **Good**: dedup by source kind survives resume (a resumed session doesn't get a second injection). The check must read the persisted surface, not just the step's outgoing messages: a later turn's outgoing array does not carry earlier turns' injections, and checking only it re-injected the baseline every turn, so a long session carried one copy per turn. A compaction replace that shadows the baseline takes it off the surface, so it is injected again on the rebuilt prefix.
- **Cost**: the baseline is a session-start snapshot; memories written by a *concurrent* session appear only next session. Accepted: memories are durable knowledge, not chat state.
- **Cost**: baseline growth is bounded by the budget, not by memory count; the drop-tail rule keeps injection cost predictable.

## Amendment (2026-11-21): selection, notes, framing

The first version walked categories in canonical order and dropped whatever no longer fit, so PROJECT_RULES filled the budget and importance never decided what was seen (a pool with many rules injected only PROJECT_RULES rows and skipped higher-importance ARCHITECTURE rows). It also injected working notes and rendered `(importance N)` on every line, which made dated status lines read as scored standing rules.

- Selection is global: importance, then most recent reinforcement (`last_seen_at` from a dedup re-observation, or `verified_at`), then id. Layout by category happens after selection (magic-context `compareMemorySelectionPriority`).
- Notes (`source_type = note`) are never injected; they stay searchable.
- Stale rows (verify found a contradiction) rank below all others and carry `possibly stale`; only a `verified` check counts as reinforcement.
- The fill is greedy with skip: a long row that does not fit is passed over and shorter lower-priority rows may still use the remaining budget. Accepted: it packs more knowledge into the budget, and long rows are the ones curate should split.
- Importance is not rendered (it ranks, it is not a claim); verified rows carry `verified`; the header says the block is records to check, not instructions, and that the user and the code win on conflict. The header and markers are English so the injection does not set the session's language, and `<project-memory` / `<ctx-search-hint` tags inside memory text are escaped so a memory cannot close the block early.
