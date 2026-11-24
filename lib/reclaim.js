/**
 * Tool-output reclaim: replace stale tool results on the surface with a short
 * placeholder that names where the full text lives (magic-context's age and
 * dedup reclaim lanes, ADR-10).
 *
 * Summaries alone leave every raw tool output of the unsummarized span on the
 * surface until the historian's next commit; with a large window that span is
 * hundreds of thousands of tokens, a fifth of it old tool output. Reclaim
 * removes that output without a model call.
 *
 * Every replace rewrites the provider-cached prefix from the replaced node
 * on, so the caller decides WHEN (only on a pass whose cache is already lost,
 * see CompartmentCompaction#bustPermission); this module decides WHAT:
 *
 * - stale: a completed result with at least `STALE_USER_TURNS` genuine user
 *   messages after it, or with newer content worth `STALE_TOKEN_RATIO` of the
 *   usable window behind it;
 * - duplicate: an older result of a read-only call whose exact call (name +
 *   arguments) appears again later, so the newer output is the current one.
 *
 * Never touched: the newest `protectedReclaimTokens` of the surface, results
 * worth less than `MIN_RECLAIM_TOKENS`, results with non-text blocks, the
 * protected tools, nodes a pending compartment or a running historian still
 * refers to, and results already reclaimed. Tool-call arguments stay as they
 * are (models copy synthetic argument values into new calls); only the
 * result content changes.
 *
 * The log keeps the original event: the placeholder cites its seq, and
 * ctx_expand reads it back.
 * @module dsh-hippocampus/reclaim
 */

/** Genuine user messages after a result that make it stale. */
export const STALE_USER_TURNS = 3
/** Newer surface content, as a share of usable context, that makes a result stale. */
export const STALE_TOKEN_RATIO = 0.25
/** Results priced below this are not worth a placeholder. */
export const MIN_RECLAIM_TOKENS = 250
/** Leading and trailing text of the original kept in the placeholder (errors and test failures sit at the end). */
export const HEAD_CHARS = 300
export const HEAD_LINES = 4
export const TAIL_CHARS = 200
export const TAIL_LINES = 2
/** First text of every placeholder; also how an already-reclaimed result is recognized. */
export const RECLAIM_MARKER = '[tool output reclaimed by hippocampus'

/**
 * Tools whose results are never reclaimed: `Infinity` keeps all of them,
 * a number keeps that many newest. Skill bodies are instructions the agent is
 * still following; the newest todo list is the live plan.
 */
export const PROTECTED_TOOLS = new Map([
  ['skill', Number.POSITIVE_INFINITY],
  ['todo_write', 1],
])

/** Read-only tools: an identical later call makes the older output redundant. */
export const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'web_fetch', 'ctx_expand', 'ctx_search', 'read_mcp_resource'])

/**
 * Surface tokens automatic reclaim never touches: magic-context's derived
 * `protected_tokens` = clamp(5% usable, min(16K, 8% usable), 64K).
 * @param {number} usable - usable context tokens (window × execute threshold)
 */
export function protectedReclaimTokens(usable) {
  const floor = Math.min(16_000, Math.round(0.08 * usable))
  return Math.max(floor, Math.min(64_000, Math.round(0.05 * usable)))
}

function textBlocks(message) {
  return (message?.content ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

/** Whether a tool message is a placeholder this module wrote. */
export function isReclaimed(message) {
  const first = message?.content?.[0]
  return first?.type === 'text' && typeof first.text === 'string' && first.text.startsWith(RECLAIM_MARKER)
}

/** A genuine user message (not harness-injected context, not another agent's report). */
function isUserTurn(message) {
  if (message?.role !== 'user') return false
  const kind = message.source?.kind
  return kind === undefined || kind === 'user'
}

/**
 * The seq of the first event in a replacement chain: the stock pruner and
 * this module both replace a tool/result with a new tool/result citing the
 * old one, so the original full text sits at the chain's root.
 */
export function originSeq(session, seq) {
  let current = seq
  for (let hops = 0; hops < 16; hops += 1) {
    const event = session.eventAt?.(current)
    const source = event?.type === 'tool/result' && Array.isArray(event.sourceEventSeqs) && event.sourceEventSeqs.length === 1
      ? event.sourceEventSeqs[0]
      : undefined
    if (source === undefined || source >= current || session.eventAt?.(source)?.type !== 'tool/result') return current
    current = source
  }
  return current
}

/**
 * The read-only facts every selection needs, computed once per pass: the
 * derived messages, tool calls by id, the protected window and the
 * protected-tool results.
 */
function surfaceView({ session, nodes, priced, usable }) {
  const messages = nodes.map(seq => session.deriveEventMessage?.(session.eventAt?.(seq)) ?? null)

  // tool calls on the surface: call id → name + exact arguments
  const calls = new Map()
  let lastAssistantIdx = -1
  for (const [index, message] of messages.entries()) {
    if (message?.role !== 'assistant') continue
    lastAssistantIdx = index
    for (const block of message.content ?? []) {
      if (block?.type === 'tool-call') calls.set(block.id, { name: block.name, args: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? null) })
    }
  }

  // protected window: the newest surface tokens
  const protect = protectedReclaimTokens(usable)
  let protectFromIdx = nodes.length
  let kept = 0
  while (protectFromIdx > 0 && kept < protect) {
    protectFromIdx -= 1
    kept += priced[protectFromIdx] ?? 0
  }

  // protected tools: newest N results of each, counted over the whole surface
  const protectedSeqs = new Set()
  const seen = new Map()
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'tool') continue
    const name = calls.get(message.toolCallId)?.name
    const limit = PROTECTED_TOOLS.get(name)
    if (limit === undefined) continue
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (count <= limit) protectedSeqs.add(nodes[index])
  }
  return { messages, calls, protectFromIdx, protectedSeqs, lastAssistantIdx }
}

