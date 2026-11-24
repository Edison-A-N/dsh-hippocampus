import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { vectorToBlob, blobToVector, cosineSimilarity, EmbeddingClient } from '../lib/embedding.js'

const makeStore = () => new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-emb-')), 'm.db'))

test('vector blob round-trip preserves values', () => {
  const v = Float64Array.from([0.1, -0.2, 0.3, 0.9])
  const blob = vectorToBlob(v)
  const back = blobToVector(blob)
  assert.equal(back.length, 4)
  assert.ok(Math.abs(back[0] - 0.1) < 1e-6)
})

test('cosine similarity: identical 1, orthogonal 0, scaled invariant', () => {
  const a = Float64Array.from([1, 0, 0])
  const b = Float64Array.from([0, 1, 0])
  const c = Float64Array.from([2, 0, 0])
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9)
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-9)
  assert.ok(Math.abs(cosineSimilarity(a, c) - 1) < 1e-9)
  assert.equal(cosineSimilarity(a, new Float64Array(0)), 0)
})

test('store embedding lifecycle: save, pending, semantic search', () => {
  const store = makeStore()
  const row1 = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'compress history into tiered summaries' })
  const row2 = store.write({ projectId: 'p1', category: 'CONFIG_VALUES', content: 'the service port is 3080' })
  assert.equal(store.pendingEmbeddings('p1').length, 2)
  // orthogonal-ish vectors: row1 along axis 0, row2 along axis 1
  store.saveEmbedding(row1.id, Float64Array.from([1, 0]))
  store.saveEmbedding(row2.id, Float64Array.from([0, 1]))
  assert.equal(store.pendingEmbeddings('p1').length, 0)
  const hits = store.semanticSearch({ projectId: 'p1', queryVector: Float64Array.from([0.9, 0.1]), limit: 2 })
  assert.equal(hits[0].row.id, row1.id)
  assert.ok(hits[0].similarity > hits[1].similarity)
  const otherProject = store.semanticSearch({ projectId: 'p2', queryVector: Float64Array.from([1, 0]) })
  assert.equal(otherProject.length, 0)
})

test('update clears stale embedding', () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'NAMING', content: 'naming A' })
  store.saveEmbedding(row.id, Float64Array.from([1, 0]))
  store.update(row.id, { content: 'naming B' })
  assert.equal(store.pendingEmbeddings('p1').length, 1)
})

test('archive mid-flight: saveEmbedding is a no-op for archived rows', () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'NAMING', content: 'naming C' })
  store.archive(row.id)
  store.saveEmbedding(row.id, Float64Array.from([1, 0]))
  assert.equal(store.pendingEmbeddings('p1').length, 0)
  assert.equal(store.semanticSearch({ projectId: 'p1', queryVector: Float64Array.from([1, 0]) }).length, 0)
})

test('embedding client unavailable without key; batch guard', async () => {
  const client = new EmbeddingClient('')
  assert.equal(client.available, false)
  assert.equal(await client.embed(['x']), null)
  const keyed = new EmbeddingClient('k')
  await assert.rejects(() => keyed.embed(Array.from({ length: 11 }, (_, i) => `t${i}`)), /batch limit/)
})
