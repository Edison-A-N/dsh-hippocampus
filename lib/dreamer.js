/**
 * Dreamer-lite: scheduled background maintenance for dsh-hippocampus.
 *
 * A 15-minute process-wide tick reconciles per-project task schedules and
 * runs due tasks, one at a time per lease domain (a design taken from
 * magic-context). Two tasks that both rewrite memories would otherwise each
 * read the pool before the other's changes land, and the later write would
 * undo the earlier one. Every task runs as a plain LLM call
 * (ctx.llm.stream, purpose-tagged) — no child sessions, no surface writes:
 * results land in the plugin's own SQLite store, never on the agent's, so a
 * background run never touches the cached prefix of a live session.
 *
 * Tasks:
 * - `verify`: check code-fact memories (not PROJECT_RULES, not notes)
 *   against the git-tracked files they name. The model gets evidence, not
 *   just paths: the file text (or the lines around the memory's
 *   identifiers) and, for a memory checked before, the git diff since the
 *   checked commit. A memory is re-checked only when it was never checked,
 *   when its files changed after the checked commit (or the diff cannot be
 *   computed), or when the last check is older than REVERIFY_AFTER_MS. The
 *   outcome is stored (verification_status, verified_at = time of the last
 *   check, verified_commit) and the baseline marks verified and stale rows.
 *   verify is advisory: it never archives (a contradiction becomes stale),
 *   and its own rewrite stays unverified until the next run checks it.
 * - `curate`: one category per run (rotating): merge duplicates, rewrite
 *   dated narrative into present-tense facts, move pending items to notes,
 *   archive only into a surviving memory. NOOP default.
 *
 * Safety (magic-context verify/curate gates): wrongly archiving a true
 * memory is the worst outcome, so the host refuses risky verdicts instead of
 * trusting the model. PROJECT_RULES rows never enter verify (process rules
 * are not code facts; a file cannot falsify them, and a "verified" mark on a
 * rule would lend it authority it did not earn). curate may archive only
 * into a named active same-category survivor, an update that drops more than
 * half the text must name one too, and a demotion to note is refused for
 * importance >= 80 or for text without an open-item marker (a date alone
 * does not qualify). Working
 * notes (source_type 'note') are outside both tasks.
 *
 * Failure model: a task that throws is hot-retried on the next ticks up to
 * 3 times, then waits for its next cron slot; last_run_at stamps only
 * successful runs.
 * @module dsh-hippocampus/dreamer
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Tick interval. */
export const TICK_MS = 15 * 60_000

/** Hot-retry cap before falling back to the cron slot. */
const MAX_RETRIES = 3

/** Lease duration: refreshed by heartbeat while a task runs. */
const LEASE_MS = 2 * 60_000

/** Task names in canonical lease order (memory:<project> domain). */
export const TASKS = ['verify', 'curate']

/** A verified memory is re-checked after this long even without a diff. */
export const REVERIFY_AFTER_MS = 30 * 24 * 60 * 60_000

/** Memories per verify run (oldest-unverified, most important first). */
const VERIFY_BATCH = 12

/** Evidence caps: per file and per run (characters). */
const FILE_EVIDENCE_CHARS = 5000
const RUN_EVIDENCE_CHARS = 40_000

/** Files larger than this are not read as evidence (bytes). */
const MAX_EVIDENCE_FILE_BYTES = 512 * 1024

/** Second line of defense behind the git-tracked allowlist. */
const SECRET_PATH = /(^|\/)\.env|secret|credential|password|token|\.pem$|\.key$|id_rsa|\.npmrc$|kubeconfig|(^|\/)\.(ssh|aws|kube|docker|gnupg)\//i

/**
 * Open-item markers: the only rows curate may demote to notes. A date alone
 * does not qualify: rules learned from user corrections usually carry the
 * date they were learned, and they must stay in the baseline.
 */
const OPEN_ITEM = /待办|待定|暂缓|以后再|稍后再|backlog|\btodo\b|pending|follow-up|未完成|进行中/i

/** Categories in curation rotation order. */
const CURATE_ORDER = ['PROJECT_RULES', 'ARCHITECTURE', 'CONSTRAINTS', 'CONFIG_VALUES', 'NAMING']

