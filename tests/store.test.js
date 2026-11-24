import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, tokenize, normalize, normalizedHash, defaultDbPath, categoryOrder } from '../lib/store.js'

const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hippo-test-'))
  const store = new MemoryStore(join(dir, 'memory.db'))
  return { store, dir }
}

test('tokenize bigrams CJK and keeps latin whole', () => {
  assert.equal(tokenize('把会话历史压缩'), '把会 会话 话历 历史 史压 压缩')
  assert.equal(tokenize('dsh-compaction 是契约'), 'dsh-compaction 是契 契约')
})

test('normalize folds case and deletes punctuation, keeps word spaces', () => {
  assert.equal(normalize('DSH, 本体！一行不改'), 'dsh 本体一行不改')
  assert.equal(normalize('dsh本体一行不改'), 'dsh本体一行不改')
})

test('write dedups by normalized hash within category', () => {
  const { store } = makeStore()
  const first = store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'dsh 本体一行不改' })
  assert.notEqual(first, null)
  const duplicate = store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'DSH 本体！一行不改。' })
  assert.equal(duplicate, null)
  const otherCategory = store.write({ projectId: 'p1', category: 'CONSTRAINTS', content: 'dsh 本体一行不改' })
  assert.notEqual(otherCategory, null)
})

test('write rejects unknown category', () => {
  const { store } = makeStore()
  assert.throws(() => store.write({ projectId: 'p1', category: 'NOTES', content: 'x' }), /category/)
})

test('search finds Chinese two-char words via bigrams', () => {
  const { store } = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: '把会话历史压缩成分层摘要' })
  store.write({ projectId: 'p1', category: 'CONFIG_VALUES', content: 'SQLite 是嵌入式数据库' })
  const hits = store.search({ projectId: 'p1', query: '压缩' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].content, '把会话历史压缩成分层摘要')
  const none = store.search({ projectId: 'p2', query: '压缩' })
  assert.equal(none.length, 0)
})

test('search tolerates FTS5 operators and quotes in the query', () => {
  const { store } = makeStore()
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'tests run with node --test' })
  // hyphens are FTS5 NOT operators when unquoted; tokenize keeps them inside
  // latin tokens, so the expression must quote every token
  const hits = store.search({ projectId: 'p1', query: 'node --test' })
  assert.equal(hits.length, 1)
  const quoted = store.search({ projectId: 'p1', query: '"node" tests' })
  assert.equal(quoted.length, 1)
})

test('update moves category and retokenizes FTS', () => {
  const { store } = makeStore()
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'the service listens on port 3080' })
  const updated = store.update(row.id, { category: 'CONFIG_VALUES' })
  assert.equal(updated.category, 'CONFIG_VALUES')
  const hits = store.search({ projectId: 'p1', query: 'port' })
  assert.equal(hits.length, 1)
})

test('update throws DUPLICATE when clashing with another active row', () => {
  const { store } = makeStore()
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'content A' })
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'content B' })
  assert.throws(() => store.update(row.id, { content: 'content A' }), /DUPLICATE|already exists/)
})

test('archive removes from search and list', () => {
  const { store } = makeStore()
  const row = store.write({ projectId: 'p1', category: 'NAMING', content: 'naming convention A' })
  store.archive(row.id)
  assert.equal(store.search({ projectId: 'p1', query: 'naming' }).length, 0)
  assert.equal(store.list({ projectId: 'p1' }).length, 0)
  assert.equal(store.list({ projectId: 'p1', status: 'archived' }).length, 1)
})

test('defaultDbPath honors DSH_HOME', () => {
  assert.match(defaultDbPath({ DSH_HOME: '/tmp/x' }), /^\/tmp\/x\/storages\/hippocampus\/memory\.db$/)
  assert.match(defaultDbPath({}), /\.dsh\/storages\/hippocampus\/memory\.db$/)
})

test('categoryOrder covers all categories', () => {
  const order = categoryOrder()
  for (const category of ['PROJECT_RULES', 'ARCHITECTURE', 'CONSTRAINTS', 'CONFIG_VALUES', 'NAMING']) {
    assert.ok(order.includes(category))
  }
})

test('lifecycle: dedup hit reinforces, content change resets verification, archive records survivor', async () => {
  const { MemoryStore } = await import('../lib/store.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-life-')), 'm.db'))
  const row = store.write({ projectId: 'p', category: 'ARCHITECTURE', content: 'X uses Y' })
  assert.equal(row.seen_count, 1)
  assert.equal(row.verification_status, 'unverified')
  assert.equal(store.write({ projectId: 'p', category: 'ARCHITECTURE', content: 'x uses y.' }), null)
  assert.equal(store.get(row.id).seen_count, 2)
  store.setVerification(row.id, 'verified', { commit: 'abc' })
  assert.equal(store.get(row.id).verified_commit, 'abc')
  store.update(row.id, { importance: 70 })
  assert.equal(store.get(row.id).verification_status, 'verified', 'an importance-only edit keeps verification')
  store.update(row.id, { content: 'X uses Z' })
  assert.equal(store.get(row.id).verification_status, 'unverified')
  const other = store.write({ projectId: 'p', category: 'ARCHITECTURE', content: 'X uses Z because W' })
  store.archive(row.id, { reason: 'merged', supersededBy: other.id })
  assert.equal(store.get(row.id).superseded_by, other.id)
  assert.equal(store.get(row.id).archive_reason, 'merged')
  assert.throws(() => store.setVerification(row.id, 'bogus'))
})

