import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { Dreamer, TICK_MS, contentFingerprint, anyPathExists, pathHints, resolveHint, fileExcerpt, trackedFiles, REVERIFY_AFTER_MS } from '../lib/dreamer.js'

const gitIn = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'pipe' })

const setup = (complete) => {
  const dir = mkdtempSync(join(tmpdir(), 'hippo-dream-'))
  const store = new MemoryStore(join(dir, 'm.db'))
  store.registerProject('p1', dir, 'dir')
  const dreamer = new Dreamer({ store, complete })
  // verify reads git-tracked files a memory names; give the fixtures one
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'setup.md'), '# Setup\nrun npm install\n')
  gitIn(dir, 'init', '-q')
  gitIn(dir, 'add', 'docs/setup.md')
  gitIn(dir, 'commit', '-qm', 'init')
  return { store, dreamer, dir }
}

test('tick runs nothing when store is empty', async () => {
  const calls = []
  const { dreamer } = setup(async (system) => { calls.push(system); return '{"verdicts":[]}' })
  const ran = await dreamer.tick()
  assert.deepEqual(ran, [])
  assert.equal(calls.length, 0)
})

test('verify records an archive verdict as stale, never archives', async () => {
  const { store, dreamer, dir } = setup(async (system, user) => {
    assert.match(system, /verify project memories/i)
    const payload = JSON.parse(user)
    assert.equal(payload.memories.length, 1)
    assert.equal(payload.memories[0].evidence[0].file, 'docs/setup.md')
    assert.match(payload.memories[0].evidence[0].excerpt, /run npm install/, 'verify sends file evidence, not just paths')
    return JSON.stringify({ verdicts: [{ id: 1, verdict: 'archive', content: null, reason: 'file gone' }] })
  })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  const ran = await dreamer.tick()
  const rows = store.list({ projectId: 'p1' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].verification_status, 'stale')
  assert.ok(ran.some(entry => entry.startsWith('verify:')))
})

test('verify updates content per the manifest', async () => {
  const { store, dreamer } = setup(async () => JSON.stringify({
    verdicts: [{ id: 1, verdict: 'update', content: 'setup steps live in docs/install.md now', reason: 'renamed' }],
  }))
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  await dreamer.tick()
  const rows = store.list({ projectId: 'p1' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, 'setup steps live in docs/install.md now')
  assert.equal(rows[0].verification_status, 'unverified', 'the model does not certify its own rewrite')
})

test('verify never sends process rules', async () => {
  let calls = 0
  const { store, dreamer } = setup(async () => { calls += 1; return '{"verdicts":[]}' })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'always read docs/setup.md before installing' })
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 0)
})

test('verify re-checks a verified row when its file changes after the verified commit', async () => {
  let calls = 0
  let lastPayload
  const { store, dreamer, dir } = setup(async (_system, user) => {
    calls += 1
    lastPayload = JSON.parse(user)
    return JSON.stringify({ verdicts: lastPayload.memories.map(entry => ({ id: entry.id, verdict: 'verified', content: null, reason: '' })) })
  })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  await dreamer.runNow('p1', 'verify')
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 1, 'no diff, fresh check: not re-sent')
  writeFileSync(join(dir, 'docs', 'setup.md'), '# Setup\nrun pnpm install\n')
  gitIn(dir, 'commit', '-qam', 'pnpm')
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 2)
  assert.match(lastPayload.memories[0].diffSinceVerified, /\+run pnpm install/)
  // a verified commit rewritten away: the diff fails and the row is re-checked
  store.db.prepare("UPDATE memories SET verified_commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE id = 1").run()
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 3)
})

test('a skip on a verified row lapses the verified mark; omitted rows are stamped too', async () => {
  let verdict = 'verified'
  let calls = 0
  const { store, dreamer, dir } = setup(async (_system, user) => {
    calls += 1
    const payload = JSON.parse(user)
    return JSON.stringify({ verdicts: verdict === 'omit' ? [] : payload.memories.map(entry => ({ id: entry.id, verdict, content: null, reason: '' })) })
  })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  await dreamer.runNow('p1', 'verify')
  assert.equal(store.get(1).verification_status, 'verified')
  writeFileSync(join(dir, 'docs', 'setup.md'), 'changed\n')
  gitIn(dir, 'commit', '-qam', 'c')
  verdict = 'skip'
  await dreamer.runNow('p1', 'verify')
  assert.equal(store.get(1).verification_status, 'unverified')
  writeFileSync(join(dir, 'docs', 'setup.md'), 'changed again\n')
  gitIn(dir, 'commit', '-qam', 'd')
  verdict = 'omit'
  await dreamer.runNow('p1', 'verify')
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 3, 'a row the manifest omitted waits like a skip')
})

test('verify stamps a skip so the row waits instead of being re-sent daily', async () => {
  let calls = 0
  const { store, dreamer } = setup(async () => { calls += 1; return JSON.stringify({ verdicts: [{ id: 1, verdict: 'skip', content: null, reason: 'n/a' }] }) })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  await dreamer.runNow('p1', 'verify')
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 1)
  assert.equal(store.get(1).verification_status, 'unverified')
})

