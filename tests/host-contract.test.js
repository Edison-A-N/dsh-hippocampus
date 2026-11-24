/**
 * Host-contract test: fold the events both engines append through the REAL
 * dsh-token-meter projections and the REAL dsh-compaction tool-pairing
 * helpers. Skips when the DSH packages are not installed next to this repo
 * (a plain clone has no host).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { MemoryStore } from '../lib/store.js'
import { HippocampusCompaction } from '../lib/compaction.js'
import { CompartmentCompaction } from '../lib/historian.js'
import { appendCompaction, finishError, openTurnOf } from '../lib/commit.js'

// Point DSH_HOST_NODE_MODULES at a DSH install's node_modules/.pnpm/node_modules
// (the directory that resolves @deepseek-ai/dsh-token-meter); unset → skip.
const HOST_BASES = [process.env.DSH_HOST_NODE_MODULES].filter(Boolean)

async function loadHost() {
  for (const base of HOST_BASES) {
    if (!existsSync(base)) continue
    try {
      const require = createRequire(join(base, 'noop.js'))
      const meterPath = require.resolve('@deepseek-ai/dsh-token-meter')
      const compaction = await import(require.resolve('@deepseek-ai/dsh-compaction'))
      // the projection definitions are module-private: load an in-memory copy
      // that also exports them (imports rewritten to absolute file URLs)
      const meterRequire = createRequire(meterPath)
      const source = readFileSync(meterPath, 'utf8')
        .replace(/from "([^".][^"]*)"/g, (_, spec) => `from "${new URL(`file://${meterRequire.resolve(spec)}`).href}"`)
        + '\nexport { contextPressureProjectionDefinition as __pressure, contextBreakdownProjectionDefinition as __breakdown, estimateMessage as __estimateMessage };\n'
      const meter = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
      const sessionModule = await import(require.resolve('@deepseek-ai/dsh-session'))
      return { compaction, pressure: meter.__pressure, breakdown: meter.__breakdown, estimateMessage: meter.__estimateMessage, Session: sessionModule.Session, deriveEventMessage: sessionModule.deriveEventMessage }
    } catch {
      // try the next base
    }
  }
  return null
}

const host = await loadHost()
const skip = host === null ? 'DSH host packages not installed' : false

const SURFACE = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

function hostSession() {
  const events = []
  const nodes = []
  const session = {
    id: 'host-1',
    header: { cwd: '/repo' },
    surface: { nodes, get replaceGeneration() { return generation } },
    get seq() { return events.length },
    eventAt: seq => events[seq],
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    deriveEventMessage: event => {
      if (event === undefined) return null
      if (event.type === 'user/message') return event.data
      if (SURFACE.has(event.type)) return event.data.message
      return null
    },
    append(type, data, options = {}) {
      const event = { type, seq: events.length, time: Date.now(), data, ...(SURFACE.has(type) ? { surfaceOp: options.surfaceOp ?? 'append', ...(options.sourceEventSeqs ? { sourceEventSeqs: options.sourceEventSeqs } : {}) } : {}) }
      events.push(event)
      if (options.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.startSeq)
        const end = nodes.indexOf(options.surfaceOp.endSeq)
        nodes.splice(start, end - start + 1, event.seq)
        generation += 1
      } else if (SURFACE.has(type)) {
        nodes.push(event.seq)
      }
      return event
    },
    events,
  }
  let generation = 0
  session.append('system/message', { turn: 0, step: 0, message: { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'sys' }] } })
  return session
}

function fill(session, turns, { toolCallOpen = false } = {}) {
  session.append('turn/start', { turn: 1 })
  for (let i = 0; i < turns; i += 1) {
    const text = `${'w'.repeat(2400)} ${i}`
    session.append('user/message', { id: `u${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
    const content = [{ type: 'text', text }, { type: 'tool-call', id: `c${i}`, name: 'read', arguments: '{}' }]
    session.append('assistant/message', { turn: 1, step: i, message: { id: `a${i}`, role: 'assistant', source: { kind: 'model' }, content }, stream: [], usage: { inputTokens: 1000, outputTokens: 10 } })
    if (toolCallOpen && i === turns - 1) break
    session.append('tool/result', { message: { id: `t${i}`, role: 'tool', toolCallId: `c${i}`, source: { kind: 'tool', callId: `c${i}` }, content: [{ type: 'text', text: 'ok' }] } })
  }
}

/** Fold every event through both projections; throws on a contract violation. */
function foldAll(session) {
  let pressure = host.pressure.init()
  let breakdown = host.breakdown.init()
  for (const event of session.events) {
    pressure = host.pressure.apply(pressure, event)
    breakdown = host.breakdown.apply(breakdown, event)
  }
  return { pressure, breakdown }
}

