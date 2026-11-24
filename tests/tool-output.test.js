import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { registerMemoryTool } from '../lib/index.js'

const makeStore = () => new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-tool-')), 'm.db'))

// Fake dsh-tools shape: capture the tool def, then run its execute with a
// minimal owning-agent exec (session header cwd drives identity resolution).
const harnessTool = (store) => {
  const registered = []
  const ctx = { tools: { register: def => registered.push(def) } }
  const defineTool = def => def
  registerMemoryTool(ctx, { defineTool }, { store, resolver: { resolve: () => ({ id: 'p1', root: '/r', kind: 'git' }) }, embeddings: undefined })
  assert.equal(registered.length, 1)
  const exec = { agent: { session: { id: 's1', header: { cwd: '/r' } } } }
  return { tool: registered[0], run: args => registered[0].execute(args, exec) }
}

test('get/list/update/archive results are lossless JSON: no embedding or embedded_at', async () => {
  const store = makeStore()
  const { tool, run } = harnessTool(store)
  assert.equal(tool.name, 'ctx_memory')

  const written = run({ action: 'write', category: 'PROJECT_RULES', content: '记忆内容甲', importance: 70 })
  assert.equal(written.result, 'written')
  // store a vector so the raw row definitely carries a BLOB
  store.saveEmbedding(written.memory.id, Float64Array.from([1, 0]))
  assert.ok(store.get(written.memory.id).embedding instanceof Uint8Array)

  for (const result of [
    run({ action: 'get', id: written.memory.id }),
    run({ action: 'list' }),
    run({ action: 'update', id: written.memory.id, importance: 80 }),
    run({ action: 'archive', id: written.memory.id, reason: 'obsolete' }),
  ]) {
    const json = JSON.stringify(result)
    assert.ok(json !== undefined, 'result must be JSON-serializable')
    assert.ok(!json.includes('embedding'), `embedding leaked: ${json}`)
    assert.ok(!json.includes('embedded_at'), `embedded_at leaked: ${json}`)
  }
})

test('projected memory carries the documented fields only', () => {
  const store = makeStore()
  const { run } = harnessTool(store)
  const written = run({ action: 'write', category: 'ARCHITECTURE', content: '记忆内容乙' })
  const got = run({ action: 'get', id: written.memory.id })
  assert.deepEqual(
    Object.keys(got.memory).sort(),
    ['archive_reason', 'category', 'content', 'created_at', 'id', 'importance', 'invalid_at', 'last_accessed', 'seen_count', 'source_session', 'source_type', 'status', 'superseded_by', 'verification_status', 'verified_at'],
  )
  const listed = run({ action: 'list', category: 'ARCHITECTURE' })
  assert.equal(listed.count, 1)
  assert.equal(listed.memories[0].id, written.memory.id)
})

test('not_found paths stay lossless JSON too', () => {
  const store = makeStore()
  const { run } = harnessTool(store)
  for (const result of [
    run({ action: 'get', id: 9999 }),
    run({ action: 'update', id: 9999, content: 'x' }),
    run({ action: 'archive', id: 9999 }),
  ]) {
    const json = JSON.stringify(result)
    assert.ok(json !== undefined)
    assert.ok(!json.includes('embedding'))
  }
})

test('ctx_memory get/update/archive by id stay inside the current project', () => {
  const store = makeStore()
  const other = store.write({ projectId: 'p2', category: 'ARCHITECTURE', content: 'another project fact' })
  const { run } = harnessTool(store)
  assert.equal(run({ action: 'get', id: other.id }).result, 'not_found')
  assert.equal(run({ action: 'update', id: other.id, content: 'rewritten' }).result, 'not_found')
  assert.equal(run({ action: 'archive', id: other.id }).result, 'not_found')
  const row = store.get(other.id)
  assert.equal(row.content, 'another project fact')
  assert.equal(row.status, 'active')
})
