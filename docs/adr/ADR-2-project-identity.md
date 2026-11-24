# ADR-2: Project identity = git root-commit sha

## Status

Accepted

## Context

Memories are project-scoped: the store needs a stable key for "the project" that all sessions over the same codebase agree on. Candidate identities:

1. **Absolute path** — breaks on re-clone, breaks across worktrees, machine-specific.
2. **Remote URL** — not unique (multiple remotes, same repo under different URLs), unavailable offline.
3. **`git rev-list --max-parents=0 HEAD` (root commit)** — the sha of the very first commit. Stable across worktrees, clones, and checkouts at different paths; the same repo always hashes to the same value.
4. **Head sha** — changes on every commit; a memory written yesterday would detach from the project today.

Option 3 is what magic-context uses for exactly this reason.

## Decision

- Git repositories: identity is `git:<root-commit-sha>`. Every worktree and clone of one repository shares one memory pool.
- Non-git directories: `dir:<md5-12>` of the normalized path — stable within a machine, honest that it's machine-local.
- Transient git failures (e.g. during a fetch lock) enter a 60-second cooldown rather than flipping identity: an identity that flaps tears the memory pool in two.

## Consequences

- **Good**: `git worktree add` and re-clones keep their memories for free.
- **Good**: worktrees deliberately share the pool — a memory written in one worktree is visible in another, which is the desired semantics (it's one project).
- **Cost**: two unrelated repos that started as forks of the same root commit would also share a pool. Accepted: at this scale it's a curiosity, not a hazard.
- **Cost**: identity resolution shells out to git; the cooldown keeps it off the hot path after a failure.
