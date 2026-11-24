/**
 * Hippocampus compaction engine (M3): a dsh-compaction backend whose
 * summarization runs in the BACKGROUND, so the main agent's step boundary
 * never waits on a model call.
 *
 * How it differs from dsh-compaction-basic:
 * - `compactIfNeeded` performs ZERO model calls. When pressure crosses the
 *   fire threshold it schedules a background summarization (ctx.llm.stream
 *   with the configured cheap model, purpose-tagged) and returns null for
 *   this step. When the background result has landed (checked on a later
 *   step), the engine commits a plain surface replace — a local log append,
 *   still zero model calls — and returns the result.
 * - `context-overflow` recovery degrades to the synchronous basic-style
 *   path (summarize inline): overflow must always be recoverable even if
 *   the background lane was never triggered.
 * - The summary message reuses the upstream 8-section checkpoint format so
 *   every consumer that recognizes compacted history keeps working.
 *
 * Engine registration replaces dsh-compaction-basic: cordis rejects a
 * second `compaction` service provider, so the profile patch disables the
 * `compaction-basic` row and inserts this one (see cordis.patch.yml, the
 * bundle patch shipped with this package).
 *
 * Cache semantics (the load-bearing part, from the magic-context study):
 * one replace invalidates the provider prefix from the first shadowed node
 * — that single bust is the engine's entire write. Nothing else the plugin
 * does ever rewrites the surface; memory injections append at the tail.
 * @module dsh-hippocampus/compaction
 */
import { appendCompaction, compactionOpen, finishError, heuristicPrice, surfaceHeadEnd } from './commit.js'
import { inputCapacity, providerPrice, providerScale, toolsHeuristicTokens } from './compartments.js'

/** Pressure ratio that triggers background summarization (vs basic's 0.8 inline). */
export const BACKGROUND_TRIGGER_RATIO = 0.65

/** Pressure ratio at which a landed background result is committed immediately. */
export const FORCE_COMMIT_RATIO = 0.8

/**
 * Growth (as a fraction of the context window) since a landed summary was
 * prepared that makes it stale enough to re-summarize once before commit.
 * Below this, a landed summary is kept and simply committed at the force
 * ratio — no repeated background runs.
 */
export const RESUMMARIZE_GROWTH_RATIO = 0.1

/**
 * Resolve thresholds with optional environment overrides (sizing and
 * testing; all must be within (0, 1] and trigger < force).
 * @param {object} env - environment mapping
 */
export function resolveThresholds(env = process.env) {
  let background = BACKGROUND_TRIGGER_RATIO
  let force = FORCE_COMMIT_RATIO
  let resummarizeGrowth = RESUMMARIZE_GROWTH_RATIO
  if (env.HIPPOCAMPUS_RESUMMARIZE_GROWTH !== undefined) {
    const value = Number(env.HIPPOCAMPUS_RESUMMARIZE_GROWTH)
    if (Number.isFinite(value) && value > 0 && value <= 1) resummarizeGrowth = value
  }
  if (env.HIPPOCAMPUS_BACKGROUND_TRIGGER !== undefined) {
    const value = Number(env.HIPPOCAMPUS_BACKGROUND_TRIGGER)
    if (Number.isFinite(value) && value > 0 && value <= 1) background = value
  }
  if (env.HIPPOCAMPUS_FORCE_COMMIT !== undefined) {
    const value = Number(env.HIPPOCAMPUS_FORCE_COMMIT)
    if (Number.isFinite(value) && value > 0 && value <= 1) force = value
  }
  if (background >= force) force = Math.min(1, background + 0.05)
  return { background, force, resummarizeGrowth }
}

/**
 * The 8-section checkpoint instruction. Adapted from the summarization
 * directive of @deepseek-ai/dsh-compaction-basic (MIT License, Copyright (c)
 * 2026 DeepSeek; see THIRD_PARTY_NOTICES.md), so checkpoints keep the stock
 * backend's format.
 */
