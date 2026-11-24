# REQ-3: Background Context Management (compaction)

## Status

Accepted (implemented)

## Background

Long sessions eventually exceed the context window. The stock DSH backend (`dsh-compaction-basic`) summarizes inline in the `agent/pre-step` waterfall: **the model call for the summary blocks the step boundary** — the user's next turn waits for a full LLM summarization round-trip.

magic-context solves this by moving summarization off the hot path (its historian runs in hidden sub-sessions; compaction commits are pure local operations). DSH has no per-request message-rewrite hook (an architectural contract, not an omission — see ADR-3), but the `CompactionEngine` contract plus a background lane covers the core win.

## Requirements

### REQ-3.1 Replace the compaction backend

- Register as `ctx.compaction` (a composition carries exactly one backend; the stock `compaction-basic` row must be disabled in the profile).

### REQ-3.2 Zero model calls at the step boundary

- When context pressure crosses the background trigger (default 65%), a background summarization starts; **the current step proceeds immediately**.
- The background lane summarizes with a cheap model and replays the conversation prefix so provider KV cache is reused.
- Overflow recovery is the exception: a context-window-exceeded error degrades to a synchronous summary, because recovery must always work.

### REQ-3.3 Deferred commit

- Once a background summary has landed, the commit (surface replace) happens in one shot on the next step whose pressure is at/above the force threshold (default 80%).
- The commit is purely local log appends: `compaction/start → summary → user/message replace → compaction/end`. No model call.
- A session that ends before landing discards the summary; the next session re-triggers.

### REQ-3.4 Selection safety (inherit the stock rules)

- A protected tail (16% of the window) is retained as recent original text.
- Tool arcs (call + result) are never split at the replace boundary.
- The system head (surface node 0) is never replaced by a user message.
- The `/compact` command keeps working (the command is backend-agnostic).

## Acceptance criteria

- A session driven past 85% pressure is never blocked at a step boundary by a summarization model call.
- After commit, the surface shows the checkpoint summary plus the retained tail; tool arcs remain paired.
- A context-overflow error always recovers (synchronous fallback).
- `/compact` behaves as before.