/**
 * Whether the node at `index` is a tool result any lane may replace: a
 * completed text-only result of a known call, not a placeholder already,
 * not a protected tool, not excluded, and worth a placeholder.
 */
function replaceable(view, { nodes, priced, scale, exclude }, index) {
  const message = view.messages[index]
  const seq = nodes[index]
  if (message?.role !== 'tool' || exclude.has(seq) || view.protectedSeqs.has(seq)) return false
  // the floor is about the placeholder's own size (heuristic), not context
  // pressure: compare in the heuristic unit, or a small result would be
  // replaced by a larger placeholder
  if ((priced[index] ?? 0) < MIN_RECLAIM_TOKENS * scale) return false
  if (isReclaimed(message)) return false
  if ((message.content ?? []).some(block => block?.type !== 'text')) return false
  return view.calls.has(message.toolCallId)
}

/**
 * Pick the results to reclaim. Pure over the session's read API.
 * @param {object} args
 * @param {object} args.session
 * @param {number[]} args.nodes - surface seqs
 * @param {number[]} args.priced - tokens per node (provider tokens), aligned with `nodes`
 * @param {number} args.startIdx - first index that may be touched (after the checkpoint)
 * @param {number} args.usable - usable context tokens
 * @param {number} [args.scale] - provider tokens per heuristic token behind `priced`
 * @param {Set<number>} [args.exclude] - seqs that must stay (pending boundaries, an in-flight historian slice)
 * @returns {Array<{index: number, seq: number, tokens: number, reason: 'stale'|'duplicate', name: string, newerSeq?: number}>}
 */
export function selectReclaim({ session, nodes, priced, startIdx, usable, scale = 1, exclude = new Set() }) {
  const view = surfaceView({ session, nodes, priced, usable })
  const { messages, calls } = view

  // suffix sums: genuine user turns and tokens strictly after each index
  const usersAfter = new Array(nodes.length).fill(0)
  const tokensAfter = new Array(nodes.length).fill(0)
  for (let index = nodes.length - 2; index >= 0; index -= 1) {
    usersAfter[index] = usersAfter[index + 1] + (isUserTurn(messages[index + 1]) ? 1 : 0)
    tokensAfter[index] = tokensAfter[index + 1] + (priced[index + 1] ?? 0)
  }

  // newest occurrence of each read-only call signature
  const newestBySignature = new Map()
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'tool') continue
    const call = calls.get(message.toolCallId)
    if (call === undefined || !READ_ONLY_TOOLS.has(call.name)) continue
    const signature = `${call.name}\u0000${call.args}`
    if (!newestBySignature.has(signature)) newestBySignature.set(signature, index)
  }

  const staleTokens = Math.round(usable * STALE_TOKEN_RATIO)
  const picked = []
  for (let index = Math.max(0, startIdx); index < view.protectFromIdx; index += 1) {
    if (!replaceable(view, { nodes, priced, scale, exclude }, index)) continue
    const call = calls.get(messages[index].toolCallId)
    let reason = null
    let newerSeq
    if (READ_ONLY_TOOLS.has(call.name)) {
      const newest = newestBySignature.get(`${call.name}\u0000${call.args}`)
      if (newest !== undefined && newest > index) {
        reason = 'duplicate'
        newerSeq = nodes[newest]
      }
    }
    if (reason === null && (usersAfter[index] >= STALE_USER_TURNS || tokensAfter[index] >= staleTokens)) reason = 'stale'
    if (reason === null) continue
    picked.push({ index, seq: nodes[index], tokens: priced[index] ?? 0, reason, name: call.name, ...(newerSeq === undefined ? {} : { newerSeq }) })
  }
  return picked
}

