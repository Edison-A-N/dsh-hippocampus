/**
 * Project identity for dsh-hippocampus memories.
 *
 * Identity is `git:<root-commit-sha>` when the directory sits in a git
 * repository and `dir:<md5-12>` otherwise, keyed by the repo root (not the
 * cwd) so every worktree of the same repository shares one memory pool. Git
 * failures (transient errors, missing binary) enter a 60-second cooldown per
 * directory before another attempt, so a flaky git never flips a project
 * between two identities and tears the memory pool apart.
 * @module dsh-hippocampus/identity
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

const COOLDOWN_MS = 60_000
const GIT_TIMEOUT_MS = 5000

/** @typedef {{ id: string, root: string, kind: 'git' | 'dir' }} ProjectIdentity */

export class IdentityResolver {
  constructor() {
    /** @type {Map<string, ProjectIdentity>} cwd/path → identity */
    this.known = new Map()
    /** @type {Map<string, number>} path → cooldown-until timestamp */
    this.cooldowns = new Map()
  }

  /**
   * Resolve the project identity for a directory. Results are cached per
   * input path; git failures are cached with a cooldown.
   * @param {string} cwd - absolute directory path
   * @returns {ProjectIdentity}
   */
  resolve(cwd) {
    const cached = this.known.get(cwd)
    if (cached !== undefined) return cached

    let identity = null
    const cooldown = this.cooldowns.get(cwd)
    if (cooldown === undefined || cooldown < Date.now()) {
      identity = this.#tryGit(cwd)
      if (identity === null) this.cooldowns.set(cwd, Date.now() + COOLDOWN_MS)
    }
    if (identity === null) identity = this.#dirIdentity(cwd)

    this.known.set(cwd, identity)
    return identity
  }

  /** Run git to find the repository root and its root commit. Returns null on any failure. */
  #tryGit(cwd) {
    try {
      const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
      }).trim()
      const rootCommit = execFileSync('git', ['-C', cwd, 'rev-list', '--max-parents=0', 'HEAD'], {
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
      }).trim()
      if (root !== '' && rootCommit !== '') {
        this.known.set(root, { id: `git:${rootCommit}`, root, kind: 'git' })
        return this.known.get(root)
      }
      return null
    } catch {
      return null
    }
  }

  /** Stable identity for non-git directories. */
  #dirIdentity(cwd) {
    const normalized = cwd === homedir() ? cwd : cwd.replace(/\/+$/, '')
    return {
      id: `dir:${createHash('md5').update(normalized).digest('hex').slice(0, 12)}`,
      root: normalized,
      kind: 'dir',
    }
  }
}

/**
 * Render an identity for display: the kind plus a short fingerprint.
 * @param {ProjectIdentity} identity
 * @returns {string}
 */
export function describeIdentity(identity) {
  const fingerprint = identity.id.slice(identity.kind === 'git' ? 4 : 4, identity.kind === 'git' ? 15 : 16)
  return `${identity.kind} ${fingerprint}`
}
