import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { registerSearchTool, registerExpandTool, registerNoteTool } from '../lib/index.js'

const makeStore = () => new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-recall-')), 'm.db'))

/** Fake dsh-tools capture harness shared by the tool registrations under test. */
const harness = (store, sessionQuery) => {
  const registered = []
  const ctx = { tools: { register: def => registered.push(def) } }
  const defineTool = def => def
  const deps = {
    store,
    resolver: { resolve: () => ({ id: 'p1', root: '/r', kind: 'git' }) },
    embeddings: undefined,
    // The production code resolves sessionQuery lazily through a getter.
    getSessionQuery: () => sessionQuery,
  }
  registerSearchTool(ctx, { defineTool }, deps)
  registerExpandTool(ctx, { defineTool }, { getSessionQuery: deps.getSessionQuery })
  registerNoteTool(ctx, { defineTool }, deps)
  const names = registered.map(def => def.name)
  const exec = { agent: { session: { id: 's1', header: { cwd: '/r' } } } }
  return {
    tools: Object.fromEntries(registered.map(def => [def.name, def])),
    run: (name, args) => registered.find(def => def.name === name).execute(args, exec),
    names,
  }
}

/** A fake sessionQuery: two sessions under /r, one elsewhere. */
const fakeSessionQuery = hits => ({
  searchSessions: async request => {
    const cwdFilter = request.sessionFilters?.find(f => f.kind === 'cwd')
    const visible = hits.filter(hit => cwdFilter === undefined || cwdFilter.values.includes(hit.header.cwd))
    return { items: visible, cursor: null }
  },
  readEvent: async request => ({
    session: { id: request.sessionId, header: { cwd: '/r' } },
    target: {
      seq: request.seq, type: 'user/message', time: 1,
      data: { role: 'user', content: [{ type: 'text', text: `event@${request.seq}` }], source: { kind: 'user' } },
    },
    events: [],
  }),
})

const HITS = [
  {
    header: { id: 'sess-a', cwd: '/r', title: 'session a' },
    bestMatch: { seq: 5, type: 'user/message', time: 1, snippet: 'how we fixed the parser' },
  },
  {
    header: { id: 'sess-b', cwd: '/r', title: 'session b' },
    bestMatch: { seq: 9, type: 'assistant/message', time: 2, snippet: 'the retry policy decision' },
  },
]

test('ctx_search without sessionQuery degrades to memories-only (no sessions key crash)', async () => {
  const store = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'parser 是递归下降实现' })
  const h = harness(store, undefined)
  const result = await h.run('ctx_search', { query: 'parser' })
  assert.equal(result.count, 1)
  assert.equal(result.memories[0].content, 'parser 是递归下降实现')
  assert.equal(result.sessions.length, 0)
})

test('late-activating sessionQuery: first search degrades, later search finds sessions', async () => {
  const store = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'parser 是递归下降实现' })
  // The getter returns undefined at first (service still loading), then the
  // service — exactly the late-activation timeline in a real composition.
  let service = undefined
  const registered = []
  const ctx = { tools: { register: def => registered.push(def) } }
  const deps = {
    store,
    resolver: { resolve: () => ({ id: 'p1', root: '/r', kind: 'git' }) },
    embeddings: undefined,
    getSessionQuery: () => service,
  }
  registerSearchTool(ctx, { defineTool: def => def }, deps)
  const tool = registered[0]
  const exec = { agent: { session: { id: 's1', header: { cwd: '/r' } } } }

  const early = await tool.execute({ query: 'parser' }, exec)
  assert.equal(early.sessions.length, 0)

  service = fakeSessionQuery(HITS)
  const late = await tool.execute({ query: 'parser' }, exec)
  assert.equal(late.sessions.length, 2)
})

