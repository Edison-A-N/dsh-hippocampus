/**
 * dsh-hippocampus — project memory layer for the DeepSeek Harness.
 *
 * M1 scope (knowledge layer, zero context-management): two model tools and
 * one baseline injection.
 *
 * - `ctx_memory` writes, updates, archives, gets, and lists project-scoped
 *   memories (five categories, exact-dedup, soft archive).
 * - `ctx_search` retrieves them through a bigram FTS5 index (CJK-safe).
 * - On an agent's first step, active memories render once into a user
 *   message tagged `source.kind: 'hippocampus'` — durable, appended behind
 *   the last claimed message, so it enters the provider's cached prefix and
 *   is never re-injected (dedup by source kind). No memories, no injection.
 *
 * Project identity: `git:<root-commit-sha>` via lib/identity.js, shared
 * across worktrees of one repository. Storage: one SQLite file per DSH_HOME
 * (`$DSH_HOME/storages/hippocampus/memory.db`, WAL + busy_timeout).
 *
 * `@deepseek-ai/dsh-tools` is imported dynamically inside apply(): the
 * plugin is linked into a dsh profile where the package resolves from the
 * enclosing bundle, but a bare `npm test` in the plugin directory must not
 * need the harness packages installed.
 * @module dsh-hippocampus
 */
import { randomUUID } from 'node:crypto'
import { MemoryStore, CATEGORIES, defaultDbPath } from './store.js'
import { IdentityResolver } from './identity.js'
import { composeBaseline, hasHippocampusInjection, escapeInjectionTags } from './baseline.js'

const isBaselineSource = source => source.baseline === true
const isHintSource = source => source.hint === true
import { embeddingClientFrom } from './embedding.js'
import { Dreamer, TICK_MS } from './dreamer.js'
import { HippocampusCompaction } from './compaction.js'
import { CompartmentCompaction } from './historian.js'
import { OverflowBudget } from './commit.js'
import { resolveReduceTargets } from './reclaim.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'hippocampus'

/** The seams this plugin registers into (timer/llm/tokenMeter/sessions: intervals, dreamer+compaction calls, pressure measurement, flush). */
export const inject = ['tools', 'timer', 'llm', 'tokenMeter', 'sessions']

/** This plugin takes no configuration. */
export const Config = undefined

const MEMORY_TOOL_DESCRIPTION = `Read and write this project's long-term memory. Active memories are injected at the start of future sessions as standing facts, so a wrong or stale one misleads every later session.
Write only knowledge that stays true for months without anyone updating it, and that a future agent would otherwise get wrong or spend turns rediscovering. Before writing, apply the test for the category:
- PROJECT_RULES: a durable rule for how to work here (process, workflow, a lesson from a user correction that will recur). Test: does it tell a future agent what to do differently?
- ARCHITECTURE: a load-bearing design decision and WHY it holds. Test: does it explain why, not just what a file does today?
- CONSTRAINTS: a hard limit imposed by an external system (API, provider, platform). Test: would fixing it require changing someone else's code?
- CONFIG_VALUES: a stable key/value/path. Test: still true in 3 months without a deliberate config change? Versions, counts, sizes and measurements fail.
- NAMING: a naming convention or rename, not an inventory of current names.
Do not write: progress or status of a task, what happened in this session, pending items or backlog (use ctx_note), commit hashes, versions that will move, investigation logs.
Write in present tense ("X uses Y because Z"), one fact per memory, no dates or "the user decided on <date>" framing, keep paths and keys verbatim, and keep it short.
- write: store one memory. Duplicates (same normalized content in the same category) are rejected and count as a re-observation; writing the text of an existing note promotes that note to a memory.
- update: rewrite content/category/importance of one memory by id (when a fact changed, update it rather than writing a second one).
- archive: retire a wrong or obsolete memory; pass superseded_by when another active memory carries its content. Archived rows leave the baseline and search.
- get / list: inspect memories by id or category.`

const SEARCH_TOOL_DESCRIPTION = `Search this project's long-term memories AND past session history. Hybrid retrieval over memories: full-text bigram match (exact identifiers, paths, Chinese) fused with semantic similarity when embeddings are available; plus full-text search over this project's past conversations (every session whose workspace was this project). Returns ranked rows with ids — use ctx_memory get/list for full memories, ctx_expand for an event's original text.`

/** Reciprocal rank fusion of two ranked id lists (k=60 standard). */
function rrf(rankedIds) {
  const K = 60
  const scores = new Map()
  for (const ids of rankedIds) {
    for (let rank = 0; rank < ids.length; rank += 1) {
      const id = ids[rank]
      scores.set(id, (scores.get(id) ?? 0) + 1 / (K + rank + 1))
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])
}

/** Resolve the workspace cwd of a tool-executing agent. */
function workspaceOf(exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (cwd === undefined) throw new Error('ctx tools require an owning agent session with a workspace')
  return cwd
}

