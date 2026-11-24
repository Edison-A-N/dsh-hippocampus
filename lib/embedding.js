/**
 * Embedding pipeline for dsh-hippocampus: an OpenAI-compatible embeddings
 * endpoint (default model `text-embedding-3-small`; any model the endpoint
 * serves works, vectors are compared only against vectors of the same length;
 * requests are chunked to a conservative 10 inputs each).
 *
 * Vectors live in the store as SQLite BLOBs and are compared in memory with
 * Float32Array cosine similarity — the magic-context pattern, appropriate at
 * project-memory scale (thousands of rows). The pipeline is fully optional:
 * when the API key is absent, ctx_search silently degrades to FTS5-only.
 * @module dsh-hippocampus/embedding
 */

/** Embedding model id (override via HIPPOCAMPUS_EMBEDDING_MODEL). */
export const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Default API base URL for the OpenAI-compatible embeddings endpoint
 * (override via HIPPOCAMPUS_EMBEDDING_BASE_URL; no trailing slash).
 */
export const EMBEDDING_BASE_URL = 'https://api.openai.com/v1'

/** Inputs per request: a conservative cap some compatible endpoints require. */
const BATCH_LIMIT = 10

/** Request timeout. */
const TIMEOUT_MS = 30_000

/**
 * Minimal client for an OpenAI-compatible embeddings endpoint
 * (`POST {baseUrl}/embeddings`). Resolved lazily from the launch environment's
 * embedding credentials (see {@link embeddingClientFrom}).
 */
export class EmbeddingClient {
  /**
   * @param {string} apiKey
   * @param {string} [baseUrl] - API base URL, e.g. `https://api.example.com/v1`.
   */
  constructor(apiKey, baseUrl = EMBEDDING_BASE_URL) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/u, '')
  }

  /** @returns {boolean} whether embedding is available (key present). */
  get available() {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0
  }

  /**
   * Embed up to BATCH_LIMIT inputs. Returns Float64Array-backed
   * vectors in input order, or null when unavailable.
   * @param {string[]} inputs
   * @returns {Promise<Float64Array[] | null>}
   */
  async embed(inputs) {
    if (!this.available || inputs.length === 0) return null
    if (inputs.length > BATCH_LIMIT) throw new Error(`batch limit is ${BATCH_LIMIT}; chunk the inputs`)
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model ?? EMBEDDING_MODEL, input: inputs }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`embedding request failed: HTTP ${response.status} ${body.slice(0, 200)}`)
    }
    const payload = await response.json()
    return payload.data
      .sort((a, b) => a.index - b.index)
      .map(entry => Float64Array.from(entry.embedding))
  }

  /**
   * Embed an arbitrary list, chunking to the batch limit. Callers embed
   * memory-sized lists, so sequential chunks are fine.
   * @param {string[]} inputs
   * @returns {Promise<Float64Array[] | null>}
   */
  async embedAll(inputs) {
    if (!this.available || inputs.length === 0) return null
    const vectors = []
    for (let i = 0; i < inputs.length; i += BATCH_LIMIT) {
      const chunk = await this.embed(inputs.slice(i, i + BATCH_LIMIT))
      if (chunk === null) return null
      vectors.push(...chunk)
    }
    return vectors
  }
}

/**
 * Resolve the client from a Cordis context.
 *
 * Credentials resolve exactly the way llm-pi-ai resolves provider keys: the
 * credentials service first (the web Models page writes values there), the
 * launch environment (process env) as fallback. Endpoint and model come from
 * the launch environment:
 * - key: `HIPPOCAMPUS_EMBEDDING_API_KEY` (absent → FTS5-only search)
 * - `HIPPOCAMPUS_EMBEDDING_BASE_URL` (optional; OpenAI-compatible base URL)
 * - `HIPPOCAMPUS_EMBEDDING_MODEL` (optional; model id)
 *
 * The key resolution is async, so this returns a promise of the client.
 */
export async function embeddingClientFrom(ctx) {
  const environment = ctx.get('launchEnvironment')
  const entry = name => environment?.get(name)?.value
  const resolveKey = async name => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(name)
        if (hit?.value !== undefined && hit.value.length > 0) return hit.value
      } catch {
        // fall through to the environment
      }
    }
    return entry(name)
  }
  const key = (await resolveKey('HIPPOCAMPUS_EMBEDDING_API_KEY')) ?? ''
  const client = new EmbeddingClient(
    key,
    entry('HIPPOCAMPUS_EMBEDDING_BASE_URL') ?? EMBEDDING_BASE_URL,
  )
  const model = entry('HIPPOCAMPUS_EMBEDDING_MODEL')
  if (typeof model === 'string' && model !== '') client.model = model
  return client
}

/** Serialize a vector for SQLite BLOB storage. */
export function vectorToBlob(vector) {
  const floats = new Float32Array(vector)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

/** Deserialize a SQLite BLOB back to a Float32Array (node:sqlite returns Uint8Array). */
export function blobToVector(blob) {
  if (!(blob instanceof Uint8Array) || blob.byteLength === 0) return null
  // copy into a standalone buffer: the source may be a view into pooled memory
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}

/** Cosine similarity between two vectors (returns 0 on size mismatch). */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}
