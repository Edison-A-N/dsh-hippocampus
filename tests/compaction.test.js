import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HippocampusCompaction, BackgroundLane, BACKGROUND_TRIGGER_RATIO, FORCE_COMMIT_RATIO, RESUMMARIZE_GROWTH_RATIO, COMPACTION_INSTRUCTION, resolveThresholds } from '../lib/compaction.js'

const CTX_WINDOW = 100_000

/** A fake surface: nodes = seqs, seq -> token count. */
function fakeSession({ nodeTokens = [1000, 2000, 3000, 4000, 5000], toolCallsAt = new Set() } = {}) {
  const nodes = nodeTokens.map((_, i) => i + 1)
  const appended = []
  return {
    id: 's1',
    surface: { nodes },
    eventAt: seq => ({ seq, type: 'user/message' }),
    deriveEventMessage: event => ({ role: 'user', content: [{ type: 'text', text: `msg@${event.seq}` }], source: { kind: 'user' }, id: `m${event.seq}` }),
    // no maxTokens: the threshold tests below are written against the raw
    // window; the output reservation has its own test
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    append: (type, data, options) => {
      const event = { type, seq: nodes.length + appended.length + 1, data, ...options }
      appended.push(event)
      return event
    },
    appended,
    toolPairingBalancedBefore: seq => !toolCallsAt.has(seq),
  }
}

function fakeAgent(session, totalTokens) {
  return { session, runMaintenance: async task => task() }
}

function makeEngine({ nodeTokens = [1000, 2000, 3000, 4000, 5000], totalTokens = 50_000, summaryText = '## Primary Request and Intent\n- test', streamText = summaryText } = {}) {
  const session = fakeSession({ nodeTokens })
  const calls = []
  const engine = new HippocampusCompaction({
    stream: async function* (options) {
      calls.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: streamText }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: streamText } }
      yield { type: 'finish', reason: 'stop' }
    },
    collectText: blocks => blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'),
    resolveModelInfo: async () => ({ context: { contextWindow: CTX_WINDOW } }),
    measure: () => ({ totalTokens: typeof totalTokens === 'function' ? totalTokens() : totalTokens, nodes: nodeTokens.map((tokens, i) => ({ seq: i + 1, tokens })) }),
    compactionModule: {
      CompactionId: value => ({ value }),
      compactCheckpointSource: compactionId => ({ kind: 'compact-checkpoint', compactionId }),
      toolPairingBalancedBefore: (session, seq) => session.toolPairingBalancedBefore(seq),
      toolPairingBalancedAfter: () => true,
    },
    llmModule: {
      BlockAssembler: class {
        push() {}
        blocks() { return [{ type: 'text', text: streamText }] }
        finish = 'stop'
      },
      CONTEXT_WINDOW_EXCEEDED_CODE: 'CONTEXT_WINDOW_EXCEEDED',
    },
  })
  return { engine, session, calls }
}

