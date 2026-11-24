import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { HippocampusCompaction } from '../lib/compaction.js'
import { CompartmentCompaction, resolveCompartmentConfig } from '../lib/historian.js'
import { PRESSURE_MIN_TOKENS, RECLAIM_MARKER, isReclaimed, originSeq, placeholderText, pressureNeed, protectedReclaimTokens, resolveReduceTargets, selectPressure, selectReclaim, selectRequested, toolTier } from '../lib/reclaim.js'
import { parseHistorianOutput } from '../lib/compartments.js'

const WINDOW = 100_000 // usable 65K; protected reclaim window 5.2K
const SURFACE = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

function fakeSession(clock) {
  const events = []
  const nodes = []
  const session = {
    id: 'sess-r',
    header: { cwd: '/repo' },
    surface: { nodes },
    get seq() { return events.length },
    eventAt: seq => events[seq],
    requestHeader: () => ({ config: { provider: 'p', model: 'main' } }),
    deriveEventMessage: event => {
      if (event === undefined) return null
      if (event.type === 'user/message') return event.data
      if (SURFACE.has(event.type)) return event.data.message
      return null
    },
    append(type, data, options = {}) {
      const event = { type, seq: events.length, time: clock.now, data, ...options }
      events.push(event)
      if (options.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.startSeq)
        const end = nodes.indexOf(options.surfaceOp.endSeq)
        if (start === -1 || end < start) throw new Error('bad replace')
        for (const seq of nodes.slice(start, end + 1)) {
          if (!options.sourceEventSeqs?.includes(seq)) throw new Error(`replace must cite ${seq}`)
        }
        nodes.splice(start, end - start + 1, event.seq)
      } else if (SURFACE.has(type)) {
        nodes.push(event.seq)
      }
      return event
    },
    events,
  }
  session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } })
  return session
}

let counter = 0
/** One user message, one assistant tool call, its result. */
function toolTurn(session, { name = 'bash', args = '{}', output = 'x'.repeat(2000), user = true, kind = 'user' } = {}) {
  counter += 1
  if (user) session.append('user/message', { id: `u${counter}`, role: 'user', source: { kind }, content: [{ type: 'text', text: `please do ${counter}` }] })
  session.append('assistant/message', { message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'ok' }, { type: 'tool-call', id: `c${counter}`, name, arguments: args }] }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1000 } })
  return session.append('tool/result', { turn: 1, step: counter, message: { role: 'tool', toolCallId: `c${counter}`, source: { kind: 'tool', callId: `c${counter}` }, content: [{ type: 'text', text: `${name} output ${counter}\n${output}` }] } })
}

const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
const measure = s => {
  const priced = s.surface.nodes.map(seq => ({ seq, tokens: textOf(s.deriveEventMessage(s.eventAt(seq))).length + 4 }))
  return { totalTokens: priced.reduce((a, n) => a + n.tokens, 0), nodes: priced }
}
const priced = s => measure(s).nodes.map(n => n.tokens)

function select(session, extra = {}) {
  const nodes = [...session.surface.nodes]
  return selectReclaim({ session, nodes, priced: priced(session), startIdx: 1, usable: 65_000, ...extra })
}

test('protected window follows magic-context protected_tokens', () => {
  assert.equal(protectedReclaimTokens(65_000), 5_200)
  assert.equal(protectedReclaimTokens(650_000), 32_500)
  assert.equal(protectedReclaimTokens(2_000_000), 64_000)
})

test('select: stale after three user turns, never inside the protected tail', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const old = toolTurn(session)
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'y'.repeat(200) }) // small: below MIN, keep
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000) }) // 6K recent: inside the protected tail or not yet stale
  const picked = select(session)
  assert.deepEqual(picked.map(p => p.seq), [old.seq])
  assert.equal(picked[0].reason, 'stale')
})

test('select: injected context and agent reports are not user turns', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  toolTurn(session)
  for (let i = 0; i < 5; i += 1) toolTurn(session, { output: 'y'.repeat(100), kind: i % 2 ? 'agent-message' : 'skill-catalog' })
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  assert.deepEqual(select(session), [])
})

test('select: token distance makes a result stale without user turns', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const old = toolTurn(session, { user: true })
  for (let i = 0; i < 9; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false }) // ~18K after it ≥ 16.25K
  const seqs = select(session).map(p => p.seq)
  assert.ok(seqs.includes(old.seq))
})

