import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  triggerBudget,
  protectedTailTokens,
  historianChunkTokens,
  decayTier,
  chooseTiers,
  renderHistory,
  renderCompartment,
  formatNode,
  parseHistorianOutput,
  historianUserMessage,
  roughTokens,
  providerScale,
  providerPrice,
  toolsHeuristicTokens,
  inputCapacity,
} from '../lib/compartments.js'

const compartment = (startSeq, endSeq, importance = 50, size = 1) => ({
  startSeq,
  endSeq,
  title: `unit ${startSeq}`,
  importance,
  p1: 'full '.repeat(80 * size),
  p2: 'mid '.repeat(25 * size),
  p3: 'short summary',
  p4: 'kw',
})

test('trigger budget: 5% of usable, clamped to [5K, 50K]', () => {
  assert.equal(triggerBudget(1_000_000, 0.65), 32_500)
  assert.equal(triggerBudget(32_000, 0.65), 5_000)
  assert.equal(triggerBudget(10_000_000, 0.65), 50_000)
})

test('protected tail: shrinks with pressure, capped at 96K, floored', () => {
  // usable 650K: α·(1−u)·usable = 0.3·650K at u=0 → 195K, capped at 96K
  assert.equal(protectedTailTokens(1_000_000, 0.65, 0), 96_000)
  // at u=0.6: 0.3·0.4·650K = 78K
  assert.equal(protectedTailTokens(1_000_000, 0.65, 0.6), 78_000)
  // at u=1: the floor (8% of usable clamped to 12K)
  assert.equal(protectedTailTokens(1_000_000, 0.65, 1), 12_000)
  // small window: floor min 2K
  assert.equal(protectedTailTokens(20_000, 0.65, 1), 2_000)
})

test('historian chunk: 25% of the historian window, clamped', () => {
  assert.equal(historianChunkTokens(1_000_000), 50_000)
  assert.equal(historianChunkTokens(100_000), 25_000)
  assert.equal(historianChunkTokens(0), 8_000)
})

test('provider scale: usage ÷ the anchor heuristic (tools + surface − delta), clamped; 1 without a usage anchor', () => {
  const usage = (u, surface, delta = 0) => ({ baseline: { kind: 'usage', tokens: u }, totalTokens: u + delta, surfaceTokens: surface, surfaceDeltaTokens: delta })
  assert.equal(providerScale(usage(505_225, 210_319), 18_774), 505_225 / (210_319 + 18_774))
  // a replace after the anchor (seq 625: 128K heuristic out) leaves the ratio where it was
  assert.equal(providerScale(usage(505_285, 210_514 - 128_467, -128_467), 18_774), 505_285 / (210_514 + 18_774))
  assert.equal(providerScale(usage(90_000, 100_000)), 0.9)
  assert.equal(providerScale(usage(1_000_000, 100_000)), 4)
  assert.equal(providerScale(usage(10_000, 100_000)), 0.5)
  assert.equal(providerScale({ baseline: { kind: 'estimated', tokens: 500_000 }, totalTokens: 500_000, surfaceTokens: 200_000 }), 1)
  assert.equal(providerScale(usage(0, 0)), 1)
  assert.equal(providerScale(undefined), 1)
})

test('provider price: scales the heuristic part only; route-priced image tokens stay', () => {
  assert.equal(providerPrice({ tokens: 100, heuristicTokens: 100 }, 2), 200)
  assert.equal(providerPrice({ tokens: 1_600, heuristicTokens: 100 }, 2), 1_700)
  assert.equal(providerPrice({ tokens: 50 }, 2), 100)
  assert.equal(providerPrice(undefined, 2), 0)
})

test('tools heuristic: the token meter formula over the header tool list', () => {
  const tools = [{ name: 'read', description: 'x', parameters: {} }]
  assert.equal(toolsHeuristicTokens({ tools }), Math.ceil(JSON.stringify(tools).length / 4) + 4)
  assert.equal(toolsHeuristicTokens({ tools: [] }), 0)
  assert.equal(toolsHeuristicTokens(undefined), 0)
})

test('input capacity: window minus the output reservation, capped at 25% of the window', () => {
  assert.equal(inputCapacity(1_000_000, 65_536), 934_464)
  assert.equal(inputCapacity(100_000, 64_000), 75_000)
  assert.equal(inputCapacity(1_000_000, undefined), 1_000_000)
  assert.equal(inputCapacity(1_000_000, 0), 1_000_000)
})

test('decay: newest is full tier, old unimportant work fades, important work lasts longer', () => {
  assert.equal(decayTier(1, 50, 1), 1)
  assert.equal(decayTier(10, 50, 1), 2)
  assert.equal(decayTier(80, 50, 1), 5)
  assert.ok(decayTier(40, 90, 1) < decayTier(40, 20, 1))
  // higher pressure ages everything faster
  assert.ok(decayTier(10, 50, 4) > decayTier(10, 50, 1))
})

