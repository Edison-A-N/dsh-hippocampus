/**
 * SQLite storage for dsh-hippocampus project memories.
 *
 * One database per DSH_HOME (`$DSH_HOME/storages/hippocampus/memory.db`),
 * shared by every profile process that loads the plugin (WAL + busy_timeout
 * keep concurrent web/headless processes safe). Memories are project-scoped
 * rows in five categories with a normalized-content hash for exact
 * deduplication; retrieval runs through an FTS5 index over a bigram
 * tokenization of the content, because the default unicode61 tokenizer does
 * not segment Chinese or Japanese text (verified: `压缩` matched nothing
 * without this).
 *
 * node:sqlite binding rule (learned from magic-context, which hit the same
 * wall): parameters are always spread, never passed as one array —
 * node:sqlite reads an array as a named-parameter mapping.
 * @module dsh-hippocampus/store
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { vectorToBlob, blobToVector, cosineSimilarity } from './embedding.js'

/** The five memory categories (magic-context v2 set). */
export const CATEGORIES = ['PROJECT_RULES', 'ARCHITECTURE', 'CONSTRAINTS', 'CONFIG_VALUES', 'NAMING']

/** Category display order for baseline injection. */
const CATEGORY_ORDER = ['PROJECT_RULES', 'ARCHITECTURE', 'CONSTRAINTS', 'CONFIG_VALUES', 'NAMING']

/**
 * Scripts written without spaces between words. Their runs become
 * overlapping 2-gram bigrams so 2-character words stay searchable, which a
 * trigram tokenizer would miss. U+30FC (the katakana length mark) is in the
 * Common script, so it is listed explicitly.
 */
const BIGRAM_RUN = /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u30fc]+$/u

/**
 * Token runs: one run per bigram-script stretch, one per word of any other
 * script (letters, digits and marks, plus `_.:/-` so identifiers and paths
 * stay whole).
 */
const TOKEN_RUNS = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u30fc]+|[[\p{L}\p{N}\p{M}_.:\/\-]--[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u30fc]]+/gv

/**
 * Tokenize text for FTS5: runs of Chinese, Japanese and Korean text become
 * overlapping bigrams; words of other scripts stay whole.
 * @param {string} text
 * @returns {string} space-separated tokens
 */
export function tokenize(text) {
  const segments = String(text).toLowerCase().match(TOKEN_RUNS) || []
  const tokens = []
  for (const segment of segments) {
    if (BIGRAM_RUN.test(segment) && segment.length > 1) {
      const chars = [...segment]
      for (let i = 0; i < chars.length - 1; i += 1) tokens.push(chars[i] + chars[i + 1])
    } else {
      tokens.push(segment)
    }
  }
  return tokens.join(' ')
}