test('select: the size floor stays in heuristic tokens when prices are scaled to provider tokens', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const small = toolTurn(session, { output: 'y'.repeat(150) }) // ~154 heuristic: under the 250 floor
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000) })
  const scaled = priced(session).map(tokens => tokens * 2)
  const picked = selectReclaim({ session, nodes: [...session.surface.nodes], priced: scaled, startIdx: 1, usable: 65_000, scale: 2 })
  assert.ok(!picked.some(p => p.seq === small.seq))
})

test('select: an identical later read makes the older output a duplicate, a different read does not', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const first = toolTurn(session, { name: 'read', args: '{"file_path":"/a.js"}' })
  const other = toolTurn(session, { name: 'read', args: '{"file_path":"/b.js"}', user: false })
  toolTurn(session, { name: 'read', args: '{"file_path":"/a.js"}', user: false })
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  const picked = select(session)
  assert.deepEqual(picked.map(p => [p.seq, p.reason]), [[first.seq, 'duplicate']])
  assert.ok(!picked.some(p => p.seq === other.seq))
})

test('select: protected tools, excluded seqs, non-text results and placeholders stay', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const skill = toolTurn(session, { name: 'skill' })
  const todoOld = toolTurn(session, { name: 'todo_write' })
  const todoNew = toolTurn(session, { name: 'todo_write' })
  const excluded = toolTurn(session)
  const image = toolTurn(session)
  image.data.message.content.push({ type: 'image', data: 'AAAA', mimeType: 'image/png' })
  for (let i = 0; i < 4; i += 1) toolTurn(session, { output: 'y'.repeat(100) })
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  const seqs = select(session, { exclude: new Set([excluded.seq]) }).map(p => p.seq)
  assert.deepEqual(seqs, [todoOld.seq])
  assert.ok(!seqs.includes(skill.seq) && !seqs.includes(todoNew.seq))
})

test('placeholder is a pure function: head and tail lines, the original seq', () => {
  const text = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n')
  const a = placeholderText({ sessionId: 's', seq: 7, name: 'bash', reason: 'stale', text })
  assert.equal(a, placeholderText({ sessionId: 's', seq: 7, name: 'bash', reason: 'stale', text }))
  assert.ok(a.startsWith(RECLAIM_MARKER))
  assert.match(a, /line4\n/)
  assert.doesNotMatch(a, /line5\n|line10\n/)
  assert.match(a, /6 lines omitted/)
  assert.match(a, /line11\nline12\n/) // errors and test failures sit at the end
  assert.match(a, /ctx_expand sessionId=s seq=7/)
})

test('placeholder never splits a surrogate pair', () => {
  const text = `${'a'.repeat(299)}😀${'b'.repeat(50)}`
  const out = placeholderText({ sessionId: 's', seq: 1, name: 'bash', reason: 'stale', text })
  assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
})

test('historian output snaps onto transcript labels when surface seqs are not increasing', () => {
  // a reclaimed node at index 3 carries a newer seq (5000) but is labelled 103
  const seqs = [100, 101, 102, 5000, 104, 105, 106, 107, 108, 109]
  const labels = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]
  const out = JSON.stringify({ compartments: [
    { start: 100, end: 102, title: 'a', importance: 50, p1: 'a' },
    { start: 103, end: 105, title: 'b', importance: 50, p1: 'b' },
    { start: 106, end: 109, title: 'c', importance: 50, p1: 'c' },
  ] })
  const parsed = parseHistorianOutput(out, seqs, labels)
  assert.deepEqual(parsed.map(c => [c.title, c.startSeq, c.endSeq]), [['a', 100, 102], ['b', 5000, 105], ['c', 106, 109]])
})

// ------------------------------------------------------------- engine wiring