/**
 * Project one raw store row to its tool-facing shape. The raw row carries
 * `embedding` (a Uint8Array BLOB) and `embedded_at`, which are not lossless
 * JSON — DSH tool-output validation rejects the whole return value when they
 * leak into get/list/update/archive results. The BLOB stays in the store
 * (semantic search reads it); only the tool surface is projected.
 */
function projectMemory(row) {
  return row === null ? null : {
    id: row.id,
    category: row.category,
    content: row.content,
    importance: row.importance,
    status: row.status,
    source_type: row.source_type,
    source_session: row.source_session,
    created_at: row.created_at,
    invalid_at: row.invalid_at,
    last_accessed: row.last_accessed,
    seen_count: row.seen_count,
    verification_status: row.verification_status,
    verified_at: row.verified_at,
    superseded_by: row.superseded_by,
    archive_reason: row.archive_reason,
  }
}

/** Register the ctx_memory tool. Split out for unit testing with a fake ctx. */
export function registerMemoryTool(ctx, { defineTool }, { store, resolver, embeddings }) {
  ctx.tools.register(defineTool({
    name: 'ctx_memory',
    description: MEMORY_TOOL_DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['write', 'get', 'list', 'update', 'archive'],
        description: 'Which operation to run.',
      },
      category: {
        type: 'string',
        enum: [...CATEGORIES],
        description: 'write: category for the new memory; update: new category.',
      },
      content: {
        type: 'string',
        description: 'write: the fact to remember (one concise sentence); update: full replacement content.',
      },
      importance: {
        type: 'integer',
        description: '1-100; priority when the start-of-session baseline cannot fit every memory (higher is injected first). 80+ only for rules that prevent real mistakes. Default 50.',
      },
      id: {
        type: 'integer',
        description: 'get/update/archive: the memory id (the m<number> from the baseline or search results).',
      },
      reason: {
        type: 'string',
        description: 'archive: why the memory is obsolete.',
      },
      superseded_by: {
        type: 'integer',
        description: 'archive: id of the active memory that now carries this one\'s content (a merge).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const cwd = workspaceOf(exec)
      const identity = resolver.resolve(cwd)
      store.registerProject(identity.id, identity.root, identity.kind)
      // Ids are global across projects; an id from another project's pool
      // reads as unknown here, so one project's session never reads or
      // rewrites another project's memories.
      const ownRow = id => {
        const row = store.get(id)
        return row !== null && row.project_id === identity.id ? row : null
      }

      switch (args.action) {
        case 'write': {
          if (args.category === undefined || args.content === undefined) {
            throw new Error('write requires category and content')
          }
          const row = store.write({
            projectId: identity.id,
            category: args.category,
            content: args.content,
            importance: typeof args.importance === 'number' ? args.importance : 50,
            sourceSession: exec.agent.session.id,
          })
          if (row === null) {
            const duplicate = store.search({ projectId: identity.id, query: args.content, limit: 3 })
              .find(hit => hit.category === args.category)
            return {
              action: 'write',
              result: 'duplicate',
              message: 'An active memory with the same content already exists in this category; nothing was written.',
              existing: duplicate === undefined ? undefined : { id: duplicate.id, content: duplicate.content },
            }
          }
          // Best-effort async embedding: never blocks the write result, a
          // failure only leaves the row for the background drain.
          if (embeddings !== undefined && embeddings.available) {
            void embeddings.embed([args.content])
              .then(([vector]) => { if (vector !== undefined) store.saveEmbedding(row.id, vector) })
              .catch(() => {})
          }
          return { action: 'write', result: row.promoted === true ? 'promoted_note' : 'written', memory: { id: row.id, category: row.category, content: row.content, importance: row.importance } }
        }
        case 'get': {
          if (args.id === undefined) throw new Error('get requires id')
          const row = ownRow(args.id)
          return row === null
            ? { action: 'get', result: 'not_found', id: args.id }
            : { action: 'get', memory: projectMemory(row) }
        }
        case 'list': {
          const rows = store.list({ projectId: identity.id, category: args.category ?? null })
          return { action: 'list', count: rows.length, memories: rows.map(projectMemory) }
        }
        case 'update': {
          if (args.id === undefined) throw new Error('update requires id')
          if (ownRow(args.id) === null) return { action: 'update', result: 'not_found', id: args.id }
          const row = store.update(args.id, {
            content: args.content ?? null,
            category: args.category ?? null,
            importance: args.importance ?? null,
          })
          if (row === null) return { action: 'update', result: 'not_found', id: args.id }
          if (args.content !== undefined && embeddings !== undefined && embeddings.available) {
            void embeddings.embed([args.content])
              .then(([vector]) => { if (vector !== undefined) store.saveEmbedding(row.id, vector) })
              .catch(() => {})
          }
          return { action: 'update', result: 'updated', memory: projectMemory(row) }
        }
        case 'archive': {
          if (args.id === undefined) throw new Error('archive requires id')
          if (ownRow(args.id) === null) return { action: 'archive', result: 'not_found', id: args.id }
          const row = store.archive(args.id, { reason: args.reason ?? null, supersededBy: args.superseded_by ?? null })
          return row === null
            ? { action: 'archive', result: 'not_found', id: args.id }
            : { action: 'archive', result: 'archived', memory: projectMemory(row), reason: args.reason ?? null }
        }
        default:
          throw new Error(`unknown action: ${args.action}`)
      }
    },
  }))
}

