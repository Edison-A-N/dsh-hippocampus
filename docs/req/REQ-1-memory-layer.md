# REQ-1: Project Memory Layer

## Status

Accepted (implemented)

## Background

Coding agents start every session with amnesia: facts established in one session (how to run tests, architectural conventions, hard constraints, naming rules) are gone in the next. Existing mitigations are manual — AGENTS.md files humans maintain — or absent. Meanwhile, an agent that *does* accumulate knowledge faces a second problem: naive memory grows unboundedly and leaks stale facts into prompts.

The reference design here is magic-context's memory subsystem (Letta/MemGPT sleep-time compute and mem0's extraction pipeline are the industry analogues; see [tech/prior-art.md](../tech/prior-art.md)).

## Requirements

### REQ-1.1 Structured memory store

- Memories are project-scoped rows in a durable store.
- Five fixed categories: `PROJECT_RULES`, `ARCHITECTURE`, `CONSTRAINTS`, `CONFIG_VALUES`, `NAMING`.
- Exact dedup: same normalized content in the same category is rejected, not duplicated.
- Soft delete: archiving retires a memory (leaves baseline and search) without destroying history.
- Every row carries: category, content, importance (1-100; ranks baseline selection and is not rendered), source type (`agent` / `note`; notes are searchable, never injected), lifecycle (seen count, verification status/time/commit, superseded-by, archive reason), status, source session, created/invalid/last-accessed timestamps.

### REQ-1.2 Model-facing tools

- `ctx_memory`: write / get / list / update / archive — the agent reads and writes its own long-term memory mid-session.
- Write guidance embedded in the tool description: "write sparingly, memories cost prompt tokens in every future session."
- Tool output must be lossless JSON (no BLOB/timestamp-binary leakage from the storage layer).

### REQ-1.3 Cross-session retrieval

- `ctx_search`: hybrid retrieval over the memory store.
- Full-text lane must support CJK (two-char words) and exact identifiers (paths, error codes) — not just English whitespace tokenization.
- Semantic lane (optional): recall by meaning, including cross-language (English query → Chinese memory), fused with full-text via reciprocal rank fusion.
- Graceful degradation: no embedding credentials → FTS5-only, silently.

### REQ-1.4 Baseline injection

- At the first step of every session, the project's active memories render into one `<project-memory>` user message.
- Injected exactly once per session (dedup by source kind; survives resume).
- No injection when there are no memories.
- Cache-friendly: the message rides the conversation prefix and is never re-injected or mutated afterward.

### REQ-1.5 Project identity

- All worktrees of one repository must share one memory pool.
- Identity must survive re-clones of the same repo (not path-based).
- Non-git directories still get a stable identity.

## Acceptance criteria

- A memory written in session A is readable and searchable in session B over the same repo.
- Chinese two-character words and exact identifiers both retrieve their memories.
- With embedding configured, a semantic-only query (no lexical overlap) retrieves the right memory.
- A fresh session over a repo with memories starts with exactly one `<project-memory>` message; a repo with none starts with zero.
- Same repo checked out at two paths resolves to the same project identity.
