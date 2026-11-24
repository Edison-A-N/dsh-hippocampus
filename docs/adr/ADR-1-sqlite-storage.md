# ADR-1: One SQLite store, WAL mode, no ORM, no npm dependencies

## Status

Accepted

## Context

The plugin needs durable, multi-process-safe storage for memories (and, later, background-run state). DSH hosts multiple processes over one `DSH_HOME`; two sessions on the same repo can write memories simultaneously. We also wanted a standalone `npm test` with zero install friction.

Options considered:

1. **Host storage domain (`dsh-storage-domain`)** — the DSH-native KV facility. Wrong shape: we need relational queries + full-text search, not zod-validated KV.
2. **A vector/embedding database** — overkill at project-memory scale (thousands of rows), adds a heavyweight dependency.
3. **Node's built-in `node:sqlite`** — no dependency, WAL + busy_timeout handles multi-process concurrency, FTS5 comes built in.

## Decision

One SQLite database per `DSH_HOME` at `$DSH_HOME/storages/hippocampus/memory.db`, opened with WAL and busy_timeout. No ORM, no npm runtime dependencies at all. Vectors live in the same database as BLOBs and are compared in memory (ADR-6).

## Consequences

- **Good**: zero-dependency install; a fresh clone runs `npm test` with nothing but Node ≥ 22.19. FTS5 + tables + leases all in one file, trivially inspectable.
- **Good**: WAL gives readers/writers concurrency across processes; busy_timeout absorbs lock contention.
- **Cost**: `node:sqlite` is still flagged experimental by Node — a Node upgrade could change behavior (pinned by the engines field).
- **Cost**: SQLite parameters must be spread (not array-wrapped) — a footgun when coming from other SQLite bindings; unit tests pin the correct usage.