/** Register the ctx_search tool. Split out for unit testing with a fake ctx. */
export function registerSearchTool(ctx, { defineTool }, { store, resolver, embeddings, getSessionQuery }) {
  ctx.tools.register(defineTool({
    name: 'ctx_search',
    description: SEARCH_TOOL_DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Search text (Chinese or identifiers). Bigram full-text plus semantic match over project memories, full-text over this project\'s past session history, fused by reciprocal rank.',
      },
      scope: {
        type: 'string',
        enum: ['all', 'memories', 'sessions'],
        description: 'Which sources to search: memories (project facts), sessions (past conversation history of this project), or all (default).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum rows to return. Default 10.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const cwd = workspaceOf(exec)
      const identity = resolver.resolve(cwd)
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const scope = args.scope ?? 'all'

      const memoryLanes = []
      const sessionLanes = []

      // Lane 1: FTS5 bigram full-text over project memories.
      if (scope !== 'sessions') {
        const ftsRows = store.search({ projectId: identity.id, query: args.query, limit: limit * 2 })
        memoryLanes.push(ftsRows.map(row => row.id))
      }

      // Lane 2: semantic over memories (only when the embedding client is
      // configured; the pending-embedding drain means most rows carry vectors).
      let semanticAvailable = false
      if (scope !== 'sessions' && embeddings !== undefined && embeddings.available) {
        try {
          const [queryVector] = await embeddings.embed([args.query])
          if (queryVector !== undefined) {
            const semanticRows = store.semanticSearch({ projectId: identity.id, queryVector, limit: limit * 2 })
            memoryLanes.push(semanticRows.map(entry => entry.row.id))
            semanticAvailable = semanticRows.length > 0
          }
        } catch {
          // gateway hiccup: degrade silently to FTS-only
        }
      }

      // Lane 3: full-text over this project's past session history (the
      // magic-context recall widening: "how did we change that function last
      // week" is a session-history question, not a memory). The cwd filter
      // scopes hits to sessions whose workspace is this project's root.
      // Resolved per execute — the service activates late.
      let sessionHits = []
      let sessionSearch = scope === 'memories' ? 'skipped' : 'on'
      const sessionQuery = getSessionQuery?.()
      if (scope !== 'memories' && sessionQuery === undefined) sessionSearch = 'unavailable'
      if (scope !== 'memories' && sessionQuery !== undefined) {
        try {
          const page = await sessionQuery.searchSessions({
            query: args.query,
            sessionFilters: [{ kind: 'cwd', values: [identity.root] }],
            limit: limit * 2,
          })
          sessionHits = page.items.map(hit => ({
            sessionId: hit.header.id,
            title: hit.header.title ?? null,
            bestMatch: {
              seq: hit.bestMatch.seq,
              type: hit.bestMatch.type,
              time: hit.bestMatch.time,
              snippet: hit.bestMatch.snippet,
            },
          }))
          sessionLanes.push(sessionHits.map((hit, index) => `s:${index}`))
        } catch (searchError) {
          // session search unavailable (service absent, index cold): degrade
          // to memories-only, but say why — a silent lane loss is undiagnosable.
          ctx.logger?.warn?.(`hippocampus session-history search failed: ${searchError?.message ?? searchError}`)
          // The stock session-query index ships disabled; tell the model so
          // an empty session lane is not read as "nothing was ever said".
          sessionSearch = searchError?.code === 'SESSION_QUERY_SEARCH_DISABLED' ? 'disabled' : 'unavailable'
        }
      }

      // RRF across lanes; memory ids and session-hit slots share the fusion
      // table (the s: prefix keeps the id spaces disjoint).
      const fused = rrf([...memoryLanes, ...sessionLanes]).slice(0, limit * 2)
      const sessionRank = new Map(fused.filter(([id]) => String(id).startsWith('s:')).map(([id], rank) => [id, rank]))
      const rows = fused
        .map(([id]) => (typeof id === 'number' ? store.get(id) : null))
        .filter(row => row !== null && row.status === 'active')
        .slice(0, scope === 'sessions' ? 0 : limit)
      const sessions = sessionHits
        .filter((hit, index) => sessionRank.has(`s:${index}`))
        .slice(0, scope === 'memories' ? 0 : limit)
      return {
        query: args.query,
        count: rows.length + sessions.length,
        semantic: semanticAvailable ? 'on' : 'off',
        ...(sessionSearch === 'on' || sessionSearch === 'skipped' ? {} : { sessionSearch }),
        memories: rows.map(row => ({ id: row.id, category: row.category, content: row.content, importance: row.importance, verification_status: row.verification_status, ...(row.source_type === 'note' ? { note: true } : {}) })),
        sessions,
      }
    },
  }))
}