/**
 * Sort the agent's queued drops (`ctx_reduce`) into the ones this pass
 * applies, the ones it holds, and the ones that can never apply.
 *
 * A queued result inside the protected window, or one a pending boundary or
 * a running historian still refers to, is held: it applies once newer work
 * pushes it out (magic-context's rule for agent drops). A result that left
 * the surface (summarized, replaced) or is no longer replaceable is dropped
 * from the queue.
 * @param {object} args - as selectReclaim, plus:
 * @param {Iterable<number>} args.requested - queued surface seqs
 * @param {Set<number>} [args.skip] - seqs another lane already picked this pass
 * @returns {{picked: Array<object>, held: number[], gone: number[], covered: number[]}}
 *   `covered`: queued seqs another lane picks this pass (cleared once applied)
 */
export function selectRequested({ session, nodes, priced, startIdx, usable, scale = 1, exclude = new Set(), requested, skip = new Set() }) {
  const view = surfaceView({ session, nodes, priced, usable })
  const indexOf = new Map(nodes.map((seq, index) => [seq, index]))
  const picked = []
  const held = []
  const gone = []
  const covered = []
  for (const seq of new Set(requested)) {
    if (skip.has(seq)) {
      covered.push(seq)
      continue
    }
    const index = indexOf.get(seq)
    if (index === undefined || index < startIdx) {
      gone.push(seq)
      continue
    }
    if (exclude.has(seq) || index >= view.protectFromIdx) {
      held.push(seq)
      continue
    }
    if (!replaceable(view, { nodes, priced, scale, exclude }, index)) {
      gone.push(seq)
      continue
    }
    const name = view.calls.get(view.messages[index].toolCallId).name
    picked.push({ index, seq, tokens: priced[index] ?? 0, reason: 'agent', name })
  }
  picked.sort((a, b) => a.index - b.index)
  return { picked, held, gone, covered }
}

/**
 * Tool tiers for pressure reclaim (magic-context's emergency tiers, mapped to
 * DSH tool names): tier 1 is kept longest (file contents and plans the agent
 * keeps working from, sub-agent reports), tier 2 next (edit and search
 * results), everything else is tier 3 and goes first (shell, web, ctx tools).
 */
export const TIER_1_TOOLS = new Set(['read', 'todo_write', 'subagent', 'subagent_fork'])
export const TIER_2_TOOLS = new Set(['edit', 'write', 'grep', 'glob'])
/** Below 95% pressure the newest share of each tier-1 and tier-2 population stays as continuation context. */
export const TIER_RECENCY_RESERVE = 0.2
/** Pressure reclaim aims at floor + this share of (usable − floor), where floor is everything that is not tool output. */
export const TARGET_FRACTION = 0.3
/** A pressure batch smaller than this many provider tokens is not worth a rewrite. */
export const PRESSURE_MIN_TOKENS = 2_000

/** The tier of a tool name (1 kept longest, 3 dropped first). */
export function toolTier(name) {
  const bare = String(name ?? '').toLowerCase().replace(/^mcp__?/, '')
  if (TIER_1_TOOLS.has(bare)) return 1
  if (TIER_2_TOOLS.has(bare)) return 2
  return 3
}

/**
 * How many provider tokens pressure reclaim should free, or 0. The floor is
 * what lies outside the surface (system prompt, tool schemas): magic-context
 * subtracts the whole live window, not only tool output, because folding
 * conversation text into the floor raises the target and under-evicts.
 * The pass aims at floor + TARGET_FRACTION × (ceiling − floor); a floor at or
 * above the ceiling returns 0 (tool reclaim cannot fit that request).
 * @param {object} args
 * @param {number} args.total - current provider-anchored total
 * @param {number} args.surfaceTokens - provider tokens of every surface node
 * @param {number} args.ceiling - usable context (input capacity × execute threshold, magic-context's ceiling)
 * @param {number} [args.already] - tokens other lanes free in this pass
 */
export function pressureNeed({ total, surfaceTokens, ceiling, already = 0 }) {
  const floor = Math.max(0, total - surfaceTokens)
  if (floor >= ceiling) return 0
  const target = floor + TARGET_FRACTION * (ceiling - floor)
  const need = Math.round(total - already - target)
  return need > PRESSURE_MIN_TOKENS ? need : 0
}

