# Industry Prior Art: Agent Memory & Context Management

> Survey of designs that informed this plugin, distilled to what mattered for the decisions here (each ADR links back where relevant). Sources are public documentation, papers, and repos.

## Letta (MemGPT): layered memory + sleep-time agents

- Context window modeled as a memory hierarchy: system prompt with labeled memory blocks (char-capped), tool schemas, message buffer. Recall/archival memory lives outside the window, paged in via tools.
- Sleep-time compute: a second agent shares the memory blocks and rewrites/organizes them in the background while the main agent just talks. Frequency-vs-cost is explicit.
- **Lesson taken**: never make the main agent maintain its own memory mid-conversation (MemGPT's original design was abandoned for being slow and unreliable). The dreamer (REQ-2) is this pattern's minimal form.
- Their Context Constitution writes cache discipline into spec: high-churn blocks go at the tail; evict stale content; dedupe across blocks (cf. ADR-5).

## mem0: extraction-update pipeline

- Two-stage: LLM extracts candidate facts, then for each fact a vector-retrieval step finds near-memories and an LLM decides ADD / UPDATE / DELETE / NOOP.
- **Lesson taken**: the NOOP option is the memory store's defense against bloat — most candidates should do nothing. Curate defaults to NOOP (REQ-2.3).
- **Lesson taken**: "retrieve similar memories before deciding to write" is not optional — without it, the same fact gets re-ADDed forever. Our write path enforces exact dedup by normalized hash.

## Zep (Graphiti): temporal knowledge graphs

- Bi-temporal fact edges (valid_from/valid_to/observed/recorded), semantic invalidation instead of deletion, episode↔entity back-links.
- **Lesson taken**: memory rows should carry timestamps + a source pointer + invalidate-not-delete semantics — a flat SQLite row buys the core time-awareness at 1% of a graph database's cost (ADR-1). Full graph memory (entity disambiguation, Neo4j hosting) is overkill for one project's harness.

## Commercial coding agents

- **Claude Code**: three-tier escalation — tool-result trimming (zero LLM cost) → tail-only surgical edits (cache-friendly) → structured LLM summary. The summary prompt uses fixed sections and demands *direct quotes* from the original (anti-drift); post-compaction it re-reads recently edited files. Memory is a human-readable Markdown file set with background dreaming.
- **Codex CLI**: single handoff-memo summary; user messages preserved verbatim, only assistant/tool content compressed.
- **OpenCode**: prune-before-summarize; pruning is timestamp-marked hiding, never physical deletion; ~15k keep-tokens of recent originals ride beside the summary.
- **Lesson taken**: the 8-section checkpoint template with quote-based summaries is battle-tested — our compaction (ADR-7) reuses DSH's own version of it from `@deepseek-ai/dsh-compaction-basic` (see THIRD_PARTY_NOTICES.md) instead of inventing a prompt. Keep a protected tail of recent original text; never physically delete.

## Cache-aware context engineering

- Providers cache by exact prefix match (Anthropic explicit breakpoints; OpenAI automatic ≥1024-token prefixes). Any byte change invalidates everything after it.
- **Lesson taken**: stable layout in the head, volatile data in the tail; appends are cheap, edits and head changes are not. This is the backbone of ADR-3 (event-stream translation) and ADR-5 (one-shot baseline).

## Local embedding options (for the record)

- transformers.js + ONNX (all-MiniLM: English-strong/Chinese-weak; multilingual: heavy; quantized q4f16: buggy on Node's onnxruntime) — the zero-API-cost option magic-context defaults to.
- fastembed-js (archived upstream, moved to qdrant-labs), bge-base-zh for Chinese.
- **Decision here**: API-based OpenAI-compatible embeddings instead of local ONNX — ADR-6 lays out the trade (no runtime dependency, no model download, provider-agnostic; costs an external round-trip and makes the semantic lane optional rather than free).

## The ten design rules this survey converged on

1. All mutations are appended events; never physically delete (invalidate/supersede instead).
2. Memory rows carry timestamps + source ids + soft-delete.
3. Write pipelines decide ADD/UPDATE/NOOP with NOOP as the expected default.
4. Escalate by cost: placeholder → prune → LLM summary; keep recent originals beside summaries.
5. Summary prompts: fixed sections, demand verbatim quotes.
6. Cache-stable layout is a hard constraint, not an optimization.
7. The main agent doesn't manage memory; background maintainers do, idempotently, producing new versions.
8. Every memory block has an owner and a budget.
9. Retrieval is dual-lane (lexical + semantic) fused by rank, all local-scale.
10. Primary storage is human-readable; indexes are derivable and rebuildable.