/** Register the ctx_expand tool: restore the original text of events shadowed by compaction. */
export function registerExpandTool(ctx, { defineTool }, { getSessionQuery }) {
  ctx.tools.register(defineTool({
    name: 'ctx_expand',
    description: 'Restore the original text of conversation events shadowed by compaction (or simply read an older event\'s raw content). DSH event logs are append-only: a compaction replace shadows events from the surface but never deletes them — this tool reads them back. Old tool outputs reclaimed from the context end with a `[full text: ctx_expand sessionId=… seq=…]` line: pass that seq to get the complete original. Use after ctx_search session hits (their sessionId+seq addresses are accepted here) or with any session/seq you remember.',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: 'Session that owns the event.',
      },
      seq: {
        type: 'integer',
        required: true,
        description: 'Event seq to read (from ctx_search session hits).',
      },
      before: {
        type: 'integer',
        description: 'Number of preceding raw events to include. Default 0.',
      },
      after: {
        type: 'integer',
        description: 'Number of following raw events to include. Default 0.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const sessionQuery = getSessionQuery?.()
      if (sessionQuery === undefined) {
        return { error: 'session history service is not available in this composition', sessionId: args.sessionId, seq: args.seq }
      }
      try {
        const window = await sessionQuery.readEvent({
          sessionId: args.sessionId,
          seq: args.seq,
          before: typeof args.before === 'number' ? args.before : 0,
          after: typeof args.after === 'number' ? args.after : 0,
        })
        // Project to lossless JSON: raw events carry non-serializable fields.
        // user/message keeps its message at data; assistant/message,
        // tool/result and system/message nest it under data.message.
        const eventText = event => {
          const data = event.data ?? {}
          const message = data.message ?? data
          const content = message.content ?? data.text ?? null
          return {
            seq: event.seq,
            type: event.type,
            time: event.time,
            role: message.role ?? null,
            source: message.source?.kind ?? null,
            text: typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.map(part => part?.type === 'text' ? part.text : part?.type === 'tool-call' ? `[tool-call ${part.name} ${typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments ?? null)}]` : null).filter(text => text !== null).join('\n')
                : null,
          }
        }
        return {
          sessionId: args.sessionId,
          target: eventText(window.target),
          events: window.events.map(eventText),
        }
      } catch (error) {
        return { error: String(error?.message ?? error), sessionId: args.sessionId, seq: args.seq }
      }
    },
  }))
}

// The "stay in front of me for the work ahead" test and the mark/keep lists
// follow magic-context's ctx_reduce description (tools/ctx-reduce/constants.ts,
// MIT, see THIRD_PARTY_NOTICES.md), reworded for DSH's queue-and-apply model.
export const REDUCE_TOOL_DESCRIPTION = `Mark tool outputs in this conversation as no longer needed, so they leave the context instead of being carried in every later request. Marking only queues them: each output stays readable until hippocampus clears the queue on a pass that rewrites the context anyway (a history commit, a model switch, an idle gap, high pressure), and the newest outputs are held until newer work pushes them out. A cleared output becomes a short placeholder with its first and last lines and a ctx_expand pointer, so the full text can always be read back.
The question before marking is not "have I read this?" but "does this need to stay in front of me for the work ahead?" Mark: search results and directory listings once you found what you needed, build/test/log output after you acted on it, repeated or superseded dumps, file reads you will not edit or quote again, data you already wrote to disk. Keep: unresolved errors, outputs you still need to quote exactly, files you keep editing. Skill bodies and todo lists cannot be marked (the newest todo list is never cleared).
Name each target by tool and a fragment of its arguments as you wrote them (e.g. {"tool":"bash","match":"npm test"}, {"tool":"read","match":"lib/store.js"}), or by an event seq you were shown. A fragment that matches several outputs marks all of them; look at what it matches before marking broad patterns.`

/**
 * Register ctx_reduce: the agent queues tool outputs it no longer needs
 * (magic-context's ctx_reduce, ADR-11). Nothing changes on the surface
 * here: the compartment engine applies the queue on a pass whose prefix is
 * rewritten anyway, so a call never costs a cache bust of its own.
 */
export function registerReduceTool(ctx, { defineTool }, { store }) {
  ctx.tools.register(defineTool({
    name: 'ctx_reduce',
    description: REDUCE_TOOL_DESCRIPTION,
    parameters: {
      targets: {
        type: 'array',
        required: true,
        description: 'Outputs to mark. Each item: {"tool": tool name, "match": substring of the call arguments} (either may be omitted, not both), or {"seq": event seq}.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: { type: 'string', description: 'Tool name of the call whose output to mark.' },
            match: { type: 'string', description: 'Substring of the call arguments, as written in the call.' },
            seq: { type: 'integer', description: 'Event seq of the tool result (or of its original, from a placeholder).' },
          },
        },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('ctx_reduce requires an owning agent session')
      const targets = Array.isArray(args.targets) ? args.targets.slice(0, 50) : []
      if (targets.length === 0) throw new Error('ctx_reduce requires at least one target')
      // the call being executed has no result yet, so it never matches itself
      const resolved = resolveReduceTargets(session, targets)
      const queue = new Set()
      const skipped = []
      const unmatched = []
      for (const { target, results } of resolved) {
        if (results.length === 0) unmatched.push(target)
        for (const result of results) {
          if (result.skipped === undefined) queue.add(result.seq)
          else skipped.push({ seq: result.seq, tool: result.name, reason: result.skipped })
        }
      }
      const added = queue.size === 0 ? 0 : store.queueReduce(session.id, [...queue])
      return {
        queued: added,
        ...(queue.size > added ? { alreadyQueued: queue.size - added } : {}),
        outputs: resolved.flatMap(({ results }) => results.filter(result => result.skipped === undefined))
          .map(result => ({ seq: result.seq, tool: result.name, args: result.args.slice(0, 120), chars: result.chars })),
        ...(skipped.length === 0 ? {} : { skipped }),
        ...(unmatched.length === 0 ? {} : { unmatched }),
      }
    },
  }))
}