function engines(session, { historianText } = {}) {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-host-')), 'm.db'))
  const measure = s => {
    const priced = s.surface.nodes.map(seq => {
      const message = s.deriveEventMessage(s.eventAt(seq))
      const tokens = Math.ceil((message?.content ?? []).reduce((n, b) => n + (b.text ?? b.arguments ?? '').length, 0) / 4) + 4
      return { seq, tokens, heuristicTokens: tokens }
    })
    return { totalTokens: priced.reduce((a, n) => a + n.tokens, 0), nodes: priced }
  }
  const shared = {
    stream: options => (async function* () {
      if (options.system !== undefined) {
        const seqs = [...options.messages[0].content[0].text.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]))
        yield { type: 'text', text: historianText ?? JSON.stringify({ compartments: [{ start: seqs[0], end: seqs.at(-1), title: 't', importance: 50, p1: 'did', p2: 'd', p3: 'd', p4: 'k' }] }) }
      } else {
        yield { type: 'text', text: '## Primary Request and Intent\n- fallback' }
      }
    })(),
    resolveModelInfo: async () => ({ context: { contextWindow: 40_000 } }),
    measure,
    compactionModule: {
      CompactionId: host.compaction.CompactionId,
      compactCheckpointSource: host.compaction.compactCheckpointSource,
      toolPairingBalancedBefore: host.compaction.toolPairingBalancedBefore,
      toolPairingBalancedAfter: host.compaction.toolPairingBalancedAfter,
    },
    llmModule: {
      BlockAssembler: class {
        constructor() { this.text = '' }
        push(chunk) { if (chunk.type === 'text') this.text += chunk.text }
        blocks() { return [{ type: 'text', text: this.text }] }
        get finish() { return { kind: 'stop' } }
      },
    },
    store,
  }
  const checkpoint = new HippocampusCompaction(shared)
  const compartments = new CompartmentCompaction({ ...shared, fallback: checkpoint, estimateText: t => Math.ceil(t.length / 4) })
  return { checkpoint, compartments, store }
}

test('compartment commit folds cleanly through the real token-meter projections', { skip }, async () => {
  const session = hostSession()
  fill(session, 14)
  const { compartments, store } = engines(session)
  const agent = { session, runMaintenance: async task => task() }
  const result = await compartments.compactIfNeeded(agent, 'context-overflow')
  assert.notEqual(result, null)
  assert.ok(store.compartments(session.id, ['committed']).length > 0)
  const summary = session.events[result.summarySeq]
  assert.equal(summary.type, 'compaction/summary')
  assert.deepEqual(summary.data.shadowedRange, { start: result.shadowedRange.start, end: result.shadowedRange.end })
  assert.ok(summary.data.shadowedTokenCount > 0)
  assert.equal(session.events[result.summarySeq + 1].surfaceOp.op, 'replace')
  assert.equal(session.events[result.startSeq].data.turn, 1) // open turn stamped
  const { pressure } = foldAll(session)
  assert.ok(pressure.surfaceTokens > 0)
})

