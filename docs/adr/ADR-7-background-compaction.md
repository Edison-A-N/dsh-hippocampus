# ADR-7: Background compaction lane — summarize off the step boundary

## Status

Superseded as the default engine by [ADR-9](ADR-9-compartment-compaction.md) (2026-11-05). This engine remains the inline fallback and is selectable with `HIPPOCAMPUS_COMPACTION=checkpoint`.

## Context

The stock DSH compaction backend summarizes inline: the summarization LLM call runs inside the `agent/pre-step` waterfall, so **the step boundary blocks on a model round-trip** (seconds to tens of seconds of dead air before the user's turn starts processing). magic-context's historian instead summarizes in hidden sub-sessions and commits with local-only operations.

DSH's `CompactionEngine` contract requires `compactIfNeeded` to return synchronously within pre-step — but nothing says what it must *do* synchronously.

## Decision

Split the work: **summarize in the background, commit locally.**

- Pressure ≥ 65% (`HIPPOCAMPUS_BACKGROUND_TRIGGER`): start (or join) a background summarization for the session — cheap model, conversation prefix replayed so the provider reuses KV cache — and return `null` immediately. The step proceeds.
- When the background summary lands, it waits. On the next pre-step with pressure ≥ 80% (`HIPPOCAMPUS_FORCE_COMMIT`), commit in one shot: `compaction/start → compaction/summary → user/message replace → compaction/end`, all local log appends, zero model calls.
- A landed summary is not re-generated while pressure sits between the two thresholds. It is refreshed only when the session grew by more than `HIPPOCAMPUS_RESUMMARIZE_GROWTH` (default 10%) of the context window since it was prepared or since the last refresh attempt (a failed refresh does not retry every step); with the default 65/80 band that is at most once. At the force ratio the kept summary commits as-is, even if it is stale. A landed summary whose span is no longer on the surface is dropped. (Before this rule every step in the 65–80% band started a fresh run and overwrote the previous one, discarding large amounts of summarization work.)
- Context-overflow is the deliberate exception: recovery must always work, so it degrades to the synchronous basic-style summary.
- One in-flight summarization per session (`BackgroundLane` dedups concurrent starts); a session ending before landing discards the summary (the next session re-triggers).
- Selection rules are inherited from the stock backend: 16% protected tail, tool arcs never split, system head untouched. The 8-section checkpoint template is reused verbatim — it is battle-tested prompt design, not worth re-inventing.

## Consequences

- **Good**: step boundaries never wait on a model call; the visible latency win is the entire point.
- **Good**: KV cache reuse in the background lane keeps summary cost near-raw-input pricing.
- **Good**: `/compact` (compactNow) and explicit regions keep working through the same engine.
- **Cost**: a commit lands one step later than the pressure crossing (it waits for the force threshold). Accepted — 65/80 spacing is the headroom.
- **Cost**: sessions that end between landing and commit waste one summary run. Accepted at current volumes.
- **Cost**: no fail-closed refusal (ADR-3); overflow fallback covers the worst case.
