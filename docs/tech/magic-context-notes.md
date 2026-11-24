# magic-context Mechanism Notes

> Design notes distilled from an implementation-level analysis of magic-context (OpenCode's infinite-context + self-managing memory plugin). These are the mechanisms this plugin borrowed, translated, or consciously deferred — kept here so deferrals stay cheap to reverse.

## The transform pass (core loop)

One pass = "read usage → schedule decision → overflow recovery → trigger historian → prepare m[0]/m[1] → tag & replay strips → inject → post-process mutation gate". Passes classify into three levels:

- **SOFT+** (defer): byte-exact replay, nothing changes.
- **SOFT**: re-render m[1] (the incremental message) only.
- **HARD** fold: rebuild m[0] (the frozen baseline) — the only moment re-tiering happens.

m[0] carries the stable head (project docs, user profile, decay-rendered compartment history, project memory); m[1] carries increments (new memories via a high-water mark, update/archive/merge via a mutation log, new compartments in full text). The discipline: **background work never busts m[0]** — new compartments, new memories, doc hashes ride m[1] and fold in at the next natural HARD.

## Compartments (tiered history compression)

The historian cuts raw history into compartments ("work units" by goal switch, not activity type), each stored with four summary tiers (p1–p4, self-contained per tier) plus an importance score where **importance is a decay rate, not a quality score** ("how accurately will you need to recall this in 3 months?"). Rendering is a pure function: H = H₅₀·2^((imp−50)/D)/pressure; z = age/H picks the tier (boundaries are the log-geometric means of measured tier costs, not invented). Because H ∝ 1/pressure, tier selection self-adjusts to budget with zero model calls. Re-tier only at HARD folds.

## Cache discipline (the load-bearing wall)

- Every byte mutation must ride a bust that was going to happen anyway ("ride signals"): a single per-pass bust permit that all mutation lanes must consult. Their 2026-09-07 incident — an age sweep bypassing the historian veto turned one threshold crossing into two billed busts — is the canonical cautionary tale.
- Placeholders are pure functions of ids, never re-derived from (mutable) content: `[dropped §N§]`.
- Strips (reasoning removal, image strip, placeholder neutralization) select ids once at the bust pass and then **replay the frozen set** exactly (frozen-id replay).
- Protected-tail boundaries never split a tool call/result arc; the tail is measured in real tokens (text + tool IO), not turns.

## Memory system

Project-scoped fact rows, five categories (PROJECT_RULES / ARCHITECTURE / CONSTRAINTS / CONFIG_VALUES / NAMING), `UNIQUE(project, category, normalized_hash)` exact dedup, soft-archive with supersession links. The historian promotes extracted facts into memories inside its publish transaction (capture); the dreamer maintains them in the background; the agent's in-session writes reach the prompt via the m[1] mutation log — never by busting m[0].

## Dreamer (background maintenance)

A process-wide 15-minute timer reconciles per-project task schedules and runs due tasks as hidden sub-sessions, serialized per lease domain: `verify` (re-check memories against the repo), `curate` (dedupe/tighten/archive, NOOP default), plus classify/retrospective/docs-proposal tasks. Failures hot-retry 3 times, then wait for the cron slot. Background writes never proactively bust the cache.

## Recall

`ctx_search` queries five sources (memories, raw messages, git commits, compartment chunks, notes) with BM25 (FTS5) + in-memory vector cosine fused; local MiniLM embeddings by default; an auto-search hint (~200 tokens, hooks not answers) may ride a new user message. `ctx_expand` restores dropped originals — nothing is ever physically deleted.

## Host requirements (what made DSH translation necessary)

magic-context needs eight host capabilities, the critical ones being: a per-call message-array transform hook, hidden sub-sessions with model/permission/step caps, a turn-refusal (fail-closed) channel, and native-compaction interop. DSH's event-sourcing contract ("a request is a pure function of the event log") rules out the transform hook by design — see [ADR-3](../adr/ADR-3-event-sourcing-contract.md) for the translation table.

## What this plugin borrowed directly

- Project identity via git root-commit sha (ADR-2).
- Five-category memory schema with normalized-hash dedup and soft archive.
- FTS5 + in-memory cosine + RRF fusion (ADR-4), vectors as SQLite BLOBs.
- Dreamer-lite: 15-min tick, `memory:<project>` lease, verify/curate with fail-closed manifests (REQ-2).
- Background-summarize / local-commit compaction split (ADR-7).
- The "background writes never touch the live surface" rule everywhere.

## What was consciously deferred

Compartments + decay rendering, historian capture, ctx_expand/ctx_note — see [ADR-8](../adr/ADR-8-deferred-compartments.md).