test('overflow fallback with retainTokens 0 works with the real tool-pairing helpers', { skip }, async () => {
  const session = hostSession()
  fill(session, 14)
  const { compartments, store } = engines(session, { historianText: 'not json' })
  const agent = { session, runMaintenance: async task => task() }
  const result = await compartments.compactIfNeeded(agent, 'context-overflow')
  assert.notEqual(result, null)
  assert.equal(store.compartments(session.id, ['committed']).length, 0)
  foldAll(session)
})

test('fallback never cuts an open tool call off its result', { skip }, async () => {
  const session = hostSession()
  fill(session, 14, { toolCallOpen: true })
  const { checkpoint } = engines(session)
  const agent = { session, runMaintenance: async task => task() }
  const result = await checkpoint.compactInline(agent, undefined, { retainTokens: 0 })
  assert.notEqual(result, null)
  // the open assistant/tool-call node is still on the surface, after the checkpoint
  const last = session.surface.nodes.at(-1)
  assert.equal(session.eventAt(last).type, 'assistant/message')
  foldAll(session)
})

test('commit helpers: finish kinds and open turn', () => {
  assert.equal(finishError({ kind: 'stop' }), undefined)
  assert.ok(finishError({ kind: 'max-tokens' }) instanceof Error)
  assert.ok(finishError({ kind: 'aborted', failure: { message: 'x' } }) instanceof Error)
  assert.ok(finishError('error') instanceof Error)
  const events = [{ type: 'turn/start', data: { turn: 3 } }, { type: 'user/message' }]
  assert.equal(openTurnOf({ seq: 2, eventAt: s => events[s] }), 3)
  events.push({ type: 'turn/end', data: { turn: 3 } })
  assert.equal(openTurnOf({ seq: 3, eventAt: s => events[s] }), null)
  assert.equal(typeof appendCompaction, 'function')
})

test('compaction lock: an unmatched start is stale after a session/end-seed', async () => {
  const { compactionOpen } = await import('../lib/commit.js')
  const events = []
  const s = { get seq() { return events.length }, eventAt: q => events[q] }
  events.push({ type: 'turn/start' }, { type: 'compaction/start' })
  assert.equal(compactionOpen(s), true)
  events.push({ type: 'turn/end' }, { type: 'session/end-seed' }, { type: 'turn/start' }, { type: 'user/message' })
  assert.equal(compactionOpen(s), false)
  events.push({ type: 'compaction/start' })
  assert.equal(compactionOpen(s), true) // a fresh one after the seed is live
  events.push({ type: 'compaction/end' })
  assert.equal(compactionOpen(s), false)
})

test('overflow budget: one recovery until the model answers or the agent idles', async () => {
  const { OverflowBudget } = await import('../lib/commit.js')
  const budget = new OverflowBudget(1)
  const session = {}
  const agent = { session }
  assert.equal(budget.allow(agent), true)
  budget.spend(agent)
  assert.equal(budget.allow(agent), false)
  assert.equal(budget.allow(agent), false)
  budget.answered(session)
  assert.equal(budget.allow(agent), true)
  budget.spend(agent)
  budget.idle(agent)
  assert.equal(budget.allow(agent), true)
})

