# REQ-2: Background Memory Maintenance (dreamer)

## Status

Accepted (implemented)

## Background

Agent-written memory degrades over time: wording drifts, near-duplicates accumulate, facts that were true when written become wrong as the codebase evolves. Industry prior art converges on the same answer — don't make the main agent maintain its own memory mid-conversation (MemGPT's original design was abandoned for exactly this); run a background "sleep-time" maintainer instead (Letta sleep-time agents, magic-context's dreamer).

This plugin's dreamer-lite is the minimal version of that pattern.

## Requirements

### REQ-2.1 Scheduled background execution

- A process-wide timer tick (15 minutes) drives maintenance.
- Work is per-project; projects are processed independently.
- Within one project, maintenance tasks are serialized by a lease (`memory:<project>`) — two tasks that rewrite memories must never run concurrently against a stale view of each other's merges.

### REQ-2.2 Verification task (verify)

- Code-fact memories (not PROJECT_RULES, not notes) that name files are checked against evidence the host collects: file text (or the lines around the memory's identifiers, flagged partial) and, for a memory checked before, the git diff since the checked commit. A model given only paths cannot verify anything and passes everything.
- Evidence is an allowlist: files tracked by git in the project repository whose real path stays inside it, at most 512 KB, not binary, not secret-looking. Home-directory files are never evidence (credentials live there). Non-git projects are not verified.
- Verdicts are advisory: verified / stale / update / skip. An archive verdict is recorded as stale, because excerpts cannot prove absence. An update's new text stays unverified until a later check. A skip, or a row the manifest omits, lapses a verified mark to unverified. Outcomes are stored on the row (`verification_status`, `verified_at` = last check, `verified_commit`); the baseline marks verified and stale rows.
- A checked memory (any outcome, including skip) is re-checked only when its files changed after the checked commit, the diff cannot be computed, or the check is older than 30 days. Never-checked rows go first.
- PROJECT_RULES are excluded: a file cannot falsify a process rule, and a verified mark would lend it unearned authority.

### REQ-2.3 Curation task (curate)

- One category per run, rotating across the five categories. Notes are out of scope.
- Actions: merge near-duplicates, rewrite dated narrative into present-tense facts, move pending items to notes (`op: note`), archive superseded entries.
- Host safety gates (magic-context `curate-memory-safety`): an archive must name an active same-category survivor that the run does not also archive; a rewrite that removes more than half the text must name one too; a demotion to note is a soft archive and is refused for importance ≥ 80 or text without an open-item marker (a date alone does not qualify: correction-learned rules carry dates); a survivor may not itself be archived or demoted in the same run. Refusals are counted in the run record.
- NOOP is the default outcome — most memories need nothing (the mem0 lesson: a no-op decision is the memory store's defense against bloat).

### REQ-2.4 Failure model

- A failing task is hot-retried on subsequent ticks up to 3 times, then waits for its next scheduled slot.
- `last_run_at` stamps only successful runs.
- LLM manifest parsing is fail-closed: an unparseable reply is a failure, never a partial application.

### REQ-2.5 Isolation

- Maintenance runs as plain LLM calls (`ctx.llm.stream`, purpose-tagged) — no child sessions.
- Results land only in the plugin's own SQLite store, never on a live session's surface.
- A background run must never touch the cached prefix of a live session.

## Acceptance criteria

- Change the code a memory describes; within the following days the dreamer marks it updated or archived.
- Two maintenance tasks for one project never interleave (lease).
- A malformed LLM reply produces no store mutation and a recorded failure.
- With no dreamer model configured, nothing runs and no error spams the log.
