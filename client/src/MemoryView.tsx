/**
 * Hippocampus memory browser as a conversation view tab: a full-width,
 * scrollable, searchable list of this project's memories, sitting beside the
 * chat and trajectory tabs. Data arrives from the plugin's JSON API
 * (`/plugins/hippocampus/api/*`); the view snapshot machinery is unused
 * (a constant empty snapshot) because memories are not part of the
 * conversation event stream.
 *
 * Layout: a sticky overview card (KPI tiles that double as category filters,
 * search, sort), then one group per category of memory cards. Each card
 * carries its category color as a left stripe and its importance as a small
 * bar; long memories clamp to four lines with an expand toggle.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { IconArchive, IconBrain, IconCheck, IconInbox, IconPencil, IconRefresh, IconSearch, IconX } from './icons.tsx'
import css from './ui.module.css'

type T = PropsLocale<typeof NS>['t']

/** Wire row of one memory (the webapi projection). */
interface MemoryRow {
  id: number
  category: string
  content: string
  importance: number
  status: string
  created_at: number
}

/** Wire shape of GET /plugins/hippocampus/api/memories. */
interface MemoriesReply { count: number, memories: MemoryRow[] }

/** Wire shape of GET /plugins/hippocampus/api/stats. */
interface StatsReply { byCategory: Record<string, number>, archived: number, pendingEmbeddings: number }

/** Resolved owning project of the session. */
interface Project { id: string, root: string }

/** Canonical category display order. */
const CATEGORY_ORDER = ['PROJECT_RULES', 'ARCHITECTURE', 'CONSTRAINTS', 'CONFIG_VALUES', 'NAMING'] as const

/** Category → accent token (ui.module.css `[data-accent]`). */
const CATEGORY_ACCENT: Record<string, string> = {
  PROJECT_RULES: 'violet',
  ARCHITECTURE: 'blue',
  CONSTRAINTS: 'red',
  CONFIG_VALUES: 'teal',
  NAMING: 'amber',
}

const accentOf = (category: string): string => CATEGORY_ACCENT[category] ?? 'gray'

/**
 * Resolve the owning project of THIS session — by its workspace cwd, the
 * same identity ctx_memory applies — so the panel never shows another
 * project's memory pool.
 */
async function fetchProject(cwd: string | undefined): Promise<Project | null> {
  if (cwd === undefined || cwd === '') return null
  const response = await fetch(`/plugins/hippocampus/api/resolve?path=${encodeURIComponent(cwd)}`)
  if (!response.ok) return null
  const reply = await response.json() as { project?: Project }
  return reply.project ?? null
}

/** Format a unix-ms timestamp as a short local date. */
function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Last two path segments, for the project subtitle. */
function shortRoot(root: string): string {
  const parts = root.split('/').filter(Boolean)
  return parts.length <= 2 ? root : `…/${parts.slice(-2).join('/')}`
}

/** Highlight every case-insensitive occurrence of `needle` in `text`. */
function highlight(text: string, needle: string): ReactNode {
  if (needle === '') return text
  const lower = text.toLowerCase()
  const out: ReactNode[] = []
  let from = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at === -1) break
    if (at > from) out.push(text.slice(from, at))
    out.push(<mark key={at} className={css.mark}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  if (out.length === 0) return text
  out.push(text.slice(from))
  return out
}

const categoryLabel = (t: T, category: string): string => {
  const key = `category.${category}` as Parameters<T>[0]
  const text = t(key)
  return text === key ? category : text
}

/**
 * The memory tab body: overview + category-filtered, searchable list.
 * @param props - framework view props (sessionId, useSessions) plus locale.
 */