function makeEngine() {
  const clock = { now: 1_000_000 }
  const session = fakeSession(clock)
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-reclaim-')), 'm.db'))
  const balanced = (s, upto) => {
    let open = 0
    for (let i = 0; i < upto; i += 1) {
      const event = s.eventAt(s.surface.nodes[i])
      if (event.type === 'assistant/message') open += event.data.message.content.filter(b => b.type === 'tool-call').length
      if (event.type === 'tool/result') open -= 1
    }
    return open === 0
  }
  const historianInputs = []
  const extraStarts = new Set()
  let gate = null
  const shared = {
    stream: options => (async function* () {
      if (options.system === undefined) {
        yield { type: 'text', text: '## Primary Request and Intent\n- fallback' }
        return
      }
      const user = options.messages[0].content[0].text
      historianInputs.push(user)
      if (gate !== null) await gate
      const seqs = [...new Set([...user.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1])))]
      // one compartment per user line: a work unit starts at each U: line
      const starts = seqs.filter(seq => new RegExp(`^\\[${seq}\\] U:`, 'm').test(user) || extraStarts.has(seq))
      if (starts[0] !== seqs[0]) starts.unshift(seqs[0])
      const compartments = starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] - 1 : seqs.at(-1), title: `w${start}`, importance: 60, p1: `did ${start}`, p2: 'd', p3: 'd', p4: 'k' }))
      yield { type: 'text', text: JSON.stringify({ compartments }) }
    })(),
    resolveModelInfo: async () => ({ context: { contextWindow: WINDOW } }),
    measure,
    compactionModule: {
      CompactionId: v => v,
      compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
      toolPairingBalancedBefore: (s, seq) => balanced(s, s.surface.nodes.indexOf(seq)),
      toolPairingBalancedAfter: (s, seq) => balanced(s, s.surface.nodes.indexOf(seq) + 1),
    },
    llmModule: {
      BlockAssembler: class {
        constructor() { this.text = '' }
        push(chunk) { if (chunk.type === 'text') this.text += chunk.text }
        blocks() { return [{ type: 'text', text: this.text }] }
        finish = 'stop'
      },
      freezeMessage: m => Object.freeze(structuredClone(m)),
    },
    store,
    resolver: { resolve: () => ({ id: 'proj' }) },
    env: {},
  }
  const engine = new CompartmentCompaction({ ...shared, fallback: new HippocampusCompaction(shared), now: () => clock.now, estimateText: t => t.length })
  const agent = { session, runMaintenance: async task => task() }
  return { engine, session, store, clock, agent, historianInputs, extraStarts, setGate: g => { gate = g } }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const reclaimed = session => session.surface.nodes.filter(seq => isReclaimed(session.deriveEventMessage(session.eventAt(seq))))

function staleSession(session, turns = 6) {
  const first = toolTurn(session, { output: 'a'.repeat(3000) })
  for (let i = 0; i < turns; i += 1) toolTurn(session, { output: 'b'.repeat(1500) })
  return first
}

test('warm cache, low pressure: no reclaim even when results are stale', async () => {
  const { engine, session, agent } = makeEngine()
  staleSession(session)
  const before = [...session.surface.nodes]
  await engine.compactIfNeeded(agent, 'pressure')
  assert.deepEqual(session.surface.nodes, before)
  assert.equal(session.events.filter(e => e.type === 'compaction/prune').length, 0)
})

test('idle past the reclaim idle threshold (cache TTL, 5m): stale results are reclaimed in one pass with prune shadow prices', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  const first = staleSession(session)
  clock.now += 6 * 60_000
  const tokensBefore = measure(session).totalTokens
  await engine.compactIfNeeded(agent, 'pressure')
  const replaced = reclaimed(session)
  assert.ok(replaced.length >= 1)
  assert.ok(measure(session).totalTokens < tokensBefore)
  // every replacement is preceded by its prune event and cites the original
  for (const seq of replaced) {
    const event = session.eventAt(seq)
    const prune = session.eventAt(seq - 1)
    assert.equal(prune.type, 'compaction/prune')
    assert.deepEqual(prune.data.shadowedSeqs, event.sourceEventSeqs)
    assert.ok(prune.data.shadowedTokenCount > 0)
    assert.equal(event.data.message.toolCallId, session.eventAt(event.sourceEventSeqs[0]).data.message.toolCallId)
  }
  const text = textOf(session.deriveEventMessage(session.eventAt(replaced[0])))
  assert.match(text, new RegExp(`seq=${first.seq}\\]`))
  // a second pass at the same moment changes nothing (placeholders are skipped)
  const after = [...session.surface.nodes]
  await engine.compactIfNeeded(agent, 'pressure')
  assert.deepEqual(session.surface.nodes, after)
  const runs = store.db.prepare("SELECT mode, status FROM compaction_runs WHERE mode = 'reclaim'").all()
  assert.equal(runs.length, 1)
})