const VERIFY_SYSTEM = `You verify project memories against the CURRENT state of a code repository.
Each memory comes with evidence: excerpts of the files it names and, when it was verified before, the git diff of those files since then. Decide from the evidence only.
Verdicts:
- verified: the evidence supports the memory, or the diff does not touch what it claims.
- update: a code fact is still true but a detail drifted (renamed symbol, moved path, changed value). Give the corrected content in present tense, same language as the original.
- stale: the evidence suggests the memory drifted but you cannot write a correct replacement.
- archive: the evidence positively contradicts a code fact, or what it describes no longer exists.
- skip: the claim is not a code fact, or the evidence cannot decide it.
Process rules (how to work, when to ask, who decides) are not code facts: skip them.
Wrongly archiving a true memory is the worst outcome. When unsure, skip. Never invent facts.
An excerpt marked complete:false is partial: something missing from it may exist elsewhere in the file, so never conclude "no longer exists" from a partial excerpt.
Output ONLY a JSON object: {"verdicts":[{"id":<number>,"verdict":"verified"|"update"|"stale"|"archive"|"skip","content":<string|null>,"reason":<string>}]}`

const CURATE_SYSTEM = `You curate one category of a project's memory pool. These memories are injected into every future session as standing facts, so stale or narrative entries mislead. Assume they are accurate (a separate task checks them against code); you handle quality only.
Work in three passes:
A. Merge duplicates: when several memories state the same knowledge, update the best one to carry every unique detail and archive the others with merged_into = that id. Only merge within this category.
B. Rewrite narrative into operational facts: present tense ("X uses Y because Z"), no dates, no "the user decided on <date>" framing, no commit hashes or versions unless the value is the point, no chronology words (initially/now/later/was changed, 最初/现在/后来/改成). Keep paths, keys and the WHY. Same language as the original. A rewrite that drops more than half the text must name the memory that keeps the dropped detail in merged_into.
C. Move to notes: an entry that is a pending item, backlog, or a status of unfinished work becomes a note (op "note"): still searchable, no longer injected.
Archive only into a surviving memory (merged_into). Never archive a rule learned from a user correction unless another memory fully covers it. Leave anything you are unsure about as noop. Most memories need nothing. Never invent facts.
Output ONLY a JSON object: {"actions":[{"id":<number>,"op":"noop"|"update"|"archive"|"note","content":<string|null>,"merged_into":<number|null>,"reason":<string>}]}`

/** Extract plausible file-path hints from memory content (relative, ~/ or absolute). */
export function pathHints(content) {
  const matches = content.match(/(?:~\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z]{1,5}\b/gi) ?? []
  return [...new Set(matches)].slice(0, 5)
}

/**
 * Resolve a hint to evidence the model may see, or null. Evidence goes to an
 * external provider, so the rule is an allowlist: the file must be tracked by
 * git in the project repository, and its real path (symlinks resolved) must
 * stay inside the repository root. Home-directory files are never evidence:
 * that is where credentials live. A secret-looking path is refused even when
 * tracked.
 * @param {string} root - project root (a git work tree)
 * @param {string} hint - path as written in the memory
 * @param {Set<string>} tracked - repo-relative paths from `git ls-files`
 * @returns {{rel: string, path: string} | null}
 */
export function resolveHint(root, hint, tracked) {
  if (hint.startsWith('~/')) return null
  let realRoot
  let real
  try {
    realRoot = realpathSync(root)
    real = realpathSync(isAbsolute(hint) ? hint : resolve(root, hint))
  } catch {
    return null
  }
  const rel = relative(realRoot, real)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const relPosix = rel.split(sep).join('/')
  if (!tracked.has(relPosix)) return null
  if (SECRET_PATH.test(relPosix)) return null
  try {
    const stat = statSync(real)
    if (!stat.isFile() || stat.size > MAX_EVIDENCE_FILE_BYTES) return null
  } catch {
    return null
  }
  return { rel: relPosix, path: real }
}

