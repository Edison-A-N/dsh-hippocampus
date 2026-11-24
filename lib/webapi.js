/**
 * JSON API over the hippocampus store for the web panels, served under the
 * webServer's named-route namespace so the panels can browse and edit
 * memories without going through a model turn.
 *
 * Every route passes two fences before its handler: the connection
 * service's Host/Origin check (`requestRejection`, the same fence the host's
 * own API routes use) and the browser login cookie (`authorizeIndex`).
 * Write routes additionally require a JSON body (`content-type:
 * application/json`), which a cross-site HTML form cannot send without a
 * CORS preflight.
 *
 * Read routes (GET):
 * - `/plugins/hippocampus/api/projects`: registered projects
 * - `/plugins/hippocampus/api/resolve?path=<cwd>`: resolve a workspace to
 *   its project identity (registers the project)
 * - `/plugins/hippocampus/api/memories?project=<id>&category=<cat>`: active
 *   (or archived with `?status=archived`) memory rows, projected the same
 *   way ctx_memory projects them (no embedding BLOBs on the wire)
 * - `/plugins/hippocampus/api/stats?project=<id>`: counts per category and
 *   embedding coverage
 * - `/plugins/hippocampus/api/context?session=<id>&project=<id>`: the
 *   compaction panel's data
 *
 * Write routes (POST, JSON body):
 * - `/plugins/hippocampus/api/memories/edit`: change content, category or
 *   importance of one memory
 * - `/plugins/hippocampus/api/memories/archive`: archive (soft-delete) one
 *   memory
 * - `/plugins/hippocampus/api/dreamer/run`: run one dreamer task now (a
 *   model call)
 *
 * DSH is single-user: a logged-in browser may read and edit every project's
 * pool. Registered only when the webServer service exists (web profile);
 * headless profiles never mount this.
 * @module dsh-hippocampus/webapi
 */

/** Wire shape of one memory row (mirrors the ctx_memory projection). */
function memoryRow(row) {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    importance: row.importance,
    status: row.status,
    created_at: row.created_at,
    invalid_at: row.invalid_at,
    last_accessed: row.last_accessed,
    source_type: row.source_type,
    verification_status: row.verification_status,
    verified_at: row.verified_at,
    superseded_by: row.superseded_by,
    archive_reason: row.archive_reason,
  }
}

