import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { registerWebApi } from '../lib/webapi.js'
import { Dreamer } from '../lib/dreamer.js'

const makeStore = () => new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-webapi-')), 'm.db'))

/** Fake req/res pair plus a harness that captures registered routes. */
const harness = ({ store, dreamer, sessionQuery, rejection } = {}) => {
  const routes = new Map()
  const ctx = {
    webServer: {
      register: ({ kind, path, handler }) => {
        assert.equal(kind, 'exact')
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
    connection: {
      // Host/Origin fence: accept unless the test sets a rejection code
      requestRejection: () => rejection,
      // every request in tests is pre-authenticated
      authorizeIndex: () => true,
    },
  }
  registerWebApi(ctx, {
    store,
    resolver: { resolve: () => ({ id: 'p1', root: '/r', kind: 'git' }) },
    dreamer,
    getSessionQuery: sessionQuery === undefined ? undefined : () => sessionQuery,
  })
  /** Issue a request against the named route. */
  const call = async (method, path, { query = '', body, contentType = 'application/json' } = {}) => {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const req = {
      method,
      url: `http://localhost${path}${query}`,
      headers: contentType === null ? {} : { 'content-type': contentType },
      on: (event, listener) => {
        if (event === 'data' && body !== undefined) listener(Buffer.from(JSON.stringify(body)))
        if (event === 'end') listener()
        if (event === 'error') { /* tests never error the stream */ }
        return req
      },
      destroy: () => {},
    }
    let status = 0
    let payload = null
    const res = {
      writeHead(code) { status = code },
      end(chunk) {
        status = status || 200
        if (typeof chunk === 'string' && chunk.length > 0) {
          try { payload = JSON.parse(chunk) } catch { payload = chunk }
        }
      },
    }
    await handler(req, res)
    return { status, payload }
  }
  return { call, routes }
}

test('PATCH memories: happy path updates content and importance', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: '原始内容' })
  const { call } = harness({ store })
  const { status, payload } = await call('POST', '/plugins/hippocampus/api/memories/edit', {
    body: { id: row.id, content: '改后的内容', importance: 90 },
  })
  assert.equal(status, 200)
  assert.equal(payload.memory.content, '改后的内容')
  assert.equal(payload.memory.importance, 90)
  assert.equal(store.get(row.id).importance, 90)
})

test('PATCH memories: validation rejections are 400s, not 500s', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'x' })
  const { call } = harness({ store })
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/edit', { body: {} })).status, 400)
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/edit', { body: { id: 'no' } })).status, 400)
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/edit', { body: { id: row.id, importance: 0 } })).status, 400)
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/edit', { body: { id: row.id, content: '' } })).status, 400)
})

test('PATCH memories: unknown id → 404', async () => {
  const store = makeStore()
  const { call } = harness({ store })
  const { status, payload } = await call('POST', '/plugins/hippocampus/api/memories/edit', { body: { id: 999 } })
  assert.equal(status, 404)
  assert.match(payload.error, /999/)
})

test('PATCH memories: unknown category surfaces as 409 (client error)', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'x' })
  const { call } = harness({ store })
  const { status } = await call('POST', '/plugins/hippocampus/api/memories/edit', { body: { id: row.id, category: 'NOT_A_CATEGORY' } })
  assert.equal(status, 409)
})

test('archive memories: archives (not hard-deletes) the row', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'x' })
  const { call } = harness({ store })
  const { status, payload } = await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: row.id } })
  assert.equal(status, 200)
  assert.equal(payload.memory.status, 'archived')
  // still on disk, just archived
  assert.notEqual(store.get(row.id), null)
  assert.equal(store.get(row.id).status, 'archived')
})

test('archive memories: missing/invalid id → 400, unknown id → 404', async () => {
  const store = makeStore()
  const { call } = harness({ store })
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/archive', {})).status, 400)
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: 'abc' } })).status, 400)
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: 999 } })).status, 404)
})

test('POST dreamer/run: unconfigured dreamer → 503', async () => {
  const store = makeStore()
  const { call } = harness({ store, dreamer: null })
  const { status } = await call('POST', '/plugins/hippocampus/api/dreamer/run', {
    body: { project: 'p1', task: 'verify' },
  })
  assert.equal(status, 503)
})

test('POST dreamer/run: runNow executes and records the run', async () => {
  const store = makeStore()
  store.registerProject('p1', '/r', 'git')
  const complete = async () => 'OK. no changes.'
  const dreamer = new Dreamer({ store, complete })
  const { call } = harness({ store, dreamer })
  const { status, payload } = await call('POST', '/plugins/hippocampus/api/dreamer/run', {
    body: { project: 'p1', task: 'verify' },
  })
  assert.equal(status, 200)
  assert.equal(payload.task, 'verify')
  // the run is visible in the recent-runs record the panel reads
  const runs = dreamer.recentRuns('p1')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].task, 'verify')
})

test('POST dreamer/run: unknown project → 409', async () => {
  const store = makeStore()
  const dreamer = new Dreamer({ store, complete: async () => 'x' })
  const { call } = harness({ store, dreamer })
  const { status } = await call('POST', '/plugins/hippocampus/api/dreamer/run', {
    body: { project: 'nope', task: 'verify' },
  })
  assert.equal(status, 409)
})