/** Repo-relative paths git tracks in this work tree, or null when it is not a git work tree. */
export function trackedFiles(root) {
  const out = git(root, ['ls-files', '-z'])
  if (out === null) return null
  return new Set(out.split('\0').filter(Boolean))
}

/** Run git in a directory; null on any failure (not a repo, bad commit, timeout). */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** Identifier-ish tokens of a memory (ASCII identifiers and CJK runs), used to pick the relevant lines of a large file. */
function identifiers(content) {
  const tokens = content.match(/[A-Za-z_][\w.-]{3,}/g) ?? []
  // CJK has no word boundaries: a run contributes its 4-char windows (or
  // itself when shorter), so 默认的压缩引擎 still finds a line with 压缩引擎.
  for (const run of content.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (run.length <= 4) tokens.push(run)
    else for (let i = 0; i + 4 <= run.length; i += 1) tokens.push(run.slice(i, i + 4))
  }
  return [...new Set(tokens)].filter(token => !/^(https?|the|this|that|with|from|when|must|never|always)$/i.test(token)).slice(0, 40)
}

/**
 * File evidence: the whole file when small, else the lines around the
 * memory's identifiers. `complete` says whether the model saw the whole file;
 * absence of a claim in a partial excerpt proves nothing. Binary files
 * (a NUL byte) are not evidence.
 * @returns {{text: string, complete: boolean} | null}
 */
export function fileExcerpt(path, content, cap = FILE_EVIDENCE_CHARS) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  if (text.includes('\u0000')) return null
  if (text.length <= cap) return { text, complete: true }
  const lines = text.split('\n')
  const wanted = identifiers(content)
  const keep = new Set()
  lines.forEach((line, index) => {
    if (wanted.some(token => line.includes(token))) {
      for (let k = Math.max(0, index - 2); k <= Math.min(lines.length - 1, index + 2); k += 1) keep.add(k)
    }
  })
  const out = []
  let last = -2
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (index !== last + 1) out.push('…')
    out.push(`${index + 1}: ${lines[index]}`)
    last = index
  }
  const excerpt = out.length > 0 ? out.join('\n') : `${text.slice(0, cap)}\n…`
  return { text: excerpt.slice(0, cap), complete: false }
}

/**
 * The dreamer state machine. Pure logic + a store; the LLM call is injected
 * as a thunk so tests run without a gateway.
 */
export class Dreamer {
  /**
   * @param {object} options
   * @param {import('./store.js').MemoryStore} options.store
   * @param {object} options.dshHomeEnv - launch-environment-like mapping for DSH_HOME
   * @param {(system: string, user: string, signal?: AbortSignal) => Promise<string>} options.complete - LLM thunk
   */
  constructor({ store, complete }) {
    this.store = store
    this.complete = complete
    this.leases = new Map()
    this.schedules = new Map()
  }