/** FTS5 MATCH expression: bigram tokens quoted and OR'ed for recall. */
function matchExpression(query) {
  return tokenize(query)
    .split(' ')
    .filter(Boolean)
    .map(token => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ')
}

/** Normalized content for exact deduplication: case-folded, punctuation deleted, whitespace-collapsed. */
export function normalize(content) {
  return String(content)
    .toLowerCase()
    .replace(/\p{P}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** md5 hex of normalized content. */
export function normalizedHash(content) {
  return createHash('md5').update(normalize(content)).digest('hex')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  kind TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'active',
  source_type TEXT NOT NULL DEFAULT 'agent',
  source_session TEXT,
  created_at INTEGER NOT NULL,
  invalid_at INTEGER,
  last_accessed INTEGER NOT NULL,
  embedding BLOB,
  embedded_at INTEGER,
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_at INTEGER,
  verified_commit TEXT,
  superseded_by INTEGER,
  archive_reason TEXT,
  UNIQUE (project_id, category, normalized_hash)
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(tokens);
CREATE TABLE IF NOT EXISTS dream_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  ran_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS compaction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_id TEXT,
  mode TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL,
  summary_json TEXT,
  error TEXT,
  usage_json TEXT,
  duration_ms INTEGER,
  shadowed_start INTEGER,
  shadowed_end INTEGER,
  ran_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS compartments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_id TEXT,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 50,
  p1 TEXT NOT NULL DEFAULT '',
  p2 TEXT NOT NULL DEFAULT '',
  p3 TEXT NOT NULL DEFAULT '',
  p4 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS compaction_state (
  session_id TEXT PRIMARY KEY,
  checkpoint_seq INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compartments_session ON compartments(session_id, status, id);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, status, category);
CREATE INDEX IF NOT EXISTS idx_compaction_runs_session ON compaction_runs(session_id, ran_at);
`

/** Columns added after the first schema, in order (name, DDL). */
const ADDED_COLUMNS = [
  ['embedding', 'BLOB'],
  ['embedded_at', 'INTEGER'],
  // Lifecycle (magic-context memory fields): re-observation reinforces a
  // memory, verification records whether the code still backs it, and an
  // archive names its survivor so a merge is auditable.
  ['seen_count', 'INTEGER NOT NULL DEFAULT 1'],
  ['last_seen_at', 'INTEGER'],
  ['verification_status', "TEXT NOT NULL DEFAULT 'unverified'"],
  ['verified_at', 'INTEGER'],
  ['verified_commit', 'TEXT'],
  ['superseded_by', 'INTEGER'],
  ['archive_reason', 'TEXT'],
]

/** Verification states: unverified (no supporting check), verified, stale (evidence says it drifted). */
export const VERIFICATION_STATES = ['unverified', 'verified', 'stale']

/**
 * Store format version (PRAGMA user_version). 1: the tokenizer covers every
 * script, so the FTS rows of older stores are rebuilt once.
 */
const STORE_VERSION = 1

/** Migration: add columns missing from stores created by older versions, then rebuild what a version bump needs (idempotent). */
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(memories)').all().map(row => row.name)
  for (const [name, ddl] of ADDED_COLUMNS) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${ddl}`)
  }
  const version = Number(db.prepare('PRAGMA user_version').get().user_version)
  if (version >= STORE_VERSION) return
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM memories_fts')
    const insert = db.prepare('INSERT INTO memories_fts (rowid, tokens) VALUES (?, ?)')
    for (const row of db.prepare("SELECT id, content FROM memories WHERE status = 'active'").all()) {
      insert.run(row.id, tokenize(row.content))
    }
    db.exec(`PRAGMA user_version = ${STORE_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Keep the store private to the current OS user: the database holds memory
 * text and session summaries (user wording, paths, commands). The directory
 * is 0700 and the database with its WAL and shared-memory files 0600.
 * Best-effort: a filesystem without POSIX modes keeps its defaults.
 */
function restrictPermissions(dbPath) {
  const targets = [[join(dbPath, '..'), 0o700], [dbPath, 0o600], [`${dbPath}-wal`, 0o600], [`${dbPath}-shm`, 0o600]]
  for (const [path, mode] of targets) {
    try {
      if (existsSync(path)) chmodSync(path, mode)
    } catch {
      // not ours to change (shared directory, read-only mount): leave as is
    }
  }
}

/**
 * The memory store. All methods are synchronous: SQLite ops here are
 * single-row reads/writes against a local WAL database, fast enough to run
 * inside tool execution and pre-step composition without yielding.
 */
export class MemoryStore {
  /** @param {string} dbPath - absolute path of the SQLite database file */
  constructor(dbPath) {
    mkdirSync(join(dbPath, '..'), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(SCHEMA)
    migrate(this.db)
    restrictPermissions(dbPath)
  }

  close() {
    this.db.close()
  }

  /** Record one compaction run (the compaction panel's records list). Best-effort: never throws. */
  recordCompactionRun({ sessionId, projectId, mode, provider, model, status, summary, error, usage, durationMs, shadowedStart, shadowedEnd }) {
    try {
      this.db.prepare(
        `INSERT INTO compaction_runs
         (session_id, project_id, mode, provider, model, status, summary_json, error, usage_json, duration_ms, shadowed_start, shadowed_end, ran_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sessionId, projectId ?? null, mode, provider ?? null, model ?? null, status,
        summary === undefined ? null : JSON.stringify(summary),
        error ?? null,
        usage === undefined ? null : JSON.stringify(usage),
        durationMs ?? null, shadowedStart ?? null, shadowedEnd ?? null, Date.now(),
      )
    } catch {
      // recording must never break the compaction commit path
    }
  }

  /** Recent compaction runs for one session (newest first). */
  compactionRuns(sessionId, limit = 20) {
    return this.db
      .prepare('SELECT * FROM compaction_runs WHERE session_id = ? ORDER BY ran_at DESC LIMIT ?')
      .all(sessionId, limit)
  }

  /**
   * Compartments of one session in chronological order. `status` is
   * 'pending' (summarized, not yet on the surface), 'committed' (rendered
   * into the current checkpoint), or 'dropped' (lineage lost; kept for audit).
   */
  compartments(sessionId, statuses = ['pending', 'committed']) {
    const marks = statuses.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM compartments WHERE session_id = ? AND status IN (${marks}) ORDER BY id`)
      .all(sessionId, ...statuses)
      .map(row => ({
        id: row.id,
        startSeq: row.start_seq,
        endSeq: row.end_seq,
        title: row.title,
        importance: row.importance,
        p1: row.p1,
        p2: row.p2,
        p3: row.p3,
        p4: row.p4,
        status: row.status,
        createdAt: row.created_at,
      }))
  }

  /** Insert freshly summarized compartments as pending (one transaction). */
  addCompartments(sessionId, projectId, rows) {
    const insert = this.db.prepare(
      `INSERT INTO compartments (session_id, project_id, start_seq, end_seq, title, importance, p1, p2, p3, p4, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        insert.run(sessionId, projectId ?? null, row.startSeq, row.endSeq, row.title, row.importance, row.p1, row.p2, row.p3, row.p4, now)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** After a surface commit: pending → committed and remember the checkpoint node. */
  commitCompartments(sessionId, checkpointSeq) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare("UPDATE compartments SET status = 'committed' WHERE session_id = ? AND status = 'pending'").run(sessionId)
      this.db.prepare(
        `INSERT INTO compaction_state (session_id, checkpoint_seq, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET checkpoint_seq = excluded.checkpoint_seq, updated_at = excluded.updated_at`,
      ).run(sessionId, checkpointSeq, Date.now())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Lineage lost: drop the given statuses (default: everything live) and forget the checkpoint when committed ones go. */
  dropCompartments(sessionId, statuses = ['pending', 'committed']) {
    const marks = statuses.map(() => '?').join(', ')
    this.db.prepare(`UPDATE compartments SET status = 'dropped' WHERE session_id = ? AND status IN (${marks})`).run(sessionId, ...statuses)
    if (statuses.includes('committed')) this.db.prepare('DELETE FROM compaction_state WHERE session_id = ?').run(sessionId)
  }

  /** The surface seq of this session's current history checkpoint, or null. */
  checkpointSeq(sessionId) {
    const row = this.db.prepare('SELECT checkpoint_seq FROM compaction_state WHERE session_id = ?').get(sessionId)
    return row?.checkpoint_seq ?? null
  }

  /** Register a project identity row (idempotent). */
  registerProject(id, root, kind) {
    this.db
      .prepare('INSERT OR IGNORE INTO projects (id, root, kind, resolved_at) VALUES (?, ?, ?, ?)')
      .run(id, root, kind, Date.now())
  }

  /**
   * Write one memory. Returns the row, or `null` when an active memory with
   * the same normalized content already exists in the category (dedup hit —
   * the caller reports it, no duplicate row is created). A dedup hit counts
   * as a re-observation: it bumps seen_count/last_seen_at, which baseline
   * selection reads as evidence the memory is still in use. Two exceptions
   * return a row: a non-note write over an active note promotes the note
   * (`promoted: true`), and a write over an archived twin revives it.
   */
  write({ projectId, category, content, importance = 50, sourceType = 'agent', sourceSession = null }) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`category must be one of ${CATEGORIES.join(', ')}`)
    }
    const hash = normalizedHash(content)
    // The UNIQUE key ignores status, so an archived twin blocks a plain
    // INSERT: look at every status and reuse the row.
    const existing = this.db
      .prepare('SELECT id, status, source_type FROM memories WHERE project_id = ? AND category = ? AND normalized_hash = ?')
      .get(projectId, category, hash)
    const now = Date.now()
    if (existing !== undefined && existing.status === 'active') {
      // A memory write over a note promotes it: the agent judged the note a
      // durable fact, and the note would otherwise never reach a baseline.
      if (existing.source_type === 'note' && sourceType !== 'note') {
        this.db.prepare('UPDATE memories SET source_type = ?, importance = MAX(importance, ?), seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?')
          .run(sourceType, importance, now, existing.id)
        return { ...this.get(existing.id), promoted: true }
      }
      this.db.prepare('UPDATE memories SET seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?').run(now, existing.id)
      return null
    }
    if (existing !== undefined) {
      // Re-writing archived knowledge revives the row as a fresh, unverified memory.
      this.db.prepare(`UPDATE memories SET content = ?, importance = ?, status = 'active', source_type = ?, source_session = ?,
                       invalid_at = NULL, archive_reason = NULL, superseded_by = NULL, created_at = ?, last_accessed = ?, last_seen_at = ?,
                       seen_count = 1, verification_status = 'unverified', verified_at = NULL, verified_commit = NULL,
                       embedding = NULL, embedded_at = NULL WHERE id = ?`)
        .run(content, importance, sourceType, sourceSession, now, now, now, existing.id)
      this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(existing.id)
      this.db.prepare('INSERT INTO memories_fts (rowid, tokens) VALUES (?, ?)').run(existing.id, tokenize(content))
      return this.get(existing.id)
    }
    const insert = this.db
      .prepare(`INSERT INTO memories (project_id, category, content, normalized_hash, importance, status, source_type, source_session, created_at, last_accessed, last_seen_at)
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`)
    insert.run(projectId, category, content, hash, importance, sourceType, sourceSession, now, now, now)
    const id = Number(this.db.prepare('SELECT last_insert_rowid() AS id').get().id)
    this.db.prepare('INSERT INTO memories_fts (rowid, tokens) VALUES (?, ?)').run(id, tokenize(content))
    return this.get(id)
  }

  /** Fetch one memory by id. */
  get(id) {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
    return row === undefined ? null : row
  }

  /** List memories of one project, optionally filtered. */
  list({ projectId, category = null, status = 'active' }) {
    if (category !== null) {
      return this.db
        .prepare('SELECT * FROM memories WHERE project_id = ? AND category = ? AND status = ? ORDER BY importance DESC, created_at ASC')
        .all(projectId, category, status)
    }
    return this.db
      .prepare('SELECT * FROM memories WHERE project_id = ? AND status = ? ORDER BY importance DESC, created_at ASC')
      .all(projectId, status)
  }

  /**
   * Update a memory's content/category/importance/source type. Re-tokenizes
   * the FTS row. New content was not checked against the code, so a content
   * change resets verification to unverified.
   * Returns the updated row, or `null` when the id is unknown.
   */
  update(id, { content = null, category = null, importance = null, sourceType = null }) {
    const row = this.get(id)
    if (row === null) return null
    const nextContent = content !== null ? content : row.content
    const nextCategory = category !== null ? category : row.category
    if (!CATEGORIES.includes(nextCategory)) {
      throw new Error(`category must be one of ${CATEGORIES.join(', ')}`)
    }
    const nextHash = normalizedHash(nextContent)
    const clash = this.db
      .prepare('SELECT id FROM memories WHERE project_id = ? AND category = ? AND normalized_hash = ? AND status = ? AND id != ?')
      .get(row.project_id, nextCategory, nextHash, 'active', id)
    if (clash !== undefined) {
      const error = new Error(`normalized content already exists as memory ${clash.id} in ${nextCategory}`)
      error.code = 'DUPLICATE'
      throw error
    }
    this.db
      .prepare('UPDATE memories SET content = ?, category = ?, normalized_hash = ?, importance = ?, source_type = ? WHERE id = ?')
      .run(nextContent, nextCategory, nextHash, importance !== null ? importance : row.importance, sourceType ?? row.source_type, id)
    if (content !== null && content !== row.content) {
      this.db.prepare("UPDATE memories SET verification_status = 'unverified', verified_at = NULL, verified_commit = NULL WHERE id = ?").run(id)
    }
    if (content !== null) {
      this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(id)
      this.db.prepare('INSERT INTO memories_fts (rowid, tokens) VALUES (?, ?)').run(id, tokenize(nextContent))
      // the old vector is stale for new content; clear it for the background drain
      this.db.prepare('UPDATE memories SET embedding = NULL, embedded_at = NULL WHERE id = ?').run(id)
    }
    return this.get(id)
  }

  /**
   * Archive a memory (soft-invalidate; the row and its history stay).
   * `supersededBy` names the active memory that now carries its content
   * (a merge); `reason` says why it left.
   * Returns the archived row, or `null` when the id is unknown.
   */
  archive(id, { reason = null, supersededBy = null } = {}) {
    const row = this.get(id)
    if (row === null) return null
    this.db
      .prepare("UPDATE memories SET status = 'archived', invalid_at = ?, archive_reason = ?, superseded_by = ? WHERE id = ?")
      .run(Date.now(), reason, supersededBy, id)
    this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(id)
    return this.get(id)
  }

  /**
   * Search active memories of one project with FTS5. Bigram tokens are OR'ed
   * for recall and ranked by bm25 (smaller is better). Hits update
   * last_accessed so retrieval counts stay observable.
   * @returns {Array<object>} ranked rows
   */
  search({ projectId, query, limit = 10 }) {
    const match = matchExpression(query)
    if (match === '') return []
    const hits = this.db
      .prepare(`SELECT f.rowid AS id, bm25(memories_fts) AS rank
                FROM memories_fts f
                WHERE memories_fts MATCH ?
                ORDER BY rank
                LIMIT ?`)
      .all(match, limit * 3)
    if (hits.length === 0) return []
    const rows = []
    for (const hit of hits) {
      const row = this.db
        .prepare('SELECT * FROM memories WHERE id = ? AND status = ? AND project_id = ?')
        .get(hit.id, 'active', projectId)
      if (row !== undefined) rows.push(row)
      if (rows.length >= limit) break
    }
    const touch = this.db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?')
    for (const row of rows) touch.run(Date.now(), row.id)
    return rows
  }

  /**
   * Record a verification check. verified_at is the time of the last check
   * (any outcome) and verified_commit the commit its evidence came from; the
   * dreamer re-checks a memory only when its files changed after that commit
   * or the check is old. Only status 'verified' counts as reinforcement.
   */
  setVerification(id, status, { commit = null } = {}) {
    if (!VERIFICATION_STATES.includes(status)) throw new Error(`verification status must be one of ${VERIFICATION_STATES.join(', ')}`)
    this.db
      .prepare('UPDATE memories SET verification_status = ?, verified_at = ?, verified_commit = ? WHERE id = ?')
      .run(status, Date.now(), commit, id)
  }

  /**
   * Store the embedding vector of one memory. No-op when the row is gone
   * (archived mid-flight) — embedding is best-effort and never blocks a write.
   */
  saveEmbedding(id, vector) {
    this.db
      .prepare('UPDATE memories SET embedding = ?, embedded_at = ? WHERE id = ? AND status = ?')
      .run(vectorToBlob(vector), Date.now(), id, 'active')
  }

  /** Active memories of one project that have no embedding yet. */
  pendingEmbeddings(projectId) {
    return this.db
      .prepare('SELECT id, content FROM memories WHERE project_id = ? AND status = ? AND embedding IS NULL')
      .all(projectId, 'active')
  }

  /**
   * Semantic search: cosine similarity of the query vector against every
   * embedded active memory of the project. In-memory comparison, fine at
   * project-memory scale.
   * @returns {Array<{row: object, similarity: number}>} best first
   */
  semanticSearch({ projectId, queryVector, limit = 10 }) {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE project_id = ? AND status = ? AND embedding IS NOT NULL')
      .all(projectId, 'active')
    const scored = []
    for (const row of rows) {
      const vector = blobToVector(row.embedding)
      if (vector === null) continue
      scored.push({ row, similarity: cosineSimilarity(queryVector, vector) })
    }
    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit)
  }
}

/**
 * Default database path: `$DSH_HOME/storages/hippocampus/memory.db`, falling
 * back to `~/.dsh` when the environment variable is unset (matches
 * dsh-home-paths precedence for the unconfigured case).
 * @param {object} [env] - environment mapping, defaults to process.env
 * @returns {string}
 */
export function defaultDbPath(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'storages', 'hippocampus', 'memory.db')
}

/** Category display order for baseline injection (exported for tests). */
export function categoryOrder() {
  return [...CATEGORY_ORDER]
}
