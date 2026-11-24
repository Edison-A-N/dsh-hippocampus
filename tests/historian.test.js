import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { HippocampusCompaction } from '../lib/compaction.js'
import { CompartmentCompaction, parseTtl, resolveCompartmentConfig } from '../lib/historian.js'

const WINDOW = 100_000
const NODE_CHARS = 1000

const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

/** A fake event-sourced session with real replace semantics. */
function fakeSession(clock) {
  const events = []
  const nodes = []
  const session = {
    id: 'sess-1',
    header: { cwd: '/repo' },
    surface: { nodes },
    get seq() { return events.length },
    eventAt: seq => events[seq],
    requestHeader: () => ({ config: { provider: 'p', model: 'main' } }),
    deriveEventMessage: event => {
      if (event === undefined) return null
      if (event.type === 'user/message') return event.data
      if (SURFACE_TYPES.has(event.type)) return event.data.message
      return null
    },
    append(type, data, options = {}) {
      const event = { type, seq: events.length, time: clock.now, data, ...options }
      events.push(event)
      if (options.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.startSeq)
        const end = nodes.indexOf(options.surfaceOp.endSeq)
        if (start === -1 || end < start) throw new Error('bad replace')
        nodes.splice(start, end - start + 1, event.seq)
      } else if (SURFACE_TYPES.has(type)) {
        nodes.push(event.seq)
      }
      return event
    },
    events,
  }
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } })
  return session
}