test('instruction and thresholds are stable', () => {
  assert.match(COMPACTION_INSTRUCTION, /## Primary Request and Intent/)
  assert.equal(BACKGROUND_TRIGGER_RATIO, 0.65)
  assert.equal(FORCE_COMMIT_RATIO, 0.8)
})

test('below trigger: compactIfNeeded returns null, no llm calls', async () => {
  const { engine, session, calls } = makeEngine({ totalTokens: 10_000 }) // 0.1 ratio
  const agent = fakeAgent(session, 10_000)
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(result, null)
  assert.equal(calls.length, 0)
})

test('pressure is taken against the input capacity: the output reservation counts', async () => {
  // 62K of a 100K window is under the 65% trigger; with 10K reserved for
  // output it is 62/90 = 69%, past it
  const { engine, session, calls } = makeEngine({ totalTokens: 62_000 })
  session.requestHeader = () => ({ config: { provider: 'p', model: 'm', maxTokens: 10_000 } })
  await engine.compactIfNeeded(fakeAgent(session), 'pressure', undefined)
  assert.equal(calls.length, 1)
})

test('over trigger: first call schedules background, returns null, no sync summary on the spot', async () => {
  const { engine, session, calls } = makeEngine({ totalTokens: 70_000 }) // 0.7 ratio
  const agent = fakeAgent(session, 70_000)
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(result, null)
  assert.equal(calls.length, 1) // background call started
  assert.ok(engine.lane.isRunning(session.id))
  // wait for the background run to land
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(engine.landed.has(session.id))
})

test('landed result commits on the next call at/after force ratio', async () => {
  const { engine, session } = makeEngine({ totalTokens: 85_000 }) // 0.85 ratio
  const agent = fakeAgent(session, 85_000)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await new Promise(resolve => setTimeout(resolve, 10))
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.notEqual(result, null)
  // retain 16% of 85k = 13600 from the tail: 5000+4000+3000+2000 = 14000 covers it at idx 1
  assert.deepEqual(result.shadowedSeqs, [1])
  assert.equal(result.summary[1].text, '## Primary Request and Intent\n- test')
  // commit appended: compaction/summary, user/message replace, compaction/end
  const types = session.appended.map(event => event.type)
  assert.deepEqual(types, ['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
  const replace = session.appended[2]
  assert.equal(replace.surfaceOp.op, 'replace')
  assert.equal(replace.surfaceOp.startSeq, 1)
  assert.equal(replace.surfaceOp.endSeq, 1)
})

test('context-overflow: synchronous path, summary and commit in one call', async () => {
  const { engine, session } = makeEngine({ totalTokens: 99_000 })
  const agent = fakeAgent(session, 99_000)
  const result = await engine.compactIfNeeded(agent, 'context-overflow', undefined)
  assert.notEqual(result, null)
  assert.equal(session.appended[2].surfaceOp.op, 'replace')
})

test('compactRegion: explicit span', async () => {
  const { engine, session } = makeEngine({})
  const agent = fakeAgent(session, 10_000)
  const result = await engine.compactRegion(2, 4, agent, undefined)
  assert.equal(result.shadowedRange.start, 2)
  assert.equal(result.shadowedRange.end, 4)
  assert.deepEqual(result.shadowedSeqs, [2, 3, 4])
})

test('compactNow: runMaintenance with retained tail', async () => {
  const { engine, session } = makeEngine({ totalTokens: 50_000 })
  const agent = fakeAgent(session, 50_000)
  const result = await engine.compactNow(agent, undefined)
  assert.notEqual(result, null)
  // retainTokens = 16% of 50k = 8000; from the tail: 5000+4000 = 9000 >= 8000 at idx 3
  // so shadowed = nodes 1..3
  assert.deepEqual(result.shadowedSeqs, [1, 2, 3])
})

test('tool-arc fencing: boundary retreats past unbalanced cut points', async () => {
  // seq 4 has an unanswered tool call: cut before it is unbalanced
  const toolCallsAt = new Set([4])
  const session = fakeSession({ nodeTokens: [1000, 2000, 3000, 4000, 5000], toolCallsAt })
  const engine = new HippocampusCompaction({
    stream: async function* () { yield { type: 'text-delta', index: 0, text: 'x' } },
    resolveModelInfo: async () => ({ context: { contextWindow: CTX_WINDOW } }),
    measure: () => ({ totalTokens: 50_000, nodes: [1000, 2000, 3000, 4000, 5000].map((tokens, i) => ({ seq: i + 1, tokens })) }),
    compactionModule: {
      CompactionId: v => ({ value: v }),
      compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
      toolPairingBalancedBefore: (session, seq) => session.toolPairingBalancedBefore(seq),
    },
    llmModule: { BlockAssembler: class { push() {} blocks() { return [{ type: "text", text: "ok" }] } finish = "stop" } },
  })
  const agent = fakeAgent(session, 50_000)
  const result = await engine.compactNow(agent, undefined)
  // retain 8000 from tail: 5000+4000=9000 → keepFromIdx=3; balancedBefore(4)=false → retreat to 3
  // balancedBefore(3)=true → shadowed = nodes 1..2
  assert.deepEqual(result.shadowedSeqs, [1, 2])
})

test('BackgroundLane dedups concurrent starts', async () => {
  const lane = new BackgroundLane()
  let runs = 0
  const run = async () => { runs += 1; await new Promise(r => setTimeout(r, 20)); return { ok: true } }
  const p1 = lane.start('s', run)
  const p2 = lane.start('s', run)
  assert.equal(p1, p2)
  assert.equal(await p1, await p2)
  assert.equal(runs, 1)
  assert.equal(lane.isRunning('s'), false)
})

test('no requestHeader and no defaults: pressure is skipped, no throw', async () => {
  const engine = new HippocampusCompaction({
    stream: async function* () { yield { type: 'text-delta', index: 0, text: 'x' } },
    resolveModelInfo: async () => ({ context: { contextWindow: CTX_WINDOW } }),
    measure: () => ({ totalTokens: 99_000, nodes: [{ seq: 1, tokens: 99_000 }] }),
    compactionModule: {
      CompactionId: v => ({ value: v }),
      compactCheckpointSource: id => ({ kind: 'compact-checkpoint', compactionId: id }),
      toolPairingBalancedBefore: () => true,
    },
    llmModule: { BlockAssembler: class { push() {} blocks() { return [{ type: "text", text: "ok" }] } finish = "stop" } },
  })
  // no requestHeader on the session, no defaultProvider/defaultModel on the
  // engine: #pressure must return null (skip) instead of throwing
  const session = { ...fakeSession({}), requestHeader: undefined, id: 's-noheader' }
  const agent = fakeAgent(session, 99_000)
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(result, null)
})

const settle = () => new Promise(resolve => setTimeout(resolve, 10))

test('landed summary below force ratio is kept: no repeated background runs', async () => {
  let total = 70_000 // 0.70
  const { engine, session, calls } = makeEngine({ totalTokens: () => total })
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.equal(calls.length, 1)
  const first = engine.landed.get(session.id)
  // many steps between trigger and force, growth under the 10% threshold
  for (const step of [71_000, 73_000, 75_000, 79_000, 79_999]) {
    total = step
    assert.equal(await engine.compactIfNeeded(agent, 'pressure', undefined), null)
    await settle()
  }
  assert.equal(calls.length, 1)
  assert.equal(engine.landed.get(session.id), first)
  assert.equal(session.appended.length, 0)
})

test('growth beyond the threshold re-summarizes exactly once', async () => {
  let total = 66_000 // 0.66
  const { engine, session, calls } = makeEngine({ totalTokens: () => total })
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.equal(calls.length, 1)
  assert.equal(engine.landed.get(session.id).measuredTokens, 66_000)
  total = 76_001 // grew 10.001% of the window since landing
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.equal(calls.length, 2)
  assert.equal(engine.landed.get(session.id).measuredTokens, 76_001)
  // the refreshed summary is now the baseline: further small growth is free
  for (const step of [77_000, 78_000, 79_000]) {
    total = step
    await engine.compactIfNeeded(agent, 'pressure', undefined)
    await settle()
  }
  assert.equal(calls.length, 2)
})

test('kept summary commits at the force ratio without another model call', async () => {
  let total = 70_000
  const { engine, session, calls } = makeEngine({ totalTokens: () => total })
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  total = 75_000
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  total = 80_000 // force ratio: commit the kept summary, no refresh first
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.notEqual(result, null)
  assert.equal(calls.length, 1)
  assert.equal(engine.landed.has(session.id), false)
  assert.deepEqual(session.appended.map(event => event.type), ['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
})

test('landed summary whose range left the surface is dropped, not committed', async () => {
  const { engine, session, calls } = makeEngine({ totalTokens: 85_000 })
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.ok(engine.landed.has(session.id))
  session.surface.nodes = [99, 2, 3, 4, 5] // seq 1 was replaced elsewhere
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(result, null)
  assert.equal(calls.length, 2) // stale one dropped, fresh run started
  assert.equal(session.appended.length, 0)
})

test('resummarize growth threshold: default and env override', () => {
  assert.equal(RESUMMARIZE_GROWTH_RATIO, 0.1)
  assert.equal(resolveThresholds({}).resummarizeGrowth, 0.1)
  assert.equal(resolveThresholds({ HIPPOCAMPUS_RESUMMARIZE_GROWTH: '0.2' }).resummarizeGrowth, 0.2)
  assert.equal(resolveThresholds({ HIPPOCAMPUS_RESUMMARIZE_GROWTH: 'nope' }).resummarizeGrowth, 0.1)
  assert.equal(resolveThresholds({ HIPPOCAMPUS_RESUMMARIZE_GROWTH: '0' }).resummarizeGrowth, 0.1)
})

test('failed refresh does not retry every step', async () => {
  let total = 66_000
  let fail = false
  const { engine, session, calls } = makeEngine({ totalTokens: () => total })
  const stream = engine.options.stream
  engine.options.stream = async function* (options) {
    if (fail) { calls.push(options); throw new Error('upstream down') }
    yield* stream(options)
  }
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  const first = engine.landed.get(session.id)
  fail = true
  total = 77_000 // grew 11%: one refresh attempt, it fails
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.equal(calls.length, 2)
  for (const step of [78_000, 79_000, 79_900]) {
    total = step
    await engine.compactIfNeeded(agent, 'pressure', undefined)
    await settle()
  }
  assert.equal(calls.length, 2)
  assert.equal(engine.landed.get(session.id), first) // old summary still usable
  total = 81_000
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure', undefined), null)
  assert.equal(calls.length, 2)
})

test('refresh still running at force: old summary commits, late result is dropped', async () => {
  let total = 66_000
  let release
  const { engine, session, calls } = makeEngine({ totalTokens: () => total })
  const stream = engine.options.stream
  let hold = false
  engine.options.stream = async function* (options) {
    if (hold) await new Promise(resolve => { release = resolve })
    yield* stream(options)
  }
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  hold = true
  total = 77_000
  await engine.compactIfNeeded(agent, 'pressure', undefined) // refresh starts and blocks
  assert.ok(engine.lane.isRunning(session.id))
  total = 81_000
  const committed = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.notEqual(committed, null)
  assert.equal(calls.length, 1) // commit made no model call (refresh still blocked)
  // the commit replaced seq 1 on the surface
  session.surface.nodes = [100, ...session.surface.nodes.slice(1)]
  hold = false
  release()
  await settle()
  assert.equal(calls.length, 2)
  assert.ok(engine.landed.has(session.id)) // late result landed with a stale range
  const stale = engine.landed.get(session.id)
  total = 85_000 // at force: a stale landed result must still not commit
  const appendedBefore = session.appended.length
  assert.equal(await engine.compactIfNeeded(agent, 'pressure', undefined), null)
  assert.equal(session.appended.length, appendedBefore) // not committed
  assert.notEqual(engine.landed.get(session.id), stale) // dropped
  assert.equal(calls.length, 3) // a fresh run started on the current surface
})

test('landed range with a middle node replaced is dropped', async () => {
  const { engine, session } = makeEngine({ nodeTokens: [1000, 1000, 1000, 1000, 40_000], totalTokens: 85_000 })
  const agent = fakeAgent(session)
  await engine.compactIfNeeded(agent, 'pressure', undefined)
  await settle()
  assert.deepEqual(engine.landed.get(session.id).range.shadowed, [1, 2, 3, 4])
  session.surface.nodes = [1, 99, 4, 5] // seqs 2..3 replaced by a region compaction
  assert.equal(await engine.compactIfNeeded(agent, 'pressure', undefined), null)
  assert.equal(session.appended.length, 0)
})
