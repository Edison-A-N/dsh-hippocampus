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
  const messages = nodes.map(seq => session.deriveEventMessage?.(session.eventAt?.(seq)) ?? null)

  // tool calls on the surface: call id → name + exact arguments
  const calls = new Map()
  for (const message of messages) {
    if (message?.role !== 'assistant') continue
    for (const block of message.content ?? []) {
      if (block?.type === 'tool-call') calls.set(block.id, { name: block.name, args: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? null) })
    }
  }

  // suffix sums: genuine user turns and tokens strictly after each index
  const usersAfter = new Array(nodes.length).fill(0)
  const tokensAfter = new Array(nodes.length).fill(0)
  for (let index = nodes.length - 2; index >= 0; index -= 1) {
    usersAfter[index] = usersAfter[index + 1] + (isUserTurn(messages[index + 1]) ? 1 : 0)
    tokensAfter[index] = tokensAfter[index + 1] + (priced[index + 1] ?? 0)
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
  for (let index = Math.max(0, startIdx); index < protectFromIdx; index += 1) {
    const message = messages[index]
    const seq = nodes[index]
    if (message?.role !== 'tool' || exclude.has(seq) || protectedSeqs.has(seq)) continue
    // the floor is about the placeholder's own size (heuristic), not context
    // pressure: compare in the heuristic unit, or a small result would be
    // replaced by a larger placeholder
    if ((priced[index] ?? 0) < MIN_RECLAIM_TOKENS * scale) continue
    if (isReclaimed(message)) continue
    if ((message.content ?? []).some(block => block?.type !== 'text')) continue
    const call = calls.get(message.toolCallId)
    if (call === undefined) continue
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
    picked.push({ index, seq, tokens: priced[index] ?? 0, reason, name: call.name, ...(newerSeq === undefined ? {} : { newerSeq }) })
  }
  return picked
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
  const why = reason === 'duplicate'
    ? `an identical later ${name} call (seq ${newerSeq}) has the current output`
    : `${name} output from earlier in the session`
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
