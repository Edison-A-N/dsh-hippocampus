# ADR-3: Work within the event-sourcing contract — no per-request message rewriting

## Status

Accepted

## Context

magic-context (on OpenCode) rewrites the outgoing message array on every model call: its transform pass re-renders a frozen baseline message (m[0]) and an incremental message (m[1]) each turn, classifying passes as SOFT+ (byte replay), SOFT (re-render m[1]), or HARD (rebuild m[0], the only re-tier moment).

DSH has no such hook, and this is an **architectural contract, not an omission**: a model request is a pure function of the event log (`deriveMessages()`), which is what makes sessions replayable and crash-recoverable. The `llm/stream` request is deep-frozen — listeners read it, never rewrite it.

We had three choices:

1. Patch DSH itself to add a per-call transform hook (rejected: we committed to "dsh core untouched"; it would also break the replayability contract).
2. Give up the magic-context-style features.
3. Translate the pass taxonomy into event-stream equivalents and accept the granularity loss.

## Decision

Option 3 — map each magic-context pass level onto what DSH's contract provides:

| magic-context | This plugin's equivalent | Cache semantics |
|---|---|---|
| SOFT+ (defer, byte replay) | do nothing — the log is unchanged, so `deriveMessages()` output is unchanged | prefix cache fully retained |
| SOFT (m[1] re-render) | append-only injections: the one-shot `<project-memory>` baseline behind the last claimed message; background results never touch a live surface | appends don't invalidate the cached prefix |
| HARD fold (m[0] rebuild) | compaction's `surfaceOp: {op: 'replace'}` | a replace invalidates the cache from the first shadowed node anyway — exactly the moment to fold history in |

Everything the plugin writes is an appended (or replace-shadowed) event. Background lanes (dreamer, embedding drain, background summarization) publish only to the plugin's own SQLite and never to a live session's surface.

## Consequences

- **Good**: zero changes to the DSH core; the plugin rides only documented seams (`CompactionEngine`, `ctx.llm.stream`, `ctx.tokenMeter`, `agent/pre-step`, `agent/request-error`).
- **Good**: replayability and crash recovery hold by construction.
- **Cost**: no ephemeral, per-request content (no per-turn decay re-rendering). Compartment-tier history with a decay curve would require folding into the replace event — deferred (see ADR-8).
- **Cost**: no mid-conversation stable-cache reordering; recall can only be appended at the tail. Accepted.
- **Cost**: no fail-closed turn-refusal channel (magic-context's 95% emergency refusal). Degraded to the synchronous-summary fallback on overflow, which guarantees recovery without ever sending an over-limit request.