/**
 * Register the first-step baseline injection on the agent/pre-step
 * waterfall. The message enters the outgoing array behind the last claimed
 * message (the same splice agent-instructions uses), and the source-kind
 * check keeps it once per session across resume boundaries.
 */
export function registerBaselineInjection(ctx, { store, resolver }) {
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || decision.messages.length === 0) return decision
    if (hasHippocampusInjection(agent?.session, decision.messages, isBaselineSource)) return decision
    const cwd = agent?.session?.header?.cwd
    if (cwd === undefined) return decision
    signal.throwIfAborted()
    const identity = resolver.resolve(cwd)
    const text = composeBaseline(store, identity.id)
    if (text === null) return decision
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'hippocampus', baseline: true, projectId: identity.id },
    }
    const lastClaimedIndex = decision.messages.findLastIndex(entry => messages.includes(entry))
    return {
      ...decision,
      messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, message),
    }
  })
}

/**
 * Register the ctx_note tool: working notes (the magic-context ctx_note
 * minus smart notes). A note is a pending intention or a point-in-time
 * finding: it lives in the memory store with source_type 'note' so ctx_search
 * finds it, but the baseline never injects it — read as a standing rule in a
 * later session, a dated status line misleads. Durable facts go through
 * ctx_memory, which carries the admission tests.
 */
export function registerNoteTool(ctx, { defineTool }, { store, resolver }) {
  ctx.tools.register(defineTool({
    name: 'ctx_note',
    description: 'Record a working note for this project: a pending intention (something to return to later, with its findings) or a point-in-time finding worth finding again. Notes are searchable with ctx_search but are NOT injected into future sessions. Do not use notes for durable rules or facts (use ctx_memory) or for the next few steps of the current task (use todos). If the detail lives in a file, record the path instead of copying it.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The note (one concise sentence when possible).',
      },
      importance: {
        type: 'integer',
        description: '1-100; search ranking weight. Default 50.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      if (args.content === undefined || args.content === '') throw new Error('note requires content')
      const cwd = workspaceOf(exec)
      const identity = resolver.resolve(cwd)
      store.registerProject(identity.id, identity.root, identity.kind)
      const row = store.write({
        projectId: identity.id,
        category: 'PROJECT_RULES',
        content: args.content,
        importance: typeof args.importance === 'number' ? args.importance : 50,
        sourceSession: exec.agent.session.id,
        sourceType: 'note',
      })
      return row === null
        ? { action: 'note', result: 'duplicate', message: 'An active memory or note with the same content already exists; nothing was written.' }
        : { action: 'note', result: 'written', memory: { id: row.id, content: row.content, importance: row.importance } }
    },
  }))
}

/**
 * Register the auto-search hint: on the first step that carries a NEW user
 * message, run a background memory search against that message's text and,
 * when strong hits exist, append one short hook message behind it (≤ ~200
 * tokens, hooks not answers — the magic-context auto-search design, on the
 * append-only side of ADR-3). One hint per session; nothing on no hits.
 */
export function registerAutoSearchHint(ctx, { store, resolver, embeddings }) {
  const HINT_BUDGET_CHARS = 600
  const HINT_TOP_K = 3
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || decision.messages.length === 0) return decision
    const cwd = agent?.session?.header?.cwd
    if (cwd === undefined) return decision
    signal.throwIfAborted()
    // One hint per session, on its first user message (a conversation-opener
    // aid). Dedup on the hint itself: the baseline lands in the same first
    // step, so keying on any hippocampus message would suppress every hint.
    if (hasHippocampusInjection(agent?.session, decision.messages, isHintSource)) return decision
    const newOnes = decision.messages.filter(entry => !messages.includes(entry) && entry?.role === 'user')
    const target = newOnes.find(entry => entry?.source?.kind === 'user')
    if (target === undefined) return decision
    const text = extractText(target)
    if (text === '' || text.length < 8) return decision
    const identity = resolver.resolve(cwd)
    // FTS-only probe (cheap, no embedding round-trip on the hot path):
    const hits = store.search({ projectId: identity.id, query: text.slice(0, 200), limit: HINT_TOP_K })
      .filter(row => row.status === 'active')
    if (hits.length === 0) return decision
    const lines = hits.map(row => `- [m${row.id}] ${escapeInjectionTags(row.content.slice(0, 80))}`)
    const hint = `<ctx-search-hint>\nThese project memories may relate to your message (hints only; verify before relying on them):\n${lines.join('\n').slice(0, HINT_BUDGET_CHARS)}\n</ctx-search-hint>`
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: hint }],
      source: { kind: 'hippocampus', hint: true, projectId: identity.id },
    }
    const lastClaimedIndex = decision.messages.findLastIndex(entry => messages.includes(entry))
    return {
      ...decision,
      messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, message),
    }
  })
}