test('reclaim rides a commit, and the historian summarizes reclaimed results from their original text', async () => {
  const { engine, session, store, clock, agent, historianInputs } = makeEngine()
  for (let i = 0; i < 30; i += 1) toolTurn(session, { output: `${'q'.repeat(1400)} marker-${i}` })
  await engine.compactIfNeeded(agent, 'pressure') // starts the historian
  await settle()
  assert.ok(store.compartments(session.id, ['pending']).length > 0)
  clock.now += 6 * 60_000
  const result = await engine.compactIfNeeded(agent, 'pressure') // commit + reclaim behind it
  assert.notEqual(result, null)
  assert.ok(reclaimed(session).length > 0)
  // lineage survived: the checkpoint is still recognized on the next pass
  const checkpoint = store.checkpointSeq(session.id)
  assert.equal(session.surface.nodes[1], checkpoint)
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(store.checkpointSeq(session.id), checkpoint)
  assert.ok(store.compartments(session.id, ['committed']).length > 0)
  // more work; the next historian slice covers reclaimed nodes but sees the original output
  for (let i = 0; i < 20; i += 1) toolTurn(session, { output: `${'r'.repeat(1400)} later-${i}` })
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const last = historianInputs.at(-1)
  assert.doesNotMatch(last, /tool output reclaimed/)
})

test('a running historian slice is never reclaimed under it', async () => {
  const { engine, session, store, clock, agent, setGate } = makeEngine()
  let release
  setGate(new Promise(resolve => { release = resolve }))
  for (let i = 0; i < 30; i += 1) toolTurn(session, { output: 'q'.repeat(1400) })
  await engine.compactIfNeeded(agent, 'pressure') // historian starts and blocks
  await settle()
  clock.now += 61 * 60_000
  await engine.compactIfNeeded(agent, 'pressure') // idle reclaim while it runs
  const inflight = engine.inflightSlices.get(session.id)
  assert.ok(inflight !== undefined && inflight.size > 0)
  const replaced = reclaimed(session)
  assert.ok(replaced.length > 0) // reclaim did run, outside the slice
  for (const seq of replaced) assert.ok(!inflight.has(session.eventAt(seq).sourceEventSeqs[0]))
  release()
  await settle()
  assert.ok(store.compartments(session.id, ['pending']).length > 0) // its result still landed
})

test('originSeq follows a replacement chain back to the first result', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const original = toolTurn(session)
  const once = session.append('tool/result', { ...original.data }, { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
  const twice = session.append('tool/result', { ...original.data }, { surfaceOp: { op: 'replace', startSeq: once.seq, endSeq: once.seq }, sourceEventSeqs: [once.seq] })
  assert.equal(originSeq(session, twice.seq), original.seq)
  assert.equal(originSeq(session, original.seq), original.seq)
})

test('a compartment that starts on a reclaimed node keeps its own range', async () => {
  const { engine, session, store, clock, agent, historianInputs, extraStarts } = makeEngine()
  for (let i = 0; i < 6; i += 1) toolTurn(session, { output: 'p'.repeat(1500) })
  clock.now += 61 * 60_000
  await engine.compactIfNeeded(agent, 'pressure') // idle reclaim of the early results
  const replaced = reclaimed(session)
  assert.ok(replaced.length > 1)
  const target = replaced[1] // a reclaimed node in the middle of the next slice
  const origin = session.eventAt(target).sourceEventSeqs[0]
  extraStarts.add(origin) // the historian starts a work unit exactly there
  for (let i = 0; i < 30; i += 1) toolTurn(session, { output: 'q'.repeat(1400) })
  await engine.compactIfNeeded(agent, 'pressure')
  await settle()
  const transcript = historianInputs.at(-1)
  const labels = [...transcript.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]))
  for (let i = 1; i < labels.length; i += 1) assert.ok(labels[i] >= labels[i - 1], `labels increase: ${labels[i - 1]} → ${labels[i]}`)
  const pending = store.compartments(session.id, ['pending'])
  // the unit the historian started at the reclaimed node starts there on the surface,
  // carries its own text, and the unit before it ends right before it
  const unit = pending.find(c => c.p1 === `did ${origin}`)
  assert.ok(unit !== undefined, 'the compartment that starts on the reclaimed node was kept')
  assert.equal(unit.startSeq, target)
  const nodes = session.surface.nodes
  const before = pending[pending.indexOf(unit) - 1]
  assert.equal(nodes.indexOf(before.endSeq), nodes.indexOf(target) - 1)
  let last = -1
  for (const c of pending) {
    const a = nodes.indexOf(c.startSeq)
    const b = nodes.indexOf(c.endSeq)
    assert.ok(a > last && b >= a, `compartment ${c.title} [${c.startSeq}, ${c.endSeq}] lies in order`)
    last = b
  }
  // the committed checkpoint cites the original seq in its heading, in order
  clock.now += 6 * 60_000
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure'), null)
  const text = textOf(session.deriveEventMessage(session.eventAt(store.checkpointSeq(session.id))))
  assert.match(text, new RegExp(`## §${origin}–\\d+§`))
  for (const [, a, b] of text.matchAll(/## §(\d+)–(\d+)§/g)) assert.ok(Number(a) <= Number(b), `heading §${a}–${b}§ in order`)
})

test('warm cache at 70% with nothing pending: no reclaim', async () => {
  const { engine, session, agent } = makeEngine()
  // 70K of 100K window: above the 65% threshold, below the 85% force band
  for (let i = 0; i < 46; i += 1) toolTurn(session, { output: 'b'.repeat(1500) })
  const before = [...session.surface.nodes]
  const ratio = measure(session).totalTokens / WINDOW
  assert.ok(ratio > 0.65 && ratio < 0.85, `ratio ${ratio}`)
  engine.lane.isRunning = () => true // keep the historian out of the way
  await engine.compactIfNeeded(agent, 'pressure')
  assert.deepEqual(session.surface.nodes, before)
})

/** Assistant prose (not a tool result, not a user turn) to raise pressure. */
function filler(session, chars) {
  session.append('assistant/message', { message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'w'.repeat(chars) }] } })
}

