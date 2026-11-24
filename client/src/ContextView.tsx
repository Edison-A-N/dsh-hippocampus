/**
 * Hippocampus compaction panel as a conversation view tab: what this plugin
 * does to the context, which the host's own token views cannot show.
 *
 * - 概览: KPI tiles (model calls and input-weighted cache hit rate over the
 *   rows the chart draws; whole-session busts and prefix rewrites, the latter
 *   counted from the log's compaction/summary events and tool-output prune
 *   batches; project curation runs).
 * - 缓存命中: one stacked bar per model call (cache read / write / uncached,
 *   height = input size), red dot = bust (a compaction replaced the prefix
 *   before that call).
 * - 压缩记录: per-call summarization records (mode, model, shadowed span,
 *   usage, duration, summary text) plus the raw compaction event timeline.
 * - 后台整理: dreamer run records with the manual trigger.
 *
 * Context occupancy and composition live in the host token views (and
 * dsh-context), so this panel does not repeat them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { IconCheck, IconGauge, IconLayers, IconRefresh, IconShield, IconSparkles, IconX } from './icons.tsx'
import css from './ui.module.css'

type T = PropsLocale<typeof NS>['t']

/** One compaction event hit (the webapi projection). */
interface CompactionHit {
  seq: number
  type: string
  time: number
  snippet: string | null
  /** a prune batch appended right after a commit: part of that rewrite */
  ridesCommit?: boolean
}

/** One dreamer run record. */
interface DreamRun {
  id: number
  task: string
  status: string
  result: unknown
  ranAt: number
}

/** One summarization call record. */
interface CompactionRun {
  id: number
  mode: string
  provider: string | null
  model: string | null
  status: string
  summary: { text?: string, shadowedCount?: number } | null
  error: string | null
  usage: { inputTokens?: number, outputTokens?: number, cacheReadTokens?: number } | null
  durationMs: number | null
  shadowedStart: number | null
  shadowedEnd: number | null
  ranAt: number
}

/** One model-call cache row. */
interface CacheRow {
  seq: number
  time: number
  input: number
  cacheRead: number
  cacheWrite: number
  hitRate: number
  bust: boolean
}

interface ContextReply {
  model: string | null
  cache: { rows: CacheRow[], busts: number }
  compactions: CompactionHit[]
  compactionRuns: CompactionRun[]
  dreamRuns: DreamRun[]
}

const EMPTY: ContextReply = { model: null, cache: { rows: [], busts: 0 }, compactions: [], compactionRuns: [], dreamRuns: [] }

/** Server-side caps (lib/webapi.js): cache rows, compaction runs, dreamer runs. */
const CACHE_ROWS_CAP = 120
const COMPACTION_RUNS_CAP = 20
const DREAM_RUNS_CAP = 50

/** Dreamer rows shown before "show more". */
const DREAM_PAGE = 12