/**
 * Pressure reclaim: when stale and duplicate output is not enough, take
 * results that are still current, tier 3 first, oldest first within a
 * tier, until `need` tokens are covered.
 *
 * Always kept: the results of the newest assistant message (the model is
 * about to read them), protected tools, excluded nodes, and results under
 * the placeholder floor. Below `absolute` pressure the protected window and
 * the newest 20% of each tier-1/tier-2 population are kept too; at 95% and
 * on overflow both give way (fitting the request outranks continuity).
 * @param {object} args - as selectReclaim, plus:
 * @param {number} args.need - provider tokens to free
 * @param {boolean} [args.absolute] - ≥ 95% pressure or overflow
 * @param {Set<number>} [args.skip] - seqs other lanes already picked
 */
export function selectPressure({ session, nodes, priced, startIdx, usable, scale = 1, exclude = new Set(), need, absolute = false, skip = new Set() }) {
  if (!(need > 0)) return []
  const view = surfaceView({ session, nodes, priced, usable })
  const limit = absolute ? nodes.length : view.protectFromIdx
  const candidates = []
  for (let index = Math.max(0, startIdx); index < limit; index += 1) {
    if (index > view.lastAssistantIdx) break // the newest round's results
    if (skip.has(nodes[index])) continue
    if (!replaceable(view, { nodes, priced, scale, exclude }, index)) continue
    const name = view.calls.get(view.messages[index].toolCallId).name
    candidates.push({ index, seq: nodes[index], tokens: priced[index] ?? 0, reason: 'pressure', name, tier: toolTier(name) })
  }
  if (!absolute) {
    // the reserve is a share of every live result of the tier (magic-context
    // counts all active tags), so newest output inside the protected window
    // uses up reserve places too
    for (const tier of [1, 2]) {
      const live = []
      for (let index = Math.max(0, startIdx); index < nodes.length; index += 1) {
        const message = view.messages[index]
        if (message?.role !== 'tool' || isReclaimed(message)) continue
        const call = view.calls.get(message.toolCallId)
        if (call !== undefined && toolTier(call.name) === tier) live.push(index)
      }
      const reserved = new Set(live.slice(live.length - Math.ceil(TIER_RECENCY_RESERVE * live.length)))
      for (const candidate of candidates) if (candidate.tier === tier && reserved.has(candidate.index)) candidate.reserved = true
    }
  }
  const ordered = [3, 2, 1].flatMap(tier => candidates.filter(candidate => candidate.tier === tier && candidate.reserved !== true))
  const picked = []
  let freed = 0
  for (const candidate of ordered) {
    if (freed >= need) break
    picked.push(candidate)
    freed += candidate.tokens
  }
  return picked.map(({ tier: _tier, reserved: _reserved, ...rest }) => rest).sort((a, b) => a.index - b.index)
}

/** Cut by Unicode code point so a surrogate pair is never split. */
function headOf(text, maxChars) {
  const points = Array.from(text)
  return points.length > maxChars ? `${points.slice(0, maxChars).join('')}…` : text
}

function tailOf(text, maxChars) {
  const points = Array.from(text)
  return points.length > maxChars ? `…${points.slice(-maxChars).join('')}` : text
}

/**
 * Placeholder text: a pure function of the original, so a replayed log
 * yields the same bytes. Keeps the first lines and, when the output is
 * longer, the last lines.
 */
export function placeholderText({ sessionId, seq, name, reason, text, newerSeq }) {
  const original = String(text)
  const lines = original.split('\n')
  const head = headOf(lines.slice(0, HEAD_LINES).join('\n'), HEAD_CHARS)
  const rest = lines.slice(HEAD_LINES)
  const tail = rest.length === 0 ? '' : tailOf(rest.slice(-TAIL_LINES).join('\n'), TAIL_CHARS)
  const why = {
    duplicate: `an identical later ${name} call (seq ${newerSeq}) has the current output`,
    agent: `${name} output the agent marked as no longer needed (ctx_reduce)`,
    pressure: `${name} output removed under context pressure`,
  }[reason] ?? `${name} output from earlier in the session`
  const omitted = rest.length > TAIL_LINES ? `\n[… ${rest.length - TAIL_LINES} lines omitted …]` : ''
  const body = tail === '' ? head : `${head}${omitted}\n${tail}`
  return `${RECLAIM_MARKER}: ${why}; ${Array.from(original).length} chars]\n${body}\n[full text: ctx_expand sessionId=${sessionId} seq=${seq}]`
}

