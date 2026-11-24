/**
 * Host-contract helpers shared by both compaction engines: the exact event
 * shapes dsh-compaction defines and the token meter folds. Kept in one place
 * so the single-checkpoint and compartment engines cannot drift apart.
 * @module dsh-hippocampus/commit
 */
import { randomUUID } from 'node:crypto'

/**
 * The open turn number, or null between turns. Automatic compaction inside a
 * turn must stamp that turn on its start/end markers; null is reserved for
 * standalone (manual, idle) transactions.
 */
export function openTurnOf(session) {
  const end = Number(session.seq ?? 0)
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt?.(seq)
    if (event?.type === 'turn/start') return event.data?.turn ?? null
    if (event?.type === 'turn/end') return null
  }
  return null
}

/**
 * Whether another compaction transaction is open (a `compaction/start`
 * without its `compaction/end`). The Web profile mounts the stock backend
 * inside each agent preset next to this engine; while it is mid-summary its
 * start marker is the lock, and a replace from us would break its span check.
 */
export function compactionOpen(session) {
  // A start left unmatched by a crash or a failed close is stale once a
  // later `session/end-seed` exists (the host appends one on recovery) —
  // the same rule the stock backend's lock check applies.
  const end = Number(session.seq ?? 0)
  let endSeedSeen = false
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const type = session.eventAt?.(seq)?.type
    if (type === 'session/end-seed') endSeedSeen = true
    else if (type === 'compaction/end') return false
    else if (type === 'compaction/start') return !endSeedSeen
  }
  return false
}

/**
 * Map a BlockAssembler finish to an error, or undefined when it completed.
 * The assembler reports `{kind}` objects; a truncated summary (max-tokens) is
 * as unusable as an aborted one — committing it would replace real history
 * with half a checkpoint.
 */
export function finishError(finish) {
  const kind = typeof finish === 'string' ? finish : finish?.kind
  if (kind === 'error' || kind === 'aborted') {
    return new Error(`summarization stream ${kind}: ${finish?.failure?.message ?? 'no detail'}`)
  }
  if (kind === 'max-tokens') return new Error('summarization truncated at the token cap')
  return undefined
}

/**
 * Index of the first surface node a compaction may replace. Node 0 holds the
 * system prompt and may not be replaced by a user/message
 * (assertSystemHeadRewrite). A delegated sub-agent's task prompt, its first
 * user message, stays too: it is the whole objective for the agent's single
 * turn, and a summary of it loses the exact wording the agent is graded on
 * (magic-context keeps the live user prompt out of compaction for the same
 * reason). Harness notices can sit before the task prompt (a
 * working-directory change does in ~8% of sub-agents); they are pinned with
 * it, so the checkpoint still sits right after the head. The scan stops at
 * anything that is not a user message, at a compaction checkpoint, and after
 * HEAD_SCAN_LIMIT nodes. A forked sub-agent (`isSeeded`) is not covered: its
 * surface starts with the inherited parent history and its own task prompt
 * sits after it, where pinning it would break ADR-9's contiguous lineage.
 * @param {object} session - session read API (header, eventAt, deriveEventMessage)
 * @param {number[]} nodes - surface seqs
 * @returns {number}
 */
export function surfaceHeadEnd(session, nodes) {
  const messageAt = index => session.deriveEventMessage?.(session.eventAt?.(nodes[index]))
  const head = messageAt(0)?.role === 'system' ? 1 : 0
  if (session.header?.origin !== 'subagent' || session.header?.isSeeded === true) return head
  for (let index = head; index < Math.min(nodes.length, head + HEAD_SCAN_LIMIT); index += 1) {
    const message = messageAt(index)
    if (message?.role !== 'user') break
    const kind = message.source?.kind
    if (kind === undefined || kind === 'user') return index + 1
    if (kind === 'compact-checkpoint') break
  }
  return head
}

/** How many nodes after the system head may precede a sub-agent's task prompt. */
const HEAD_SCAN_LIMIT = 8

/**
 * Heuristic shadow price of a surface span: what the token meter must
 * subtract when the replace lands. It prices with `heuristicTokens` (route-
 * independent), so use that field, falling back to `tokens` for meters that
 * do not report it.
 */
export function heuristicPrice(measurement, seqs) {
  const wanted = new Set(seqs)
  let total = 0
  for (const node of measurement.nodes) {
    if (wanted.has(node.seq)) total += node.heuristicTokens ?? node.tokens ?? 0
  }
  return total
}

/**
 * Append one complete compaction transaction: start → summary → replace →
 * end, synchronously (no await between them: the summary event is the
 * replace's shadow price and must sit directly before it).
 * @param {object} session
 * @param {object} compactionModule - CompactionId, compactCheckpointSource
 * @param {object} args
 * @returns the CompactionResult
 */
export function appendCompaction(session, compactionModule, {
  startSeq, endSeq, shadowedSeqs, shadowedTokenCount, summaryBlocks, provider, model, usage, maxTokens,
}) {
  const { CompactionId, compactCheckpointSource } = compactionModule
  const compactionId = CompactionId(randomUUID())
  const turn = openTurnOf(session)
  const startEvent = session.append('compaction/start', { compactionId, turn })
  const summaryEvent = session.append('compaction/summary', {
    compactionId,
    summary: summaryBlocks,
    shadowedRange: { start: startSeq, end: endSeq },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
    provider,
    model,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(usage === undefined ? {} : { usage }),
  })
  const checkpointEvent = session.append('user/message', {
    id: randomUUID(),
    role: 'user',
    content: summaryBlocks,
    source: compactCheckpointSource(compactionId),
  }, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: [...new Set([startEvent.seq, summaryEvent.seq, ...shadowedSeqs])],
  })
  const endEvent = session.append('compaction/end', { compactionId, turn })
  return {
    compactionId,
    startSeq: startEvent.seq,
    summarySeq: summaryEvent.seq,
    endSeq: endEvent.seq,
    checkpointSeq: checkpointEvent.seq,
    summary: summaryBlocks,
    shadowedRange: { start: startSeq, end: endSeq },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
  }
}

/**
 * Per-agent overflow-recovery budget: `limit` recoveries until the model
 * answers again (an assistant message) or the agent goes idle. Without it a
 * fold that does not make the request fit is retried forever, each round
 * re-summarizing the checkpoint it just wrote.
 */
export class OverflowBudget {
  constructor(limit = 1) {
    this.limit = limit
    this.used = new WeakMap()
    this.agentsBySession = new WeakMap()
  }

  /** Whether one more recovery is allowed for this agent; records the agent under its session. */
  allow(agent) {
    const agents = this.agentsBySession.get(agent.session) ?? new Set()
    agents.add(agent)
    this.agentsBySession.set(agent.session, agents)
    return (this.used.get(agent) ?? 0) < this.limit
  }

  /** Count one recovery that returned a retry. */
  spend(agent) {
    this.used.set(agent, (this.used.get(agent) ?? 0) + 1)
  }

  /** The model answered in this session: every agent on it gets its budget back. */
  answered(session) {
    for (const agent of this.agentsBySession.get(session) ?? []) this.used.delete(agent)
  }

  /** The agent went idle: its budget resets. */
  idle(agent) {
    this.used.delete(agent)
  }
}