export const COMPACTION_INSTRUCTION = `You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.

Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.

## Primary Request and Intent
- [the user's original and evolving goals; quote verbatim where the exact wording matters]

## Key Technical Concepts
- [technologies, frameworks, patterns, and conventions in play]

## Files and Code
- [exact path: why it matters, key changes or snippets]

## Errors and Fixes
- [error: how it was resolved, plus any related user feedback]

## Pending Jobs
- [explicitly requested work not yet completed]

## Current Work
- [precisely what was in progress at this checkpoint]

## Next Step
- [the single next action, directly in line with the most recent request, or "(none)"]

## Critical Context
- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]

Rules:
- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.
- Capture user feedback and explicit instructions faithfully, especially corrections.
- Do NOT mention this summarization request or that the context was compacted.
- Output only the checkpoint text: do not call any tool or take any other action.
- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`

/** Framing of a landed checkpoint (same source and license as COMPACTION_INSTRUCTION). */
export const CHECKPOINT_PREAMBLE = 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * Per-session background state: one in-flight summarization at a time.
 * Keyed by session id; lives in memory (a restarted process simply loses
 * the pending run and the next pressure trigger starts a new one).
 */
export class BackgroundLane {
  constructor() {
    /** @type {Map<string, {startedAt: number, promise: Promise<object>}>} */
    this.inFlight = new Map()
  }

  /**
   * Start a background summarization for a session, or return the existing
   * one. The promise never rejects (failures resolve to an error record).
   */
  start(sessionId, run) {
    const existing = this.inFlight.get(sessionId)
    if (existing !== undefined) return existing.promise
    const promise = Promise.resolve(run()).catch(error => ({ error: String(error?.message ?? error) }))
    const entry = { startedAt: Date.now(), promise }
    this.inFlight.set(sessionId, entry)
    void promise.then(() => this.inFlight.delete(sessionId))
    return promise
  }

  /** Whether a run is in flight for a session. */
  isRunning(sessionId) {
    return this.inFlight.has(sessionId)
  }
}

/**
 * The engine. Constructed with injected primitives (store-free, llm-free)
 * so the logic is unit-testable; apply() wires it to the real ctx.
 */
export class HippocampusCompaction {
  /**
   * @param {object} options
   * @param {(options: {provider: string, model: string, system: string, messages: Array, maxTokens: number, purpose: string, signal?: AbortSignal}) => AsyncIterable<object>} options.stream
   * @param {(blocks: Array) => string} options.collectText - assemble streaming chunks to full text
   * @param {(provider: string, model: string) => Promise<{contextWindow?: number}>} options.resolveModelInfo
   * @param {(session: object) => {totalTokens: number, nodes: Array}} options.measure
   * @param {object} options.compactionModule - dsh-compaction exports (CompactionId, compactCheckpointSource, toolPairingBalancedBefore, toolPairingBalancedAfter)
   * @param {object} options.llmModule - dsh-llm exports (BlockAssembler, CONTEXT_WINDOW_EXCEEDED_CODE)
   * @param {object} [options.modelConfig] - {provider, model, maxTokens}
   * @param {object} [options.store] - MemoryStore, for compaction-run records
   * @param {(cwd: string) => {id: string}} [options.resolver] - project identity for run records
   */
  constructor(options) {
    this.options = options
    this.lane = new BackgroundLane()
    this.thresholds = resolveThresholds(options.env)
  }