/**
 * Append one `compaction/prune` + replacement `tool/result` pair per picked
 * result, synchronously (the prune event is the replace's shadow price and
 * must sit directly before it).
 * @param {object} session
 * @param {Array} picked - from selectReclaim
 * @param {object} options
 * @param {object} options.measurement - token meter measurement of the current surface
 * @param {(message: object) => object} [options.freeze]
 * @returns {{count: number, tokens: number, seqs: number[]}}
 */
export function applyReclaim(session, picked, { measurement, freeze = message => structuredClone(message) }) {
  const heuristic = new Map(measurement.nodes.map(node => [node.seq, node.heuristicTokens ?? node.tokens ?? 0]))
  let tokens = 0
  const seqs = []
  for (const candidate of picked) {
    const event = session.eventAt(candidate.seq)
    const original = session.deriveEventMessage(event)
    const root = originSeq(session, candidate.seq)
    const rootMessage = session.deriveEventMessage(session.eventAt(root)) ?? original
    const text = placeholderText({
      sessionId: session.id,
      seq: root,
      name: candidate.name,
      reason: candidate.reason,
      text: textBlocks(rootMessage),
      newerSeq: candidate.newerSeq === undefined ? undefined : originSeq(session, candidate.newerSeq),
    })
    session.append('compaction/prune', {
      shadowedRange: { start: candidate.seq, end: candidate.seq },
      shadowedSeqs: [candidate.seq],
      shadowedTokenCount: heuristic.get(candidate.seq) ?? 0,
    })
    session.append('tool/result', {
      ...event.data,
      message: freeze({ ...original, content: [{ type: 'text', text }] }),
    }, {
      surfaceOp: { op: 'replace', startSeq: candidate.seq, endSeq: candidate.seq },
      sourceEventSeqs: [candidate.seq],
    })
    tokens += candidate.tokens
    seqs.push(candidate.seq)
  }
  return { count: seqs.length, tokens, seqs }
}

/**
 * Resolve `ctx_reduce` targets to tool-result seqs on the current surface.
 * The model cannot see tool-call ids reliably, so a target names a tool and
 * a fragment of the call's arguments (both as the model wrote them), or an
 * event seq it was shown (a placeholder, a ctx_search hit). Pure over the
 * session's read API.
 * @param {object} session
 * @param {Array<{tool?: string, match?: string, seq?: number}>} targets
 * @returns {Array<{target: object, results: Array<{seq: number, name: string, args: string, chars: number, skipped?: string}>}>}
 */
export function resolveReduceTargets(session, targets) {
  const nodes = [...(session.surface?.nodes ?? [])]
  const messages = nodes.map(seq => session.deriveEventMessage?.(session.eventAt?.(seq)) ?? null)
  const calls = new Map()
  for (const message of messages) {
    if (message?.role !== 'assistant') continue
    for (const block of message.content ?? []) {
      if (block?.type === 'tool-call') calls.set(block.id, { name: block.name, args: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? null) })
    }
  }
  const results = []
  for (const [index, message] of messages.entries()) {
    if (message?.role !== 'tool') continue
    const call = calls.get(message.toolCallId)
    if (call === undefined) continue
    const seq = nodes[index]
    let skipped
    if (PROTECTED_TOOLS.has(call.name)) skipped = 'protected tool'
    else if (isReclaimed(message)) skipped = 'already reclaimed'
    else if ((message.content ?? []).some(block => block?.type !== 'text')) skipped = 'non-text result'
    // the replace floor in heuristic tokens (chars/4, the meter's estimate):
    // queuing such a result would report a drop that never happens. The apply
    // pass prices the whole message, so a result near the floor may still be
    // dropped from the queue there (rare; it then stays as it is)
    else if (textBlocks(message).length / 4 < MIN_RECLAIM_TOKENS) skipped = 'too small to reclaim'
    results.push({ seq, origin: originSeq(session, seq), name: call.name, args: call.args, chars: textBlocks(message).length, ...(skipped === undefined ? {} : { skipped }) })
  }
  return targets.map(target => {
    const tool = typeof target?.tool === 'string' && target.tool !== '' ? target.tool : undefined
    const match = typeof target?.match === 'string' && target.match !== '' ? target.match : undefined
    const seq = Number.isInteger(target?.seq) ? target.seq : undefined
    const hits = results.filter(result => {
      if (seq !== undefined) return result.seq === seq || result.origin === seq
      if (tool === undefined && match === undefined) return false
      return (tool === undefined || result.name === tool) && (match === undefined || result.args.includes(match))
    })
    return { target, results: hits.map(({ origin: _origin, ...rest }) => rest) }
  })
}
