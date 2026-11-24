/**
 * Compartment math and text for the hippocampus historian: the pure half of
 * the magic-context-style context management (no store, no llm, no dsh
 * imports — unit-testable on plain values).
 *
 * The design follows magic-context (OpenCode plugin, v0.49): history is cut
 * into "compartments" (one per work unit), each stored at four summary tiers
 * plus an importance score; one checkpoint message renders all compartments,
 * picking each one's tier with a decay curve so the rendered history fits a
 * fixed budget. The constants below are magic-context's own (see
 * docs/tech/magic-context-notes.md); where DSH differs the comment says why.
 * @module dsh-hippocampus/compartments
 */

/** Fraction of usable context (window × execute threshold) for size-based historian triggers. */
export const TRIGGER_BUDGET_RATIO = 0.05
export const TRIGGER_BUDGET_MIN = 5_000
export const TRIGGER_BUDGET_MAX = 50_000
/** Historian fires once the unsummarized eligible span reaches this many trigger budgets. */
export const TAIL_SIZE_MULTIPLIER = 3

/** Protected-tail sizing (magic-context protected-tail-boundary.ts). */
const TAIL_ALPHA = 0.3
const TAIL_FLOOR_RATIO = 0.08
const TAIL_FLOOR_MIN = 2_000
const TAIL_FLOOR_MAX = 12_000
const TAIL_ABS_CAP = 96_000
const TAIL_MAX_USABLE_RATIO = 0.4
const RESERVE_MIN = 1_000
const RESERVE_RATIO = 0.02

/** Historian input chunk: fraction of the historian model's window, clamped. */
const CHUNK_RATIO = 0.25
const CHUNK_MIN = 8_000
const CHUNK_MAX = 50_000

/** Decay curve (magic-context decay-curve.ts): half-life, importance doubling, tier cuts. */
const H50 = 24
const DECAY_D = 25
const Z_CUTS = [0.201, 0.729, 1.322, 2.587]
const P_FLOOR = 0.1

/** Rough token cost of text when no meter is supplied (CJK-heavy text runs ~1.5–3 chars/token). */
export function roughTokens(text) {
  return Math.ceil(String(text).length / 3)
}

/** Usable working space: window × execute threshold. */
export function usableTokens(window, executeThreshold) {
  return Math.max(1, Math.round(window * executeThreshold))
}

/** The output reservation never takes more than this share of the window. */
const OUTPUT_RESERVE_MAX_RATIO = 0.25

/**
 * Input capacity of a request: the context window minus the output the
 * request reserves (magic-context's context limit; the stock backend also
 * subtracts maxTokens). Pressure and every size threshold are measured
 * against this, not the raw window.
 * @param {number} window - context window tokens
 * @param {number} [maxTokens] - the request's output cap, when known
 */
export function inputCapacity(window, maxTokens) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return window
  return Math.max(1, window - Math.min(maxTokens, Math.floor(window * OUTPUT_RESERVE_MAX_RATIO)))
}

/**
 * Bounds of the provider-tokens-per-heuristic-token factor (CJK and dense
 * JSON run ~2.4×). The floor is a guard only: the meter reports a usage
 * baseline only when usage ≥ its own estimate, so a route below 1× gets
 * factor 1.
 */
const SCALE_MIN = 0.5
const SCALE_MAX = 4

/**
 * Provider tokens per heuristic token, taken at the usage anchor. The token
 * meter reports `totalTokens` = the last provider usage (the anchor) + the
 * heuristic delta of whatever changed on the surface since, and prices every
 * node with its chars/4 heuristic. The real ratio varies by route and content
 * (1.7–2.4× with Chinese and JSON-heavy tool output). Size
 * thresholds are written in provider tokens, so node prices are scaled by
 * this factor first. It is read at the anchor (usage ÷ the anchor's own
 * heuristic price: tools + surface − delta) so a replace or append after the
 * anchor does not move it; `totalTokens / surfaceTokens` would, because the
 * delta is heuristic. Without a usage anchor the factor is 1.
 * @param {object} measurement - token meter measurement
 * @param {number} toolsTokens - heuristic price of the request's tool schemas
 * @returns {number}
 */
export function providerScale(measurement, toolsTokens = 0) {
  if (measurement?.baseline?.kind !== 'usage') return 1
  const anchorHeuristic = toolsTokens + (measurement.surfaceTokens ?? 0) - (measurement.surfaceDeltaTokens ?? 0)
  const usage = measurement.baseline.tokens
  if (!(anchorHeuristic > 0) || !(usage > 0)) return 1
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, usage / anchorHeuristic))
}