test('chooseTiers fits the budget, never archives the newest compartment', () => {
  const list = Array.from({ length: 30 }, (_, i) => compartment(i * 10 + 1, i * 10 + 10))
  const roomy = chooseTiers(list, 1_000_000)
  assert.equal(roomy.at(-1), 1)
  const tight = chooseTiers(list, 400)
  assert.ok(tight.at(-1) <= 4)
  const rendered = renderHistory(list, 400)
  // the rendered sections (excluding the wrapper) fit roughly in the budget
  assert.ok(roughTokens(rendered.text) < 600, `got ${roughTokens(rendered.text)}`)
  assert.ok(rendered.text.includes('archived'))
  // the oldest goes first
  assert.ok(tight[0] >= tight.at(-1))
})

test('renderCompartment: heading carries the seq range, tier falls back to a richer one', () => {
  const c = { startSeq: 3, endSeq: 9, title: 'Fix\nparser', importance: 50, p1: 'full text', p2: '', p3: '', p4: '' }
  assert.equal(renderCompartment(c, 3), '## §3–9§ Fix parser\nfull text')
  assert.equal(renderCompartment(c, 5), '')
  const nested = { ...c, p1: '## not a heading\nbody' }
  assert.ok(renderCompartment(nested, 1).includes('\n ## not a heading'))
})

test('formatNode: user verbatim, TC/TR compact, reasoning and system dropped', () => {
  const names = new Map()
  assert.equal(formatNode(1, { role: 'system', content: [{ type: 'text', text: 'sys' }] }), '')
  assert.equal(formatNode(2, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fix this' }] }), '[2] U: fix this')
  const assistant = formatNode(3, {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'secret thoughts' },
      { type: 'text', text: 'looking' },
      { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":"a.js"}' },
    ],
  }, names)
  assert.equal(assistant, '[3] A: looking\n[3] TC: read({"file_path":"a.js"})')
  const tool = formatNode(4, { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(1000) }] }, names)
  assert.ok(tool.startsWith('[4] TR read: xxx'))
  assert.ok(tool.length < 320)
  assert.equal(formatNode(5, { role: 'user', source: { kind: 'hippocampus' }, content: [{ type: 'text', text: 'mem' }] }), '[5] (project-memory injection)')
})

test('parseHistorianOutput: snaps bounds onto the slice and covers it end to end', () => {
  const seqs = [10, 11, 12, 13, 14, 15]
  const text = 'noise {"compartments":[' +
    '{"start":9,"end":12,"title":"a","importance":70,"p1":"A1","p2":"A2","p3":"A3","p4":"A4"},' +
    '{"start":13.5,"end":99,"title":"b","importance":"x","p1":"B1","p2":"","p3":"","p4":""}]} trailing'
  const out = parseHistorianOutput(text, seqs)
  assert.deepEqual(out.map(c => [c.startSeq, c.endSeq]), [[10, 12], [13, 15]])
  assert.equal(out[0].importance, 70)
  assert.equal(out[1].importance, 50)
})

test('parseHistorianOutput: rejects junk', () => {
  assert.throws(() => parseHistorianOutput('no json here', [1]))
  assert.throws(() => parseHistorianOutput('{"compartments":[]}', [1]))
  assert.throws(() => parseHistorianOutput('{"compartments":[{"start":1,"p1":""}]}', [1]))
})

test('parseHistorianOutput: duplicate starts collapse, coverage stays contiguous', () => {
  const out = parseHistorianOutput('{"compartments":[{"start":1,"p1":"a"},{"start":1,"p1":"b"},{"start":3,"p1":"c"}]}', [1, 2, 3, 4])
  const ranges = out.map(c => [c.startSeq, c.endSeq])
  assert.equal(ranges[0][0], 1)
  assert.equal(ranges.at(-1)[1], 4)
  for (let i = 1; i < ranges.length; i += 1) assert.ok(ranges[i][0] > ranges[i - 1][1])
})

test('historianUserMessage includes earlier compartments for continuity', () => {
  const text = historianUserMessage('[1] U: hi', [compartment(1, 5)])
  assert.ok(text.includes('<earlier-compartments>'))
  assert.ok(text.includes('short summary'))
  assert.ok(text.includes('[1] U: hi'))
})

test('formatNode: injected context is skipped or labelled, long text keeps head and tail', () => {
  const user = (kind, text) => ({ role: 'user', source: { kind }, content: [{ type: 'text', text }] })
  assert.equal(formatNode(1, user('skill-catalog', 'x'.repeat(10000))), '')
  assert.equal(formatNode(2, user('time-context', 'now')), '')
  assert.match(formatNode(3, user('agent-message', 'report')), /^\[3\] AGENT REPORT: report/)
  assert.match(formatNode(4, user('something-new', 'ctx')), /^\[4\] CONTEXT\(something-new\): ctx/)
  const long = formatNode(5, user('user', `HEAD${'m'.repeat(50000)}TAIL`))
  assert.ok(long.length < 7000)
  assert.ok(long.includes('HEAD') && long.includes('TAIL') && long.includes('chars omitted'))
})

test('parseHistorianOutput honours the declared end of the last compartment', () => {
  const out = parseHistorianOutput('{"compartments":[{"start":1,"end":3,"p1":"a"}]}', [1, 2, 3, 4, 5, 6])
  assert.deepEqual(out.map(c => [c.startSeq, c.endSeq]), [[1, 3]])
  const missing = parseHistorianOutput('{"compartments":[{"start":1,"p1":"a"}]}', [1, 2, 3])
  assert.equal(missing[0].endSeq, 3)
})