/** Resolve the owning project of this session (same as MemoryView). */
async function fetchProjectId(cwd: string | undefined): Promise<string | null> {
  if (cwd === undefined || cwd === '') return null
  const response = await fetch(`/plugins/hippocampus/api/resolve?path=${encodeURIComponent(cwd)}`)
  if (!response.ok) return null
  const reply = await response.json() as { project?: { id: string } }
  return reply.project?.id ?? null
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? day : `${d.getFullYear()}-${day}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

const pct = (rate: number): string => `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`

/** Tile accent for a hit rate (green ≥ 70%, amber ≥ 40%, red below). */
const hitAccent = (rate: number): string => rate >= 0.7 ? 'green' : rate >= 0.4 ? 'amber' : 'red'

const MODE_ACCENT: Record<string, string> = {
  background: 'blue',
  overflow: 'red',
  region: 'amber',
  historian: 'violet',
  commit: 'teal',
  reclaim: 'amber',
}

const modeLabel = (t: T, mode: string): string => {
  const key = `ctx.mode.${mode}` as Parameters<T>[0]
  const text = t(key)
  return text === key ? mode : text
}

const eventLabel = (t: T, type: string): string => {
  if (type === 'compaction/start') return t('ctx.event.start')
  if (type === 'compaction/summary') return t('ctx.event.summary')
  if (type === 'compaction/end') return t('ctx.event.end')
  if (type === 'compaction/prune') return t('ctx.event.prune')
  return type
}

/** Human summary of one dreamer run result (task-specific shapes). */
function dreamResultText(t: T, run: DreamRun): string {
  const r = run.result as Record<string, unknown> | null
  if (r === null) return ''
  if (typeof r.error === 'string') return r.error
  if (typeof r.checked === 'number') return t('ctx.dreamer.checked', { checked: r.checked, applied: Number(r.applied ?? 0) })
  if (typeof r.considered === 'number') return t('ctx.dreamer.considered', { considered: r.considered, applied: Number(r.applied ?? 0) })
  if (r.task === 'verify' && Object.keys(r).length === 1) return t('ctx.dreamer.nothing')
  return JSON.stringify(r).slice(0, 160)
}

/** "applied" count of a dreamer run, for emphasis. */
const dreamApplied = (run: DreamRun): number => {
  const r = run.result as Record<string, unknown> | null
  return r !== null && typeof r.applied === 'number' ? r.applied : 0
}

function StatusIcon({ ok, t }: { ok: boolean, t: T }) {
  return (
    <span className={css.status} data-status={ok ? 'ok' : 'error'} role="img" aria-label={ok ? t('ctx.status.ok') : t('ctx.status.error')}>
      {ok ? <IconCheck size={11} /> : <IconX size={11} />}
    </span>
  )
}

/** Stacked bar chart of per-call cache composition. */
function CacheChart({ rows, t }: { rows: CacheRow[], t: T }) {
  const max = Math.max(1, ...rows.map(row => row.input))
  return (
    <>
      <div className={css.chart} role="img" aria-label={t('ctx.cache.title')}>
        {rows.map(row => {
          const miss = Math.max(0, row.input - row.cacheRead - row.cacheWrite)
          return (
            <div
              key={row.seq}
              className={css.bar}
              style={{ height: `${Math.max(2, (row.input / max) * 100)}%` }}
              title={t('ctx.cache.tip', {
                seq: row.seq,
                rate: pct(row.hitRate),
                read: formatTokens(row.cacheRead),
                write: formatTokens(row.cacheWrite),
                miss: formatTokens(miss),
              }) + (row.bust ? ` · ${t('ctx.cache.bust')}` : '')}
            >
              {/* column-reverse: first child sits at the bottom */}
              <span className={css.barSeg} data-kind="read" style={{ height: row.input > 0 ? `${(row.cacheRead / row.input) * 100}%` : 0 }} />
              <span className={css.barSeg} data-kind="write" style={{ height: row.input > 0 ? `${(row.cacheWrite / row.input) * 100}%` : 0 }} />
              <span className={css.barSeg} data-kind="miss" style={{ height: row.input > 0 ? `${(miss / row.input) * 100}%` : 0 }} />
              {row.bust ? <span className={css.bust} /> : null}
            </div>
          )
        })}
      </div>
      <div className={css.axis}>
        <span>{t('ctx.cache.axisSeq', { seq: rows[0]?.seq ?? 0 })}</span>
        <span>{t('ctx.cache.axisMax', { value: formatTokens(max) })}</span>
        <span>{t('ctx.cache.axisSeq', { seq: rows.at(-1)?.seq ?? 0 })}</span>
      </div>
      <div className={css.legend}>
        <span className={css.legendItem}><span className={css.legendSwatch} data-kind="read" />{t('ctx.cache.read')}</span>
        <span className={css.legendItem}><span className={css.legendSwatch} data-kind="write" />{t('ctx.cache.write')}</span>
        <span className={css.legendItem}><span className={css.legendSwatch} data-kind="miss" />{t('ctx.cache.miss')}</span>
        <span className={css.legendItem}><span className={css.legendSwatch} data-kind="bust" />{t('ctx.cache.bust')}</span>
      </div>
    </>
  )
}

/** One summarization call row. */
function CompactionRunRow({ run, t }: { run: CompactionRun, t: T }) {
  const ok = run.status === 'ok'
  const facts: string[] = []
  if (run.shadowedStart !== null || run.shadowedEnd !== null) {
    facts.push(t('ctx.compaction.shadowed', { start: String(run.shadowedStart ?? '?'), end: String(run.shadowedEnd ?? '?') }))
  }
  if (run.usage != null) {
    facts.push(t('ctx.compaction.input', { value: formatTokens(run.usage.inputTokens ?? 0) }))
    if ((run.usage.outputTokens ?? 0) > 0) facts.push(t('ctx.compaction.output', { value: formatTokens(run.usage.outputTokens ?? 0) }))
    if ((run.usage.cacheReadTokens ?? 0) > 0) facts.push(t('ctx.compaction.cacheRead', { value: formatTokens(run.usage.cacheReadTokens ?? 0) }))
  }
  if (run.durationMs != null && run.durationMs > 0) facts.push(`${(run.durationMs / 1000).toFixed(1)}s`)
  const summary = run.summary?.text
  return (
    <li className={css.row} data-status={ok ? 'ok' : 'error'}>
      <StatusIcon ok={ok} t={t} />
      <span className={css.chip} data-accent={MODE_ACCENT[run.mode] ?? 'gray'}>{modeLabel(t, run.mode)}</span>
      <div className={css.rowMain}>
        {!ok ? <div className={css.rowText}>{run.error ?? t('ctx.compaction.failed')}</div> : null}
        <div className={css.rowFacts}>
          {run.model !== null ? <b>{run.model}</b> : null}
          {facts.map(fact => <span key={fact}>{fact}</span>)}
        </div>
        {summary != null && summary !== ''
          ? (
            <details className={css.details}>
              <summary>{t('ctx.compaction.summary')}</summary>
              <div className={css.detailsBody}>{summary}</div>
            </details>
          )
          : null}
      </div>
      <span className={css.meta}>{formatDate(run.ranAt)}</span>
    </li>
  )
}

/**
 * The compaction tab body: KPIs, cache chart, compaction records, and
 * dreamer runs.
 * @param props - framework view props plus locale.
 */
export function ContextView({ sessionId, useSessions, t }: ConvViewProps & PropsLocale<typeof NS>) {
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const [data, setData] = useState<ContextReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<'verify' | 'curate' | null>(null)
  const [triggerNote, setTriggerNote] = useState<{ ok: boolean, text: string } | null>(null)
  const [dreamFilter, setDreamFilter] = useState<'all' | 'failed'>('all')
  const [dreamLimit, setDreamLimit] = useState(DREAM_PAGE)
  // Request sequence: only the newest load may write state, so a slow reply
  // for a previous session never overwrites the current one.
  const loadSeq = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const seq = ++loadSeq.current
    const current = () => seq === loadSeq.current
    if (!quiet) setData(null)
    setLoading(true)
    setError(null)
    try {
      const project = await fetchProjectId(cwd)
      if (!current()) return
      setProjectId(project)
      if (project === null) {
        setData(EMPTY)
        return
      }
      const response = await fetch(
        `/plugins/hippocampus/api/context?session=${encodeURIComponent(sessionId)}&project=${encodeURIComponent(project)}`,
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const reply = { ...EMPTY, ...(await response.json() as Partial<ContextReply>) }
      if (current()) setData(reply)
    } catch (reason) {
      if (!current()) return
      setError(String(reason instanceof Error ? reason.message : reason))
      // A failed quiet refresh keeps what is on screen; a failed first load
      // shows the empty panel and disables the dreamer triggers.
      if (!quiet) {
        setProjectId(null)
        setData(EMPTY)
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [sessionId, cwd])

  /** Manual dreamer trigger: run one task now, then refresh the runs list. */
  const triggerDreamer = useCallback(async (task: 'verify' | 'curate') => {
    if (projectId === null || triggering !== null) return
    setTriggering(task)
    setTriggerNote(null)
    try {
      const response = await fetch('/plugins/hippocampus/api/dreamer/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectId, task }),
      })
      const payload = await response.json().catch(() => null) as { error?: string, status?: string, result?: { error?: string } } | null
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      setTriggerNote(payload?.status === 'ok'
        ? { ok: true, text: t('ctx.dreamer.done') }
        : { ok: false, text: `${t('ctx.dreamer.failed')}: ${payload?.result?.error ?? ''}` })
    } catch (reason) {
      setTriggerNote({ ok: false, text: String(reason instanceof Error ? reason.message : reason) })
    } finally {
      setTriggering(null)
      void load(true)
    }
  }, [projectId, triggering, t, load])

  useEffect(() => { void load() }, [load])

  const hasFailedDreams = data?.dreamRuns.some(run => run.status !== 'ok') ?? false
  useEffect(() => { if (!hasFailedDreams) setDreamFilter('all') }, [hasFailedDreams])

  const kpi = useMemo(() => {
    if (data === null) return null
    // Calls and hit rate describe the rows the chart draws (the newest
    // CACHE_ROWS_CAP calls); busts and prefix rewrites are whole-session
    // counts from the same log, so the two compaction figures pair up.
    const rows = data.cache.rows
    const input = rows.reduce((sum, row) => sum + row.input, 0)
    const read = rows.reduce((sum, row) => sum + row.cacheRead, 0)
    const runs = data.compactionRuns
    // A prefix rewrite is a compaction/summary event in the session log (every
    // engine appends exactly one per checkpoint replace, and only when the
    // replace happens) or one batch of tool-output prunes (reclaim or the
    // stock pruner; the API collapses each batch into one row, and a batch
    // riding a commit is part of that commit's rewrite). Run records
    // are not used here: a background summary records "ok" when it lands,
    // which may be long before (or instead of) a commit.
    const rewrites = data.compactions.filter(hit => hit.type === 'compaction/summary' || (hit.type === 'compaction/prune' && hit.ridesCommit !== true)).length
    return {
      calls: rows.length,
      input,
      read,
      hit: input > 0 ? read / input : 0,
      busts: data.cache.busts,
      capped: rows.length >= CACHE_ROWS_CAP,
      rewrites,
      summaries: runs.filter(run => run.mode === 'historian' && run.status === 'ok').length,
      runsFailed: runs.filter(run => run.status !== 'ok').length,
      runsCapped: runs.length >= COMPACTION_RUNS_CAP,
      dreams: data.dreamRuns.length,
      dreamsFailed: data.dreamRuns.filter(run => run.status !== 'ok').length,
    }
  }, [data])

  if (data === null || kpi === null) {
    return <div className={css.root}><div className={css.state}>{t('ctx.loading')}</div></div>
  }

  const dreams = dreamFilter === 'failed' ? data.dreamRuns.filter(run => run.status !== 'ok') : data.dreamRuns
  const hasCompactions = data.compactionRuns.length > 0 || data.compactions.length > 0

  return (
    <div className={css.root}>
      {error !== null
        ? (
          <div className={css.banner} data-tone="error">
            {t('ctx.error', { reason: error })}
            <button type="button" className={css.btn} onClick={() => { void load() }}>{t('ctx.refresh')}</button>
          </div>
        )
        : null}

      <section className={css.card}>
        <header className={css.cardHead}>
          <h2 className={css.cardTitle}><IconGauge />{t('ctx.cache.title')}</h2>
          <span className={css.cardSub}>
            {data.model !== null ? `${data.model} · ` : ''}{t('ctx.cache.sub')}
          </span>
          <span className={css.cardTools}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => { void load(true) }}
              aria-label={t('ctx.refresh')}
              title={t('ctx.refresh')}
              disabled={loading}
            >
              <span className={loading ? css.spin : undefined} style={{ display: 'inline-flex' }}><IconRefresh /></span>
            </button>
          </span>
        </header>
        <div className={css.tiles} style={{ marginBottom: 12 }}>
          <div className={css.tile} data-accent="ink">
            <span className={css.tileValue}>{kpi.calls}</span>
            <span className={css.tileLabel}>{t('ctx.kpi.calls')}</span>
            {kpi.capped ? <span className={css.tileSub}>{t('ctx.cache.recent', { count: kpi.calls })}</span> : null}
          </div>
          <div className={css.tile} data-accent={kpi.calls > 0 ? hitAccent(kpi.hit) : 'gray'}>
            <span className={css.tileValue}>{kpi.calls > 0 ? pct(kpi.hit) : '—'}</span>
            <span className={css.tileLabel}>{t('ctx.kpi.hit')}</span>
            <span className={css.tileSub}>{t('ctx.kpi.hitSub', { read: formatTokens(kpi.read), input: formatTokens(kpi.input) })}</span>
          </div>
          <div className={css.tile} data-accent={kpi.busts > 0 ? 'red' : 'gray'}>
            <span className={css.tileValue}>{kpi.busts}</span>
            <span className={css.tileLabel}>{t('ctx.kpi.busts')}</span>
            <span className={css.tileSub}>{t('ctx.kpi.bustsSub')}</span>
          </div>
          <div className={css.tile} data-accent={kpi.runsFailed > 0 ? 'amber' : 'violet'}>
            <span className={css.tileValue}>{kpi.rewrites}</span>
            <span className={css.tileLabel}>{t('ctx.kpi.compactions')}</span>
            <span className={css.tileSub}>
              {kpi.summaries > 0 ? t('ctx.kpi.summaries', { count: kpi.summaries, capped: kpi.runsCapped ? '+' : '' }) : t('ctx.kpi.compactionsSub')}
              {kpi.runsFailed > 0 ? ` · ${t('ctx.kpi.failed', { count: kpi.runsFailed })}` : ''}
            </span>
          </div>
          <div className={css.tile} data-accent={kpi.dreamsFailed > 0 ? 'amber' : 'teal'}>
            <span className={css.tileValue}>{kpi.dreams}{kpi.dreams >= DREAM_RUNS_CAP ? '+' : ''}</span>
            <span className={css.tileLabel}>{t('ctx.kpi.dreams')}</span>
            <span className={css.tileSub}>
              {t('ctx.kpi.dreamsSub')}
              {kpi.dreamsFailed > 0 ? ` · ${t('ctx.kpi.failed', { count: kpi.dreamsFailed })}` : ''}
            </span>
          </div>
        </div>
        {data.cache.rows.length === 0
          ? <div className={css.inlineState}>{t('ctx.cache.empty')}</div>
          : <CacheChart rows={data.cache.rows} t={t} />}
      </section>

      <section className={css.card}>
        <header className={css.cardHead}>
          <h2 className={css.cardTitle}><IconLayers />{t('ctx.compaction.title')}</h2>
        </header>
        {!hasCompactions
          ? <div className={css.inlineState}>{t('ctx.compaction.empty')}</div>
          : null}
        {data.compactionRuns.length > 0
          ? (
            <ul className={css.rows}>
              {data.compactionRuns.map(run => <CompactionRunRow key={`run-${run.id}`} run={run} t={t} />)}
            </ul>
          )
          : null}
        {data.compactions.length > 0
          ? (
            <details className={css.details} open={data.compactionRuns.length === 0} style={{ marginTop: 8 }}>
              <summary>{t('ctx.compaction.events', { count: data.compactions.length })}</summary>
              <ul className={css.rows} style={{ marginTop: 6 }}>
                {data.compactions.map(hit => (
                  <li key={hit.seq} className={css.row}>
                    <span className={css.dot} data-accent={hit.type === 'compaction/summary' ? 'blue' : hit.type === 'compaction/prune' ? 'amber' : 'gray'} style={{ marginTop: 5, marginLeft: 5 }} />
                    <span className={css.chip} data-accent={hit.type === 'compaction/summary' ? 'blue' : hit.type === 'compaction/prune' ? 'amber' : 'gray'}>{eventLabel(t, hit.type)}</span>
                    <div className={css.rowMain}>
                      <span className={css.meta}>seq {hit.seq}</span>
                      {hit.snippet !== null && hit.snippet !== '' ? <div className={`${css.rowText} ${css.muted}`}>{hit.snippet}</div> : null}
                    </div>
                    <span className={css.meta}>{formatDate(hit.time)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )
          : null}
      </section>

      <section className={css.card}>
        <header className={css.cardHead}>
          <h2 className={css.cardTitle}><IconSparkles />{t('ctx.dreamer.title')}</h2>
          <span className={css.cardSub}>{t('ctx.dreamer.sub')}</span>
          <span className={css.cardTools}>
            {hasFailedDreams
              ? (
                <span className={css.segmented}>
                  <button type="button" aria-pressed={dreamFilter === 'all'} className={dreamFilter === 'all' ? css.segmentOn : css.segment} onClick={() => { setDreamFilter('all') }}>{t('ctx.dreamer.all')}</button>
                  <button type="button" aria-pressed={dreamFilter === 'failed'} className={dreamFilter === 'failed' ? css.segmentOn : css.segment} onClick={() => { setDreamFilter('failed') }}>{t('ctx.dreamer.failedOnly')}</button>
                </span>
              )
              : null}
            <button
              type="button"
              className={css.btn}
              disabled={projectId === null || triggering !== null}
              onClick={() => { void triggerDreamer('verify') }}
              title={t('ctx.dreamer.verifyTip')}
            >
              <IconShield size={13} />{triggering === 'verify' ? t('ctx.dreamer.running') : t('ctx.dreamer.verify')}
            </button>
            <button
              type="button"
              className={css.btn}
              disabled={projectId === null || triggering !== null}
              onClick={() => { void triggerDreamer('curate') }}
              title={t('ctx.dreamer.curateTip')}
            >
              <IconSparkles size={13} />{triggering === 'curate' ? t('ctx.dreamer.running') : t('ctx.dreamer.curate')}
            </button>
          </span>
        </header>
        {triggerNote !== null
          ? <div className={css.banner} data-tone={triggerNote.ok ? 'ok' : 'error'} style={{ marginBottom: 8 }}>{triggerNote.text}</div>
          : null}
        {dreams.length === 0
          ? <div className={css.inlineState}>{t('ctx.dreamer.empty')}</div>
          : (
            <ul className={css.rows}>
              {dreams.slice(0, dreamLimit).map(run => {
                const ok = run.status === 'ok'
                const applied = dreamApplied(run)
                return (
                  <li key={`dream-${run.id}`} className={css.row} data-status={ok ? 'ok' : 'error'}>
                    <StatusIcon ok={ok} t={t} />
                    <span className={css.chip} data-accent={run.task === 'verify' ? 'teal' : 'violet'}>
                      {run.task === 'verify' ? t('ctx.dreamer.task.verify') : run.task === 'curate' ? t('ctx.dreamer.task.curate') : run.task}
                    </span>
                    <div className={css.rowMain}>
                      <div className={css.rowText} style={ok && applied > 0 ? { fontWeight: 600 } : undefined}>{dreamResultText(t, run)}</div>
                    </div>
                    <span className={css.meta}>{formatDate(run.ranAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        {dreams.length > dreamLimit
          ? (
            <div className={css.listFoot}>
              <button type="button" className={css.btn} onClick={() => { setDreamLimit(dreamLimit + DREAM_PAGE * 2) }}>
                {t('ctx.dreamer.more', { count: Math.min(DREAM_PAGE * 2, dreams.length - dreamLimit) })}
              </button>
            </div>
          )
          : null}
      </section>
    </div>
  )
}
