import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { registerReduceTool } from '../lib/index.js'

const SURFACE = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

function session() {
  const events = []
  const nodes = []
  const append = (type, data) => {
    events.push({ type, seq: events.length, data })
    if (SURFACE.has(type)) nodes.push(events.length - 1)
    return events.length - 1
  }
  append('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } })
  let n = 0
  const call = (name, args, text = 'o'.repeat(2000)) => {
    n += 1
    append('assistant/message', { message: { role: 'assistant', content: [{ type: 'tool-call', id: `c${n}`, name, arguments: args }] } })
    return append('tool/result', { message: { role: 'tool', toolCallId: `c${n}`, content: [{ type: 'text', text }] } })
  }
  return {
    id: 's1',
    surface: { nodes },
    eventAt: seq => events[seq],
    deriveEventMessage: event => event === undefined ? null : event.type === 'user/message' ? event.data : event.data.message,
    call,
  }
}

function harness() {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-reduce-')), 'm.db'))
  const registered = []
  registerReduceTool({ tools: { register: def => registered.push(def) } }, { defineTool: def => def }, { store })
  const s = session()
  return { store, s, tool: registered[0], run: args => registered[0].execute(args, { agent: { session: s } }) }
}

test('ctx_reduce queues matching outputs and reports what it matched', () => {
  const { store, s, tool, run } = harness()
  assert.equal(tool.name, 'ctx_reduce')
  const npm = s.call('bash', '{"command":"npm test"}', 'x'.repeat(1500))
  s.call('bash', '{"command":"ls"}')
  const result = run({ targets: [{ tool: 'bash', match: 'npm test' }] })
  assert.equal(result.queued, 1)
  assert.deepEqual(result.outputs.map(o => [o.seq, o.tool, o.chars]), [[npm, 'bash', 1500]])
  assert.deepEqual(store.reduceQueue('s1'), [npm])
  // the result is lossless JSON (the tool output schema is json)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

test('ctx_reduce: repeat marks count as already queued; protected tools and misses are reported', () => {
  const { store, s, run } = harness()
  const grep = s.call('grep', '{"pattern":"foo"}')
  const skill = s.call('skill', '{"name":"dsh-doc"}')
  run({ targets: [{ seq: grep }] })
  const again = run({ targets: [{ seq: grep }, { tool: 'skill' }, { tool: 'web_fetch' }] })
  assert.equal(again.queued, 0)
  assert.equal(again.alreadyQueued, 1)
  assert.deepEqual(again.skipped, [{ seq: skill, tool: 'skill', reason: 'protected tool' }])
  assert.deepEqual(again.unmatched, [{ tool: 'web_fetch' }])
  assert.deepEqual(store.reduceQueue('s1'), [grep])
})

test('ctx_reduce reports an output below the placeholder floor as skipped, not queued', () => {
  const { store, s, run } = harness()
  const tiny = s.call('bash', '{"command":"pwd"}', '/repo')
  const result = run({ targets: [{ seq: tiny }] })
  assert.equal(result.queued, 0)
  assert.deepEqual(result.skipped, [{ seq: tiny, tool: 'bash', reason: 'too small to reclaim' }])
  assert.deepEqual(store.reduceQueue('s1'), [])
})

test('ctx_reduce refuses an empty target list and a call without an owning session', () => {
  const { run, tool } = harness()
  assert.throws(() => run({ targets: [] }), /at least one target/)
  assert.throws(() => tool.execute({ targets: [{ tool: 'bash' }] }, {}), /owning agent session/)
})

test('reduce queue is per session and clears by seq', () => {
  const { store } = harness()
  assert.equal(store.queueReduce('a', [5, 7, 5]), 2)
  store.queueReduce('b', [5])
  store.clearReduce('a', [5])
  assert.deepEqual(store.reduceQueue('a'), [7])
  assert.deepEqual(store.reduceQueue('b'), [5])
})
