/**
 * Compartment compaction engine: magic-context-style context management on
 * the DSH CompactionEngine seam (ADR-9).
 *
 * The single-checkpoint engine (compaction.js) waits until 65% and then
 * folds everything into one summary. magic-context keeps the context low by
 * doing three things instead, and so does this engine:
 *
 * 1. Summarize early and in small pieces. A background historian call fires
 *    when the unsummarized span outside the protected tail reaches
 *    3 × triggerBudget (≈ 5% of usable context), independent of pressure. Each
 *    call covers at most one chunk (≤ 50K formatted tokens) and stores
 *    "compartments" — one per work unit, four summary tiers each — as
 *    pending rows in the plugin's SQLite. Nothing touches the surface yet.
 * 2. Commit when the cache is already dead or pressure demands it. Pending
 *    compartments land in one surface replace (old checkpoint + summarized
 *    raw span → one new checkpoint) when the provider cache is cold (idle
 *    longer than the cache TTL, or a route that reports no cache use at
 *    all), or when pressure reaches the execute threshold (65%). That replace
 *    is the only cache bust, and it rides moments the prefix was lost anyway.
 * 3. Render history with decay. The checkpoint renders every compartment,
 *    each at a tier chosen by importance and age so the whole history fits
 *    15% of usable context; old, unimportant work fades to one line or is
 *    archived (ctx_search / ctx_expand still reach the raw events).
 *
 * Blocking paths: provider overflow, manual /compact, and ≥ 95% pressure
 * with nothing pending summarize inline (bounded chunks) and commit at once.
 * If the historian cannot produce compartments there, the engine falls back
 * to the single-checkpoint summary so recovery always works.
 * @module dsh-hippocampus/historian
 */
import { appendCompaction, compactionOpen, finishError, heuristicPrice, surfaceHeadEnd } from './commit.js'
import { BackgroundLane, BACKGROUND_TRIGGER_RATIO } from './compaction.js'
import { CATEGORIES } from './store.js'
import { applyReclaim, isReclaimed, originSeq, pressureNeed, selectPressure, selectReclaim, selectRequested } from './reclaim.js'
import {
  HISTORIAN_SYSTEM,
  formatNode,
  historianChunkTokens,
  historianUserMessage,
  inputCapacity,
  parseHistorianFacts,
  parseHistorianOutput,
  protectedTailTokens,
  providerPrice,
  providerScale,
  renderHistory,
  roughTokens,
  toolsHeuristicTokens,
  triggerBudget,
  usableTokens,
  TAIL_SIZE_MULTIPLIER,
} from './compartments.js'

/** Default provider cache TTL (Anthropic ephemeral cache is 5 minutes). */
export const CACHE_TTL_MS = 5 * 60_000
/** Share of usable context the rendered history may take. */
export const HISTORY_BUDGET_RATIO = 0.15
/** Proactive historian floor sits this far below the execute threshold. */
const PROACTIVE_OFFSET = 0.02
/** Pressure at which nothing-pending forces an inline (blocking) fold. */
export const EMERGENCY_RATIO = 0.95
/** Upper bound of historian calls inside one blocking fold. */
const MAX_BLOCKING_CHUNKS = 6
/** A route counts as cacheless after this many usage samples with zero cache reads/writes. */
const CACHELESS_MIN_SAMPLES = 3
/** A background historian call is abandoned after this long. */
const HISTORIAN_TIMEOUT_MS = 10 * 60_000
/** A blocking fold waits at most this long for a background historian already running. */
const BLOCKING_WAIT_MS = 2 * 60_000
/** Historian output budget. */
const HISTORIAN_MAX_TOKENS = 16_000
/** Failure backoff: 30s doubling, capped. */
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 15 * 60_000
/** A warm-cache reclaim at the force band must free at least this share of usable context (magic-context's 2% bust floor). */
export const FORCE_RECLAIM_MIN_RATIO = 0.02
/** Importance of a fact the historian promotes: below an agent-written memory's default 50, so the agent's own judgment wins a tight baseline. */
export const HISTORIAN_FACT_IMPORTANCE = 40

export const HISTORY_PREAMBLE = 'This checkpoint replaces the earlier part of this session with a compressed record of its work units, oldest first. Older or less important units are condensed or archived. Each heading carries the original event seq range: call ctx_expand with this session id and a seq from that range to read the original text. Treat the record as established background and continue directly from the messages that follow, without acknowledging this checkpoint.'

/** Parse a TTL value: seconds as a number, or "30s" / "5m" / "1h", or "never". */
export function parseTtl(value, fallback = CACHE_TTL_MS) {
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (text === 'never' || text === 'off') return Number.POSITIVE_INFINITY
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(text)
  if (match === null) return fallback
  const amount = Number(match[1])
  const unit = match[2] ?? 's'
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]
  return amount * factor
}

/**
 * Resolve engine knobs from an env mapping (`HIPPOCAMPUS_*`).
 * @param {object} env
 */