/**
 * One node's price in provider tokens. Only the heuristic part is scaled:
 * a route that prices images already charges their real visual tokens in
 * `tokens`, and that difference is kept as is.
 * @param {{tokens?: number, heuristicTokens?: number}} node - token meter node
 * @param {number} scale - providerScale
 */
export function providerPrice(node, scale) {
  if (node === undefined) return 0
  const tokens = node.tokens ?? 0
  const heuristic = node.heuristicTokens ?? tokens
  return heuristic * scale + (tokens - heuristic)
}

/** Heuristic price of the tool schemas in a request header (the token meter's formula). */
export function toolsHeuristicTokens(header) {
  const tools = header?.tools
  if (!Array.isArray(tools) || tools.length === 0) return 0
  return Math.ceil(JSON.stringify(tools).length / 4) + 4
}

/** Size budget behind the tail-size historian trigger. */
export function triggerBudget(window, executeThreshold) {
  const derived = Math.round(usableTokens(window, executeThreshold) * TRIGGER_BUDGET_RATIO)
  return Math.max(TRIGGER_BUDGET_MIN, Math.min(TRIGGER_BUDGET_MAX, derived))
}

/**
 * Protected tail N: the recent span the historian never touches. Shrinks as
 * pressure rises (α·(1−usage)), floored and capped like magic-context.
 * @param {number} window - context window tokens
 * @param {number} executeThreshold - 0..1
 * @param {number} usage - current pressure ratio 0..1
 */
export function protectedTailTokens(window, executeThreshold, usage) {
  const usable = usableTokens(window, executeThreshold)
  const budget = triggerBudget(window, executeThreshold)
  const reserve = Math.max(RESERVE_MIN, Math.round(usable * RESERVE_RATIO))
  const clamped = Math.max(0, Math.min(1, usage))
  const rawN = Math.round(usable * TAIL_ALPHA * (1 - clamped))
  const floorN = Math.min(TAIL_FLOOR_MAX, Math.max(TAIL_FLOOR_MIN, Math.round(usable * TAIL_FLOOR_RATIO)))
  const headroom = Math.min(budget + reserve, Math.floor(usable * 0.5))
  const ceilingN = Math.max(1, Math.min(TAIL_ABS_CAP, Math.floor(usable * TAIL_MAX_USABLE_RATIO), usable - headroom))
  return Math.min(ceilingN, Math.max(Math.min(floorN, ceilingN), rawN))
}

/** Formatted-token budget of one historian call. */
export function historianChunkTokens(historianWindow) {
  if (!Number.isFinite(historianWindow) || historianWindow <= 0) return CHUNK_MIN
  return Math.max(CHUNK_MIN, Math.min(CHUNK_MAX, Math.round(historianWindow * CHUNK_RATIO)))
}

/**
 * Decay tier for one compartment: 1..4 render, 5 = archived (title only is
 * dropped too). `index` counts from the newest compartment (1 = newest).
 */
export function decayTier(index, importance, pressure) {
  const age = Math.max(index, 1) - 1
  const imp = Math.max(1, Math.min(100, importance))
  const p = Math.max(pressure, P_FLOOR)
  const halfLife = H50 * 2 ** ((imp - 50) / DECAY_D) / p
  const z = age / halfLife
  for (let tier = 0; tier < Z_CUTS.length; tier += 1) {
    if (z < Z_CUTS[tier]) return tier + 1
  }
  return 5
}

/** One compartment's heading: seq range (for ctx_expand) and title. */
export function compartmentHeading(compartment) {
  const title = String(compartment.title ?? '').replace(/[\r\n]+/g, ' ').trim() || '(untitled)'
  return `## §${compartment.startSeq}–${compartment.endSeq}§ ${title}`
}

/** Body text of a compartment at a tier, falling back to the next richer tier that exists. */
export function tierBody(compartment, tier) {
  const tiers = [compartment.p1, compartment.p2, compartment.p3, compartment.p4]
  for (let index = tier - 1; index >= 0; index -= 1) {
    const text = tiers[index]
    if (typeof text === 'string' && text.trim() !== '') return text.trim()
  }
  return ''
}