/** Whether a request declares a JSON body (`application/json`, any parameters). */
function isJsonRequest(req) {
  const type = req.headers?.['content-type']
  return typeof type === 'string' && type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/** Send one JSON response. */
function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * Register the read-only API routes. Requires both the webServer (route
 * registration) and connection (browser-cookie authentication) services —
 * the same pair dsh-host-frontend-static injects.
 * @param {object} ctx - Cordis context carrying `webServer` and `connection`.
 * @param {object} options
 * @param {import('./store.js').MemoryStore} options.store
 * @param {import('./identity.js').IdentityResolver} options.resolver
 * @param {() => unknown} [options.getSessionQuery] - lazy sessionQuery capture
 *   (powers the context-history endpoint)
 * @param {() => unknown} [options.getProjections] - lazy sessionProjections
 *   capture (live token/pressure/breakdown for the context panel)
 * @param {() => unknown} [options.getSessions] - lazy sessions capture (live
 *   session lookup for the projections snapshot)
 * @param {import('./dreamer.js').Dreamer} [options.dreamer] - for run records
 */
/** Newest compaction/* events returned per session (start + summary + end per commit). */
const COMPACTION_EVENT_CAP = 300

/** First 300 characters of a compaction summary's text blocks. */
function summarySnippet(blocks) {
  if (!Array.isArray(blocks)) return null
  const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join(' ').trim()
  return text === '' ? null : text.slice(0, 300)
}

export function registerWebApi(ctx, { store, resolver, getSessionQuery, getProjections, getSessions, dreamer }) {
  const routes = []

  /** Wrap a handler with the request fences + JSON error fencing. */
  const route = (method, path, handler) => {
    const disposer = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          // Host/Origin fence first (DNS rebinding, cross-site requests): the
          // check the host applies to its own API routes. Then the browser
          // login cookie: authorizeIndex checks it and on failure writes the
          // 401 itself, the call pattern dsh-host-frontend-static uses.
          const rejection = ctx.connection.requestRejection?.(req)
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
            return
          }
          if (!ctx.connection.authorizeIndex(req, res)) return
          if (req.method !== method) {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          if (method === 'POST' && !isJsonRequest(req)) {
            sendJson(res, 415, { error: 'content-type must be application/json' })
            return
          }
          await handler(req, res)
        } catch (error) {
          // Details go to the host log; the browser gets no paths or stack.
          ctx.logger?.warn?.(`hippocampus web api ${method} ${path} failed: ${error?.stack ?? error}`)
          sendJson(res, 500, { error: 'internal error' })
        }
      },
    })
    routes.push(disposer)
  }

  const parseQuery = req => new URL(req.url ?? '/', 'http://localhost').searchParams

  route('GET', '/plugins/hippocampus/api/projects', (req, res) => {
    const rows = store.db.prepare('SELECT id, root, kind FROM projects').all()
    sendJson(res, 200, { projects: rows })
  })

  route('GET', '/plugins/hippocampus/api/resolve', (req, res) => {
    // Resolve a session workspace path (its cwd) to the owning project
    // identity — the same resolution ctx_memory applies to tool calls, so
    // the panel always shows the memories of the project the open session
    // belongs to, never another project's pool.
    const params = parseQuery(req)
    const path = params.get('path')
    if (path === null || path === '') {
      sendJson(res, 400, { error: 'path query parameter is required' })
      return
    }
    const identity = resolver.resolve(path)
    store.registerProject(identity.id, identity.root, identity.kind)
    sendJson(res, 200, { project: { id: identity.id, root: identity.root, kind: identity.kind } })
  })

  route('GET', '/plugins/hippocampus/api/memories', (req, res) => {
    const params = parseQuery(req)
    const project = params.get('project')
    if (project === null) {
      sendJson(res, 400, { error: 'project query parameter is required' })
      return
    }
    const category = params.get('category')
    const status = params.get('status') ?? 'active'
    const rows = store.list({ projectId: project, category, status })
    sendJson(res, 200, { count: rows.length, memories: rows.map(memoryRow) })
  })

  route('GET', '/plugins/hippocampus/api/stats', (req, res) => {
    const params = parseQuery(req)
    const project = params.get('project')
    if (project === null) {
      sendJson(res, 400, { error: 'project query parameter is required' })
      return
    }
    const byCategory = {}
    for (const row of store.list({ projectId: project })) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
    }
    const archived = store.list({ projectId: project, status: 'archived' }).length
    const pending = store.pendingEmbeddings(project).length
    sendJson(res, 200, { byCategory, archived, pendingEmbeddings: pending })
  })

  // The compaction panel's data. Sections:
  // - tokens: the tokenMeter projections (usage / pressure / breakdown) for a
  //   LIVE session through the sessionProjections service, or a log-derived
  //   fallback (usage accumulated from assistant/message usage rows, the
  //   newest request header's model) for closed sessions.
  // - cache: per-model-call cache hit rows from assistant/message usage
  //   (uncached input / cache read / cache write); a compaction between two
  //   rows marks the later one as a bust (prefix rewrite).
  // - compactions: this session's compaction timeline from the append-only log.
  // - compactionRuns: summarization call records (model, duration, usage).
  // - dreamRuns: the project's dreamer run records.
  route('GET', '/plugins/hippocampus/api/context', async (req, res) => {
    const params = parseQuery(req)
    const session = params.get('session')
    const project = params.get('project')
    if (session === null || project === null) {
      sendJson(res, 400, { error: 'session and project query parameters are required' })
      return
    }
    const sessionQuery = getSessionQuery?.()

    // --- tokens + cache, live-session projections first ---
    let tokens = null
    let cache = { rows: [], busts: 0 }
    const projections = getProjections?.()
    if (projections !== undefined) {
      try {
        const live = getSessions?.()?.get(session)
        if (live !== undefined) {
          const snapshot = projections.snapshot(live, ['tokenUsage', 'contextPressure', 'contextBreakdown'])
          const values = snapshot.values
          tokens = {
            usage: values.tokenUsage ?? null,
            pressure: values.contextPressure ?? null,
            breakdown: values.contextBreakdown ?? null,
          }
        }
      } catch {
        // live projection unavailable: fall through to the log-derived path
      }
    }
    let model = null
    let totalUsage = null
    // Compaction timeline, read from the same log as the cache rows so the
    // panel's prefix-rewrite count and bust count share one source. (The
    // host search index does not index compaction/* events, so a
    // searchEvents query cannot find them.)
    let compactions = []
    if (sessionQuery !== undefined) {
      try {
        const log = await sessionQuery.readSession(session)
        let uncached = 0
        let output = 0
        let read = 0
        let write = 0
        const rows = []
        for (const event of log.events) {
          if (event.type === 'request/header' && model === null) model = event.data?.header?.config?.model ?? null
          if (event.type === 'assistant/message') {
            const usage = event.data?.usage
            if (usage !== undefined) {
              uncached += usage.inputTokens ?? 0
              output += usage.outputTokens ?? 0
              read += usage.cacheReadTokens ?? 0
              write += usage.cacheWriteTokens ?? 0
              const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
              rows.push({
                seq: event.seq,
                time: event.time,
                input,
                cacheRead: usage.cacheReadTokens ?? 0,
                cacheWrite: usage.cacheWriteTokens ?? 0,
                hitRate: input > 0 ? (usage.cacheReadTokens ?? 0) / input : 0,
                bust: false,
              })
            }
          }
        }
        totalUsage = { uncachedInputTokens: uncached, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write }
        // Mark busts: a replace (compaction checkpoint, or any other surface
        // rewrite) between two usage rows means the prefix changed under the
        // cache — the next model call re-pays the cache write. One row per
        // replace, never more.
        const replaceSeqs = new Set()
        for (const event of log.events) {
          if (event.surfaceOp?.op === 'replace') replaceSeqs.add(event.seq)
        }
        let cursor = 0
        let pendingReplace = false
        for (const row of rows) {
          while (cursor < log.events.length && log.events[cursor].seq < row.seq) {
            if (replaceSeqs.has(log.events[cursor].seq)) pendingReplace = true
            cursor += 1
          }
          if (pendingReplace) {
            row.bust = true
            pendingReplace = false
          }
        }
        cache = { rows: rows.slice(-120), busts: rows.filter(r => r.bust).length }
        // A batch of tool-output prunes (hippocampus reclaim or the stock
        // pruner: compaction/prune + replacement pairs appended back to back)
        // is one prefix rewrite: collapse it into one timeline row.
        const timeline = []
        for (const event of log.events) {
          if (event.type === 'compaction/prune') {
            const last = timeline.at(-1)
            if (last?.type === 'compaction/prune' && last.lastSeq === event.seq - 2) {
              last.count += 1
              last.lastSeq = event.seq
            } else {
              // right after a checkpoint commit it rides the same rewrite
              const ridesCommit = last?.type === 'compaction/end' && last.seq === event.seq - 1
              timeline.push({ seq: event.seq, type: event.type, time: event.time, count: 1, lastSeq: event.seq, ridesCommit })
            }
            continue
          }
          if (event.type === 'compaction/summary' || event.type === 'compaction/start' || event.type === 'compaction/end') {
            timeline.push({ seq: event.seq, type: event.type, time: event.time, snippet: event.type === 'compaction/summary' ? summarySnippet(event.data?.summary) : null })
          }
        }
        compactions = timeline
          .slice(-COMPACTION_EVENT_CAP)
          .map(({ lastSeq, count, ridesCommit, ...hit }) => hit.type === 'compaction/prune'
            ? { ...hit, ridesCommit, snippet: `${count} tool result${count === 1 ? '' : 's'} pruned${ridesCommit ? ' (with the commit above)' : ''}` }
            : hit)
      } catch {
        // session log unavailable (cold, corrupted): tokens/cache stay null
      }
    }
    if (tokens === null && totalUsage !== null) {
      tokens = { usage: totalUsage, pressure: null, breakdown: null }
    }
    if (tokens?.usage == null && totalUsage !== null) tokens = { ...tokens, usage: totalUsage }

    // --- summarization call records + dreamer runs ---
    const compactionRuns = store.compactionRuns(session, 20).map(row => ({
      id: row.id,
      mode: row.mode,
      provider: row.provider,
      model: row.model,
      status: row.status,
      summary: (() => { try { return JSON.parse(row.summary_json ?? 'null') } catch { return null } })(),
      error: row.error,
      usage: (() => { try { return JSON.parse(row.usage_json ?? 'null') } catch { return null } })(),
      durationMs: row.duration_ms,
      shadowedStart: row.shadowed_start,
      shadowedEnd: row.shadowed_end,
      ranAt: row.ran_at,
    }))
    // dreamer is null when no dreamer model is configured (it does not
    // register); the panel then shows an empty run list.
    const dreamRuns = dreamer != null
      ? dreamer.recentRuns(project, 50).map(row => ({
        id: row.id,
        task: row.task,
        status: row.status,
        result: (() => { try { return JSON.parse(row.result_json ?? 'null') } catch { return null } })(),
        ranAt: row.ran_at,
      }))
      : []
    sendJson(res, 200, { tokens, model, cache, compactions, compactionRuns, dreamRuns })
  })

  // ── write routes (the panel's edit/archive/trigger affordances) ────────────
  // Read one JSON body, size-capped so a runaway client cannot buffer the
  // world; the route fence above already checked Host/Origin, the cookie and
  // the content type.
  const readJsonBody = async req => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text.trim() === '' ? {} : JSON.parse(text))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })

  /** The row-projection shared by the edit and archive routes. */
  const editedRow = row => row === null ? null : {
    id: row.id,
    category: row.category,
    content: row.content,
    importance: row.importance,
    status: row.status,
  }

  // Exact-path routes: the webServer table rejects duplicate paths, so the
  // write variants live on their own paths (…/edit, …/archive) instead of
  // method-overloading the GET …/memories route.
  route('POST', '/plugins/hippocampus/api/memories/edit', async (req, res) => {
    const body = await readJsonBody(req)
    if (typeof body.id !== 'number' || !Number.isInteger(body.id)) {
      sendJson(res, 400, { error: 'id (integer) is required' })
      return
    }
    if (body.content !== undefined && (typeof body.content !== 'string' || body.content.trim() === '')) {
      sendJson(res, 400, { error: 'content must be a non-empty string' })
      return
    }
    if (body.importance !== undefined && (typeof body.importance !== 'number' || body.importance < 1 || body.importance > 100)) {
      sendJson(res, 400, { error: 'importance must be a number in 1..100' })
      return
    }
    if (body.category !== undefined && typeof body.category !== 'string') {
      sendJson(res, 400, { error: 'category must be a string' })
      return
    }
    const before = store.get(body.id)
    if (before === null) {
      sendJson(res, 404, { error: `no memory with id ${body.id}` })
      return
    }
    try {
      const row = store.update(body.id, {
        ...(body.content === undefined ? {} : { content: body.content }),
        ...(body.category === undefined ? {} : { category: body.category }),
        ...(body.importance === undefined ? {} : { importance: body.importance }),
      })
      sendJson(res, 200, { memory: editedRow(row) })
    } catch (error) {
      // update() throws on an unknown category or a duplicate-normalized
      // conflict — both are client errors.
      sendJson(res, 409, { error: String(error?.message ?? error) })
    }
  })

  route('POST', '/plugins/hippocampus/api/memories/archive', async (req, res) => {
    const body = await readJsonBody(req)
    if (typeof body.id !== 'number' || !Number.isInteger(body.id)) {
      sendJson(res, 400, { error: 'id (integer) is required' })
      return
    }
    const before = store.get(body.id)
    if (before === null) {
      sendJson(res, 404, { error: `no memory with id ${body.id}` })
      return
    }
    const row = store.archive(body.id)
    sendJson(res, 200, { memory: editedRow(row) })
  })

  route('POST', '/plugins/hippocampus/api/dreamer/run', async (req, res) => {
    if (dreamer == null) {
      sendJson(res, 503, { error: 'dreamer is not configured (set HIPPOCAMPUS_DREAMER_PROVIDER/MODEL)' })
      return
    }
    const body = await readJsonBody(req)
    if (typeof body.project !== 'string' || body.project === '') {
      sendJson(res, 400, { error: 'project is required' })
      return
    }
    const task = body.task === 'curate' ? 'curate' : 'verify'
    try {
      const run = await dreamer.runNow(body.project, task)
      sendJson(res, 200, run)
    } catch (error) {
      sendJson(res, 409, { error: String(error?.message ?? error) })
    }
  })

  return () => { for (const dispose of routes) dispose() }
}