test('verify stores verified status and skips the row next run until the window passes', async () => {
  let calls = 0
  const { store, dreamer } = setup(async (_system, user) => {
    calls += 1
    const payload = JSON.parse(user)
    return JSON.stringify({ verdicts: payload.memories.map(entry => ({ id: entry.id, verdict: 'verified', content: null, reason: '' })) })
  })
  const row = store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'setup steps live in docs/setup.md' })
  await dreamer.runNow('p1', 'verify')
  assert.equal(store.get(row.id).verification_status, 'verified')
  const again = await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 1, 'a freshly verified row with no diff is not re-sent')
  assert.equal(again.result.checked, 0)
  store.db.prepare('UPDATE memories SET verified_at = ? WHERE id = ?').run(Date.now() - REVERIFY_AFTER_MS - 1, row.id)
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 2, 'an old verification is re-checked')
})

test('verify stale verdict records status without touching content', async () => {
  const { store, dreamer } = setup(async () => JSON.stringify({ verdicts: [{ id: 1, verdict: 'stale', content: null, reason: 'drifted' }] }))
  store.write({ projectId: 'p1', category: 'CONFIG_VALUES', content: 'install step: docs/setup.md' })
  await dreamer.runNow('p1', 'verify')
  const row = store.get(1)
  assert.equal(row.status, 'active')
  assert.equal(row.verification_status, 'stale')
})

test('verify ignores notes, untracked files and paths that do not resolve to files', async () => {
  let calls = 0
  const { store, dreamer, dir } = setup(async () => { calls += 1; return '{"verdicts":[]}' })
  writeFileSync(join(dir, 'docs', 'untracked.md'), 'x')
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'note about docs/setup.md', sourceType: 'note' })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'untracked docs/untracked.md' })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'lives in src/missing.js' })
  await dreamer.runNow('p1', 'verify')
  assert.equal(calls, 0)
})

test('curate archives only into a surviving same-category memory', async () => {
  const { store, dreamer } = setup(async () => JSON.stringify({
    actions: [
      { id: 1, op: 'archive', content: null, merged_into: null, reason: 'redundant' },
      { id: 2, op: 'archive', content: null, merged_into: 3, reason: 'dup of 3' },
      { id: 4, op: 'archive', content: null, merged_into: 6, reason: 'other category' },
    ],
  }))
  for (const content of ['rule one', 'rule two', 'rule three', 'rule four', 'rule five']) {
    store.write({ projectId: 'p1', category: 'PROJECT_RULES', content })
  }
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'arch fact' })
  const run = await dreamer.runNow('p1', 'curate')
  const active = store.list({ projectId: 'p1', category: 'PROJECT_RULES' }).map(row => row.id).sort()
  assert.deepEqual(active, [1, 3, 4, 5])
  assert.equal(store.get(2).superseded_by, 3)
  assert.equal(run.result.refused, 2)
})

test('curate refuses a shrinking rewrite without a survivor and gates demotion to notes', async () => {
  const long = 'this rule carries a lot of important detail that must not silently vanish from memory'
  const { store, dreamer } = setup(async () => JSON.stringify({
    actions: [
      { id: 1, op: 'update', content: 'short', merged_into: null, reason: 'tighten' },
      { id: 2, op: 'note', content: null, merged_into: null, reason: 'backlog item' },
      { id: 3, op: 'note', content: null, merged_into: null, reason: 'looks dated' },
      { id: 4, op: 'note', content: null, merged_into: null, reason: 'timeless' },
      { id: 5, op: 'archive', content: null, merged_into: 2, reason: 'into a demoted row' },
      { id: 6, op: 'note', content: null, merged_into: null, reason: 'dated rule' },
    ],
  }))
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: long })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'backlog: do x later' })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'Since 2026-01-05: run the full test suite before a release', importance: 80 })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'rule four' })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'rule five' })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'Design rule (since 2026-01-05): keep the public API stable', importance: 75 })
  const run = await dreamer.runNow('p1', 'curate')
  assert.equal(store.get(1).content, long)
  assert.equal(store.get(2).source_type, 'note', 'a pending item may become a note')
  assert.equal(store.get(3).source_type, 'agent', 'importance >= 80 is never demoted')
  assert.equal(store.get(4).source_type, 'agent', 'timeless text is never demoted')
  assert.equal(store.get(5).status, 'active', 'a demoted row is no survivor')
  assert.equal(store.get(6).source_type, 'agent', 'a date alone does not make a rule demotable')
  assert.equal(run.result.refused, 5)
})

