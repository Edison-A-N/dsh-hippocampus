# dsh-hippocampus

[English](README.md) | [中文](README.zh.md)

A project-memory + background context-management plugin for the [DSH](https://github.com/deepseek-ai/deepseek-harness) (DeepSeek Harness) — an event-sourcing-native take on the ideas behind [magic-context](https://github.com/cortexkit/magic-context) (OpenCode's infinite-context + self-managing memory plugin). It is an independent reimplementation; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for what it adapts and from where.

The hippocampus handles memory while you think: project knowledge survives across sessions — automatically injected, retrieved, and curated in the background — and context compaction summarizes off the hot path so step boundaries never wait on a model call.

**How it maps to magic-context's four subsystems:**

| magic-context subsystem | dsh-hippocampus |
|---|---|
| Memory (five-category project memory) | `ctx_memory` / `ctx_search` tools over a per-project store; baseline injection once per session |
| Recall (unified hybrid search) | FTS5 bigram full-text + semantic vectors, reciprocal rank fusion |
| Curation (dreamer) | 15-minute background tick: verify memories against the codebase, curate categories |
| Context management (historian) | Background compartment summaries with decay-tier rendering, committed on cache-cold moments through the `CompactionEngine` contract |

The key architectural translation: DSH has no per-request message-rewrite hook (its requests are pure functions of the event log — replayability by contract), so magic-context's per-pass re-rendering becomes append-only events and fold-on-replace. See [ADR-3](docs/adr/ADR-3-event-sourcing-contract.md).

**Documentation:** [requirements](docs/req/) · [architecture decisions](docs/adr/) · [design notes & prior art](docs/tech/)

## Install

```bash
dsh plugin --profile web add github:Edison-A-N/dsh-hippocampus
```

The package ships its own bundle patch (`dsh.bundle.patch` + `cordis.patch.yml`): it disables the profile's host-level `compaction-basic` row (hippocampus registers the `compaction` service, and cordis refuses a second provider of the same name) and inserts the `hippocampus` row. Restart DSH and reload the page. Memory tools and background compaction work with no configuration; semantic search and background curation need the variables under [Configuration](#configuration-env-vars-all-optional).

To include past sessions in `ctx_search` results and to use `ctx_expand`, also enable DSH's session index in the profile's own `cordis.patch.yml` (the stock profile ships it with `openAt: never`):

```yaml
- id: session-query-sqlite
  config:
    path: !!js dshHomePath('storages', 'session-query', 'index.db')
    openAt: first-search
```

Without it, `ctx_search` returns memories only and reports `"sessionSearch": "disabled"`.

To remove the plugin, run `dsh plugin --profile web remove dsh-hippocampus`. The store under `$DSH_HOME/storages/hippocampus/` is left in place; delete that directory to drop the memories.

## Feature Overview

### Memory Layer

- **`ctx_memory`**: read/write the current project's long-term memory (ids from another project's pool read as not found). Five categories (PROJECT_RULES / ARCHITECTURE / CONSTRAINTS / CONFIG_VALUES / NAMING), exact dedup within a category (a duplicate write counts as a re-observation), soft-delete archiving with an optional `superseded_by` survivor. write / get / list / update / archive. The tool description carries one admission test per category (magic-context's historian rubric) and rules out status, progress, backlog, commit hashes and moving versions.
- **`ctx_note`**: working notes (pending intentions, point-in-time findings). Stored with `source_type = note`, found by `ctx_search`, never injected into the baseline. A `ctx_memory write` of a note's exact text promotes it to a memory.
- **`ctx_search`**: hybrid retrieval — FTS5 full-text (Chinese, Japanese and Korean text indexed as bigrams so two-character words match; words of other scripts and identifiers stay whole; FTS5 operators escaped) fused with semantic vectors (OpenAI-compatible embeddings endpoint) via reciprocal rank fusion. Degrades to FTS5-only when no API key is set.
- **Baseline injection**: on the first step of every session, the project's active memories (notes excluded) render into one `<project-memory>` user message inserted behind the last claimed message. Rows are selected across all categories by importance, then most recent reinforcement (re-observation or verification), until a 4000-character budget is spent; the selection is then laid out by category. Importance is not rendered; verified rows carry `verified`, stale rows `possibly stale` and rank below all others; the header frames the block as records to check, not instructions, and tags inside memory text are escaped so a memory cannot close the block. The injected text is in English and does not set the session's language. Injected once (dedup by source kind, survives resume); no injection when there are no memories. Cache-friendly: it never changes once inside the prefix.
- **Embedding pipeline**: async best-effort embedding on write; anything it misses is picked up by a background drain every 5 minutes.

### Background Curation (dreamer-lite)

A 15-minute tick runs two tasks per project, serialized by a `memory:<project>` lease:

- **verify**: check code-fact memories (PROJECT_RULES and notes excluded) against evidence from the git-tracked files they name: file text (or the lines around the memory's identifiers, marked partial) and, for a memory checked before, the git diff since the checked commit. Only files tracked in the project repository whose real path stays inside it are read; home-directory files, files over 512 KB, binaries and secret-looking paths never leave the machine. Verdicts are advisory: verified / stale (an archive verdict also lands as stale) / update (the new text stays unverified until a later check) / skip (a verified mark lapses to unverified), stored on the row (`verification_status`, `verified_at` = last check, `verified_commit`). A checked memory is re-checked only when its files changed, the diff cannot be computed, or after 30 days. Up to 12 memories and 40 000 evidence characters per run.
- **curate**: rotating single-category cleanup: merge duplicates, rewrite dated narrative into present-tense facts, move dated or pending items to notes (refused for importance ≥ 80 or text without an open-item marker such as 待办/backlog/pending; a date alone does not qualify). An archive must name an active same-category survivor, and a rewrite that drops more than half the text must name one too; the host refuses anything else.

LLM calls go through `ctx.llm.stream` (provider/model configured via env vars); results land only in the plugin's own SQLite and never touch a live session's surface.

### Background Context Management

A `CompactionEngine` backend registered as `ctx.compaction` (the bundle patch disables the profile's host-level `compaction-basic` row, because cordis throws on duplicate service names). It follows magic-context's historian ([ADR-9](docs/adr/ADR-9-compartment-compaction.md)) and makes **zero model calls at the step boundary**:

- **Summarize early, in small pieces.** A background historian call fires as soon as the unsummarized span outside the protected tail reaches 3 × trigger budget (trigger budget = 5% of usable context, clamped to 5K–50K; usable = window × 65%), at any pressure. Each call reads at most one compact transcript chunk (tool calls as `TC:` lines, tool results as short heads, reasoning dropped) and stores *compartments*: one per work unit, each with four self-contained summary tiers and an importance score. The surface is not touched.
- **Commit when the cache is dead anyway.** Pending compartments land in one surface replace when the provider cache is cold (no model response for longer than `HIPPOCAMPUS_CACHE_TTL`, or a route that never reports cache use), or when pressure reaches the execute threshold (65%, `HIPPOCAMPUS_BACKGROUND_TRIGGER`). The replace folds the previous checkpoint and the newly summarized raw span into one new checkpoint: `compaction/start → summary → user/message replace → end`, local log appends only.
- **Decay rendering.** The checkpoint renders all compartments inside a history budget (15% of usable context, `HIPPOCAMPUS_HISTORY_BUDGET`). Each compartment's tier comes from magic-context's decay curve (half-life ∝ 2^((importance−50)/25) / budget pressure): recent and important work stays in full, old routine work fades to one line or is archived. Headings carry the original event seq range, so `ctx_expand` recovers the raw text.
- **Protected tail** (magic-context formula): 30% × usable × (1 − pressure), clamped to [min(12K, 8% usable), min(96K, 40% usable)]; tool arcs are never split.
- **One token unit.** Pressure and every size above are provider tokens against the input capacity (window − the request's maxTokens, at most 25% of the window). Node prices come from the token meter's chars/4 heuristic and are scaled by the session's measured ratio at the last provider usage (usage ÷ that request's heuristic price), which can run 1.7–2.4× on routes with Chinese or JSON-heavy output. A sub-agent's task prompt (its first genuine user message, with any harness notice before it) is never compacted; a forked sub-agent is not covered.
- **Blocking paths**: provider overflow, ≥ 95% pressure with nothing pending, and manual `/compact` summarize inline in bounded chunks and commit at once. If the historian cannot produce compartments, the engine falls back to the single-checkpoint summary (ADR-7), so recovery always works.
- Historian failures back off (30s doubling, max 15 min) instead of retrying every step. `HIPPOCAMPUS_COMPACTION=checkpoint` switches back to the single-checkpoint engine.
- **Tool-output reclaim** ([ADR-10](docs/adr/ADR-10-tool-output-reclaim.md)). Stale tool results on the unsummarized surface are replaced with a placeholder (first and last lines of the output + a `ctx_expand` pointer to the original seq), without a model call: a result is stale once 3 genuine user messages follow it or the newer content reaches 25% of usable context; an older `read`/`grep`/`glob`/`web_fetch`… result whose identical call appears later is a duplicate. The newest protected window (5% of usable, clamped to [min(16K, 8%), 64K]), results under 250 tokens, non-text results, `skill` results and the newest `todo_write` stay. Tool-call arguments are never touched. Reclaim assumes a prompt cache and never busts a warm one on its own: it rides a compartment commit or a blocking fold, and runs alone only when the cache is already lost (the step switches model, or no model response for `HIPPOCAMPUS_RECLAIM_IDLE`, the cache TTL by default) or at the force band (≥ 85%) when the batch frees at least 2% of usable context. Each replacement is a `compaction/prune` shadow price followed by a `tool/result` replace citing the original, so the token meter subtracts it and the log keeps the full text.

### Web Panels

Two conversation view tabs (beside Chat and Trajectory), served by the plugin's JSON API (`/plugins/hippocampus/api/*`). Every route passes the host's Host/Origin check and the Web login cookie; the three write routes (edit, archive, run curation now) also require a JSON body. The API is registered only in the Web profile.

**Memories** — the project's memory pool for the session you have open. A sticky overview card shows count tiles per category (click a tile to filter), archived and pending-embedding counts, full-text search (content, category, `m<id>`) with match highlighting, and newest/importance sorting. Each memory card carries its category color and an importance bar; long memories clamp to four lines with an expand toggle. Hover a card to edit it (content + importance slider) or archive it (two-click confirm). Project-scoped: the panel resolves the session's workspace through the same identity chain `ctx_memory` uses, so switching sessions switches the pool.

**Compaction & curation** — what hippocampus does to the open session's context. Context occupancy and composition are left to the host token views (and plugins such as dsh-context), so this tab does not repeat them:

- **Cache hits** — KPI tiles (model calls and input-weighted cache hit rate over the calls the chart draws; whole-session busts and prefix replacements, the latter counted from the log's `compaction/summary` events; the project's recent curation runs) and one stacked bar per model call (cache read / cache write / uncached, height = input size); a red dot marks a bust (a compaction replaced the prefix before that call).
- **Compactions** — summarization call records (mode, model, shadowed span, usage, duration, expandable summary text), plus the raw compaction event timeline from the append-only log.
- **Background curation** — dreamer run records (task, status, what changed) with a failed-only filter and manual Verify/Curate-now triggers.

The panels use the host theme variables, so light and dark themes follow DSH.

## Configuration (env vars, all optional)

| Variable | Purpose | Default |
|---|---|---|
| `HIPPOCAMPUS_EMBEDDING_API_KEY` | API key for semantic search; absent → FTS5-only | none |
| `HIPPOCAMPUS_EMBEDDING_BASE_URL` | OpenAI-compatible embeddings base URL | `https://api.openai.com/v1` |
| `HIPPOCAMPUS_EMBEDDING_MODEL` | embedding model id | `text-embedding-3-small` |
| `HIPPOCAMPUS_DREAMER_PROVIDER` / `_MODEL` | LLM provider/model for background verify/curate; the dreamer registers only when both are set (either missing → not registered at all: no interval, no LLM calls) | none |
| `HIPPOCAMPUS_DREAMER_MAX_TOKENS` | maxTokens per dreamer call | 4000 |
| `HIPPOCAMPUS_COMPACTION` | `checkpoint` switches to the single-checkpoint engine (ADR-7) | compartments |
| `HIPPOCAMPUS_BACKGROUND_TRIGGER` | execute threshold: usable-context ratio and the pressure that commits pending compartments | 0.65 |
| `HIPPOCAMPUS_CACHE_TTL` | provider cache TTL; idle longer than this commits pending compartments (`30s`, `5m`, `1h`, `never`) | 5m |
| `HIPPOCAMPUS_RECLAIM_IDLE` | idle time after which stale tool output is reclaimed without riding a commit (never below `HIPPOCAMPUS_CACHE_TTL`; for a route with a 1-hour cache set `HIPPOCAMPUS_CACHE_TTL=1h` instead) | `HIPPOCAMPUS_CACHE_TTL` |
| `HIPPOCAMPUS_HISTORY_BUDGET` | share of usable context for the rendered history | 0.15 |
| `HIPPOCAMPUS_HISTORIAN_PROVIDER` / `_MODEL` | model for historian calls; unset → the session's own model | none |
| `HIPPOCAMPUS_FORCE_COMMIT` / `HIPPOCAMPUS_RESUMMARIZE_GROWTH` | single-checkpoint engine only: force-commit ratio / re-summarize growth | 0.8 / 0.1 |

Storage location follows `DSH_HOME` (default `~/.dsh`): `$DSH_HOME/storages/hippocampus/memory.db`.

## Storage & Identity

- SQLite (WAL + busy_timeout, multi-process safe): `$DSH_HOME/storages/hippocampus/memory.db`. The directory is created `0700` and the database files are set to `0600` on open.
- Project identity: git root-commit sha (`git rev-list --max-parents=0 HEAD`) — all worktrees of one repository share a memory pool; non-git directories use a path hash; git failures get a 60-second cooldown. Two repositories with the same root commit (a fork, or a copy that kept its history) share one pool.

## Data and privacy

What is stored, all in the one database above:

- memories and notes (the text agents write through `ctx_memory` / `ctx_note`), with their embedding vectors when semantic search is on;
- compartment summaries and compaction run records for each session (summaries of user and assistant messages and tool activity);
- dreamer run records (what each verify/curate run changed).

Nothing is deleted on a schedule: archived memories, summaries and run records stay until you delete the database. Memories are plain text; do not ask an agent to remember secrets.

What leaves the machine, and only through routes you configure:

- **Historian and compaction calls** send transcript chunks of the session to the session's own model, or to `HIPPOCAMPUS_HISTORIAN_PROVIDER` / `_MODEL` when set.
- **Dreamer calls** (only when `HIPPOCAMPUS_DREAMER_PROVIDER` and `_MODEL` are set) send memory text plus excerpts of git-tracked project files and diffs, under the file guards described in [Background Curation](#background-curation-dreamer-lite).
- **Embedding calls** (only when `HIPPOCAMPUS_EMBEDDING_API_KEY` is set) send memory text and search queries to `HIPPOCAMPUS_EMBEDDING_BASE_URL`.

The Web panels are not isolated between projects: DSH is single-user, and a logged-in browser can browse and edit every project's pool.

## Requirements

- **DSH host** ([DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)) 0.2.2-rc.3 or later in the 0.2 line (`engines.dsh`): services like `ctx.llm` / `ctx.tools` come from the host; the plugin cannot run standalone
- Node.js >= 22.19 (`node:sqlite` needs a recent runtime)

## Manual composition

The bundle patch is the supported path. To compose the rows yourself instead (for example in a profile that lists the package as a plain dependency), add the same two patches the bundle ships:

```yaml
# cordis.patch.yml
- id: compaction-basic
  disabled: true
- insert:
    - id: hippocampus
      name: 'dsh-hippocampus'
```

## Development

```sh
npm install
npm run build:client   # bundles client/src into lib/client.js
npm test               # unit tests; set DSH_HOST_NODE_MODULES=<dsh install>/node_modules/.pnpm/node_modules to also run the host-contract tests against the real token meter
```

`lib/client.js` is committed because DSH loads it as-is; rebuild it in the same change as any edit under `client/src`. See [CONTRIBUTING.md](CONTRIBUTING.md).

Zero npm runtime dependencies: storage uses the built-in `node:sqlite`; `@deepseek-ai/dsh-tools` / `dsh-llm` / `dsh-compaction` are provided by the DSH host at plugin runtime (bare-import failures fall back to a repo-root resolution chain), so a standalone `npm test` needs none of them installed.

## Known Limitations

- Resolution of `@deepseek-ai/dsh-tools` / `dsh-llm` / `dsh-compaction` relies on the bare-name → repo-root fallback chain (pnpm link dependency isolation: bare names don't resolve from the plugin directory).
- The baseline injection is a one-shot snapshot at session start: memories written mid-session enter the baseline in the next session.
- After a background summary lands, the commit waits for the next pre-step over the force threshold (usually the next step); a session that ends before landing discards that summary (the next session re-triggers).
- Not yet implemented (deferred, see [ADR-8](docs/adr/ADR-8-deferred-compartments.md) and [ADR-10](docs/adr/ADR-10-tool-output-reclaim.md)): historian capture (extracting memories while compacting), agent-driven `ctx_reduce`, reasoning clearing. Superseded-edit compression is out of scope (ADR-10: it rewrites tool-call arguments, which DSH cannot replace).

## License

[MIT](LICENSE). Portions are adapted from MIT-licensed projects; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
