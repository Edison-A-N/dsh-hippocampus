# REQ-4: Semantic Recall (embedding pipeline)

## Status

Accepted (implemented)

## Background

FTS5 full-text retrieval only finds lexical overlap. Real recall questions are semantic: "how do we handle retries" should find a memory that never uses those words, and an English query should find a Chinese memory. magic-context fuses BM25 with vector similarity; the industry consensus (see [tech/prior-art.md](../tech/prior-art.md)) is that dual-lane retrieval beats either lane alone for coding memories.

## Requirements

### REQ-4.1 Embedding on write

- New memories are embedded asynchronously, best-effort: the write result is never blocked by the embedding call.
- An embedding failure leaves the row pending, not broken.

### REQ-4.2 Background drain

- A background pass (every 5 minutes) embeds pending rows — anything write-time embedding missed (endpoint hiccup, rows from before this feature existed).
- Idempotent per row; archived rows are never embedded.

### REQ-4.3 Storage and comparison

- Vectors are stored as SQLite BLOBs and compared in memory (Float32 cosine similarity) — the magic-context pattern, appropriate at project-memory scale (thousands of rows). No vector-database dependency.

### REQ-4.4 Fusion

- `ctx_search` runs full-text and semantic lanes in parallel and fuses them with reciprocal rank fusion (k=60).
- Updating a memory's content clears its stale embedding (re-embedded on the next drain).

### REQ-4.5 Configurability and degradation

- Endpoint, model, and credentials are configurable via environment variables (OpenAI-compatible API).
- Without credentials, semantic search is silently unavailable; retrieval degrades to FTS5-only. Nothing else breaks.

## Acceptance criteria

- A semantic-only query (no lexical overlap with the target memory) retrieves it when embeddings are enabled.
- Batch limits of the embedding endpoint are respected (chunked, sequential).
- Disabling the API key never errors a write, a search, or the background drain.