/** Plain text of a message (best effort, for hint probing). */
function extractText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter(part => part?.type === 'text').map(part => part.text).join(' ')
  return ''
}

/**
 * Load `defineTool` from `@deepseek-ai/dsh-tools`.
 *
 * When the plugin directory is a pnpm `link:` dependency of a profile, the
 * bare specifier does not resolve from here (pnpm's strict isolation: the
 * enclosing repo's dependencies are not the plugin's). Runtime module
 * resolution for the harness happens through the enclosing repo install,
 * so the fallbacks walk outward from this file to that install's
 * node_modules. The bare import stays first so a hoisted layout (or a
 * published package with declared dependencies) keeps working unchanged.
 * @returns {Promise<{defineTool: Function}>}
 */
async function loadDefineTool() {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch {
    // walk up from <plugin>/lib toward the enclosing install's node_modules
    const { createRequire } = await import('node:module')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(here, '..', '..', '..', 'node_modules'), // <enclosing repo>/node_modules
      join(here, '..', '..', '..', '..', 'node_modules'), // one level above (defensive)
    ]
    for (const base of candidates) {
      const require = createRequire(join(base, 'noop.js'))
      try {
        const resolved = require.resolve('@deepseek-ai/dsh-tools')
        return await import(resolved)
      } catch {
        continue
      }
    }
    throw new Error('dsh-hippocampus could not resolve @deepseek-ai/dsh-tools (bare import and repo-root fallbacks both failed)')
  }
}

/**
 * Register the dreamer: one interval per process running the 15-minute tick.
 * Requires HIPPOCAMPUS_DREAMER_PROVIDER and HIPPOCAMPUS_DREAMER_MODEL (plus
 * optional HIPPOCAMPUS_DREAMER_MAX_TOKENS) — without both the dreamer is not
 * registered at all (no interval, no LLM calls). The LLM thunk goes through
 * ctx.llm.stream with BlockAssembler-style text collection; purpose-tagged so
 * gateway accounting can tell it from user traffic.
 */
export function registerDreamer(ctx, { store }) {
  const env = ctx.get('launchEnvironment')
  const envValue = name => env?.get(name)?.value
  const dreamerProvider = envValue('HIPPOCAMPUS_DREAMER_PROVIDER')
  const dreamerModel = envValue('HIPPOCAMPUS_DREAMER_MODEL')
  // No dreamer model configured: skip registration entirely. A complete()
  // that cannot call an LLM would make every manifest parse fail and burn
  // the retry budget three times per day for nothing.
  if (dreamerProvider === undefined || dreamerModel === undefined) {
    ctx.logger?.info?.('hippocampus dreamer disabled: HIPPOCAMPUS_DREAMER_PROVIDER/MODEL not set')
    return null
  }
  const complete = async (system, user, signal) => {
    const { BlockAssembler } = await loadDshLlm()
    const options = {
      provider: dreamerProvider,
      model: dreamerModel,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens: numberFromEnv(envValue('HIPPOCAMPUS_DREAMER_MAX_TOKENS'), 4000),
      purpose: 'compaction',
      ...(signal === undefined ? {} : { signal }),
    }
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    if (assembler.finish === 'error' || assembler.finish === 'aborted') {
      throw new Error(`dreamer llm call failed: ${assembler.finish}`)
    }
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (text.trim() === '') throw new Error('dreamer llm call produced no text')
    return text
  }
  const dreamer = new Dreamer({ store, complete })
  ctx.interval(() => { void dreamer.tick() }, TICK_MS)
  return dreamer
}

/** Parse a positive integer from an env value; fall back to the default. */
function numberFromEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Resolve BlockAssembler from @deepseek-ai/dsh-llm (same fallback chain as dsh-tools). */
async function loadDshLlm() {
  try {
    return await import('@deepseek-ai/dsh-llm')
  } catch {
    const { createRequire } = await import('node:module')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    for (const base of [join(here, '..', '..', '..', 'node_modules')]) {
      const require = createRequire(join(base, 'noop.js'))
      try {
        return await import(require.resolve('@deepseek-ai/dsh-llm'))
      } catch {
        continue
      }
    }
    throw new Error('dsh-hippocampus could not resolve @deepseek-ai/dsh-llm')
  }
}