export function MemoryView({ sessionId, useSessions, t }: ConvViewProps & PropsLocale<typeof NS>) {
  // The session's workspace cwd: the panel follows the project THIS session
  // belongs to — switch sessions and the memory pool follows.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const [rows, setRows] = useState<readonly MemoryRow[] | null>(null)
  const [stats, setStats] = useState<StatsReply | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'importance'>('recent')
  // Request sequence: only the newest load may write state, so a slow reply
  // for a previous session's project never overwrites the current pool.
  const loadSeq = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const seq = ++loadSeq.current
    const current = () => seq === loadSeq.current
    if (!quiet) setRows(null)
    setLoading(true)
    setError(null)
    try {
      const resolved = await fetchProject(cwd)
      if (!current()) return
      setProject(resolved)
      if (resolved === null) {
        setRows([])
        setStats(null)
        return
      }
      const [memories, statsReply] = await Promise.all([
        fetch(`/plugins/hippocampus/api/memories?project=${encodeURIComponent(resolved.id)}`),
        fetch(`/plugins/hippocampus/api/stats?project=${encodeURIComponent(resolved.id)}`),
      ])
      if (!memories.ok || !statsReply.ok) throw new Error(`HTTP ${memories.ok ? statsReply.status : memories.status}`)
      const nextRows = ((await memories.json()) as MemoriesReply).memories
      const nextStats = await statsReply.json() as StatsReply
      if (!current()) return
      setRows(nextRows)
      setStats(nextStats)
    } catch (reason) {
      if (!current()) return
      setError(String(reason instanceof Error ? reason.message : reason))
      // A failed quiet refresh (after an edit) keeps the list on screen.
      if (!quiet) {
        setRows([])
        setStats(null)
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [cwd])

  useEffect(() => { void load() }, [load])

  const needle = query.trim().toLowerCase()

  /** Group rows by category, canonical order, sorted inside a group. */
  const grouped = useMemo(() => {
    const source = rows ?? []
    const filtered = needle === ''
      ? source
      : source.filter(row =>
        row.content.toLowerCase().includes(needle)
        || row.category.toLowerCase().includes(needle)
        || `m${row.id}` === needle || `m${row.id}`.startsWith(needle))
    const visible = filter === 'ALL' ? filtered : filtered.filter(row => row.category === filter)
    const byCategory = new Map<string, MemoryRow[]>()
    for (const row of visible) {
      const bucket = byCategory.get(row.category) ?? []
      bucket.push(row)
      byCategory.set(row.category, bucket)
    }
    for (const bucket of byCategory.values()) {
      bucket.sort(sort === 'importance'
        ? (a, b) => b.importance - a.importance || b.created_at - a.created_at
        : (a, b) => b.created_at - a.created_at)
    }
    const rank = (c: string) => {
      const i = (CATEGORY_ORDER as readonly string[]).indexOf(c)
      return i === -1 ? CATEGORY_ORDER.length : i
    }
    const categories = [...byCategory.keys()].sort((a, b) => rank(a) - rank(b))
    return categories.map(category => [category, byCategory.get(category)!] as const)
  }, [rows, filter, needle, sort])

  const shown = grouped.reduce((sum, [, bucket]) => sum + bucket.length, 0)

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') setQuery('')
  }

  if (rows === null && error === null) {
    return <div className={css.root}><div className={css.state}>{t('list.loading')}</div></div>
  }

  const total = stats ? Object.values(stats.byCategory).reduce((a, b) => a + b, 0) : (rows?.length ?? 0)
  const categories = stats
    ? Object.keys(stats.byCategory).sort((a, b) => {
      const ai = (CATEGORY_ORDER as readonly string[]).indexOf(a), bi = (CATEGORY_ORDER as readonly string[]).indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    : []

  return (
    <div className={css.root}>
      <section className={`${css.card} ${css.cardSticky}`}>
        <header className={css.cardHead}>
          <h2 className={css.cardTitle}><IconBrain />{t('list.title')}</h2>
          {project !== null ? <span className={css.cardSub} title={project.root}>{shortRoot(project.root)}</span> : null}
          <span className={css.cardTools}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => { void load(true) }}
              aria-label={t('list.refresh')}
              title={t('list.refresh')}
              disabled={loading}
            >
              <span className={loading ? css.spin : undefined} style={{ display: 'inline-flex' }}><IconRefresh /></span>
            </button>
          </span>
        </header>

        <div className={css.tiles} role="group" aria-label={t('list.aria')}>
          <button
            type="button"
            aria-pressed={filter === 'ALL'}
            className={css.tile}
            data-accent="ink"
            data-on={filter === 'ALL'}
            onClick={() => { setFilter('ALL') }}
          >
            <span className={css.tileValue}>{total}</span>
            <span className={css.tileLabel}>{t('filter.all')}</span>
          </button>
          {categories.map(category => (
            <button
              key={category}
              type="button"
              aria-pressed={filter === category}
              className={css.tile}
              data-accent={accentOf(category)}
              data-on={filter === category}
              onClick={() => { setFilter(filter === category ? 'ALL' : category) }}
            >
              <span className={css.tileValue}>{stats?.byCategory[category] ?? 0}</span>
              <span className={css.tileLabel}>{categoryLabel(t, category)}</span>
            </button>
          ))}
          {stats !== null && stats.archived > 0
            ? (
              <div className={css.tile} data-accent="gray">
                <span className={css.tileValue}>{stats.archived}</span>
                <span className={css.tileLabel}>{t('list.archived')}</span>
              </div>
            )
            : null}
          {stats !== null && stats.pendingEmbeddings > 0
            ? (
              <div className={css.tile} data-accent="amber" title={t('list.pendingSub')}>
                <span className={css.tileValue}>{stats.pendingEmbeddings}</span>
                <span className={css.tileLabel}>{t('list.pending')}</span>
                <span className={css.tileSub}>{t('list.pendingSub')}</span>
              </div>
            )
            : null}
        </div>

        <div className={css.editRow} style={{ marginTop: 10 }}>
          <label className={css.searchBox}>
            <IconSearch />
            <input
              type="search"
              className={css.searchInput}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={e => { setQuery(e.target.value) }}
              onKeyDown={onSearchKeyDown}
              aria-label={t('search.placeholder')}
            />
          </label>
          <span className={css.segmented}>
            <button type="button" aria-pressed={sort === 'recent'} className={sort === 'recent' ? css.segmentOn : css.segment} onClick={() => { setSort('recent') }}>{t('sort.recent')}</button>
            <button type="button" aria-pressed={sort === 'importance'} className={sort === 'importance' ? css.segmentOn : css.segment} onClick={() => { setSort('importance') }}>{t('sort.importance')}</button>
          </span>
          {(needle !== '' || filter !== 'ALL') && rows !== null && rows.length > 0
            ? <span className={css.meta}>{t('list.shown', { shown, total: rows.length })}</span>
            : null}
        </div>
      </section>

      {error !== null
        ? (
          <div className={css.banner} data-tone="error">
            {t('list.error', { reason: error })}
            <button type="button" className={css.btn} onClick={() => { void load() }}>{t('list.refresh')}</button>
          </div>
        )
        : null}

      {rows !== null && rows.length === 0 && error === null
        ? <div className={css.card}><div className={css.state}><IconInbox size={28} />{t('list.empty')}</div></div>
        : null}
      {grouped.length === 0 && rows !== null && rows.length > 0
        ? <div className={css.card}><div className={css.state}><IconSearch size={24} />{t('search.noMatch')}</div></div>
        : null}

      {grouped.map(([category, bucket]) => (
        <section key={category} className={css.group}>
          <h3 className={css.groupHead}>
            <span className={css.dot} data-accent={accentOf(category)} />
            {categoryLabel(t, category)}
            <span className={css.groupCount}>{bucket.length}</span>
          </h3>
          {bucket.map(row => (
            <MemoryCard
              key={row.id}
              row={row}
              needle={needle}
              t={t}
              onChanged={() => { void load(true) }}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

/** Importance tier for the bar color. */
const tierOf = (importance: number): string => importance >= 80 ? 'high' : importance >= 60 ? 'mid' : 'low'

/** One memory card with edit + archive affordances (two-click confirm). */
function MemoryCard({ row, needle, t, onChanged }: { row: MemoryRow, needle: string, t: T, onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.content)
  const [draftImportance, setDraftImportance] = useState(row.importance)
  const [busy, setBusy] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraft(row.content); setDraftImportance(row.importance) }, [row.content, row.importance])

  // Disarm the archive confirm after a short while.
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => { setArmed(false) }, 3000)
    return () => { clearTimeout(timer) }
  }, [armed])

  const post = async (path: string, body: object) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? `HTTP ${response.status}`)
    }
  }

  const save = async () => {
    if (busy) return
    if (draft.trim() === '') { setCardError(t('edit.empty')); return }
    setBusy(true)
    setCardError(null)
    try {
      await post('/plugins/hippocampus/api/memories/edit', { id: row.id, content: draft, importance: draftImportance })
      setEditing(false)
      onChanged()
    } catch (reason) {
      setCardError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    if (busy) return
    if (!armed) { setArmed(true); return } // first click arms, second confirms
    setBusy(true)
    setCardError(null)
    try {
      await post('/plugins/hippocampus/api/memories/archive', { id: row.id })
      onChanged()
    } catch (reason) {
      setCardError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  // A search hit should never hide behind the clamp.
  const clamped = !expanded && needle === ''

  // Show the expand toggle only when the four-line clamp actually cuts text
  // (measured, so wide panels do not offer to expand what already fits).
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null || !clamped) return
    const measure = () => { setOverflows(el.scrollHeight > el.clientHeight + 1) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [clamped, row.content, editing])

  return (
    <article className={css.memory} data-accent={accentOf(row.category)}>
      <div className={css.memoryHead}>
        <span className={css.idChip}>m{row.id}</span>
        <span className={css.importance} title={t('importance.aria', { value: row.importance })}>
          <span className={css.importanceTrack}>
            <span className={css.importanceFill} data-tier={tierOf(row.importance)} style={{ width: `${Math.max(4, Math.min(100, row.importance))}%`, display: 'block' }} />
          </span>
          {row.importance}
        </span>
        <span className={css.meta}>{formatDate(row.created_at)}</span>
        <span className={css.memoryActions} data-sticky={editing || armed}>
          {editing
            ? (
              <>
                <button type="button" className={css.action} data-primary="true" disabled={busy} onClick={() => { void save() }}><IconCheck size={13} />{t('edit.save')}</button>
                <button type="button" className={css.action} disabled={busy} onClick={() => { setEditing(false); setCardError(null); setDraft(row.content); setDraftImportance(row.importance) }}><IconX size={13} />{t('edit.cancel')}</button>
              </>
            )
            : (
              <>
                <button type="button" className={css.action} disabled={busy} onClick={() => { setEditing(true) }}><IconPencil size={13} />{t('edit.edit')}</button>
                <button type="button" className={css.action} data-armed={armed} disabled={busy} onClick={() => { void archive() }}>
                  <IconArchive size={13} />{armed ? t('edit.confirmArchive') : t('edit.archive')}
                </button>
              </>
            )}
        </span>
      </div>
      {editing
        ? (
          <div className={css.editBox}>
            <textarea
              className={css.editArea}
              value={draft}
              onChange={event => { setDraft(event.target.value) }}
              rows={Math.min(14, Math.max(3, Math.ceil(draft.length / 70)))}
              disabled={busy}
              aria-label={t('edit.edit')}
            />
            <label className={css.editRow}>
              {t('edit.importance')}
              <input
                type="range"
                min={1}
                max={100}
                value={draftImportance}
                onChange={event => { setDraftImportance(Number(event.target.value)) }}
                disabled={busy}
              />
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{draftImportance}</b>
            </label>
          </div>
        )
        : (
          <>
            <div ref={bodyRef} className={clamped ? `${css.memoryBody} ${css.clamped}` : css.memoryBody}>{highlight(row.content, needle)}</div>
            {needle === '' && (expanded || overflows)
              ? <button type="button" className={css.more} onClick={() => { setExpanded(!expanded) }}>{expanded ? t('list.collapse') : t('list.expand')}</button>
              : null}
          </>
        )}
      {cardError !== null ? <div className={css.error}>{cardError}</div> : null}
    </article>
  )
}
