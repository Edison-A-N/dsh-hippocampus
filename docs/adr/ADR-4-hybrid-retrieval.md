# ADR-4: Hybrid retrieval — FTS5 bigram full-text fused with in-memory cosine vectors

## Status

Accepted

## Context

`ctx_search` must recall memories by exact identifier, by Chinese two-character word, and by meaning. Candidate architectures (analysis in [tech/prior-art.md](../tech/prior-art.md)):

1. **Vector-only** — misses exact identifiers (file names, error codes) that embeddings blur; requires an embedding round-trip on every query.
2. **FTS5-only** — the default SQLite tokenizer (unicode61) is useless for CJK: Chinese text collapses into unsearchable blobs.
3. **External search stack** (BM25 service + vector DB) — operational weight disproportionate to thousands of rows.
4. **Dual-lane + fusion** — magic-context's design, and the industry consensus.

## Decision

Dual-lane retrieval with reciprocal rank fusion (RRF, k=60):

- **Full-text lane**: FTS5 with a pre-tokenized column. The tokenizer emits overlapping 2-gram bigrams for runs of Han, Hiragana, Katakana and Hangul (so 压缩 matches 把会话历史压缩) and keeps words of other scripts whole (letters, digits and marks of any script, plus `_.:/-`) (so `dsh-compaction` matches as one token). Query tokens are individually quoted so FTS5 operators (`-` = NOT, quotes) can't inject. Recall-oriented: tokens OR'ed.
- **Semantic lane** (optional, see ADR-6): query embedded once, cosine similarity against stored vectors, top-k.
- **Fusion**: RRF over the two ranked id lists — no score calibration needed across lanes with incomparable units.

## Consequences

- **Good**: CJK search works out of the box with a 30-line pure-JS tokenizer — no jieba, no SQLite extensions.
- **Good**: the two lanes fail independently: no embedding key → FTS5 still serves; no FTS hits → semantic still serves.
- **Cost**: bigram indexes inflate the FTS table and can surface false-positive bigram matches; acceptable at this scale, and ranking pushes them down.
- **Tokenizer changes rebuild the index.** The store records a format version in `PRAGMA user_version`; a version bump rebuilds every active row's FTS tokens once on open (the first bump moved from Han + ASCII-only to the script-based tokenizer above).
- **Cost**: RRF ignores raw scores (only ranks) — deliberate: fusing BM25 scores with cosine similarities directly is meaningless.