test('force band reclaims on a warm cache only when the batch is worth 2% of usable context', async () => {
  const small = makeEngine()
  // ~86K surface, but only one stale result worth ~1K: below the 1.3K floor
  toolTurn(small.session, { output: 'a'.repeat(1000) })
  for (let i = 0; i < 3; i += 1) toolTurn(small.session, { output: 'y'.repeat(100) })
  filler(small.session, 84_000)
  small.engine.lane.isRunning = () => true
  const ratio = measure(small.session).totalTokens / WINDOW
  assert.ok(ratio >= 0.85 && ratio < 0.95, `ratio ${ratio}`)
  await small.engine.compactIfNeeded(small.agent, 'pressure')
  assert.equal(reclaimed(small.session).length, 0)

  const big = makeEngine()
  for (let i = 0; i < 6; i += 1) toolTurn(big.session, { output: 'a'.repeat(3000) })
  for (let i = 0; i < 3; i += 1) toolTurn(big.session, { output: 'y'.repeat(100) })
  filler(big.session, 67_000)
  big.engine.lane.isRunning = () => true
  const bigRatio = measure(big.session).totalTokens / WINDOW
  assert.ok(bigRatio >= 0.85 && bigRatio < 0.95, `ratio ${bigRatio}`)
  await big.engine.compactIfNeeded(big.agent, 'pressure')
  assert.ok(reclaimed(big.session).length >= 6)
})

test('a step that switches model reclaims on a warm cache; the same model does not', async () => {
  const same = makeEngine()
  staleSession(same.session)
  await same.engine.compactIfNeeded(same.agent, 'pressure', undefined, { modelSelection: { provider: 'p', model: 'main' } })
  assert.equal(reclaimed(same.session).length, 0)

  const switched = makeEngine()
  staleSession(switched.session)
  await switched.engine.compactIfNeeded(switched.agent, 'pressure', undefined, { modelSelection: { provider: 'p', model: 'other' } })
  assert.ok(reclaimed(switched.session).length > 0)
  const run = switched.store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").get()
  assert.match(run.summary_json, /model-switch/)
})

test('overflow reclaims even when the fold itself fails', async () => {
  const { engine, session, agent } = makeEngine()
  staleSession(session)
  engine.lane.isRunning = () => false
  // make every model call fail: the inline historian and the fallback
  engine.options.stream = () => (async function* () { throw new Error('provider down') })()
  engine.options.fallback.options.stream = engine.options.stream
  const result = await engine.compactIfNeeded(agent, 'context-overflow') // must not throw
  assert.equal(result, null)
  assert.ok(reclaimed(session).length > 0)
})


test('idle under the cache TTL: standalone reclaim waits; past it, reclaim runs', async () => {
  const { engine, session, clock, agent } = makeEngine()
  staleSession(session)
  clock.now += 4 * 60_000 // short of 5m: the cache may still be warm
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(reclaimed(session).length, 0)
  clock.now += 2 * 60_000
  await engine.compactIfNeeded(agent, 'pressure')
  assert.ok(reclaimed(session).length > 0)
})