test('ctx_search fuses memories and session history, scoped by cwd', async () => {
  const store = makeStore()
  store.write({ projectId: 'p1', category: 'CONFIG_VALUES', content: '端口 3080' })
  const h = harness(store, fakeSessionQuery(HITS))
  const result = await h.run('ctx_search', { query: 'parser 端口' })
  // one memory hit + two session hits (both under /r), the /elsewhere session invisible
  assert.equal(result.memories.length, 1)
  assert.equal(result.sessions.length, 2)
  assert.ok(result.sessions.every(s => s.sessionId === 'sess-a' || s.sessionId === 'sess-b'))
  assert.equal(result.sessions[0].bestMatch.snippet, 'how we fixed the parser')
})

test('ctx_search scope=memories skips the session lane entirely', async () => {
  const store = makeStore()
  const h = harness(store, fakeSessionQuery(HITS))
  const result = await h.run('ctx_search', { query: 'parser', scope: 'memories' })
  assert.equal(result.sessions.length, 0)
})

test('ctx_search scope=sessions skips the memory lanes entirely', async () => {
  const store = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'parser 是递归下降实现' })
  const h = harness(store, fakeSessionQuery(HITS))
  const result = await h.run('ctx_search', { query: 'parser', scope: 'sessions' })
  assert.equal(result.memories.length, 0)
  assert.equal(result.sessions.length, 2)
})

test('ctx_expand projects the event window to lossless JSON', async () => {
  const store = makeStore()
  const h = harness(store, fakeSessionQuery(HITS))
  const result = await h.run('ctx_expand', { sessionId: 'sess-a', seq: 5, before: 1 })
  assert.equal(result.target.seq, 5)
  assert.equal(result.target.text, 'event@5')
  assert.equal(result.target.role, 'user')
  const json = JSON.stringify(result)
  assert.ok(!json.includes('undefined'))
})

test('ctx_expand returns an error record (not a throw) on failure', async () => {
  const store = makeStore()
  const failing = {
    searchSessions: async () => ({ items: [], cursor: null }),
    readEvent: async () => { throw new Error('no such event') },
  }
  const h = harness(store, failing)
  const result = await h.run('ctx_expand', { sessionId: 'x', seq: 1 })
  assert.match(result.error, /no such event/)
})

test('ctx_note stores a note as a searchable memory with source_type note', async () => {
  const store = makeStore()
  const h = harness(store, undefined)
  const written = h.run('ctx_note', { content: '部署脚本入口是 scripts/deploy.sh', importance: 60 })
  assert.equal(written.result, 'written')
  const row = store.get(written.memory.id)
  assert.equal(row.source_type, 'note')
  // searchable
  const found = await h.run('ctx_search', { query: 'deploy' })
  assert.equal(found.memories.length, 1)
  // dedup: same note again is a duplicate
  const dup = h.run('ctx_note', { content: '部署脚本入口是 scripts/deploy.sh' })
  assert.equal(dup.result, 'duplicate')
})

test('ctx_note empty content throws', () => {
  const store = makeStore()
  const h = harness(store, undefined)
  assert.throws(() => h.run('ctx_note', { content: '' }), /requires content/)
})

test('ctx_search says when the session-history lane is off', async () => {
  const store = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'parser 是递归下降实现' })
  const disabled = Object.assign(new Error('session search is disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
  const off = harness(store, { searchSessions: async () => { throw disabled } })
  assert.equal((await off.run('ctx_search', { query: 'parser' })).sessionSearch, 'disabled')
  assert.equal((await harness(store, undefined).run('ctx_search', { query: 'parser' })).sessionSearch, 'unavailable')
  const on = await harness(store, fakeSessionQuery(HITS)).run('ctx_search', { query: 'parser' })
  assert.equal(on.sessionSearch, undefined, 'a working lane adds no field')
  const memoriesOnly = await harness(store, undefined).run('ctx_search', { query: 'parser', scope: 'memories' })
  assert.equal(memoriesOnly.sessionSearch, undefined)
})