  /** Record one compaction run (best-effort; the context panel reads these). */
  #recordRun(agent, mode, target, status, detail) {
    if (this.options.store === undefined) return
    try {
      const session = agent.session
      const cwd = session.header?.cwd
      const identity = cwd !== undefined && this.options.resolver !== undefined
        ? this.options.resolver.resolve(cwd)
        : undefined
      this.options.store.recordCompactionRun({
        sessionId: session.id,
        projectId: identity?.id,
        mode,
        provider: target?.provider,
        model: target?.model,
        status,
        ...detail,
      })
    } catch {
      // recording must never break the compaction path
    }
  }

  /** Resolve the summarization target: explicit config, else the session's own model, else the configured default. Null when unresolvable. */
  #target(agent) {
    const config = this.options.modelConfig
    if (config?.provider && config?.model) return { provider: config.provider, model: config.model }
    const header = agent.session.requestHeader?.()
    const provider = header?.config?.provider
    const model = header?.config?.model
    if (provider !== undefined && model !== undefined) return { provider, model }
    // pressure measurement happens before the first request header exists;
    // the background lane needs an explicit fallback then. Without one the
    // target is unresolvable — the caller treats null as "skip this step"
    // rather than guessing a provider.
    if (this.options.defaultProvider === undefined || this.options.defaultModel === undefined) return null
    return { provider: this.options.defaultProvider, model: this.options.defaultModel }
  }

  /** Pressure ratio (0..∞) of a session against its context window. Null when unmeasurable this step. */
  async #pressure(agent) {
    try {
      const target = this.#target(agent)
      if (target === null) return null
      const { provider, model } = target
      const info = await this.options.resolveModelInfo(provider, model)
      const window = info?.context?.contextWindow
      if (window === undefined || window <= 0) return null
      const measurement = this.options.measure(agent.session)
      // pressure against the input capacity (window − the output reservation)
      const capacity = inputCapacity(window, agent.session.requestHeader?.()?.config?.maxTokens)
      return { ratio: measurement.totalTokens / capacity, measurement, window }
    } catch {
      // no header yet / no window info: skip this step, retry on the next
      return null
    }
  }

  /** Select the compactable surface span: retain the protected tail, fence tool arcs. */
  #selectRange(session, measurement, retainTokens) {
    const { toolPairingBalancedBefore } = this.options.compactionModule
    const nodes = session.surface.nodes
    if (nodes.length === 0) return null
    // the system prompt (and a sub-agent's task prompt) stay: see surfaceHeadEnd
    const firstIdx = surfaceHeadEnd(session, nodes)
    // retainTokens is in provider tokens (a share of totalTokens); node
    // prices are the meter's heuristic, so scale them into the same unit
    const scale = providerScale(measurement, toolsHeuristicTokens(session.requestHeader?.()))
    const bySeq = new Map(measurement.nodes.map(node => [node.seq, node]))
    const priced = nodes.map(seq => providerPrice(bySeq.get(seq), scale))
    let keepFromIdx = nodes.length
    let retained = 0
    while (keepFromIdx > firstIdx && retained < retainTokens) {
      keepFromIdx -= 1
      retained += priced[keepFromIdx]
    }
    // keepFromIdx === nodes.length means "retain nothing": that cut sits
    // after the last node, which is balanced only when no tool call is
    // still waiting for its result
    const { toolPairingBalancedAfter } = this.options.compactionModule
    const balancedAt = index => index < nodes.length
      ? toolPairingBalancedBefore(session, nodes[index])
      : toolPairingBalancedAfter === undefined || toolPairingBalancedAfter(session, nodes[index - 1])
    while (keepFromIdx > firstIdx && !balancedAt(keepFromIdx)) {
      keepFromIdx -= 1
    }
    if (keepFromIdx <= firstIdx) return null
    return { start: nodes[firstIdx], end: nodes[keepFromIdx - 1], shadowed: nodes.slice(firstIdx, keepFromIdx) }
  }

  /**
   * compactIfNeeded: zero model calls on the hot path.
   * - under the background trigger: null (nothing to do)
   * - over it with no landed result and no run in flight: start the
   *   background run, return null
   * - over it with a landed result below the force ratio: keep it (no new
   *   run) unless the session grew by more than `resummarizeGrowth` of the
   *   window since it was prepared — then re-summarize once
   * - at/over the force ratio with a landed result: commit the replace
   * - context-overflow trigger: synchronous fallback (must recover now)
   */
  async compactIfNeeded(agent, trigger, signal) {
    if (trigger === 'context-overflow') {
      return this.#compactSynchronous(agent, signal, { retainTokens: 0 })
    }
    const pressure = await this.#pressure(agent)
    if (pressure === null) return null
    const { ratio, measurement, window } = pressure
    if (ratio < this.thresholds.background) return null
    const sessionId = agent.session.id
    let landed = this.landed.get(sessionId)
    if (landed !== undefined && !this.#rangeOnSurface(agent.session, landed.range)) {
      // the surface changed under the landed summary (e.g. a synchronous
      // compaction committed meanwhile): committing it would replace a
      // span that no longer exists — drop it and summarize afresh
      this.landed.delete(sessionId)
      landed = undefined
    }
    if (landed !== undefined && (ratio >= this.thresholds.force || landed.forced)) {
      this.landed.delete(sessionId)
      return this.#commit(agent, landed, signal)
    }
    if (landed !== undefined) {
      // growth is measured from the later of: when this summary was
      // prepared, and the last refresh attempt. A failed refresh therefore
      // waits for another full growth step instead of retrying every step.
      const baseline = Math.max(landed.measuredTokens, landed.refreshAttemptTokens ?? 0)
      const growth = (measurement.totalTokens - baseline) / window
      if (!(growth > this.thresholds.resummarizeGrowth)) return null
    }
    if (!this.lane.isRunning(sessionId)) {
      if (landed !== undefined) landed.refreshAttemptTokens = measurement.totalTokens
      const retainTokens = Math.floor(measurement.totalTokens * 0.16)
      void this.lane.start(sessionId, () => this.#summarize(agent, measurement, retainTokens, signal))
    }
    return null
  }

  /**
   * The background summarization: replay-prefix llm call. On success the
   * result lands in `landed` (with the range it summarized); the NEXT
   * compactIfNeeded above the force ratio commits it.
   */
  async #summarize(agent, measurement, retainTokens, signal) {
    const range = this.#selectRange(agent.session, measurement, retainTokens)
    if (range === null) return { error: 'nothing compactable' }
    const messages = this.#replayPrefix(agent, range)
    const target = this.#target(agent)
    let result
    try {
      result = await this.#callLlm(target, messages, signal)
    } catch (error) {
      this.#recordRun(agent, 'background', target, 'error', { error: String(error?.message ?? error) })
      return { error: 'summarization failed' }
    }
    if (result.text === null || result.text.trim() === '') {
      this.#recordRun(agent, 'background', target, 'error', { error: 'empty summary' })
      return { error: 'empty summary' }
    }
    this.landed.set(agent.session.id, {
      range,
      summaryText: result.text,
      target,
      forced: false,
      measuredTokens: measurement.totalTokens,
    })
    this.#recordRun(agent, 'background', target, 'ok', {
      summary: { text: result.text.slice(0, 400), shadowedCount: range.shadowed.length },
      usage: result.usage,
      durationMs: result.durationMs,
      shadowedStart: range.start,
      shadowedEnd: range.end,
    })
    return { scheduled: true }
  }

  /** Whether a range's shadowed seqs are still a contiguous run on the current surface. */
  #rangeOnSurface(session, range) {
    const nodes = session.surface.nodes
    const startIndex = nodes.indexOf(range.start)
    if (startIndex === -1) return false
    return range.shadowed.every((seq, offset) => nodes[startIndex + offset] === seq)
  }

  /** Replay the shadowed span as the summarization prefix (KV-cache reuse). */
  #replayPrefix(agent, range) {
    const session = agent.session
    const messages = []
    for (const seq of range.shadowed) {
      const message = session.deriveEventMessage?.(session.eventAt?.(seq))
      if (message !== null && message !== undefined) messages.push(message)
    }
    return messages
  }

  /** One llm call with the checkpoint instruction appended as the final user message. Returns {text, usage}. */
  async #callLlm(target, messages, signal) {
    const assembler = new this.options.llmModule.BlockAssembler()
    const options = {
      provider: target.provider,
      model: target.model,
      messages: [...messages, { role: 'user', content: [{ type: 'text', text: COMPACTION_INSTRUCTION }] }],
      maxTokens: this.options.modelConfig?.maxTokens ?? 65536,
      purpose: 'compaction',
      ...(signal === undefined ? {} : { signal }),
    }
    const startedAt = Date.now()
    for await (const chunk of this.options.stream(options)) assembler.push(chunk)
    const usage = assembler.usage === undefined ? undefined : {
      inputTokens: assembler.usage.inputTokens,
      outputTokens: assembler.usage.outputTokens,
      ...(assembler.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: assembler.usage.cacheReadTokens }),
      ...(assembler.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: assembler.usage.cacheWriteTokens }),
    }
    const failed = finishError(assembler.finish)
    if (failed !== undefined) throw failed
    return {
      usage,
      durationMs: Date.now() - startedAt,
      text: assembler.blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n'),
    }
  }

  /**
   * Commit a landed background result (or a synchronous one) as a surface
   * replace. Model-free, synchronous log appends only.
   */
  #commit(agent, landed, signal) {
    const session = agent.session
    if (compactionOpen(session)) throw new Error('another compaction is in progress')
    const summaryBlocks = [
      { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n<compacted-summary>` },
      { type: 'text', text: landed.summaryText },
      { type: 'text', text: '</compacted-summary>' },
    ]
    let shadowedTokenCount = 0
    try {
      shadowedTokenCount = heuristicPrice(this.options.measure(session), landed.range.shadowed)
    } catch {
      // unmeasurable now: price 0 keeps the claim armed for the replace
    }
    return appendCompaction(session, this.options.compactionModule, {
      startSeq: landed.range.start,
      endSeq: landed.range.end,
      shadowedSeqs: landed.range.shadowed,
      shadowedTokenCount,
      summaryBlocks,
      provider: landed.target.provider,
      model: landed.target.model,
    })
  }

  /** Synchronous fallback for overflow (and for compactNow): summarize inline, then commit. */
  async #compactSynchronous(agent, signal, { retainTokens }) {
    const measurement = this.options.measure(agent.session)
    const range = this.#selectRange(agent.session, measurement, retainTokens)
    if (range === null) return null
    const messages = this.#replayPrefix(agent, range)
    const target = this.#target(agent)
    let result
    try {
      result = await this.#callLlm(target, messages, signal)
    } catch (error) {
      this.#recordRun(agent, 'overflow', target, 'error', { error: String(error?.message ?? error) })
      throw error
    }
    if (result.text === null || result.text.trim() === '') {
      this.#recordRun(agent, 'overflow', target, 'error', { error: 'empty summary' })
      throw new Error('synchronous summarization produced no text')
    }
    this.#recordRun(agent, 'overflow', target, 'ok', {
      summary: { text: result.text.slice(0, 400), shadowedCount: range.shadowed.length },
      usage: result.usage,
      durationMs: result.durationMs,
      shadowedStart: range.start,
      shadowedEnd: range.end,
    })
    return this.#commit(agent, { range, summaryText: result.text, target, forced: true }, signal)
  }

  /** Landed-but-uncommitted background results, keyed by session. */
  landed = new Map()

  /**
   * Inline summarize-and-commit with a retained tail, for callers that
   * already hold whatever admission they need (the compartment engine's
   * fallback). Returns null when nothing is compactable.
   */
  async compactInline(agent, signal, { retainTokens = 0 } = {}) {
    return this.#compactSynchronous(agent, signal, { retainTokens })
  }

  /** compactNow: manual idle compaction (synchronous, whole useful span). */
  async compactNow(agent, signal) {
    return agent.runMaintenance(async () => {
      const measurement = this.options.measure(agent.session)
      return this.#compactSynchronous(agent, signal, { retainTokens: Math.floor(measurement.totalTokens * 0.16) })
    })
  }

  /** compactRegion: explicit span (synchronous). */
  async compactRegion(start, end, agent, signal) {
    const session = agent.session
    const nodes = session.surface.nodes
    const startIndex = nodes.indexOf(start)
    const endIndex = nodes.indexOf(end)
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      throw new Error('region not on the current surface')
    }
    const shadowed = nodes.slice(startIndex, endIndex + 1)
    const messages = this.#replayPrefix(agent, { shadowed })
    const target = this.#target(agent)
    let result
    try {
      result = await this.#callLlm(target, messages, signal)
    } catch (error) {
      this.#recordRun(agent, 'region', target, 'error', { error: String(error?.message ?? error) })
      throw error
    }
    if (result.text === null || result.text.trim() === '') {
      this.#recordRun(agent, 'region', target, 'error', { error: 'empty summary' })
      throw new Error('compactRegion summarization produced no text')
    }
    this.#recordRun(agent, 'region', target, 'ok', {
      summary: { text: result.text.slice(0, 400), shadowedCount: shadowed.length },
      usage: result.usage,
      durationMs: result.durationMs,
      shadowedStart: start,
      shadowedEnd: end,
    })
    return this.#commit(agent, { range: { start, end, shadowed }, summaryText: result.text, target, forced: true }, signal)
  }
}