test('reclaim idle threshold: the cache TTL by default, configurable, never under the commit TTL', () => {
  assert.equal(resolveCompartmentConfig({}).reclaimIdleMs, 300_000)
  assert.equal(resolveCompartmentConfig({ HIPPOCAMPUS_CACHE_TTL: '1h' }).reclaimIdleMs, 3_600_000)
  assert.equal(resolveCompartmentConfig({ HIPPOCAMPUS_RECLAIM_IDLE: '20m' }).reclaimIdleMs, 1_200_000)
  assert.equal(resolveCompartmentConfig({ HIPPOCAMPUS_RECLAIM_IDLE: '1m', HIPPOCAMPUS_CACHE_TTL: '10m' }).reclaimIdleMs, 600_000)
  assert.equal(resolveCompartmentConfig({ HIPPOCAMPUS_RECLAIM_IDLE: 'never' }).reclaimIdleMs, Number.POSITIVE_INFINITY)
})

// ------------------------------------------------- ctx_reduce (ADR-11)

test('reduce targets resolve by tool + argument fragment or by seq; protected tools are reported, not queued', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const npm = toolTurn(session, { name: 'bash', args: '{"command":"npm test"}' })
  const ls = toolTurn(session, { name: 'bash', args: '{"command":"ls -la"}' })
  const read = toolTurn(session, { name: 'read', args: '{"file_path":"/repo/lib/store.js"}' })
  const skill = toolTurn(session, { name: 'skill', args: '{"name":"x"}' })
  const [byMatch, byTool, bySeq, protectedOne, none] = resolveReduceTargets(session, [
    { tool: 'bash', match: 'npm test' },
    { tool: 'bash' },
    { seq: read.seq },
    { tool: 'skill' },
    { tool: 'grep' },
  ])
  assert.deepEqual(byMatch.results.map(r => r.seq), [npm.seq])
  assert.deepEqual(byTool.results.map(r => r.seq), [npm.seq, ls.seq])
  assert.deepEqual(bySeq.results.map(r => r.name), ['read'])
  assert.deepEqual(protectedOne.results.map(r => [r.seq, r.skipped]), [[skill.seq, 'protected tool']])
  assert.deepEqual(none.results, [])
  // a target with neither tool, match nor seq matches nothing (never "everything")
  assert.deepEqual(resolveReduceTargets(session, [{}])[0].results, [])
})

test('requested drops: applied outside the protected window, held inside it or under a pending boundary, forgotten once gone', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const old = toolTurn(session, { output: 'a'.repeat(3000) })
  const boundary = toolTurn(session, { output: 'a'.repeat(3000) })
  const small = toolTurn(session, { output: 'y'.repeat(100) })
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  const recent = toolTurn(session, { output: 'r'.repeat(2000), user: false })
  const nodes = [...session.surface.nodes]
  const out = selectRequested({ session, nodes, priced: priced(session), startIdx: 1, usable: 65_000, exclude: new Set([boundary.seq]), requested: [old.seq, boundary.seq, small.seq, recent.seq, 99_999] })
  assert.deepEqual(out.picked.map(p => [p.seq, p.reason]), [[old.seq, 'agent']])
  assert.deepEqual(out.held.sort(), [boundary.seq, recent.seq].sort())
  assert.deepEqual(out.gone.sort(), [small.seq, 99_999].sort())
})

test('ctx_reduce queue never starts a rewrite on a warm cache; it rides the next pass that rewrites anyway', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  engine.lane.isRunning = () => false
  engine.lane.start = async () => {} // keep the historian out of the way
  // the queued results are not stale on their own (one user turn, < 16.25K
  // after them) and sit outside the 5.2K protected window
  filler(session, 1)
  const big = []
  for (let i = 0; i < 4; i += 1) big.push(toolTurn(session, { output: 'a'.repeat(3000), user: i === 0 }))
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  assert.equal(select(session).length, 0)
  store.queueReduce(session.id, big.map(r => r.seq))
  // at 70% on a warm cache: still queued. The padding goes before the
  // results so they do not turn stale by token distance.
  session.events[1].data.message.content[0].text = 'w'.repeat(52_000)
  const ratio = measure(session).totalTokens / WINDOW
  assert.ok(ratio >= 0.65 && ratio < 0.85, `ratio ${ratio}`)
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(reclaimed(session).length, 0)
  assert.equal(store.reduceQueue(session.id).length, 4)
  // the cache goes cold: the queued drops land in that pass
  clock.now += 6 * 60_000
  await engine.compactIfNeeded(agent, 'pressure')
  const origins = reclaimed(session).map(seq => originSeq(session, seq))
  for (const result of big) assert.ok(origins.includes(result.seq), `seq ${result.seq} reclaimed`)
  assert.deepEqual(store.reduceQueue(session.id), [])
  const text = textOf(session.deriveEventMessage(session.eventAt(reclaimed(session)[0])))
  assert.match(text, /marked as no longer needed \(ctx_reduce\)/)
  const run = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").get()
  assert.match(run.summary_json, /4 agent/)
  assert.match(run.summary_json, /on idle/)
})