/** Resolve the dsh-compaction contract module (same fallback chain). */
async function loadDshCompaction() {
  try {
    return await import('@deepseek-ai/dsh-compaction')
  } catch {
    const { createRequire } = await import('node:module')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    for (const base of [join(here, '..', '..', '..', 'node_modules')]) {
      const require = createRequire(join(base, 'noop.js'))
      try {
        return await import(require.resolve('@deepseek-ai/dsh-compaction'))
      } catch {
        continue
      }
    }
    throw new Error('dsh-hippocampus could not resolve @deepseek-ai/dsh-compaction')
  }
}

/** Overflow recoveries per agent before the error is handed back (reset when the model answers). */
export const MAX_OVERFLOW_RETRIES = 1

/** HIPPOCAMPUS_* compaction knobs: the launch environment first, the process environment second. */
const COMPACTION_ENV_KEYS = [
  'HIPPOCAMPUS_COMPACTION',
  'HIPPOCAMPUS_BACKGROUND_TRIGGER',
  'HIPPOCAMPUS_FORCE_COMMIT',
  'HIPPOCAMPUS_RESUMMARIZE_GROWTH',
  'HIPPOCAMPUS_CACHE_TTL',
  'HIPPOCAMPUS_HISTORY_BUDGET',
  'HIPPOCAMPUS_HISTORIAN_PROVIDER',
  'HIPPOCAMPUS_HISTORIAN_MODEL',
  'HIPPOCAMPUS_HISTORIAN_FACTS',
]

function compactionEnv(ctx) {
  const launch = ctx.get?.('launchEnvironment')
  const env = {}
  for (const key of COMPACTION_ENV_KEYS) {
    const value = launch?.get?.(key)?.value ?? process.env[key]
    if (value !== undefined && value !== '') env[key] = value
  }
  return env
}

/**
 * Register the hippocampus compaction engine as ctx.compaction. The profile
 * patch disables the `compaction-basic` row (cordis rejects a second
 * provider of the same service name); the engine subclass wraps
 * HippocampusCompaction logic behind the CompactionEngine contract.
 *
 * The wrapper binds the automatic triggers exactly like compaction-basic:
 * agent/pre-step (pressure) and agent/request-error (context-overflow with
 * one retry when the surface advanced).
 */
export async function registerCompactionEngine(ctx, { store, resolver, defineTool } = {}) {
  const [compactionModule, llmModule] = await Promise.all([loadDshCompaction(), loadDshLlm()])
  const { CompactionId, compactCheckpointSource, toolPairingBalancedBefore, toolPairingBalancedAfter, CompactionEngine } = compactionModule
  const env = compactionEnv(ctx)
  const shared = {
    stream: options => ctx.llm.stream(options),
    collectText: blocks => blocks.filter(block => block.type === 'text').map(block => block.text).join('\n'),
    resolveModelInfo: (provider, model, signal) => ctx.llm.resolveModelInfo(provider, model, signal),
    measure: session => ctx.tokenMeter.measure(session),
    compactionModule: { CompactionId, compactCheckpointSource, toolPairingBalancedBefore, toolPairingBalancedAfter },
    llmModule,
    // run records feed the context panel's summarization-call section
    store,
    resolver,
    env,
  }
  const checkpointEngine = new HippocampusCompaction(shared)
  // HIPPOCAMPUS_COMPACTION=checkpoint restores the single-checkpoint engine
  // (ADR-7); the default is the compartment engine (ADR-9), which keeps the
  // checkpoint engine as its inline fallback.
  const engine = env.HIPPOCAMPUS_COMPACTION === 'checkpoint'
    ? checkpointEngine
    : new CompartmentCompaction({
      ...shared,
      fallback: checkpointEngine,
      estimateText: text => {
        try {
          return ctx.tokenMeter.estimateMessage({ id: 'estimate', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
        } catch {
          return Math.ceil(text.length / 3)
        }
      },
    })

  // only the compartment engine applies the ctx_reduce queue
  if (engine !== checkpointEngine && defineTool !== undefined && store !== undefined) registerReduceTool(ctx, { defineTool }, { store })

  class Engine extends CompactionEngine {
    static inject = ['llm', 'tokenMeter', 'sessions']
    compactIfNeeded(agent, trigger, signal) {
      return engine.compactIfNeeded(agent, trigger, signal)
    }
    compactNow(agent, signal, sourceCommandId) {
      return engine.compactNow(agent, signal)
    }
    compactRegion(start, end, agent, signal) {
      return engine.compactRegion(start, end, agent, signal)
    }
  }
  new Engine(ctx)

  // Automatic triggers (the compaction-basic shape).
  ctx.on('agent/pre-step', async ({ agent, signal, modelSelection }, next) => {
    if (!signal.aborted) {
      try {
        const result = await engine.compactIfNeeded(agent, 'pressure', signal, { modelSelection })
        if (result !== null) ctx.logger?.info?.('hippocampus compaction committed on step pressure')
      } catch (error) {
        ctx.logger?.warn?.(`hippocampus step compaction failed: ${error.message}; continuing the turn`)
      }
    }
    return next()
  })
  // One overflow recovery per agent until the model answers again (the
  // stock backend's maxOverflowRetries default): if a fold did not make the
  // request fit, folding the fresh checkpoint again would loop forever,
  // paying a model call each round.
  const overflowBudget = new OverflowBudget(MAX_OVERFLOW_RETRIES)
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'assistant/message') overflowBudget.answered(session)
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') overflowBudget.idle(agent)
  })
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
    if (failure?.code !== 'CONTEXT_WINDOW_EXCEEDED' || signal.aborted) return next()
    if (!overflowBudget.allow(agent)) return next()
    try {
      const generation = agent.session.surface.replaceGeneration
      const result = await engine.compactIfNeeded(agent, 'context-overflow', signal)
      if (result !== null || agent.session.surface.replaceGeneration !== generation) {
        overflowBudget.spend(agent)
        return { kind: 'retry' }
      }
    } catch (error) {
      ctx.logger?.warn?.(`hippocampus overflow recovery failed: ${error.message}`)
    }
    return next()
  })
  return engine
}