test('write promotes a note with the same text and revives an archived twin', async () => {
  const { MemoryStore } = await import('../lib/store.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'hippo-prom-')), 'm.db'))
  const note = store.write({ projectId: 'p', category: 'PROJECT_RULES', content: 'the staging API has no cache', sourceType: 'note', importance: 80 })
  assert.equal(store.write({ projectId: 'p', category: 'PROJECT_RULES', content: 'the staging API has no cache', sourceType: 'note' }), null)
  const promoted = store.write({ projectId: 'p', category: 'PROJECT_RULES', content: 'the staging API has no cache', importance: 70 })
  assert.equal(promoted.promoted, true)
  assert.equal(promoted.id, note.id)
  assert.equal(store.get(note.id).source_type, 'agent')
  assert.equal(store.get(note.id).importance, 80, 'promotion keeps the higher importance')
  store.archive(note.id, { reason: 'test' })
  const revived = store.write({ projectId: 'p', category: 'PROJECT_RULES', content: 'the staging API has no cache' })
  assert.equal(revived.id, note.id)
  assert.equal(revived.status, 'active')
  assert.equal(revived.archive_reason, null)
  assert.equal(store.search({ projectId: 'p', query: 'staging' }).length, 1, 'the revived row is searchable again')
})

test('migration adds lifecycle columns to an old store', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { MemoryStore } = await import('../lib/store.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const path = join(mkdtempSync(join(tmpdir(), 'hippo-mig-')), 'm.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL, normalized_hash TEXT NOT NULL, importance INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'active', source_type TEXT NOT NULL DEFAULT 'agent', source_session TEXT, created_at INTEGER NOT NULL, invalid_at INTEGER, last_accessed INTEGER NOT NULL, UNIQUE (project_id, category, normalized_hash))`)
  old.prepare("INSERT INTO memories (project_id, category, content, normalized_hash, created_at, last_accessed) VALUES ('p','ARCHITECTURE','old','h',1,1)").run()
  old.close()
  const store = new MemoryStore(path)
  const row = store.get(1)
  assert.equal(row.seen_count, 1)
  assert.equal(row.verification_status, 'unverified')
  assert.equal(row.superseded_by, null)
})

test('tokenize bigrams Japanese and Korean and keeps accented words whole', () => {
  assert.equal(tokenize('データベース'), 'デー ータ タベ ベー ース')
  assert.equal(tokenize('설정 파일'), '설정 파일')
  assert.equal(tokenize('café au lait'), 'café au lait')
  assert.equal(tokenize('Привет мир'), 'привет мир')
})

test('search finds Japanese, Korean and accented words', () => {
  const { store } = makeStore()
  store.write({ projectId: 'p', category: 'NAMING', content: '設定ファイルは config.yml' })
  store.write({ projectId: 'p', category: 'NAMING', content: '데이터베이스 경로는 고정' })
  store.write({ projectId: 'p', category: 'NAMING', content: 'the café module owns billing' })
  assert.equal(store.search({ projectId: 'p', query: 'ファイル' }).length, 1)
  assert.equal(store.search({ projectId: 'p', query: '데이터' }).length, 1)
  assert.equal(store.search({ projectId: 'p', query: 'café' }).length, 1)
})

test('the store directory and database files are private to the user', { skip: process.platform === 'win32' }, () => {
  const { store, dir } = makeStore()
  store.write({ projectId: 'p', category: 'NAMING', content: 'x' })
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(join(dir, 'memory.db')).mode & 0o777, 0o600)
  store.close()
})

test('a store from an older tokenizer gets its FTS rows rebuilt once', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { dir, store } = makeStore()
  const row = store.write({ projectId: 'p', category: 'NAMING', content: 'データベース 設定' })
  store.close()
  // simulate a version-0 store whose FTS row was tokenized without kana
  const raw = new DatabaseSync(join(dir, 'memory.db'))
  raw.exec('PRAGMA user_version = 0')
  raw.prepare('DELETE FROM memories_fts').run()
  raw.prepare('INSERT INTO memories_fts (rowid, tokens) VALUES (?, ?)').run(row.id, '設定')
  raw.close()
  const reopened = new MemoryStore(join(dir, 'memory.db'))
  assert.equal(reopened.search({ projectId: 'p', query: 'データ' }).length, 1)
  assert.equal(Number(reopened.db.prepare('PRAGMA user_version').get().user_version), 1)
})