test('ctx_reduce queue waits on a warm cache below the force band', async () => {
  const { engine, session, store, agent } = makeEngine()
  engine.lane.isRunning = () => true
  const big = []
  for (let i = 0; i < 4; i += 1) big.push(toolTurn(session, { output: 'a'.repeat(3000) }))
  filler(session, 58_000)
  store.queueReduce(session.id, big.map(r => r.seq))
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(reclaimed(session).length, 0)
  assert.equal(store.reduceQueue(session.id).length, 4)
})

test('ctx_reduce queue rides a cold-cache pass at low pressure', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  engine.lane.isRunning = () => true
  const target = toolTurn(session, { output: 'a'.repeat(3000) })
  // not stale on its own (one user turn, ~6K after it), and outside the 5.2K protected window
  toolTurn(session, { output: 'y'.repeat(6000) })
  store.queueReduce(session.id, [target.seq])
  clock.now += 6 * 60_000
  await engine.compactIfNeeded(agent, 'pressure')
  assert.deepEqual(reclaimed(session).map(seq => originSeq(session, seq)), [target.seq])
})

// ------------------------------------------- tiered pressure reclaim (ADR-11)

test('tool tiers: reads and plans last, edits and searches next, the rest first', () => {
  assert.equal(toolTier('read'), 1)
  assert.equal(toolTier('todo_write'), 1)
  assert.equal(toolTier('subagent'), 1)
  assert.equal(toolTier('edit'), 2)
  assert.equal(toolTier('grep'), 2)
  assert.equal(toolTier('bash'), 3)
  assert.equal(toolTier('web_fetch'), 3)
  assert.equal(toolTier('mcp__x__read'), 3)
})

test('pressure need: aims at floor + 30% of the gap, refuses when the floor alone exceeds the ceiling or the batch is trivial', () => {
  // total 90K, surface 80K: floor (system + tools) 10K, target 10K + 0.3 × 55K = 26.5K
  assert.equal(pressureNeed({ total: 90_000, surfaceTokens: 80_000, ceiling: 65_000 }), 63_500)
  assert.equal(pressureNeed({ total: 90_000, surfaceTokens: 80_000, ceiling: 65_000, already: 60_000 }), 3_500)
  assert.equal(pressureNeed({ total: 90_000, surfaceTokens: 20_000, ceiling: 65_000 }), 0) // floor 70K ≥ ceiling
  assert.equal(pressureNeed({ total: 20_000, surfaceTokens: 10_000, ceiling: 65_000 }), 0) // under target
  assert.equal(pressureNeed({ total: 90_000, surfaceTokens: 80_000, ceiling: 65_000, already: 63_500 - PRESSURE_MIN_TOKENS }), 0)
})

test('pressure selection: tier 3 first, oldest first; newest 20% of tier 1/2 and the latest round stay below 95%', () => {
  const clock = { now: 0 }
  const session = fakeSession(clock)
  const reads = []
  for (let i = 0; i < 5; i += 1) reads.push(toolTurn(session, { name: 'read', args: `{"file_path":"/f${i}"}`, output: 'r'.repeat(3000), user: false }))
  const bash = []
  for (let i = 0; i < 3; i += 1) bash.push(toolTurn(session, { name: 'bash', args: `{"command":"c${i}"}`, output: 'b'.repeat(3000), user: false }))
  for (let i = 0; i < 3; i += 1) toolTurn(session, { output: 'z'.repeat(2000), user: false })
  const nodes = [...session.surface.nodes]
  const base = { session, nodes, priced: priced(session), startIdx: 1, usable: 65_000 }
  // need 7K: two bash results (tier 3) cover it, reads untouched
  const small = selectPressure({ ...base, need: 7_000 })
  assert.deepEqual(small.map(p => p.seq), [bash[0].seq, bash[1].seq, bash[2].seq].slice(0, small.length))
  assert.ok(small.every(p => p.reason === 'pressure'))
  assert.ok(!small.some(p => reads.some(r => r.seq === p.seq)))
  // need everything: all three bash, then reads oldest first, newest read reserved
  const all = selectPressure({ ...base, need: 1_000_000 }).map(p => p.seq)
  assert.ok(!all.includes(reads[4].seq), 'newest 20% of reads reserved')
  assert.ok(all.includes(reads[0].seq))
  // at 95%: the reserve and the protected window give way, the latest round still stays
  const absolute = selectPressure({ ...base, need: 1_000_000, absolute: true }).map(p => p.seq)
  assert.ok(absolute.includes(reads[4].seq))
  assert.ok(!absolute.includes(nodes.at(-1)), 'the newest round is about to be read')
})