let callCounter = 0
function addTurn(session, { cached = true, toolCall = false } = {}) {
  callCounter += 1
  const text = `${'w'.repeat(NODE_CHARS - 20)} turn ${callCounter}`
  session.append('user/message', { id: `u${callCounter}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const usage = cached ? { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5000 } : { inputTokens: 5000, outputTokens: 10 }
  const content = [{ type: 'text', text }]
  if (toolCall) content.push({ type: 'tool-call', id: `c${callCounter}`, name: 'read', arguments: '{}' })
  session.append('assistant/message', { message: { role: 'assistant', source: { kind: 'model' }, content }, usage })
  if (toolCall) {
    session.append('tool/result', { message: { role: 'tool', toolCallId: `c${callCounter}`, source: { kind: 'tool', callId: `c${callCounter}` }, content: [{ type: 'text', text: 'result' }] } })
  }
}

function messageText(message) {
  return (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
}

function balanced(session, uptoIdxExclusive) {
  let open = 0
  for (let i = 0; i < uptoIdxExclusive; i += 1) {
    const event = session.eventAt(session.surface.nodes[i])
    if (event.type === 'assistant/message') open += event.data.message.content.filter(b => b.type === 'tool-call').length
    if (event.type === 'tool/result') open -= 1
  }
  return open === 0
}

/** Historian fake: one compartment over the slice, titled by its range. */
function historianStream(calls, behaviour = { mode: 'ok' }) {
  return async function* (options) {
    calls.push(options)
    if (behaviour.gate !== undefined) await behaviour.gate
    if (behaviour.mode === 'throw') throw new Error('upstream down')
    const user = options.messages[0].content[0].text
    const seqs = [...user.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]))
    const text = behaviour.mode === 'junk'
      ? 'I cannot do that'
      : JSON.stringify({ compartments: [{ start: seqs[0], end: seqs.at(-1), title: `work ${seqs[0]}-${seqs.at(-1)}`, importance: 60, p1: `did things ${seqs[0]}`, p2: 'did', p3: 'did', p4: 'kw' }] })
    yield { type: 'text', text }
  }
}

function makeEngine({ behaviour, env = {} } = {}) {
  const clock = { now: 1_000_000 }
  const session = fakeSession(clock)
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-historian-')), 'm.db'))
  const calls = []
  let streamText = ''
  const compactionModule = {
    CompactionId: v => v,
    compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
    toolPairingBalancedBefore: (s, seq) => balanced(s, s.surface.nodes.indexOf(seq)),
    toolPairingBalancedAfter: (s, seq) => balanced(s, s.surface.nodes.indexOf(seq) + 1),
  }
  const llmModule = {
    BlockAssembler: class {
      constructor() { this.text = '' }
      push(chunk) { if (chunk.type === 'text') this.text += chunk.text }
      blocks() { return [{ type: 'text', text: this.text }] }
      get usage() { return { inputTokens: 1234, outputTokens: 56 } }
      finish = 'stop'
    },
  }
  const shared = {
    stream: options => {
      if (options.system === undefined) {
        // the single-checkpoint fallback (no system prompt)
        calls.push(options)
        return (async function* () { yield { type: 'text', text: '## Primary Request and Intent\n- fallback summary' } })()
      }
      return historianStream(calls, behaviour ?? { mode: 'ok' })(options)
    },
    resolveModelInfo: async () => ({ context: { contextWindow: WINDOW } }),
    measure: s => {
      const priced = s.surface.nodes.map(seq => ({ seq, tokens: messageText(s.deriveEventMessage(s.eventAt(seq))).length }))
      return { totalTokens: priced.reduce((a, n) => a + n.tokens, 0), nodes: priced }
    },
    compactionModule,
    llmModule,
    store,
    resolver: { resolve: () => ({ id: 'proj' }) },
    env,
  }
  const fallback = new HippocampusCompaction(shared)
  const engine = new CompartmentCompaction({ ...shared, fallback, now: () => clock.now, estimateText: t => t.length })
  const agent = { session, runMaintenance: async task => task() }
  return { engine, session, store, calls, clock, agent, setStreamText: t => { streamText = t } }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const historianCalls = calls => calls.filter(c => c.system !== undefined).length

test('config: ttl parsing and env knobs', () => {
  assert.equal(parseTtl('5m'), 300_000)
  assert.equal(parseTtl('90'), 90_000)
  assert.equal(parseTtl('never'), Number.POSITIVE_INFINITY)
  assert.equal(parseTtl('bogus'), 300_000)
  const config = resolveCompartmentConfig({ HIPPOCAMPUS_HISTORIAN_PROVIDER: 'hp', HIPPOCAMPUS_HISTORIAN_MODEL: 'hm', HIPPOCAMPUS_HISTORY_BUDGET: '0.2' })
  assert.deepEqual(config.historian, { provider: 'hp', model: 'hm' })
  assert.equal(config.historyBudgetRatio, 0.2)
  assert.equal(config.executeThreshold, 0.65)
  assert.equal(config.forceRatio, 0.85)
  assert.equal(resolveCompartmentConfig({ HIPPOCAMPUS_HISTORIAN_PROVIDER: 'hp' }).historian, undefined)
})

test('quiet session: small unsummarized span fires nothing', async () => {
  const { engine, session, calls, agent } = makeEngine()
  for (let i = 0; i < 8; i += 1) addTurn(session) // 16K at 16% pressure, tail eats most of it
  assert.equal(await engine.compactIfNeeded(agent, 'pressure'), null)
  await settle()
  assert.equal(historianCalls(calls), 0)
})

test('historian runs early (well below 65%) and stores pending compartments without touching the surface', async () => {
  const { engine, session, store, calls, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session) // 40K = 40%; tail ≈ 11.7K → eligible ≈ 28K ≥ 15K
  const before = [...session.surface.nodes]
  assert.equal(await engine.compactIfNeeded(agent, 'pressure'), null)
  await settle()
  assert.equal(historianCalls(calls), 1)
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length >= 1)
  assert.equal(pending[0].startSeq, session.surface.nodes[1]) // right after the system head
  assert.deepEqual(session.surface.nodes, before)
  // warm cache, low pressure: the next step does not commit
  assert.equal(await engine.compactIfNeeded(agent, 'pressure'), null)
  assert.deepEqual(session.surface.nodes, before)
})

test('pending compartments commit once the cache has gone cold (idle > TTL), with no model call', async () => {
  const { engine, session, store, calls, clock, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const callsBefore = calls.length
  const pending = store.compartments(session.id, ['pending'])
  clock.now += 6 * 60_000
  const result = await engine.compactIfNeeded(agent, 'pressure')
  assert.notEqual(result, null)
  assert.equal(calls.length, callsBefore)
  assert.equal(result.shadowedRange.start, pending[0].startSeq)
  assert.equal(result.shadowedRange.end, pending.at(-1).endSeq)
  // the checkpoint sits right after the system head and renders the work
  const checkpointSeq = session.surface.nodes[1]
  assert.equal(store.checkpointSeq(session.id), checkpointSeq)
  const text = messageText(session.deriveEventMessage(session.eventAt(checkpointSeq)))
  assert.match(text, /<session-history>/)
  assert.match(text, /work \d+-\d+/)
  assert.match(text, /Session id: sess-1/)
  assert.equal(store.compartments(session.id, ['pending']).length, 0)
  assert.equal(store.compartments(session.id, ['committed']).length, pending.length)
})

test('a route that never reports cache use commits right away', async () => {
  const { engine, session, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session, { cached: false })
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const result = await engine.compactIfNeeded(agent, 'pressure')
  assert.notEqual(result, null)
})

test('pressure at the execute threshold commits even with a warm cache', async () => {
  const { engine, session, store, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
  for (let i = 0; i < 13; i += 1) addTurn(session) // 66K = 66%
  const result = await engine.compactIfNeeded(agent, 'pressure')
  assert.notEqual(result, null)
})

test('second round folds the previous checkpoint and new pending work into one history', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  clock.now += 6 * 60_000
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure'), null)
  const firstCheckpoint = session.surface.nodes[1]
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length > 0)
  assert.equal(pending[0].startSeq, session.surface.nodes[2]) // right after the checkpoint
  clock.now += 6 * 60_000
  const result = await engine.compactIfNeeded(agent, 'pressure')
  assert.notEqual(result, null)
  assert.equal(result.shadowedRange.start, firstCheckpoint) // the old checkpoint is folded in
  const text = messageText(session.deriveEventMessage(session.eventAt(session.surface.nodes[1])))
  assert.equal((text.match(/## §/g) ?? []).length, store.compartments(session.id, ['committed']).length)
  assert.ok(store.compartments(session.id, ['committed']).length >= 2)
})

test('lineage: a foreign replace of the checkpoint drops stored compartments', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  clock.now += 6 * 60_000
  await engine.compactIfNeeded(agent, 'pressure')
  const checkpoint = session.surface.nodes[1]
  // something else replaces the checkpoint node
  session.append('user/message', { id: 'x', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'replaced' }] }, { surfaceOp: { op: 'replace', startSeq: checkpoint, endSeq: checkpoint } })
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(store.compartments(session.id, ['committed']).length, 0)
  assert.equal(store.checkpointSeq(session.id), null)
})

test('historian failure backs off instead of retrying every step', async () => {
  const behaviour = { mode: 'throw' }
  const { engine, session, store, calls, clock, agent } = makeEngine({ behaviour })
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.equal(historianCalls(calls), 1)
  for (let i = 0; i < 4; i += 1) {
    clock.now += 5_000
    await engine.compactIfNeeded(agent, 'pressure')
    await settle()
  }
  assert.equal(historianCalls(calls), 1)
  clock.now += 30_000
  behaviour.mode = 'ok'
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.equal(historianCalls(calls), 2)
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
  const runs = store.compactionRuns(session.id)
  assert.ok(runs.some(r => r.mode === 'historian' && r.status === 'error'))
})

test('one historian at a time per session', async () => {
  let release
  const behaviour = { mode: 'ok', gate: new Promise(r => { release = r }) }
  const { engine, session, calls, agent } = makeEngine({ behaviour })
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await engine.compactIfNeeded(agent, 'pressure')
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(historianCalls(calls), 1)
  release()
  await settle()
})

test('surface moving under a running historian discards its result', async () => {
  let release
  const behaviour = { mode: 'ok', gate: new Promise(r => { release = r }) }
  const { engine, session, store, agent } = makeEngine({ behaviour })
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle() // the historian has cut its slice and is waiting on the model
  // a foreign replace of the first raw node while the historian runs
  const first = session.surface.nodes[1]
  session.append('user/message', { id: 'y', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'pruned' }] }, { surfaceOp: { op: 'replace', startSeq: first, endSeq: first } })
  release()
  await settle()
  assert.equal(store.compartments(session.id, ['pending']).length, 0)
})

test('slices never split a tool call from its result', async () => {
  const { engine, session, store, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session, { toolCall: true })
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length > 0)
  const endIdx = session.surface.nodes.indexOf(pending.at(-1).endSeq)
  assert.ok(balanced(session, endIdx + 1))
})

test('overflow: summarizes inline and commits in the same call', async () => {
  const { engine, session, store, agent } = makeEngine()
  for (let i = 0; i < 45; i += 1) addTurn(session) // 90K
  const result = await engine.compactIfNeeded(agent, 'context-overflow')
  assert.notEqual(result, null)
  assert.ok(store.compartments(session.id, ['committed']).length > 0)
  const measured = session.surface.nodes.length
  assert.ok(measured < 91)
})

test('overflow with an unusable historian falls back to the single checkpoint', async () => {
  const { engine, session, store, calls, agent } = makeEngine({ behaviour: { mode: 'junk' } })
  for (let i = 0; i < 45; i += 1) addTurn(session)
  const result = await engine.compactIfNeeded(agent, 'context-overflow')
  assert.notEqual(result, null)
  assert.equal(store.compartments(session.id, ['committed']).length, 0)
  assert.ok(calls.some(c => c.system === undefined)) // fallback summary call
  const text = messageText(session.deriveEventMessage(session.eventAt(session.surface.nodes[1])))
  assert.match(text, /fallback summary/)
})

test('manual compaction folds the eligible span through runMaintenance', async () => {
  const { engine, session, store, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  let maintenance = 0
  agent.runMaintenance = async task => { maintenance += 1; return task() }
  const result = await engine.compactNow(agent)
  assert.equal(maintenance, 1)
  assert.notEqual(result, null)
  assert.ok(store.compartments(session.id, ['committed']).length > 0)
})

test('emergency fold under historian backoff makes no model call', async () => {
  const behaviour = { mode: 'throw' }
  const { engine, session, calls, clock, agent } = makeEngine({ behaviour })
  for (let i = 0; i < 49; i += 1) addTurn(session) // ~96.8%
  // first emergency: historian fails (1 call), fallback summary runs
  await engine.compactIfNeeded(agent, 'pressure')
  const afterFirst = calls.length
  assert.ok(historianCalls(calls) >= 1)
  // refill above 95% and step again inside the backoff window
  for (let i = 0; i < 49; i += 1) addTurn(session)
  clock.now += 5_000
  await engine.compactIfNeeded(agent, 'pressure')
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(historianCalls(calls), historianCalls(calls.slice(0, afterFirst)))
})

test('partial historian coverage leaves the rest unsummarized instead of swallowing it', async () => {
  const { engine, session, store, agent } = makeEngine()
  // the fake historian returns one compartment ending halfway through the slice
  engine.options.stream = async function* (options) {
    const seqs = [...options.messages[0].content[0].text.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]))
    const half = seqs[Math.floor(seqs.length / 2)]
    yield { type: 'text', text: JSON.stringify({ compartments: [{ start: seqs[0], end: half, title: 'first half', importance: 50, p1: 'x', p2: 'x', p3: 'x', p4: 'x' }] }) }
  }
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.equal(pending.length, 1)
  const endIdx = session.surface.nodes.indexOf(pending[0].endSeq)
  const tailStart = session.surface.nodes.length - 12 // rough protected tail
  assert.ok(endIdx < tailStart - 2, 'covered span stops well before the eligible end')
})

test('commit is skipped while another compaction transaction is open', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  session.append('compaction/start', { compactionId: 'other', turn: null })
  clock.now += 6 * 60_000
  assert.equal(await engine.compactIfNeeded(agent, 'pressure'), null)
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
  session.append('compaction/end', { compactionId: 'other', turn: null })
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure'), null)
})

test('background historian is not tied to the turn signal', async () => {
  const { engine, session, store, agent } = makeEngine()
  for (let i = 0; i < 20; i += 1) addTurn(session)
  const controller = new AbortController()
  let seen
  const stream = engine.options.stream
  engine.options.stream = options => { seen = options.signal; return stream(options) }
  await engine.compactIfNeeded(agent, 'pressure', controller.signal)
  controller.abort()
  await settle()
  assert.notEqual(seen, controller.signal)
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
})

test('size thresholds use provider tokens: a usage anchor 2x the heuristic fires the historian a heuristic-only meter would not', async () => {
  // 10 turns = 20K heuristic at 20% of the 100K window: the tail (~19K)
  // eats nearly all of it, so nothing is eligible in heuristic units
  const plain = makeEngine()
  for (let i = 0; i < 10; i += 1) addTurn(plain.session)
  await plain.engine.compactIfNeeded(plain.agent, 'pressure')
  await settle()
  assert.equal(historianCalls(plain.calls), 0)
  // the same surface where the provider reported twice the heuristic:
  // 40K real, tail ~16K real, eligible ~24K real ≥ 3 × 5K
  const scaled = makeEngine()
  for (let i = 0; i < 10; i += 1) addTurn(scaled.session)
  const measure = scaled.engine.options.measure
  scaled.engine.options.measure = s => {
    const m = measure(s)
    return { ...m, baseline: { kind: 'usage', tokens: m.totalTokens * 2 }, surfaceDeltaTokens: 0, surfaceTokens: m.totalTokens, totalTokens: m.totalTokens * 2 }
  }
  await scaled.engine.compactIfNeeded(scaled.agent, 'pressure')
  await settle()
  assert.equal(historianCalls(scaled.calls), 1)
})

test('pressure is measured against the input capacity (window minus the output reservation)', async () => {
  // 60K of a 100K window is under 65%; with 10K reserved for output it is
  // 60/90 = 67%, past the execute threshold: pending work commits on a warm cache
  const { engine, session, store, agent } = makeEngine()
  session.requestHeader = () => ({ config: { provider: 'p', model: 'main', maxTokens: 10_000 } })
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
  for (let i = 0; i < 10; i += 1) addTurn(session)
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure'), null)
})

test('a sub-agent keeps its task prompt: compaction starts after the first user message', async () => {
  const { engine, session, store, agent } = makeEngine()
  session.header = { cwd: '/repo', origin: 'subagent' }
  for (let i = 0; i < 20; i += 1) addTurn(session)
  const task = session.surface.nodes[1]
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length > 0)
  assert.equal(pending[0].startSeq, session.surface.nodes[2])
  // a forced commit replaces the span after the task prompt, not the prompt
  const result = await engine.compactNow(agent)
  assert.notEqual(result, null)
  assert.equal(session.surface.nodes[1], task)
  assert.equal(store.checkpointSeq(session.id), session.surface.nodes[2])
  // lineage holds on the next pass: the checkpoint is found right after the head
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(store.compartments(session.id, ['committed']).length > 0, true)
})

test('a sub-agent whose task prompt follows a harness notice pins both', async () => {
  const { engine, session, store, agent } = makeEngine()
  session.header = { cwd: '/repo', origin: 'subagent' }
  session.append('user/message', { id: 'wd', role: 'user', source: { kind: 'working-directory' }, content: [{ type: 'text', text: 'The working directory changed from /a to /b' }] })
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length > 0)
  // nodes: [system, notice, task prompt, ...]: compaction starts after the task prompt
  assert.equal(pending[0].startSeq, session.surface.nodes[3])
})

test('a forked (seeded) sub-agent is not pinned: its first surface message is inherited parent history', async () => {
  const { engine, session, store, agent } = makeEngine()
  session.header = { cwd: '/repo', origin: 'subagent', isSeeded: true }
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const pending = store.compartments(session.id, ['pending'])
  assert.ok(pending.length > 0)
  assert.equal(pending[0].startSeq, session.surface.nodes[1])
})

// ------------------------------------------------- historian facts (ADR-11)

/** A historian that covers the whole slice and states the given facts. */
function factHistorian(facts, { half = false } = {}) {
  const inputs = []
  return {
    inputs,
    stream: async function* (options) {
      const text = options.messages[0].content[0].text
      inputs.push(text)
      const seqs = [...text.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]))
      const end = half ? seqs[Math.floor(seqs.length / 2)] : seqs.at(-1)
      yield { type: 'text', text: JSON.stringify({ compartments: [{ start: seqs[0], end, title: 'work', importance: 60, p1: 'p', p2: 'p', p3: 'p', p4: 'k' }], facts }) }
    },
  }
}

test('historian facts become project memories tagged as historian output, deduped against the store', async () => {
  const { engine, session, store, agent } = makeEngine()
  store.write({ projectId: 'proj', category: 'NAMING', content: 'The deployment repo is called example-deploy.' })
  const fake = factHistorian([
    { category: 'PROJECT_RULES', content: 'Run npm test before every commit.' },
    { category: 'naming', content: 'The deployment repo is called example-deploy.' }, // restated: a re-observation
    { category: 'STATUS', content: 'Tests are green.' }, // unknown category: dropped
    { category: 'ARCHITECTURE', content: '' }, // empty: dropped
  ])
  engine.options.stream = fake.stream
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  // the existing memory is shown to the historian for dedup
  assert.match(fake.inputs[0], /<project-memory>\n- NAMING: The deployment repo is called example-deploy\.\n<\/project-memory>/)
  const rows = store.list({ projectId: 'proj' })
  const rule = rows.find(row => row.category === 'PROJECT_RULES')
  assert.equal(rule.content, 'Run npm test before every commit.')
  assert.equal(rule.source_type, 'historian')
  assert.equal(rule.source_session, session.id)
  assert.equal(rule.importance, 40)
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row => row.category === 'NAMING').seen_count, 2)
  const run = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'historian'").get()
  assert.equal(JSON.parse(run.summary_json).facts, 1)
})

test('a historian fact never revives an archived memory or promotes a note: it only counts as seen', async () => {
  const { engine, session, store, agent } = makeEngine()
  const archived = store.write({ projectId: 'proj', category: 'ARCHITECTURE', content: 'The cache layer is write-through.' })
  store.archive(archived.id, { reason: 'wrong' })
  const note = store.write({ projectId: 'proj', category: 'NAMING', content: 'The panel is called Context.', sourceType: 'note' })
  engine.options.stream = factHistorian([
    { category: 'ARCHITECTURE', content: 'The cache layer is write-through.' },
    { category: 'NAMING', content: 'The panel is called Context.' },
  ]).stream
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const back = store.get(archived.id)
  assert.equal(back.status, 'archived')
  assert.equal(back.seen_count, 2)
  const stillNote = store.get(note.id)
  assert.equal(stillNote.source_type, 'note')
  assert.equal(stillNote.seen_count, 2)
  assert.equal(store.list({ projectId: 'proj' }).filter(row => row.source_type === 'historian').length, 0)
})

test('facts from a call that stopped early are not promoted (the rest is read again)', async () => {
  const { engine, session, store, agent } = makeEngine()
  engine.options.stream = factHistorian([{ category: 'PROJECT_RULES', content: 'Never push without review.' }], { half: true }).stream
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.equal(store.compartments(session.id, ['pending']).length, 1)
  assert.equal(store.list({ projectId: 'proj' }).length, 0)
})

test('HIPPOCAMPUS_HISTORIAN_FACTS=off: no memory block, no promotion', async () => {
  const { engine, session, store, agent } = makeEngine({ env: { HIPPOCAMPUS_HISTORIAN_FACTS: 'off' } })
  store.write({ projectId: 'proj', category: 'NAMING', content: 'X is Y.' })
  const fake = factHistorian([{ category: 'PROJECT_RULES', content: 'Never push without review.' }])
  engine.options.stream = fake.stream
  for (let i = 0; i < 20; i += 1) addTurn(session)
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  assert.doesNotMatch(fake.inputs[0], /project-memory/)
  assert.equal(store.list({ projectId: 'proj' }).length, 1)
})