export function resolveCompartmentConfig(env = {}) {
  const ratio = (name, fallback, min, max) => {
    const value = Number(env[name])
    return env[name] !== undefined && env[name] !== '' && Number.isFinite(value) && value > min && value <= max ? value : fallback
  }
  const executeThreshold = ratio('HIPPOCAMPUS_BACKGROUND_TRIGGER', BACKGROUND_TRIGGER_RATIO, 0, 0.9)
  const provider = env.HIPPOCAMPUS_HISTORIAN_PROVIDER || undefined
  const model = env.HIPPOCAMPUS_HISTORIAN_MODEL || undefined
  return {
    executeThreshold,
    forceRatio: Math.max(0.85, executeThreshold + 0.02),
    cacheTtlMs: parseTtl(env.HIPPOCAMPUS_CACHE_TTL),
    // standalone idle reclaim uses the same "cache is cold" test as the idle
    // commit (the cache TTL, 5m by default), never less than it
    reclaimIdleMs: Math.max(parseTtl(env.HIPPOCAMPUS_RECLAIM_IDLE ?? env.HIPPOCAMPUS_CACHE_TTL), parseTtl(env.HIPPOCAMPUS_CACHE_TTL)),
    historyBudgetRatio: ratio('HIPPOCAMPUS_HISTORY_BUDGET', HISTORY_BUDGET_RATIO, 0.01, 0.5),
    historian: provider !== undefined && model !== undefined ? { provider, model } : undefined,
    historianFacts: !['off', 'false', '0', 'no'].includes(String(env.HIPPOCAMPUS_HISTORIAN_FACTS ?? '').trim().toLowerCase()),
  }
}

export class CompartmentCompaction {
  /**
   * @param {object} options - the HippocampusCompaction options plus:
   * @param {object} options.store - MemoryStore (compartment rows; required)
   * @param {object} options.fallback - single-checkpoint engine for unrecoverable cases
   * @param {object} [options.env] - HIPPOCAMPUS_* mapping
   * @param {() => number} [options.now]
   * @param {(text: string) => number} [options.estimateText]
   */
  constructor(options) {
    if (options.store === undefined) throw new Error('compartment compaction needs a store')
    this.options = options
    this.config = resolveCompartmentConfig(options.env ?? {})
    this.lane = new BackgroundLane()
    this.now = options.now ?? Date.now
    this.estimate = options.estimateText ?? roughTokens
    /** @type {Map<string, {count: number, until: number}>} */
    this.failures = new Map()
    /** @type {Map<string, {scanned: number, samples: number, cached: number}>} */
    this.cacheStats = new Map()
    /** @type {Map<string, Set<number>>} surface seqs a running historian call is summarizing */
    this.inflightSlices = new Map()
    /** Sessions whose force-band pressure reclaim already ran in this pressure episode. */
    this.pressureLatch = new Set()
  }

  // ---------------------------------------------------------------- hooks

  /**
   * @param {object} [step] - pre-step facts: `modelSelection` is the model
   *   this step will call (a switch means the prefix is uncached anyway)
   */
  async compactIfNeeded(agent, trigger, signal, step = {}) {
    if (trigger === 'context-overflow') return this.#blockingWithReclaim(agent, signal, 'overflow')
    const state = await this.#inspect(agent)
    if (state === null) return null
    if (state.pending.length > 0 && this.#commitWindowOpen(agent.session, state, step.modelSelection)) {
      const result = this.#commit(agent, state)
      // the commit rewrote the prefix from the checkpoint on: stale tool
      // output behind it goes in the same bust
      if (result !== null) await this.#reclaimAfter(agent, 'commit')
      return result
    }
    if (state.ratio >= EMERGENCY_RATIO && state.pending.length === 0 && !this.lane.isRunning(agent.session.id) && !this.#backoffActive(agent.session.id)) {
      return this.#blockingWithReclaim(agent, signal, 'emergency')
    }
    this.#maybeReclaim(agent, state, step.modelSelection)
    this.#maybeStartHistorian(agent, state, signal)
    return null
  }