test('provider scale holds across a replace on the real TokenMeter', { skip }, async () => {
  const { providerScale } = await import('../lib/compartments.js')
  const require = createRequire(join(HOST_BASES[0], 'noop.js'))
  const { TokenMeter } = await import(require.resolve('@deepseek-ai/dsh-token-meter'))
  // the service outside cordis: no projections (measure folds the log
  // itself), no llm (no image or file pricing)
  const meter = Object.create(TokenMeter.prototype)
  meter.states = new WeakMap()
  meter.ctx = { get: () => undefined }
  const { Session } = host
  const session = Session.create('scale-host')
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' })
  session.append('turn/start', { turn: 1 })
  for (let i = 0; i < 6; i += 1) {
    session.append('user/message', { id: `u${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'w'.repeat(4000) }] }, { surfaceOp: 'append' })
  }
  session.append('step/start', { turn: 1, step: 0 })
  session.append('request/header', { header: { config: { provider: 'p', model: 'm' } } })
  const stream = [
    { type: 'chunk', time: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'chunk', time: 1, chunk: { type: 'text-delta', index: 0, text: 'ok' } },
    { type: 'chunk', time: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } } },
  ]
  // the provider reports ~2x the heuristic
  session.append('assistant/message', { turn: 1, step: 0, message: { id: 'a0', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'ok' }] }, stream, usage: { inputTokens: 12_000, outputTokens: 10 } }, { surfaceOp: 'append' })
  const anchored = meter.measure(session)
  assert.equal(anchored.baseline.kind, 'usage')
  const scale = providerScale(anchored)
  assert.ok(scale > 1.9 && scale < 2.1)
  // fold half the surface into a small checkpoint: totalTokens drops by a
  // heuristic delta, the anchor ratio must not move
  const nodes = [...session.surface.nodes]
  session.append('user/message', { id: 'cp', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'summary' }] }, { surfaceOp: { op: 'replace', startSeq: nodes[1], endSeq: nodes[3] }, sourceEventSeqs: nodes.slice(1, 4) })
  const replaced = meter.measure(session)
  assert.ok(replaced.surfaceDeltaTokens < 0)
  assert.equal(providerScale(replaced), scale)
  // totalTokens ÷ current surface would have jumped
  assert.ok(replaced.totalTokens / replaced.surfaceTokens > scale * 1.3)
})

test('tool-output reclaim: a real dsh-session Session accepts the events and the meter subtracts exactly', { skip }, async () => {
  const { applyReclaim, selectReclaim, isReclaimed } = await import('../lib/reclaim.js')
  const { Session, deriveEventMessage, estimateMessage, pressure } = host
  const session = Session.create('reclaim-host')
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' })
  for (let i = 0; i < 8; i += 1) {
    session.append('user/message', { id: `u${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `step ${i}` }] }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: i, message: { id: `a${i}`, role: 'assistant', source: { kind: 'model' }, content: [{ type: 'tool-call', id: `c${i}`, name: 'bash', arguments: '{}' }] }, stream: [], usage: { inputTokens: 1000, outputTokens: 10 } }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: i, message: { id: `t${i}`, role: 'tool', toolCallId: `c${i}`, source: { kind: 'tool', callId: `c${i}` }, content: [{ type: 'text', text: `${'o'.repeat(4000)} ${i}` }] } }, { surfaceOp: 'append' })
  }
  const price = () => [...session.surface.nodes].map(seq => {
    const message = deriveEventMessage(session.eventAt(seq))
    const tokens = message === null ? 0 : estimateMessage(message)
    return { seq, tokens, heuristicTokens: tokens }
  })
  const fold = () => {
    let state = pressure.init()
    for (let seq = 0; seq < session.log.length; seq += 1) state = pressure.apply(state, session.eventAt(seq))
    return state.surfaceTokens
  }
  const before = price()
  const total = nodes => nodes.reduce((sum, node) => sum + node.tokens, 0)
  assert.equal(fold(), total(before)) // the fold and the per-node sum agree before reclaim
  const picked = selectReclaim({ session, nodes: before.map(n => n.seq), priced: before.map(n => n.tokens), startIdx: 1, usable: 20_000 })
  assert.ok(picked.length > 0)
  applyReclaim(session, picked, { measurement: { nodes: before } })
  const after = price()
  assert.ok(total(after) < total(before))
  assert.equal(fold(), total(after)) // shadow prices exact: no drift
  assert.ok(session.surface.nodes.some(seq => isReclaimed(deriveEventMessage(session.eventAt(seq)))))
})
