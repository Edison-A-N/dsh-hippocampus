import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'

const makeStore = () => new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-compaction-runs-')), 'm.db'))

const RUN = {
  sessionId: 's1',
  projectId: 'p1',
  mode: 'background',
  provider: 'p',
  model: 'm',
  status: 'ok',
  summary: { text: 'folded the parser discussion', shadowedCount: 12 },
  usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 8000 },
  durationMs: 4200,
  shadowedStart: 3,
  shadowedEnd: 40,
}

test('recordCompactionRun/compactionRuns round-trip every field', () => {
  const store = makeStore()
  store.recordCompactionRun(RUN)
  store.recordCompactionRun({ ...RUN, mode: 'overflow', status: 'error', error: 'stream error', durationMs: undefined })
  const rows = store.compactionRuns('s1')
  assert.equal(rows.length, 2)
  // newest first: the error row
  assert.equal(rows[0].mode, 'overflow')
  assert.equal(rows[0].status, 'error')
  assert.equal(rows[0].error, 'stream error')
  assert.equal(rows[0].duration_ms, null)
  const ok = rows[1]
  assert.equal(ok.mode, 'background')
  assert.equal(ok.provider, 'p')
  assert.equal(ok.model, 'm')
  assert.equal(ok.duration_ms, 4200)
  assert.equal(ok.shadowed_start, 3)
  assert.equal(ok.shadowed_end, 40)
  assert.deepEqual(JSON.parse(ok.summary_json), RUN.summary)
  assert.deepEqual(JSON.parse(ok.usage_json), RUN.usage)
})

test('recordCompactionRun is best-effort: a broken row never throws', () => {
  const store = makeStore()
  // sessionId must be a string; the store swallows the constraint error
  store.recordCompactionRun({ sessionId: null, mode: 'background', status: 'ok' })
  assert.equal(store.compactionRuns('s1').length, 0)
})

test('compactionRuns only returns the requested session', () => {
  const store = makeStore()
  store.recordCompactionRun(RUN)
  store.recordCompactionRun({ ...RUN, sessionId: 's2' })
  assert.equal(store.compactionRuns('s1').length, 1)
  assert.equal(store.compactionRuns('s2').length, 1)
})

test('compactionRuns respects the limit', () => {
  const store = makeStore()
  for (let i = 0; i < 5; i += 1) store.recordCompactionRun({ ...RUN, summary: { i } })
  assert.equal(store.compactionRuns('s1', 2).length, 2)
})

test('compaction runs record through the engine: compactNow writes one ok row', async () => {
  const { HippocampusCompaction } = await import('../lib/compaction.js')
  const store = makeStore()
  const recorded = []
  const original = store.recordCompactionRun.bind(store)
  store.recordCompactionRun = row => { recorded.push(row); original(row) }

  const nodes = [1000, 2000, 3000, 4000, 5000].map((tokens, i) => ({ seq: i + 1, tokens }))
  const session = {
    id: 's1',
    header: { cwd: '/repo' },
    surface: { nodes: nodes.map(n => n.seq) },
    eventAt: seq => ({ seq, type: 'user/message' }),
    deriveEventMessage: event => ({ role: 'user', content: [{ type: 'text', text: `msg@${event.seq}` }], source: { kind: 'user' }, id: `m${event.seq}` }),
    requestHeader: () => ({ config: { provider: 'p', model: 'm', maxTokens: 4096 } }),
    append: () => ({}),
    toolPairingBalancedBefore: () => true,
  }
  const engine = new HippocampusCompaction({
    stream: async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '## summary\n- folded' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '## summary\n- folded' } }
    },
    collectText: blocks => blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'),
    resolveModelInfo: async () => ({ context: { contextWindow: 10_000 } }),
    measure: () => ({ totalTokens: 50_000, nodes }),
    compactionModule: {
      CompactionId: v => ({ value: v }),
      compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
      toolPairingBalancedBefore: () => true,
    },
    llmModule: {
      BlockAssembler: class {
        constructor() { this._text = '' }
        push(chunk) { if (chunk?.block?.text !== undefined) this._text = chunk.block.text }
        blocks() { return [{ type: 'text', text: this._text }] }
        get usage() { return { inputTokens: 900, outputTokens: 100, cacheReadTokens: 7000 } }
        get finish() { return { kind: 'stop' } }
      },
    },
    store,
    resolver: { resolve: () => ({ id: 'p1', root: '/repo', kind: 'git' }) },
  })
  const agent = { session, runMaintenance: async task => task() }
  await engine.compactNow(agent, undefined)
  assert.equal(recorded.length, 1)
  const row = recorded[0]
  assert.equal(row.mode, 'overflow') // compactNow routes through the synchronous (overflow) path
  assert.equal(row.status, 'ok')
  assert.equal(row.sessionId, 's1')
  assert.equal(row.projectId, 'p1')
  assert.equal(row.provider, 'p')
  assert.equal(row.model, 'm')
  assert.deepEqual(row.usage, { inputTokens: 900, outputTokens: 100, cacheReadTokens: 7000 })
  assert.equal(typeof row.durationMs, 'number')
  assert.ok(row.summary.text.includes('folded'))
})

test('engine records the failure when the summary stream errors', async () => {
  const { HippocampusCompaction } = await import('../lib/compaction.js')
  const store = makeStore()
  const recorded = []
  store.recordCompactionRun = row => recorded.push(row)

  const nodes = [10_000, 10_000, 10_000, 10_000].map((tokens, i) => ({ seq: i + 1, tokens }))
  const session = {
    id: 's2',
    header: { cwd: '/repo' },
    surface: { nodes: [1, 2, 3, 4] },
    eventAt: seq => ({ seq, type: 'user/message' }),
    deriveEventMessage: event => ({ role: 'user', content: [{ type: 'text', text: `msg@${event.seq}` }], source: { kind: 'user' }, id: `m${event.seq}` }),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    append: () => ({}),
    toolPairingBalancedBefore: () => true,
  }
  const engine = new HippocampusCompaction({
    stream: async function* () { throw new Error('gateway 502') },
    collectText: () => '',
    resolveModelInfo: async () => ({ context: { contextWindow: 10_000 } }),
    measure: () => ({ totalTokens: 50_000, nodes }),
    compactionModule: {
      CompactionId: v => ({ value: v }),
      compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
      toolPairingBalancedBefore: () => true,
    },
    llmModule: {
      BlockAssembler: class { push() {} blocks() { return [] } get finish() { return { kind: 'stop' } } },
    },
    store,
  })
  const agent = { session, runMaintenance: async task => task() }
  // runMaintenance returns the task's rejection; the engine records the
  // failure either way (the record happens before the rethrow).
  await engine.compactNow(agent, undefined).catch(() => undefined)
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].status, 'error')
  assert.match(recorded[0].error, /502/)
})