  /**
   * A blocking fold rewrites the prefix anyway. Reclaim before it (the fold
   * then has less to summarize) and after it (results that aged into range).
   * A failing fold still keeps the reclaim, which may be what lets the
   * retried request fit.
   */
  async #blockingWithReclaim(agent, signal, mode) {
    const before = await this.#reclaimAfter(agent, mode)
    let result
    try {
      result = await this.#compactBlocking(agent, signal, mode)
    } catch (error) {
      if (before !== null) return null
      throw error
    }
    await this.#reclaimAfter(agent, mode)
    return result
  }

  async compactNow(agent, signal) {
    return agent.runMaintenance(() => this.#compactBlocking(agent, signal, 'manual'))
  }

  async compactRegion(start, end, agent, signal) {
    // explicit spans are rare and user-directed; the single-checkpoint path
    // handles them, and the lineage check drops compartments it invalidates
    return this.options.fallback.compactRegion(start, end, agent, signal)
  }

  // --------------------------------------------------------------- state

  /** Target whose context window defines pressure: the session's routed model. */
  #sessionTarget(agent) {
    const config = agent.session.requestHeader?.()?.config
    if (config?.provider && config?.model) return { provider: config.provider, model: config.model }
    if (this.options.defaultProvider && this.options.defaultModel) return { provider: this.options.defaultProvider, model: this.options.defaultModel }
    return null
  }

  /** Historian target: configured cheap model, else the session's own. */
  #historianTarget(agent) {
    return this.config.historian ?? this.options.modelConfig ?? this.#sessionTarget(agent)
  }

  async #windowOf(target) {
    try {
      const info = await this.options.resolveModelInfo(target.provider, target.model)
      const window = info?.context?.contextWindow
      return window !== undefined && window > 0 ? window : null
    } catch {
      return null
    }
  }

  /**
   * Measure the session and reconcile stored compartments with the surface.
   * Lineage rules: committed compartments live only inside the checkpoint at
   * the stored seq, which must sit right after the system head; pending
   * compartments must tile the surface contiguously from there. Anything
   * else (a fork, another engine's replace, a pruned node) drops the rows
   * that no longer describe the surface — the raw events are re-summarized.
   * @param {object} agent
   * @param {{tailTokens?: number}} [options]
   */
  async #inspect(agent, { tailTokens } = {}) {
    const session = agent.session
    const target = this.#sessionTarget(agent)
    if (target === null) return null
    const window = await this.#windowOf(target)
    if (window === null) return null
    let measurement
    try {
      measurement = this.options.measure(session)
    } catch {
      return null
    }
    const nodes = [...session.surface.nodes]
    if (nodes.length === 0) return null
    const firstIdx = surfaceHeadEnd(session, nodes)
    // Pressure is anchored on provider usage, node prices are the meter's
    // chars/4 heuristic. Every size threshold below (protected tail, trigger
    // budget, stale distance, history budget) is in provider tokens, so node
    // prices are scaled into that unit first. The input capacity excludes
    // the output the request reserves.
    const header = session.requestHeader?.()
    const scale = providerScale(measurement, toolsHeuristicTokens(header))
    const capacity = inputCapacity(window, header?.config?.maxTokens)
    const bySeq = new Map(measurement.nodes.map(node => [node.seq, node]))
    const priced = nodes.map(seq => providerPrice(bySeq.get(seq), scale))
    const ratio = measurement.totalTokens / capacity

    const { store } = this.options
    const sessionId = session.id
    let committed = store.compartments(sessionId, ['committed'])
    let pending = store.compartments(sessionId, ['pending'])
    const checkpointSeq = store.checkpointSeq(sessionId)
    let checkpointIdx = -1
    if (checkpointSeq !== null) {
      const index = nodes.indexOf(checkpointSeq)
      if (index !== firstIdx || committed.length === 0) {
        store.dropCompartments(sessionId)
        committed = []
        pending = []
      } else {
        checkpointIdx = index
      }
    } else if (committed.length > 0) {
      store.dropCompartments(sessionId, ['committed'])
      committed = []
    }
    let cursor = checkpointIdx >= 0 ? checkpointIdx + 1 : firstIdx
    for (const compartment of pending) {
      const startIndex = nodes.indexOf(compartment.startSeq)
      const endIndex = nodes.indexOf(compartment.endSeq)
      if (startIndex !== cursor || endIndex < startIndex) {
        store.dropCompartments(sessionId, ['pending'])
        pending = []
        cursor = checkpointIdx >= 0 ? checkpointIdx + 1 : firstIdx
        break
      }
      cursor = endIndex + 1
    }
    const rawStartIdx = cursor

    // protected tail, in provider tokens, never splitting a tool arc
    const tail = tailTokens ?? protectedTailTokens(capacity, this.config.executeThreshold, ratio)
    let keepFromIdx = nodes.length
    let retained = 0
    while (keepFromIdx > rawStartIdx && retained < tail) {
      keepFromIdx -= 1
      retained += priced[keepFromIdx]
    }
    const { toolPairingBalancedBefore, toolPairingBalancedAfter } = this.options.compactionModule
    const balancedAt = index => index < nodes.length
      ? toolPairingBalancedBefore(session, nodes[index])
      : toolPairingBalancedAfter === undefined || toolPairingBalancedAfter(session, nodes[index - 1])
    while (keepFromIdx > rawStartIdx && !balancedAt(keepFromIdx)) {
      keepFromIdx -= 1
    }
    const eligibleEndIdx = keepFromIdx - 1
    let eligibleTokens = 0
    for (let index = rawStartIdx; index <= eligibleEndIdx; index += 1) eligibleTokens += priced[index]
    // `window` is the input capacity from here on: every size threshold
    // derives from it
    return { window: capacity, scale, ratio, measurement, nodes, priced, firstIdx, checkpointIdx, committed, pending, rawStartIdx, eligibleEndIdx, eligibleTokens }
  }

  /** Whether committing now rides a cache that is dead anyway (or pressure forces it). */
  #commitWindowOpen(session, state, modelSelection) {
    if (state.ratio >= this.config.executeThreshold) return true
    if (this.#cacheless(session)) return true
    if (this.#modelChanged(session, modelSelection)) return true
    return this.#cacheExpired(session)
  }

  /** Whether the provider cache has expired by the configured TTL (ADR-9's commit test). */
  #cacheExpired(session) {
    return this.#idleMs(session) >= this.config.cacheTtlMs
  }

  /** A route that never reports cache reads/writes gets no benefit from a stable prefix. */
  #cacheless(session) {
    const stats = this.cacheStats.get(session.id) ?? { scanned: 0, samples: 0, cached: 0 }
    const end = Number(session.seq ?? 0)
    for (let seq = stats.scanned; seq < end; seq += 1) {
      const event = session.eventAt?.(seq)
      const usage = event?.type === 'assistant/message' ? event.data?.usage : undefined
      if (usage === undefined) continue
      stats.samples += 1
      if ((usage.cacheReadTokens ?? 0) > 0 || (usage.cacheWriteTokens ?? 0) > 0) stats.cached += 1
    }
    stats.scanned = Math.max(stats.scanned, end)
    this.cacheStats.set(session.id, stats)
    return stats.samples >= CACHELESS_MIN_SAMPLES && stats.cached === 0
  }

  /** Time since the last model response (the provider cache ages from there). */
  #idleMs(session) {
    const end = Number(session.seq ?? 0)
    for (let seq = end - 1; seq >= 0 && seq >= end - 5000; seq -= 1) {
      const event = session.eventAt?.(seq)
      if (event?.type === 'assistant/message') return this.now() - event.time
    }
    return 0
  }

  // -------------------------------------------------------------- reclaim

  /**
   * Why this pass may rewrite the prefix for tool-output reclaim on its own,
   * or null. The design assumes a prompt cache (ADR-10): reclaim never
   * originates a bust on a warm cache. It runs alone only when the cache for
   * this prefix is already lost (the step switches model, or no model
   * response for `reclaimIdleMs`, the cache TTL by default) or at the
   * force band, where fitting the window outranks the cache. Every other
   * reclaim rides a commit or a blocking fold (#reclaimAfter), which
   * rewrites the prefix anyway.
   */
  #reclaimReason(session, state, modelSelection) {
    if (this.#modelChanged(session, modelSelection)) return 'model-switch'
    if (this.#idleMs(session) >= this.config.reclaimIdleMs) return 'idle'
    if (state.ratio >= this.config.forceRatio) return 'force'
    return null
  }

  #maybeReclaim(agent, state, modelSelection) {
    // a pressure episode ends once pressure leaves the force band
    if (state.ratio < this.config.forceRatio) this.pressureLatch.delete(agent.session.id)
    const reason = this.#reclaimReason(agent.session, state, modelSelection)
    if (reason !== null) this.#reclaim(agent, state, reason)
  }

  /** The session's queued `ctx_reduce` seqs (empty when the store cannot be read). */
  #queued(session) {
    try {
      return this.options.store.reduceQueue?.(session.id) ?? []
    } catch {
      return []
    }
  }

  /** Reclaim on a pass whose prefix is rewritten anyway (commit, fold). */
  async #reclaimAfter(agent, reason) {
    const state = await this.#inspect(agent)
    return state === null ? null : this.#reclaim(agent, state, reason)
  }

  /**
   * Whether this step's model differs from the one the last request ran on.
   * The request header is logged after pre-step, so the step's selection is
   * compared with the last logged header (the same test as dsh-agent's
   * model-switch notice). A different model has no cache for this prefix:
   * the next request writes the prefix anew either way. Tool or system
   * prompt changes are not visible here and are not used.
   */
  #modelChanged(session, modelSelection) {
    if (modelSelection === undefined) return false
    const previous = session.requestHeader?.()?.config
    if (previous === undefined) return false
    return modelSelection.provider !== previous.provider || modelSelection.model !== previous.model
  }

  /**
   * Replace tool results with placeholders. Three lanes feed one batch:
   * stale and duplicate output (ADR-10), the agent's queued `ctx_reduce`
   * drops, and, at the force band, on a blocking fold or on overflow,
   * tiered pressure reclaim of output that is still current (ADR-11).
   * Leaves alone the nodes the compartment bookkeeping keys on (pending
   * boundaries, the running historian's slice) so lineage and the
   * historian's surface check hold. Synchronous log appends only.
   */
  #reclaim(agent, state, reason) {
    const session = agent.session
    if (compactionOpen(session)) return null
    const exclude = new Set(this.inflightSlices.get(session.id) ?? [])
    for (const compartment of state.pending) {
      exclude.add(compartment.startSeq)
      exclude.add(compartment.endSeq)
    }
    const startIdx = state.checkpointIdx >= 0 ? state.checkpointIdx + 1 : state.firstIdx
    const usable = usableTokens(state.window, this.config.executeThreshold)
    const view = { session, nodes: state.nodes, priced: state.priced, scale: state.scale, startIdx, usable, exclude }
    const sum = list => list.reduce((total, candidate) => total + candidate.tokens, 0)
    let stale
    let requested
    let pressure = []
    try {
      stale = selectReclaim(view)
      const queued = this.#queued(session)
      requested = queued.length === 0
        ? { picked: [], held: [], gone: [], covered: [] }
        : selectRequested({ ...view, requested: queued, skip: new Set(stale.map(candidate => candidate.seq)) })
      const absolute = reason === 'overflow' || reason === 'emergency' || state.ratio >= EMERGENCY_RATIO
      // once per force-band episode (magic-context's latch): a batch that
      // did not bring pressure down is not repeated every step; the fold
      // takes over. The latch gives way on a pass that rewrites the prefix
      // anyway (a commit, a fold, a cold cache), and at ≥ 95% and on
      // overflow every pass may take more.
      const independent = reason !== 'force'
      const pressureLane = absolute || (state.ratio >= this.config.forceRatio && (independent || !this.pressureLatch.has(session.id)))
      if (pressureLane) {
        const already = [...stale, ...requested.picked]
        const need = pressureNeed({
          total: state.measurement.totalTokens,
          surfaceTokens: state.priced.slice(Math.max(0, state.firstIdx)).reduce((total, tokens) => total + (tokens ?? 0), 0),
          ceiling: usable,
          already: sum(already),
        })
        pressure = selectPressure({ ...view, need, absolute, skip: new Set(already.map(candidate => candidate.seq)) })
      }
    } catch {
      return null
    }
    if (requested.gone.length > 0) {
      try {
        this.options.store.clearReduce(session.id, requested.gone)
      } catch {
        // retried on the next pass
      }
    }
    const picked = [...stale, ...requested.picked, ...pressure].sort((a, b) => a.index - b.index)
    if (picked.length === 0) return null
    // a standalone rewrite on a warm cache must be worth it (magic-context's
    // 2% bust floor); queued agent drops never start one of their own
    if (reason === 'force' && sum(picked) < usable * FORCE_RECLAIM_MIN_RATIO) return null
    const result = applyReclaim(session, picked, { measurement: state.measurement, freeze: this.options.llmModule?.freezeMessage })
    const applied = [...requested.picked.map(candidate => candidate.seq), ...requested.covered]
    if (applied.length > 0) {
      try {
        this.options.store.clearReduce(session.id, applied)
      } catch {
        // a stale queue entry is dropped on a later pass (the node is gone by then)
      }
    }
    if (pressure.length > 0) this.pressureLatch.add(session.id)
    const counts = {}
    for (const candidate of picked) counts[candidate.reason] = (counts[candidate.reason] ?? 0) + 1
    const parts = Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(', ')
    this.#recordRun(agent, 'reclaim', undefined, 'ok', {
      summary: { text: `${result.count} tool results (${parts}), ~${result.tokens} tokens; on ${reason}`, shadowedCount: result.count },
      shadowedStart: result.seqs[0],
      shadowedEnd: result.seqs.at(-1),
    })
    return result
  }

  // ------------------------------------------------------------ historian

  #backoffActive(sessionId) {
    const failure = this.failures.get(sessionId)
    return failure !== undefined && this.now() < failure.until
  }

  #maybeStartHistorian(agent, state, signal) {
    const sessionId = agent.session.id
    if (this.lane.isRunning(sessionId) || this.#backoffActive(sessionId)) return
    if (state.eligibleTokens <= 0) return
    const budget = triggerBudget(state.window, this.config.executeThreshold)
    const tailSize = state.eligibleTokens >= TAIL_SIZE_MULTIPLIER * budget
    const proactive = state.ratio >= this.config.executeThreshold - PROACTIVE_OFFSET && state.eligibleTokens >= budget
    const forced = state.ratio >= this.config.forceRatio
    if (!tailSize && !proactive && !forced) return
    // background work outlives the turn that triggered it: a user stopping
    // the turn must not abort (and back off) the historian. A timeout keeps
    // a hung stream from holding the lane forever.
    void this.lane.start(sessionId, () => this.#runHistorian(agent, AbortSignal.timeout(HISTORIAN_TIMEOUT_MS), {}))
  }

  /**
   * One historian call over the next chunk of the eligible span. On success
   * the compartments are stored as pending; the surface is not touched.
   * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
   */
  async #runHistorian(agent, signal, { tailTokens } = {}) {
    const session = agent.session
    const target = this.#historianTarget(agent)
    if (target === null) return { ok: false, error: 'no historian target' }
    const historianWindow = await this.#windowOf(target)
    const state = await this.#inspect(agent, { tailTokens })
    if (state === null || state.eligibleEndIdx < state.rawStartIdx) return { ok: false, error: 'nothing eligible' }
    const slice = this.#slice(session, state, historianChunkTokens(historianWindow ?? 0))
    if (slice === null) return { ok: false, error: 'no balanced slice' }
    this.inflightSlices.set(session.id, new Set(slice.seqs))
    try {
      return await this.#summarizeSlice(agent, target, slice, state, signal, tailTokens)
    } finally {
      this.inflightSlices.delete(session.id)
    }
  }

  async #summarizeSlice(agent, target, slice, state, signal, tailTokens) {
    const session = agent.session
    const recent = [...state.committed, ...state.pending].slice(-3)
      .map(compartment => ({ ...compartment, startSeq: originSeq(session, compartment.startSeq), endSeq: originSeq(session, compartment.endSeq) }))
    const startedAt = this.now()
    const identity = this.#identity(session)
    const memories = this.config.historianFacts ? this.#memoriesFor(identity) : []
    let result
    try {
      result = await this.#callLlm(target, historianUserMessage(slice.transcript, recent, memories), signal)
    } catch (error) {
      return this.#historianFailed(agent, target, String(error?.message ?? error), slice)
    }
    let compartments
    try {
      compartments = parseHistorianOutput(result.text, slice.seqs, slice.labels)
    } catch (error) {
      return this.#historianFailed(agent, target, String(error?.message ?? error), slice, result.usage)
    }
    // partial coverage: the model stopped early. Keep what it covered, cut
    // back to the last tool-balanced point inside it; the rest is summarized
    // by the next run
    const coveredIdx = slice.seqs.indexOf(compartments.at(-1).endSeq)
    const partial = coveredIdx < slice.seqs.length - 1
    if (partial) {
      const { toolPairingBalancedAfter } = this.options.compactionModule
      let cut = coveredIdx
      while (cut >= 0 && toolPairingBalancedAfter !== undefined && !toolPairingBalancedAfter(session, slice.seqs[cut])) cut -= 1
      const firstOfLast = slice.seqs.indexOf(compartments.at(-1).startSeq)
      if (cut < firstOfLast) return this.#historianFailed(agent, target, 'historian covered no balanced span', slice, result.usage)
      compartments.at(-1).endSeq = slice.seqs[cut]
      slice.seqs = slice.seqs.slice(0, cut + 1)
      slice.labels = slice.labels.slice(0, cut + 1)
    }
    // the surface may have moved while the call ran: the slice must still
    // start right after the current pending end, contiguously
    const fresh = await this.#inspect(agent, { tailTokens })
    const at = fresh === null ? -1 : fresh.rawStartIdx
    const stillThere = fresh !== null && slice.seqs.every((seq, offset) => fresh.nodes[at + offset] === seq)
    if (!stillThere) return this.#historianFailed(agent, target, 'surface moved under the slice', slice, result.usage, false)
    this.options.store.addCompartments(session.id, identity?.id, compartments)
    this.failures.delete(session.id)
    // facts from a call that stopped early cannot be told apart from the
    // uncovered rest, which the next call reads again: promoting them now
    // would state them twice (magic-context's discard-last rule)
    const promoted = this.config.historianFacts && !partial ? this.#promoteFacts(session, identity, result.text) : 0
    this.#recordRun(agent, 'historian', target, 'ok', {
      summary: { text: compartments.map(c => c.title).join(' | ').slice(0, 400), shadowedCount: slice.seqs.length, compartments: compartments.length, ...(promoted > 0 ? { facts: promoted } : {}) },
      usage: result.usage,
      durationMs: this.now() - startedAt,
      shadowedStart: slice.seqs[0],
      shadowedEnd: slice.seqs.at(-1),
    })
    return { ok: true, count: compartments.length }
  }

  #historianFailed(agent, target, message, slice, usage, backoff = true) {
    const sessionId = agent.session.id
    if (backoff) {
      const count = (this.failures.get(sessionId)?.count ?? 0) + 1
      this.failures.set(sessionId, { count, until: this.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (count - 1)) })
    }
    this.#recordRun(agent, 'historian', target, 'error', {
      error: message,
      usage,
      shadowedStart: slice?.seqs[0],
      shadowedEnd: slice?.seqs.at(-1),
    })
    return { ok: false, error: message }
  }

  /**
   * Cut the next historian chunk: from the raw start, accumulate formatted
   * tokens up to the chunk budget and end on the last tool-balanced cut.
   */
  #slice(session, state, chunkTokens) {
    const { toolPairingBalancedBefore } = this.options.compactionModule
    const { nodes, rawStartIdx, eligibleEndIdx } = state
    const toolNames = new Map()
    const lines = []
    let used = 0
    let lastBalanced = -1
    let linesAtBalanced = 0
    const labels = []
    for (let index = rawStartIdx; index <= eligibleEndIdx; index += 1) {
      const seq = nodes[index]
      // a replaced tool result (reclaim or the stock pruner) carries a newer
      // seq than its neighbours: label it with the original event's seq so
      // transcript labels stay increasing, and summarize a reclaimed result
      // from its original text
      const label = originSeq(session, seq)
      labels.push(label)
      let message = session.deriveEventMessage?.(session.eventAt?.(seq))
      if (isReclaimed(message)) message = session.deriveEventMessage?.(session.eventAt?.(label)) ?? message
      const line = formatNode(label, message, toolNames)
      if (line !== '') {
        lines.push(line)
        // the chunk budget is in provider tokens (a share of the historian's window)
        used += this.estimate(line) * (state.scale ?? 1)
      }
      const balancedAfter = index === eligibleEndIdx || toolPairingBalancedBefore(session, nodes[index + 1])
      if (balancedAfter) {
        lastBalanced = index
        linesAtBalanced = lines.length
        if (used >= chunkTokens) break
      }
    }
    if (lastBalanced < rawStartIdx) return null
    const transcript = lines.slice(0, linesAtBalanced).join('\n')
    if (transcript.trim() === '') return null
    const count = lastBalanced - rawStartIdx + 1
    return { seqs: nodes.slice(rawStartIdx, lastBalanced + 1), labels: labels.slice(0, count), transcript }
  }

  async #callLlm(target, userText, signal) {
    const assembler = new this.options.llmModule.BlockAssembler()
    const options = {
      provider: target.provider,
      model: target.model,
      system: HISTORIAN_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens: HISTORIAN_MAX_TOKENS,
      purpose: 'compaction',
      ...(signal === undefined ? {} : { signal }),
    }
    for await (const chunk of this.options.stream(options)) assembler.push(chunk)
    const failed = finishError(assembler.finish)
    if (failed !== undefined) throw failed
    const usage = assembler.usage === undefined ? undefined : {
      inputTokens: assembler.usage.inputTokens,
      outputTokens: assembler.usage.outputTokens,
      ...(assembler.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: assembler.usage.cacheReadTokens }),
      ...(assembler.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: assembler.usage.cacheWriteTokens }),
    }
    const text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('\n')
    return { text, usage }
  }

  // --------------------------------------------------------------- commit

  /**
   * Land every pending compartment: replace [old checkpoint or first node …
   * last pending end] with one checkpoint rendering all compartments.
   * Synchronous log appends only.
   */
  #commit(agent, state) {
    const session = agent.session
    const { nodes, firstIdx, checkpointIdx, committed, pending, priced } = state
    const startIdx = checkpointIdx >= 0 ? checkpointIdx : firstIdx
    const endIdx = nodes.indexOf(pending.at(-1).endSeq)
    if (endIdx < startIdx) return null
    if (compactionOpen(session)) return null
    const { toolPairingBalancedBefore } = this.options.compactionModule
    if (endIdx + 1 < nodes.length && !toolPairingBalancedBefore(session, nodes[endIdx + 1])) return null
    // headings cite raw-event seqs for ctx_expand: a bound on a replaced
    // node (reclaim, stock pruner) is shown as its original event's seq, so
    // the range reads in order; stored bounds stay surface seqs (lineage)
    const all = [...committed, ...pending].map(compartment => ({
      ...compartment,
      startSeq: originSeq(session, compartment.startSeq),
      endSeq: originSeq(session, compartment.endSeq),
    }))
    const budget = Math.round(usableTokens(state.window, this.config.executeThreshold) * this.config.historyBudgetRatio)
    // the budget is in provider tokens; the estimator is the meter's heuristic
    const history = renderHistory(all, budget, text => this.estimate(text) * (state.scale ?? 1))
    const shadowed = nodes.slice(startIdx, endIdx + 1)
    const target = this.#historianTarget(agent) ?? { provider: 'unknown', model: 'unknown' }
    const summaryBlocks = [
      { type: 'text', text: `${HISTORY_PREAMBLE}\nSession id: ${session.id}\n\n<compacted-summary>` },
      { type: 'text', text: history.text },
      { type: 'text', text: '</compacted-summary>' },
    ]
    const result = appendCompaction(session, this.options.compactionModule, {
      startSeq: nodes[startIdx],
      endSeq: nodes[endIdx],
      shadowedSeqs: shadowed,
      shadowedTokenCount: heuristicPrice(state.measurement, shadowed),
      summaryBlocks,
      provider: target.provider,
      model: target.model,
    })
    this.options.store.commitCompartments(session.id, result.checkpointSeq)
    const archived = history.tiers.filter(tier => tier >= 5).length
    this.#recordRun(agent, 'commit', target, 'ok', {
      summary: { text: `${all.length} compartments (${pending.length} new, ${archived} archived), ~${this.estimate(history.text)} tokens`, shadowedCount: shadowed.length },
      shadowedStart: nodes[startIdx],
      shadowedEnd: nodes[endIdx],
    })
    return result
  }

  /**
   * Blocking fold for overflow / emergency / manual compaction: wait out a
   * running historian, summarize the eligible span inline (bounded chunks),
   * commit. Falls back to the single-checkpoint engine when no compartments
   * could be produced.
   */
  async #compactBlocking(agent, signal, mode) {
    const sessionId = agent.session.id
    const running = this.lane.inFlight.get(sessionId)
    if (running !== undefined) {
      await Promise.race([running.promise, new Promise(resolve => setTimeout(resolve, BLOCKING_WAIT_MS).unref?.())])
    }
    let state = await this.#inspect(agent)
    if (state === null) return this.#fallback(agent, signal, mode)
    // overflow/emergency keep only the tail floor; manual keeps the normal tail
    const tailTokens = mode === 'manual' ? undefined : protectedTailTokens(state.window, this.config.executeThreshold, 1)
    // under backoff the historian just failed: go straight to the fallback
    // instead of paying for another doomed call
    const calls = this.#backoffActive(sessionId) && mode !== 'manual' ? 0 : MAX_BLOCKING_CHUNKS
    for (let call = 0; call < calls; call += 1) {
      state = await this.#inspect(agent, { tailTokens })
      if (state === null || state.eligibleEndIdx < state.rawStartIdx) break
      const outcome = await this.#runHistorian(agent, signal, { tailTokens })
      if (!outcome.ok) break
    }
    state = await this.#inspect(agent, { tailTokens })
    if (state !== null && state.pending.length > 0) {
      const result = this.#commit(agent, state)
      if (result !== null) return result
    }
    return this.#fallback(agent, signal, mode)
  }

  async #fallback(agent, signal, mode) {
    const fallback = this.options.fallback
    if (fallback === undefined) return null
    // compactNow already holds runMaintenance, so call the inline path
    // directly; manual keeps a 16% tail like the stock backend, overflow
    // and emergency keep nothing back
    const retainTokens = mode === 'manual' ? Math.floor(this.options.measure(agent.session).totalTokens * 0.16) : 0
    try {
      return await fallback.compactInline(agent, signal, { retainTokens })
    } catch (error) {
      // emergency retries must not hammer a failing model every step
      if (mode === 'emergency') {
        const sessionId = agent.session.id
        const count = (this.failures.get(sessionId)?.count ?? 0) + 1
        this.failures.set(sessionId, { count, until: this.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (count - 1)) })
      }
      throw error
    }
  }

  // --------------------------------------------------------------- facts

  /** Active project memories for the historian's dedup block (notes excluded), or none. */
  #memoriesFor(identity) {
    if (identity?.id === undefined) return []
    try {
      return this.options.store.list({ projectId: identity.id }).filter(row => row.source_type !== 'note')
    } catch {
      return []
    }
  }

  /**
   * Write the historian's facts as project memories (source_type
   * 'historian'). A fact matching any stored row only counts as a
   * re-observation; the dreamer's verify and curate passes review new rows
   * like any other memory. Best effort: a failure never blocks the
   * compartments.
   * @returns {number} new memories
   */
  #promoteFacts(session, identity, text) {
    if (identity?.id === undefined) return 0
    const facts = parseHistorianFacts(text, CATEGORIES)
    if (facts.length === 0) return 0
    try {
      // the dreamer walks the projects table; a project known only through
      // historian facts must be in it
      if (identity.root !== undefined) this.options.store.registerProject(identity.id, identity.root, identity.kind)
    } catch {
      // the memories still land; registration is retried by the next tool call
    }
    let written = 0
    for (const fact of facts) {
      try {
        // a fact that matches any stored row, archived or a note included,
        // only counts as a re-observation: the historian never revives what
        // the agent or the dreamer archived (it only sees active memories)
        // and never promotes a note (magic-context's promotion does the same)
        if (this.options.store.observe({ projectId: identity.id, category: fact.category, content: fact.content })) continue
        const row = this.options.store.write({
          projectId: identity.id,
          category: fact.category,
          content: fact.content,
          importance: HISTORIAN_FACT_IMPORTANCE,
          sourceType: 'historian',
          sourceSession: session.id,
        })
        if (row !== null) written += 1
      } catch {
        // one bad fact must not drop the others
      }
    }
    return written
  }

  // ------------------------------------------------------------- records

  #identity(session) {
    try {
      const cwd = session.header?.cwd
      return cwd !== undefined && this.options.resolver !== undefined ? this.options.resolver.resolve(cwd) : undefined
    } catch {
      return undefined
    }
  }

  #recordRun(agent, mode, target, status, detail) {
    try {
      const session = agent.session
      this.options.store.recordCompactionRun({
        sessionId: session.id,
        projectId: this.#identity(session)?.id,
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
}