  /** Acquire a lease (single-writer per domain, expiring). */
  #acquireLease(domain) {
    const now = Date.now()
    const held = this.leases.get(domain)
    if (held !== undefined && held.until > now) return false
    this.leases.set(domain, { until: now + LEASE_MS })
    return true
  }

  /** Heartbeat while a task runs. */
  #renewLease(domain) {
    const held = this.leases.get(domain)
    if (held !== undefined) held.until = Date.now() + LEASE_MS
  }

  /** One tick: run every due task whose gate passes, one project at a time. */
  async tick(signal) {
    const projects = this.store.db.prepare('SELECT id, root FROM projects').all()
    const ran = []
    for (const project of projects) {
      for (const task of TASKS) {
        if (!this.#isDue(project.id, task)) continue
        if (!this.#gate(task, project.id)) continue
        if (!this.#acquireLease(`memory:${project.id}`)) continue
        try {
          const result = await this.#runTask(task, project, signal)
          this.#stampSuccess(project.id, task)
          this.#recordRun(project, task, 'ok', result)
          ran.push(`${task}:${project.root}`)
        } catch (error) {
          this.#stampFailure(project.id, task, error)
          this.#recordRun(project, task, 'error', { error: String(error?.message ?? error) })
        } finally {
          this.leases.delete(`memory:${project.id}`)
        }
      }
    }
    return ran
  }

  /** Persist one run record (the panel's background-curation section reads this table). */
  #recordRun(project, task, status, result) {
    try {
      this.store.db.prepare(
        'INSERT INTO dream_runs (project_id, task, status, result_json, ran_at) VALUES (?, ?, ?, ?, ?)',
      ).run(project.id, task, status, JSON.stringify(result ?? null), Date.now())
    } catch {
      // recording must never break the tick
    }
  }

  /** Recent run records for the dashboard (newest first). */
  recentRuns(projectId, limit = 50) {
    return this.store.db
      .prepare('SELECT id, task, status, result_json, ran_at FROM dream_runs WHERE project_id = ? ORDER BY ran_at DESC LIMIT ?')
      .all(projectId, limit)
  }

  /** Daily schedule (fixed for M2; cron config lands with the real dreamer). */
  #isDue(projectId, task) {
    const key = `${projectId}|${task}`
    const state = this.schedules.get(key)
    if (state === undefined) return true // first run after upgrade
    if (state.error !== undefined && state.retries < MAX_RETRIES) return true
    return Date.now() - state.lastRunAt >= 24 * 60 * 60_000
  }

  /** Cheap "is there work" gate so idle projects cost no model calls. */
  #gate(task, projectId) {
    if (task === 'curate') {
      return this.store.list({ projectId }).length >= 5
    }
    // verify: only memories that name a path can be checked; the cheap
    // gate is "some row names a path and is not freshly verified"
    const now = Date.now()
    return this.store
      .list({ projectId })
      .some(row => row.source_type !== 'note' && row.category !== 'PROJECT_RULES' && pathHints(row.content).length > 0 &&
        (row.verified_at === null || row.verified_commit !== null || now - row.verified_at >= REVERIFY_AFTER_MS))
  }

  #stampSuccess(projectId, task) {
    this.schedules.set(`${projectId}|${task}`, { lastRunAt: Date.now(), retries: 0 })
  }

  #stampFailure(projectId, task, error) {
    const key = `${projectId}|${task}`
    const prior = this.schedules.get(key)
    this.schedules.set(key, {
      lastRunAt: prior?.lastRunAt ?? 0,
      retries: (prior?.retries ?? 0) + 1,
      error: String(error?.message ?? error),
    })
  }

  /** Dispatch one task. */
  async #runTask(task, project, signal) {
    if (task === 'verify') return this.#verify(project, signal)
    return this.#curate(project, signal)
  }

  /**
   * Manual trigger (the panel's run-now buttons): run one task for one
   * project NOW — skipping the schedule gate and the work gate, still
   * serialized by the memory lease. Records the run like a tick run.
   * @returns {Promise<{task: string, status: string, result: object}>}
   */
  async runNow(projectId, task, signal) {
    if (!TASKS.includes(task)) throw new Error(`task must be one of ${TASKS.join(', ')}`)
    const project = this.store.db.prepare('SELECT id, root FROM projects WHERE id = ?').get(projectId)
    if (project === undefined) throw new Error(`unknown project: ${projectId}`)
    if (!this.#acquireLease(`memory:${projectId}`)) throw new Error('another curation run is in flight for this project')
    try {
      const result = await this.#runTask(task, project, signal)
      this.#stampSuccess(projectId, task)
      this.#recordRun(project, task, 'ok', result)
      return { task, status: 'ok', result }
    } catch (error) {
      this.#stampFailure(projectId, task, error)
      this.#recordRun(project, task, 'error', { error: String(error?.message ?? error) })
      return { task, status: 'error', result: { error: String(error?.message ?? error) } }
    } finally {
      this.leases.delete(`memory:${projectId}`)
    }
  }

  /**
   * Pick the memories that need a check and attach their evidence. A row
   * checked before (any outcome, including skip) comes back only when its
   * files changed after the checked commit, when that diff cannot be
   * computed (commit rewritten away), or after REVERIFY_AFTER_MS. Never-
   * checked rows go first, so repeat skips cannot starve them.
   */
  #verifyCandidates(project) {
    const root = project.root
    const tracked = trackedFiles(root)
    if (tracked === null) return { picked: [], head: null }
    const head = git(root, ['rev-parse', 'HEAD'])?.trim() || null
    const now = Date.now()
    const picked = []
    let budget = RUN_EVIDENCE_CHARS
    const rows = this.store.list({ projectId: project.id })
      .filter(row => row.source_type !== 'note' && row.category !== 'PROJECT_RULES')
      .sort((a, b) => (a.verified_at ?? 0) - (b.verified_at ?? 0) || b.importance - a.importance)
    for (const row of rows) {
      if (picked.length >= VERIFY_BATCH) break
      const files = pathHints(row.content)
        .map(hint => ({ hint, resolved: resolveHint(root, hint, tracked) }))
        .filter(entry => entry.resolved !== null)
      if (files.length === 0) continue
      let diff = null
      if (row.verified_at !== null) {
        const fresh = now - row.verified_at < REVERIFY_AFTER_MS
        if (row.verified_commit !== null && head !== null) {
          // --no-ext-diff/--no-textconv: a cloned repository's config must not
          // pick the program git runs while the dreamer reads evidence.
          diff = git(root, ['diff', '--no-ext-diff', '--no-textconv', row.verified_commit, '--', ...files.map(entry => entry.resolved.rel)])
          if (diff !== null && diff.trim() === '' && fresh) continue
        } else if (fresh) {
          continue
        }
      }
      const evidence = []
      for (const { hint, resolved } of files) {
        const excerpt = fileExcerpt(resolved.path, row.content)
        if (excerpt !== null) evidence.push({ file: hint, complete: excerpt.complete, excerpt: excerpt.text })
      }
      if (evidence.length === 0) continue
      const entry = {
        id: row.id,
        category: row.category,
        content: row.content,
        evidence,
        ...(diff !== null && diff.trim() !== '' ? { diffSinceVerified: diff.slice(0, FILE_EVIDENCE_CHARS) } : {}),
      }
      const cost = JSON.stringify(entry).length
      if (cost > budget) continue
      budget -= cost
      picked.push(entry)
    }
    return { picked, head }
  }

  /**
   * Verify memories against the evidence of the files they name; store the
   * outcome. Advisory by construction: an archive verdict is recorded as
   * stale (the evidence is excerpts, the model cannot search), and an update
   * stays unverified until a later run checks the new text.
   */
  async #verify(project, signal) {
    const { picked, head } = this.#verifyCandidates(project)
    if (picked.length === 0) return { task: 'verify', checked: 0 }
    const manifest = await this.#manifest(VERIFY_SYSTEM, {
      projectRoot: project.root,
      memories: picked,
    }, signal, this.#renewLease.bind(this, `memory:${project.id}`))
    const byId = new Map(picked.map(entry => [entry.id, entry]))
    const counts = { verified: 0, updated: 0, stale: 0, skipped: 0 }
    for (const verdict of manifest.verdicts ?? []) {
      const entry = byId.get(verdict.id)
      if (entry === undefined) continue
      byId.delete(verdict.id)
      if (verdict.verdict === 'verified') {
        this.store.setVerification(entry.id, 'verified', { commit: head })
        counts.verified += 1
      } else if (verdict.verdict === 'update' && typeof verdict.content === 'string' && verdict.content.trim() !== '') {
        try {
          this.store.update(entry.id, { content: verdict.content })
          counts.updated += 1
        } catch {
          // duplicate of another row: leave the text, still stamp the check
          counts.skipped += 1
        }
        this.store.setVerification(entry.id, 'unverified', { commit: head })
      } else if (verdict.verdict === 'stale' || verdict.verdict === 'archive') {
        this.store.setVerification(entry.id, 'stale', { commit: head })
        counts.stale += 1
      } else {
        // skip: this check did not support the memory, so a verified mark
        // lapses (stale stays stale); the stamp makes the row wait for a
        // diff or the window instead of being re-sent daily
        const status = this.store.get(entry.id)?.verification_status === 'stale' ? 'stale' : 'unverified'
        this.store.setVerification(entry.id, status, { commit: head })
        counts.skipped += 1
      }
    }
    // rows the manifest left out are stamped like a skip
    for (const entry of byId.values()) {
      const status = this.store.get(entry.id)?.verification_status === 'stale' ? 'stale' : 'unverified'
      this.store.setVerification(entry.id, status, { commit: head })
      counts.skipped += 1
    }
    return { task: 'verify', checked: picked.length, ...counts }
  }

  /** Curate one category per run, rotating. */
  async #curate(project, signal) {
    const key = `${project.id}|curate`
    const state = this.schedules.get(key)
    const index = (state?.curatedCount ?? 0) % CURATE_ORDER.length
    const category = CURATE_ORDER[index]
    const rows = this.store.list({ projectId: project.id, category }).filter(row => row.source_type !== 'note')
    if (rows.length === 0) {
      this.schedules.set(key, { ...state, lastRunAt: Date.now(), retries: 0, curatedCount: (state?.curatedCount ?? 0) + 1 })
      return { task: 'curate', category, considered: 0 }
    }
    const manifest = await this.#manifest(CURATE_SYSTEM, {
      category,
      memories: rows.map(row => ({ id: row.id, content: row.content, importance: row.importance, seen_count: row.seen_count })),
    }, signal, this.#renewLease.bind(this, `memory:${project.id}`))
    const inScope = new Map(rows.map(row => [row.id, row]))
    const archivedNow = new Set()
    // A survivor must be an active memory of this run's category that this
    // run does not itself archive.
    const leaving = new Set((manifest.actions ?? []).filter(action => action.op === 'archive' || action.op === 'note').map(action => action.id))
    const survivor = id => typeof id === 'number' && inScope.has(id) && !leaving.has(id)
    let applied = 0
    let refused = 0
    for (const action of manifest.actions ?? []) {
      const row = inScope.get(action.id)
      if (row === undefined || archivedNow.has(row.id)) continue
      if (action.op === 'archive') {
        if (!survivor(action.merged_into) || action.merged_into === row.id) { refused += 1; continue }
        this.store.archive(row.id, { reason: `curate: ${String(action.reason ?? '').slice(0, 300)}`, supersededBy: action.merged_into })
        archivedNow.add(row.id)
        applied += 1
      } else if (action.op === 'update' && typeof action.content === 'string' && action.content.trim() !== '') {
        const shrinks = action.content.trim().length * 2 < row.content.trim().length
        if (shrinks && (!survivor(action.merged_into) || action.merged_into === row.id)) { refused += 1; continue }
        try {
          this.store.update(row.id, { content: action.content })
          applied += 1
        } catch {
          // duplicate or gone: skip
        }
      } else if (action.op === 'note') {
        // A demotion takes the row out of every future baseline: a soft
        // archive. Only time-bound text qualifies, never a high-importance row.
        if (row.importance >= 80 || !OPEN_ITEM.test(row.content)) { refused += 1; continue }
        this.store.update(row.id, { sourceType: 'note' })
        applied += 1
      }
    }
    this.schedules.set(key, { lastRunAt: Date.now(), retries: 0, curatedCount: (state?.curatedCount ?? 0) + 1 })
    return { task: 'curate', category, considered: rows.length, applied, refused }
  }

  /**
   * Run one manifest call: send the prompt, parse the JSON object (the only
   * JSON object in the reply — fenced or bare), fail closed on parse.
   */
  async #manifest(system, payload, signal, heartbeat) {
    heartbeat?.()
    const reply = await this.complete(system, JSON.stringify(payload, null, 1), signal)
    heartbeat?.()
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('manifest parse failed: no JSON object in reply')
    let parsed
    try {
      parsed = JSON.parse(reply.slice(start, end + 1))
    } catch (error) {
      throw new Error(`manifest parse failed: ${error.message}`)
    }
    return parsed
  }
}

/** Content-hash gate helper exported for tests. */
export function contentFingerprint(content) {
  return createHash('md5').update(content).digest('hex')
}

/** Whether any of the hint paths exists under root (used by verify gate tests). */
export function anyPathExists(root, paths) {
  return paths.some(relative => existsSync(`${root}/${relative}`))
}
