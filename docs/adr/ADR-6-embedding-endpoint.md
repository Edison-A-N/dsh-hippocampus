# ADR-6: Embedding via OpenAI-compatible API; no local ONNX runtime

## Status

Accepted

## Context

The semantic lane (ADR-4) needs an embedding model. Options:

1. **Local ONNX inference** (transformers.js + all-MiniLM / bge-base-zh) — zero API cost, but: English MiniLM is weak on Chinese; multilingual models are heavy; ONNX quantization has Node-specific bugs; the dependency tree (onnxruntime-node) is large and platform-sensitive.
2. **An OpenAI-compatible embeddings API** — a small client (one fetch call), works with any provider that speaks the `/embeddings` shape, including self-hosted gateways.
3. **Skip semantic search entirely** — the FTS5 lane alone misses meaning-based recall.

magic-context defaults to local MiniLM because it runs in environments without API access; our constraints differ.

## Decision

Option 2 — a minimal built-in client for the OpenAI-compatible `/embeddings` shape. Endpoint base URL, model id, and API key all come from environment variables (`HIPPOCAMPUS_EMBEDDING_*`); nothing is hardcoded to any specific provider. Default base URL is the public OpenAI endpoint; deployments point it at their own gateway. The client is ~40 lines: batch-limit chunking, timeout, null-on-unavailable.

Everything else about the pipeline is deliberately boring (REQ-4): write-time async best-effort embedding, a 5-minute background drain for stragglers, vectors as SQLite BLOBs, Float32 cosine in memory.

## Consequences

- **Good**: zero dependencies, no ONNX runtime, no model download, no quantization bugs.
- **Good**: provider-agnostic by construction — the same code serves OpenAI, self-hosted gateways, or anything speaking the same shape.
- **Good**: without a key the pipeline is silently inert; FTS5 keeps the plugin fully useful.
- **Cost**: recall quality depends on the configured model; cross-language quality varies by model and should be spot-checked for the one you configure.
- **Cost**: an external round-trip per embedding (batched, capped at 10 per request — the client chunks and sequences).