test('curate rotates categories and applies noop/update/archive', async () => {
  const seen = []
  const { store, dreamer } = setup(async (system, user) => {
    seen.push(JSON.parse(user))
    return JSON.stringify({
      actions: seen.length === 1
        ? [{ id: 1, op: 'update', content: 'tightened rule', reason: 'wording' }, { id: 2, op: 'noop', content: null, reason: '' }]
        : [{ id: 3, op: 'archive', content: null, merged_into: 4, reason: 'superseded' }],
    })
  })
  for (const content of ['rule one', 'rule two', 'rule three', 'rule four', 'rule five']) {
    store.write({ projectId: 'p1', category: 'PROJECT_RULES', content })
  }
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'arch fact one' })
  await dreamer.tick()
  // first due task order: verify (no path hints → gate skips), curate runs PROJECT_RULES
  assert.equal(seen.length, 1)
  assert.equal(seen[0].category, 'PROJECT_RULES')
  const contents = store.list({ projectId: 'p1', category: 'PROJECT_RULES' }).map(row => row.content).sort()
  assert.deepEqual(contents, ['rule five', 'rule four', 'rule three', 'rule two', 'tightened rule'])
})

test('manifest parse failure is recorded and retried, not thrown out of tick', async () => {
  let calls = 0
  const { store, dreamer } = setup(async () => { calls += 1; return 'not json at all' })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'rule in docs/setup.md' })
  const ran = await dreamer.tick()
  assert.equal(calls, 1)
  assert.deepEqual(ran, [])
})

test('daily schedule: second immediate tick is a no-op after success', async () => {
  let calls = 0
  const { store, dreamer } = setup(async () => { calls += 1; return '{"verdicts":[]}' })
  store.write({ projectId: 'p1', category: 'ARCHITECTURE', content: 'rule in docs/setup.md' })
  await dreamer.tick()
  await dreamer.tick()
  assert.equal(calls, 1)
})

test('gate: curate needs at least 5 memories', async () => {
  let calls = 0
  const { store, dreamer } = setup(async () => { calls += 1; return '{"actions":[]}' })
  store.write({ projectId: 'p1', category: 'PROJECT_RULES', content: 'only one' })
  await dreamer.tick()
  assert.equal(calls, 0)
})

test('path helpers: hints, git-tracked allowlist, excerpts', () => {
  assert.deepEqual(pathHints('see lib/store.js and ~/.dsh/AGENTS.md and /etc/hosts.conf'), ['lib/store.js', '~/.dsh/AGENTS.md', '/etc/hosts.conf'])
  const root = mkdtempSync(join(tmpdir(), 'hippo-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'hippo-out-'))
  writeFileSync(join(outside, 'id_secret'), 'KEY')
  writeFileSync(join(root, 'a.js'), 'x')
  writeFileSync(join(root, 'untracked.js'), 'x')
  writeFileSync(join(root, '.env.local'), 'SECRET=1')
  writeFileSync(join(root, 'img.png'), Buffer.from([0x89, 0x50, 0, 0, 1]))
  symlinkSync(join(outside, 'id_secret'), join(root, 'link.txt'))
  gitIn(root, 'init', '-q')
  gitIn(root, 'add', 'a.js', '.env.local', 'img.png', 'link.txt')
  gitIn(root, 'commit', '-qm', 'x')
  const tracked = trackedFiles(root)
  assert.equal(resolveHint(root, 'a.js', tracked)?.rel, 'a.js')
  assert.equal(resolveHint(root, 'untracked.js', tracked), null, 'only git-tracked files are evidence')
  assert.equal(resolveHint(root, '.env.local', tracked), null, 'secret-looking files are refused even when tracked')
  assert.equal(resolveHint(root, 'link.txt', tracked), null, 'a symlink out of the repo is refused')
  assert.equal(resolveHint(root, '~/.npmrc', tracked), null, 'home files are never evidence')
  assert.equal(resolveHint(root, '/etc/hosts.conf', tracked), null)
  assert.equal(fileExcerpt(join(root, 'img.png'), 'x'), null, 'binary files are not evidence')
  assert.equal(trackedFiles(outside), null, 'a non-git root has no evidence')
  const big = join(root, 'big.js')
  writeFileSync(big, Array.from({ length: 2000 }, (_, i) => i === 1500 ? 'const SPECIAL_MARKER = 1 // 压缩引擎' : `line ${i}`).join('\n'))
  const excerpt = fileExcerpt(big, 'uses SPECIAL_MARKER', 500)
  assert.match(excerpt.text, /1501: const SPECIAL_MARKER = 1/)
  assert.equal(excerpt.complete, false)
  assert.ok(excerpt.text.length <= 500)
  assert.match(fileExcerpt(big, '默认的压缩引擎', 500).text, /1501:/, 'CJK words select lines too')
  assert.equal(fileExcerpt(join(root, 'a.js'), 'x').complete, true)
})

test('path helpers', () => {
  assert.equal(contentFingerprint('a'), contentFingerprint('a'))
  const dir = mkdtempSync(join(tmpdir(), 'hippo-paths-'))
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'docs', 'x.md'), 'x')
  assert.equal(anyPathExists(dir, ['docs/x.md', 'nope.md']), true)
  assert.equal(anyPathExists(dir, ['nope.md']), false)
})