/**
 * Plugin entry: open the store, register tools and the baseline injection.
 * @param {object} ctx - Cordis context exposing `tools`.
 */
export async function apply(ctx) {
  const { defineTool } = await loadDefineTool()
  const store = new MemoryStore(defaultDbPath())
  const resolver = new IdentityResolver()
  const embeddings = await embeddingClientFrom(ctx)
  // sessionQuery powers the session-history search lane and ctx_expand. Its
  // fiber activates late (it injects the sessions service), and a strict
  // ctx.get from our fiber stays undefined for cross-fiber services — the
  // same class of problem as conversationViews on the client. The proven fix
  // in this plugin is the dynamic inject: capture the service instance when
  // it becomes available; the tools read the captured cell (search degrades
  // to memories-only and ctx_expand answers a friendly error until then).
  let sessionQueryCell = undefined
  ctx.inject(['sessionQuery'], queryCtx => {
    // Property access (not queryCtx.get): the injected context carries the
    // service directly on itself — the frontend-static pattern.
    sessionQueryCell = queryCtx.sessionQuery
    ctx.logger?.info?.('hippocampus: session history search enabled')
    return () => { sessionQueryCell = undefined }
  })
  const lazySessionQuery = () => sessionQueryCell

  // The context panel's live projections (tokenUsage / contextPressure /
  // contextBreakdown) and the live sessions list, captured the same way.
  let projectionsCell = undefined
  ctx.inject(['sessionProjections'], projCtx => {
    projectionsCell = projCtx.sessionProjections
    return () => { projectionsCell = undefined }
  })
  let sessionsCell = undefined
  ctx.inject(['sessions'], sessionsCtx => {
    sessionsCell = sessionsCtx.sessions
    return () => { sessionsCell = undefined }
  })
  registerMemoryTool(ctx, { defineTool }, { store, resolver, embeddings })
  registerSearchTool(ctx, { defineTool }, { store, resolver, embeddings, getSessionQuery: lazySessionQuery })
  registerExpandTool(ctx, { defineTool }, { getSessionQuery: lazySessionQuery })
  registerBaselineInjection(ctx, { store, resolver })
  registerAutoSearchHint(ctx, { store, resolver, embeddings })
  registerNoteTool(ctx, { defineTool }, { store, resolver })
  registerEmbeddingDrain(ctx, { store, embeddings })
  const dreamer = registerDreamer(ctx, { store })
  await registerCompactionEngine(ctx, { store, resolver, defineTool })
  // JSON API for the web panels. webServer + connection exist
  // only in web profiles (provided by the web bundle), so this dynamic inject
  // never fires under headless/tui. connection supplies the browser-cookie
  // fence (the same pair dsh-host-frontend-static injects).
  ctx.inject(['webServer', 'connection'], async webCtx => {
    const { registerWebApi } = await import('./webapi.js')
    return registerWebApi(webCtx, {
      store, resolver, dreamer,
      getSessionQuery: lazySessionQuery,
      getProjections: () => projectionsCell,
      getSessions: () => sessionsCell,
    })
  })
}

/**
 * Background drain of un-embedded memories (write-time embedding is
 * best-effort; anything it missed — gateway hiccup, rows from before M4 —
 * gets embedded here). One interval per process; failures retry on the next
 * tick. Idempotent per row: saveEmbedding only touches rows still active.
 */
export function registerEmbeddingDrain(ctx, { store, embeddings }) {
  if (embeddings === undefined || !embeddings.available) return
  const DRAIN_INTERVAL_MS = 5 * 60_000
  const drain = async () => {
    try {
      const projects = store.db.prepare('SELECT id FROM projects').all()
      for (const { id } of projects) {
        const pending = store.pendingEmbeddings(id)
        if (pending.length === 0) continue
        const vectors = await embeddings.embedAll(pending.map(row => row.content))
        if (vectors === null) return
        for (let i = 0; i < pending.length; i += 1) store.saveEmbedding(pending[i].id, vectors[i])
      }
    } catch {
      // retried on the next tick
    }
  }
  ctx.interval(drain, DRAIN_INTERVAL_MS)
  void drain()
}