test('Dreamer.runNow: bad task throws before touching the store', async () => {
  const store = makeStore()
  const dreamer = new Dreamer({ store, complete: async () => 'x' })
  await assert.rejects(() => dreamer.runNow('p1', 'bogus'), /verify, curate/)
})

test('GET context: compaction timeline comes from the session log and agrees with the bust count', async () => {
  const store = makeStore()
  const usage = { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 10 }
  const events = [
    { seq: 1, time: 1, type: 'user/message', data: {} },
    { seq: 2, time: 2, type: 'assistant/message', data: { usage } },
    { seq: 3, time: 3, type: 'compaction/start', data: {} },
    { seq: 4, time: 4, type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'checkpoint body' }] } },
    { seq: 5, time: 5, type: 'user/message', data: {}, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } },
    { seq: 6, time: 6, type: 'compaction/end', data: {} },
    { seq: 7, time: 7, type: 'assistant/message', data: { usage } },
  ]
  const sessionQuery = {
    readSession: async () => ({ events }),
    // the host index never returns compaction/* events; reading must not depend on it
    searchEvents: async () => { throw new Error('limit exceeds maxLimit') },
  }
  const { call } = harness({ store, sessionQuery })
  const { status, payload } = await call('GET', '/plugins/hippocampus/api/context', { query: '?session=s1&project=p1' })
  assert.equal(status, 200)
  assert.deepEqual(payload.compactions.map(hit => hit.type), ['compaction/start', 'compaction/summary', 'compaction/end'])
  assert.equal(payload.compactions[1].snippet, 'checkpoint body')
  const rewrites = payload.compactions.filter(hit => hit.type === 'compaction/summary').length
  assert.equal(rewrites, 1)
  assert.equal(payload.cache.rows.filter(row => row.bust).length, 1)
})

test('GET context: a prune batch is one timeline row; a batch riding a commit is part of it', async () => {
  const store = makeStore()
  const usage = { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 10 }
  const prune = (seq, node) => [
    { seq, time: seq, type: 'compaction/prune', data: { shadowedRange: { start: node, end: node }, shadowedSeqs: [node], shadowedTokenCount: 50 } },
    { seq: seq + 1, time: seq + 1, type: 'tool/result', data: {}, surfaceOp: { op: 'replace', startSeq: node, endSeq: node }, sourceEventSeqs: [node] },
  ]
  const events = [
    { seq: 1, time: 1, type: 'tool/result', data: {} },
    { seq: 2, time: 2, type: 'tool/result', data: {} },
    { seq: 3, time: 3, type: 'assistant/message', data: { usage } },
    { seq: 4, time: 4, type: 'compaction/start', data: {} },
    { seq: 5, time: 5, type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'cp' }] } },
    { seq: 6, time: 6, type: 'user/message', data: {}, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 } },
    { seq: 7, time: 7, type: 'compaction/end', data: {} },
    ...prune(8, 1), // rides the commit
    { seq: 10, time: 10, type: 'assistant/message', data: { usage } },
    ...prune(11, 2), ...prune(13, 9), // an idle batch of two
    { seq: 15, time: 15, type: 'assistant/message', data: { usage } },
  ]
  const sessionQuery = { readSession: async () => ({ events }), searchEvents: async () => [] }
  const { call } = harness({ store, sessionQuery })
  const { payload } = await call('GET', '/plugins/hippocampus/api/context', { query: '?session=s1&project=p1' })
  const prunes = payload.compactions.filter(hit => hit.type === 'compaction/prune')
  assert.deepEqual(prunes.map(hit => [hit.seq, hit.ridesCommit]), [[8, true], [11, false]])
  assert.match(prunes[1].snippet, /^2 tool results pruned$/)
  // the panel's rewrite count: one checkpoint + one standalone prune batch, matching the busts
  const rewrites = payload.compactions.filter(hit => hit.type === 'compaction/summary' || (hit.type === 'compaction/prune' && hit.ridesCommit !== true)).length
  assert.equal(rewrites, 2)
  assert.equal(payload.cache.rows.filter(row => row.bust).length, 2)
})

test('write routes refuse a body that is not declared as JSON', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'x' })
  const { call } = harness({ store })
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', null]) {
    const { status } = await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: row.id }, contentType })
    assert.equal(status, 415, `content-type ${contentType}`)
  }
  assert.equal(store.get(row.id).status, 'active')
  const ok = await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: row.id }, contentType: 'application/json; charset=utf-8' })
  assert.equal(ok.status, 200)
})

test('a request the Host/Origin fence rejects never reaches the handler', async () => {
  const store = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'x' })
  const { call } = harness({ store, rejection: 403 })
  assert.equal((await call('POST', '/plugins/hippocampus/api/memories/archive', { body: { id: row.id } })).status, 403)
  assert.equal((await call('GET', '/plugins/hippocampus/api/projects')).status, 403)
  assert.equal(store.get(row.id).status, 'active')
})

test('an unexpected handler error answers a generic 500', async () => {
  const store = makeStore()
  store.db.close()
  const { call } = harness({ store })
  const { status, payload } = await call('GET', '/plugins/hippocampus/api/projects')
  assert.equal(status, 500)
  assert.deepEqual(payload, { error: 'internal error' })
})