test('force band: pressure reclaim takes current output once per episode when stale output is not enough', async () => {
  const { engine, session, store, agent } = makeEngine()
  engine.lane.isRunning = () => true
  filler(session, 50_000)
  // 12 bash results of ~3K, no user turn between them: the older half is
  // stale by token distance, the newer half is current
  const results = []
  for (let i = 0; i < 12; i += 1) results.push(toolTurn(session, { name: 'bash', args: `{"command":"c${i}"}`, output: 'b'.repeat(3000), user: i === 0 }))
  const ratio = measure(session).totalTokens / WINDOW
  assert.ok(ratio >= 0.85 && ratio < 0.95, `ratio ${ratio}`)
  const stale = new Set(select(session).map(p => p.seq))
  assert.ok(stale.size > 0 && stale.size < 12)
  await engine.compactIfNeeded(agent, 'pressure')
  const origins = new Set(reclaimed(session).map(seq => originSeq(session, seq)))
  const current = results.filter(r => !stale.has(r.seq) && origins.has(r.seq))
  assert.ok(current.length > 0, 'some current output was taken')
  assert.ok(!origins.has(results.at(-1).seq), 'the newest round stays')
  const run = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").get()
  assert.match(run.summary_json, /pressure/)
  // the next step is still in the band: the latch holds, no second batch
  const first = origins.size
  for (let i = 0; i < 3; i += 1) toolTurn(session, { name: 'bash', args: `{"command":"d${i}"}`, output: 'b'.repeat(3000), user: false })
  filler(session, 30_000)
  assert.ok(measure(session).totalTokens / WINDOW >= 0.85)
  await engine.compactIfNeeded(agent, 'pressure')
  const pressureAfter = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").all().filter(row => /pressure/.test(row.summary_json))
  assert.equal(pressureAfter.length, 1)
  assert.ok(reclaimed(session).length >= first)
})

test('pressure reclaim does not take again what the stale lane already took', async () => {
  const { engine, session, store, agent } = makeEngine()
  engine.lane.isRunning = () => true
  toolTurn(session, { name: 'bash', output: 'b'.repeat(3000) })
  toolTurn(session, { name: 'bash', output: 'b'.repeat(3000), user: false })
  filler(session, 82_000)
  assert.ok(measure(session).totalTokens / WINDOW >= 0.85)
  await engine.compactIfNeeded(agent, 'pressure')
  // only the stale lane runs (both results are stale by token distance)
  const runs = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").all()
  assert.ok(runs.every(row => !/pressure/.test(row.summary_json)))
})

test('the pressure latch gives way on a pass that rewrites the prefix anyway', async () => {
  const { engine, session, store, clock, agent } = makeEngine()
  engine.lane.isRunning = () => true
  // current bash output only (one user turn, < 25% newer content after the
  // oldest), padding before it so nothing is stale
  filler(session, 1)
  for (let i = 0; i < 5; i += 1) toolTurn(session, { name: 'bash', args: `{"command":"c${i}"}`, output: 'b'.repeat(3000), user: i === 0 })
  session.events[1].data.message.content[0].text = 'w'.repeat(76_000)
  assert.ok(measure(session).totalTokens / WINDOW >= 0.85)
  assert.equal(select(session).length, 0)
  engine.pressureLatch.add(session.id) // an earlier batch in this episode
  await engine.compactIfNeeded(agent, 'pressure')
  assert.equal(reclaimed(session).length, 0, 'latched on a warm cache')
  // the cache is cold: this pass rewrites anyway. Commit, fold and model
  // switch take the same branch (any reason other than 'force').
  clock.now += 6 * 60_000
  await engine.compactIfNeeded(agent, 'pressure')
  const runs = store.db.prepare("SELECT summary_json FROM compaction_runs WHERE mode = 'reclaim'").all()
  assert.ok(runs.some(row => /pressure/.test(row.summary_json) && /on idle/.test(row.summary_json)), JSON.stringify(runs))
})