/** Render a compartment at a tier (5 → empty). Body lines starting with "## " are indented so headings stay unambiguous. */
export function renderCompartment(compartment, tier) {
  if (tier >= 5) return ''
  const body = tierBody(compartment, tier).replace(/^## /gm, ' ## ')
  return body === '' ? compartmentHeading(compartment) : `${compartmentHeading(compartment)}\n${body}`
}

/**
 * Choose tiers for every compartment so the rendered history fits the
 * budget. Pressure p = natural cost (everything at its p=1 tier) / budget —
 * since half-life ∝ 1/p the curve self-adjusts; a final oldest-first
 * downgrade loop enforces the budget with the real estimator.
 * @param {Array<object>} compartments - oldest first
 * @param {number} budgetTokens
 * @param {(text: string) => number} [estimate]
 * @returns {number[]} tier per compartment (same order)
 */
export function chooseTiers(compartments, budgetTokens, estimate = roughTokens) {
  const count = compartments.length
  if (count === 0) return []
  const indexOf = position => count - position // newest = 1
  const costCache = new Map()
  const cost = (position, tier) => {
    const key = `${position}:${tier}`
    if (!costCache.has(key)) {
      const text = renderCompartment(compartments[position], tier)
      costCache.set(key, text === '' ? 0 : estimate(text) + 1)
    }
    return costCache.get(key)
  }
  let natural = 0
  compartments.forEach((compartment, position) => {
    natural += cost(position, decayTier(indexOf(position), compartment.importance ?? 50, 1))
  })
  const pressure = budgetTokens > 0 ? Math.max(P_FLOOR, natural / budgetTokens) : 1
  const tiers = compartments.map((compartment, position) =>
    decayTier(indexOf(position), compartment.importance ?? 50, pressure))
  // the newest compartment always renders (it is the hook into the work
  // right before the protected tail)
  tiers[count - 1] = Math.min(tiers[count - 1], 4)
  if (budgetTokens <= 0) return tiers
  let total = tiers.reduce((sum, tier, position) => sum + cost(position, tier), 0)
  // oldest first: step each down one tier, sweep again until it fits; the
  // newest compartment is never archived (the history must keep a hook to
  // the work right before the protected tail)
  while (total > budgetTokens) {
    let changed = false
    for (let position = 0; position < count && total > budgetTokens; position += 1) {
      const limit = position === count - 1 ? 4 : 5
      if (tiers[position] >= limit) continue
      total -= cost(position, tiers[position])
      tiers[position] += 1
      total += cost(position, tiers[position])
      changed = true
    }
    if (!changed) break
  }
  return tiers
}

/** The `<session-history>` block for a set of compartments (oldest first). */
export function renderHistory(compartments, budgetTokens, estimate = roughTokens) {
  const tiers = chooseTiers(compartments, budgetTokens, estimate)
  const sections = compartments
    .map((compartment, position) => renderCompartment(compartment, tiers[position]))
    .filter(text => text !== '')
  const archived = tiers.filter(tier => tier >= 5).length
  const lines = ['<session-history>']
  if (archived > 0) lines.push(`(${archived} older work unit${archived === 1 ? '' : 's'} archived; ctx_search / ctx_expand recover them)`)
  lines.push(...sections)
  lines.push('</session-history>')
  return { text: lines.join('\n\n'), tiers }
}

const TOOL_CALL_ARGS_CHARS = 300
const TOOL_RESULT_CHARS = 240
/** Long user/agent text keeps head and tail: one pasted log must not exceed a historian chunk on its own. */
const TURN_TEXT_CHARS = 6000
const CHECKPOINT_CHARS = 24000
const SUBAGENT_CHARS = 1500
/** Injected context that says nothing about the work (re-derived every session). */
const SKIPPED_SOURCES = new Set(['skill-catalog', 'time-context', 'runtime-context'])
/** Reports from other agents: useful, but not the user's words. */
const AGENT_SOURCES = new Set(['agent-message', 'subagent-settled'])

/** Plain text of a message's text blocks. */
function textOf(message) {
  return (message?.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function clip(text, max) {
  const value = String(text)
  return value.length <= max ? value : `${value.slice(0, max)}… (${value.length} chars)`
}

/** Keep head and tail of long text, naming how much was cut. */
function clipMiddle(text, max) {
  const value = String(text)
  if (value.length <= max) return value
  const head = Math.floor(max * 0.7)
  const tail = max - head
  return `${value.slice(0, head)}\n[… ${value.length - max} chars omitted …]\n${value.slice(-tail)}`
}

/**
 * Format one surface node for the historian transcript. Tool results are
 * reduced to a short head and tool calls to `TC:` lines (magic-context's
 * compact form: a 50K-token chunk then covers far more raw history);
 * reasoning is dropped. Returns '' for nodes with nothing to tell.
 * @param {number} seq
 * @param {object} message - derived surface message
 * @param {Map<string, string>} toolNames - call id → tool name, filled as calls are seen
 */
export function formatNode(seq, message, toolNames = new Map()) {
  if (message === null || message === undefined) return ''
  const role = message.role
  const source = message.source ?? {}
  if (role === 'system' || role === 'developer') return ''
  if (role === 'user') {
    if (source.kind === 'hippocampus') return `[${seq}] (project-memory injection)`
    if (source.kind === 'compact-checkpoint') return `[${seq}] PRIOR CHECKPOINT:\n${clipMiddle(textOf(message), CHECKPOINT_CHARS)}`
    if (SKIPPED_SOURCES.has(source.kind)) return ''
    const text = textOf(message)
    if (text === '') return ''
    if (AGENT_SOURCES.has(source.kind)) return `[${seq}] AGENT REPORT: ${clipMiddle(text, SUBAGENT_CHARS)}`
    if (source.kind !== undefined && source.kind !== 'user') return `[${seq}] CONTEXT(${source.kind}): ${clip(text, TOOL_RESULT_CHARS)}`
    return `[${seq}] U: ${clipMiddle(text, TURN_TEXT_CHARS)}`
  }
  if (role === 'assistant') {
    const lines = []
    const text = textOf(message)
    if (text !== '') lines.push(`[${seq}] A: ${clipMiddle(text, TURN_TEXT_CHARS)}`)
    for (const block of message.content ?? []) {
      if (block?.type !== 'tool-call') continue
      toolNames.set(block.id, block.name)
      lines.push(`[${seq}] TC: ${block.name}(${clip(block.arguments ?? '', TOOL_CALL_ARGS_CHARS)})`)
    }
    return lines.join('\n')
  }
  if (role === 'tool') {
    const name = toolNames.get(message.toolCallId) ?? 'tool'
    const flag = message.isError ? ' ERROR' : ''
    return `[${seq}] TR ${name}${flag}: ${clip(textOf(message).replace(/\s+/g, ' '), TOOL_RESULT_CHARS)}`
  }
  return ''
}

/** Historian system prompt: compartments with four self-contained tiers. */
export const HISTORIAN_SYSTEM = `You are the memory organizer of an AI coding agent — the same mind, writing the long-term record of its own session so it can keep working after the raw messages are dropped from its context.

You receive a transcript slice. Lines are "[seq] U:" (the human user, verbatim; very long text is cut in the middle), "[seq] A:" (agent text), "[seq] TC:" (tool call, args clipped), "[seq] TR:" (tool result head), "[seq] AGENT REPORT:" (a sub-agent's report — not the user's words), "[seq] CONTEXT(kind):" (harness-injected context — never a user request), "PRIOR CHECKPOINT" (an older summary of earlier history). Only "U:" lines carry user intent and preferences. Cut the slice into compartments: one per WORK UNIT, split where the goal changes (a new request, a new problem), not by activity type. A short slice is usually one compartment.

For each compartment write four tiers. Each tier must stand alone (never "see above"):
- p1: full record, 120–400 words. What was asked (quote the user with "U: ..." verbatim when wording matters), what was done and found, decisions and their reasons, exact file paths, commands, identifiers, error strings, numbers, commit hashes, and what is still open.
- p2: the same in 40–120 words, keeping user quotes that carry intent, decisions, paths and open items.
- p3: 1–2 sentences: the goal and the outcome.
- p4: a keyword line (names, paths, hashes) under 20 words.

importance (1–100) is how long this must stay recallable at high fidelity: 80+ for user preferences, constraints, decisions and unfinished commitments; ~50 for ordinary work; 20 or less for dead ends and chatter.

Never invent facts. Write in English except verbatim quotes. Output ONLY one JSON object, no prose, no code fence:
{"compartments":[{"start":<first seq>,"end":<last seq>,"title":"<=12 words","importance":<int>,"p1":"...","p2":"...","p3":"...","p4":"..."}]}
Compartments must be in order, non-overlapping, and together cover the slice from its first to its last seq.`

/**
 * The user message for one historian call.
 * @param {string} transcript - formatted nodes
 * @param {Array<object>} recent - recent existing compartments (for continuity)
 */
export function historianUserMessage(transcript, recent = []) {
  const parts = []
  if (recent.length > 0) {
    parts.push('<earlier-compartments>')
    for (const compartment of recent) parts.push(`- ${compartmentHeading(compartment).slice(3)}: ${tierBody(compartment, 3)}`)
    parts.push('</earlier-compartments>')
  }
  parts.push('<transcript>', transcript, '</transcript>')
  parts.push('Write the compartments JSON for the transcript.')
  return parts.join('\n')
}

/**
 * Parse and validate historian output against the slice's seqs. Compartment
 * bounds are snapped onto the slice: the first starts at the slice's first
 * seq and the last absorbs everything to the slice end (the slice end is a
 * tool-balanced cut; an inner bound the model got wrong is snapped to the
 * nearest slice seq). Throws on unusable output.
 * @param {string} text - raw model output
 * @param {number[]} seqs - the slice's surface seqs, in order
 * @param {number[]} [labels] - the seq each node was labelled with in the
 *   transcript, aligned with `seqs`; defaults to `seqs`. Surface seqs are not
 *   increasing once nodes have been replaced (a replacement carries a newer
 *   seq), so the transcript labels replaced tool results with their original
 *   seq and snapping runs over those labels.
 * @returns {Array<{startSeq, endSeq, title, importance, p1, p2, p3, p4}>}
 */
export function parseHistorianOutput(text, seqs, labels = seqs) {
  if (seqs.length === 0) throw new Error('empty slice')
  if (labels.length !== seqs.length) throw new Error('labels must align with seqs')
  const raw = String(text ?? '')
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first === -1 || last <= first) throw new Error('historian output has no JSON object')
  let parsed
  try {
    parsed = JSON.parse(raw.slice(first, last + 1))
  } catch (error) {
    throw new Error(`historian output is not valid JSON: ${error.message}`)
  }
  const list = Array.isArray(parsed?.compartments) ? parsed.compartments : null
  if (list === null || list.length === 0) throw new Error('historian output has no compartments')
  const usable = list.filter(entry => entry && typeof entry === 'object' && [entry.p1, entry.p2, entry.p3, entry.p4].some(tier => typeof tier === 'string' && tier.trim() !== ''))
  if (usable.length === 0) throw new Error('historian compartments have no text')
  const snap = value => {
    const number = Number(value)
    if (!Number.isFinite(number)) return null
    // an exact label wins; otherwise the node with the largest label ≤ n
    // (labels are increasing in practice, this stays correct if not)
    const exact = labels.indexOf(number)
    if (exact !== -1) return exact
    let best = 0
    let bestLabel = -Infinity
    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] <= number && labels[index] >= bestLabel) {
        best = index
        bestLabel = labels[index]
      }
    }
    return best
  }
  // order by declared start; derive contiguous index ranges from the starts
  const starts = usable
    .map(entry => ({ entry, at: snap(entry.start) ?? 0 }))
    .sort((a, b) => a.at - b.at)
  // the last compartment ends where the model said it ends (snapped onto
  // the slice); content after it stays unsummarized instead of being
  // silently swallowed — the caller shrinks the slice to match
  const lastEnd = (() => {
    const declared = snap(starts.at(-1).entry.end)
    return declared === null ? seqs.length - 1 : Math.max(declared, starts.at(-1).at)
  })()
  const result = []
  for (let k = 0; k < starts.length; k += 1) {
    const startIndex = k === 0 ? 0 : starts[k].at
    const endIndex = k === starts.length - 1 ? lastEnd : starts[k + 1].at - 1
    if (endIndex < startIndex) continue // collapsed onto a neighbour
    const entry = starts[k].entry
    const importance = Math.round(Number(entry.importance))
    result.push({
      startSeq: seqs[startIndex],
      endSeq: seqs[endIndex],
      title: String(entry.title ?? '').slice(0, 200),
      importance: Number.isFinite(importance) ? Math.max(1, Math.min(100, importance)) : 50,
      p1: typeof entry.p1 === 'string' ? entry.p1 : '',
      p2: typeof entry.p2 === 'string' ? entry.p2 : '',
      p3: typeof entry.p3 === 'string' ? entry.p3 : '',
      p4: typeof entry.p4 === 'string' ? entry.p4 : '',
    })
  }
  if (result.length === 0) throw new Error('historian compartments collapsed')
  // the absorbed head: if snapping merged leading entries, the first range
  // must still begin at the slice start
  result[0].startSeq = seqs[0]
  return result
}
