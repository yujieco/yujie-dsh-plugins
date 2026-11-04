/**
 * Session ports — Host half.
 *
 * Serves `GET /plugin/session-ports/list?sessionId=<id>` with the TCP ports the
 * given session is (or was) serving. Both halves of the answer are facts about
 * the machine, not about a model transcript:
 *
 *   - job side: background shells owned by the session, their command labels,
 *     and the retained output ring (dev servers print `Local: http://…`);
 *   - process side: real TCP listeners found with `lsof`/`netstat`, attributed
 *     to the session when the listener's working directory sits inside the
 *     session's working directory.
 *
 * Every candidate port is probed with a real TCP connect before it is reported
 * as running, so a stale command line never claims a live port.
 */
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Longest route prefix this plugin owns. */
const ROUTE = '/plugin/session-ports'
/** How long one scan answer is reused; several pollers share it. */
const SCAN_CACHE_MS = 1200
/** TCP connect bound for one candidate port. */
const PROBE_TIMEOUT_MS = 400
/** Upper bound for `lsof`/`netstat`, so a stuck scan cannot hold a request. */
const COMMAND_TIMEOUT_MS = 2500
/** Retention cap for one job's scanned output text. */
const MAX_JOB_TEXT = 192 * 1024
/** Ports at or above this need no keyword nearby to be trusted. */
const MIN_DEV_PORT = 1024

/** Cached whole-answer promises, keyed by session id. */
const scanCache = new Map()
/** Cached job output text, keyed by job id and validated by byte total. */
const outputCache = new Map()

export const inject = ['webServer']

/** Host loopback host names that a browser can open directly. */
const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
  'localhost.localdomain',
])

/**
 * Register the HTTP route that the browser half polls.
 * @param ctx - host context carrying `webServer`.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => handleRequest(ctx, req, res),
      }),
    'session-ports: list route',
  )

  ctx.effect(() => () => {
    scanCache.clear()
    outputCache.clear()
  }, 'session-ports: caches')
}

/**
 * Answer one HTTP request of the route.
 * @param ctx - host context.
 * @param req - incoming request.
 * @param res - response to write.
 */
async function handleRequest(ctx, req, res) {
  let url
  try {
    url = new URL(req.url ?? '/', 'http://session-ports.local')
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('bad request url')
    return
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' })
    res.end('method not allowed')
    return
  }

  if (url.pathname !== `${ROUTE}/list` && url.pathname !== `${ROUTE}/count`) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'not-found' }))
    return
  }

  const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
  if (sessionId === '') {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'missing-session' }))
    return
  }

  let payload
  try {
    payload = await cachedScan(ctx, sessionId)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        sessionId,
        error: 'scan-failed',
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    return
  }

  const body =
    url.pathname === `${ROUTE}/count`
      ? JSON.stringify({
          sessionId,
          running: payload.running,
          total: payload.ports.length,
          scannedAt: payload.scannedAt,
        })
      : JSON.stringify(payload)

  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * Share one scan between concurrent pollers for a short window.
 * @param ctx - host context.
 * @param sessionId - session whose ports are requested.
 * @returns the scan payload.
 */
function cachedScan(ctx, sessionId) {
  const now = Date.now()
  const hit = scanCache.get(sessionId)
  if (hit !== undefined && now - hit.at < SCAN_CACHE_MS) return hit.promise

  const promise = scanPorts(ctx, sessionId)
  const entry = { at: now, promise }
  scanCache.set(sessionId, entry)
  promise.catch(() => {
    if (scanCache.get(sessionId) === entry) scanCache.delete(sessionId)
  })
  if (scanCache.size > 64) {
    for (const [key, value] of scanCache) {
      if (key !== sessionId && now - value.at > 60_000) scanCache.delete(key)
    }
  }
  return promise
}

/**
 * Build the whole answer for one session.
 * @param ctx - host context.
 * @param sessionId - session whose ports are requested.
 * @returns ports, running count, and the directory the session works in.
 */
async function scanPorts(ctx, sessionId) {
  const cwd = sessionCwd(ctx, sessionId)
  /** @type {Map<number, Candidate>} */
  const candidates = new Map()

  collectJobPorts(ctx, sessionId, candidates)

  const listeners = await listListeners()
  const attributed = await attributeListeners(listeners, cwd)
  for (const listener of attributed) {
    mergePort(candidates, listener.port, {
      url: listener.url,
      listening: true,
      process: listener.command,
      source: 'listener',
      detail: `pid ${listener.pid}${listener.cwd === undefined ? '' : ` · ${listener.cwd}`}`,
      jobStatus: undefined,
      label: undefined,
    })
  }

  const ports = [...candidates.values()]
  await Promise.all(
    ports.map(async (entry) => {
      if (entry.listening === true) return
      entry.listening = await probePort(entry.port)
    }),
  )

  // A candidate whose job has already settled and whose port accepts no
  // connection is a leftover from an earlier command, not something this
  // session is serving; keep only live ports and still-running intentions.
  const visible = ports.filter(
    (entry) => entry.listening === true || entry.jobStatus === 'running',
  )

  visible.sort((left, right) => {
    if (left.listening !== right.listening) return left.listening ? -1 : 1
    return left.port - right.port
  })

  const running = visible.filter((entry) => entry.listening === true).length
  return {
    sessionId,
    scannedAt: Date.now(),
    cwd,
    running,
    total: visible.length,
    ports: visible.map((entry) => ({
      port: entry.port,
      listening: entry.listening === true,
      url: entry.url,
      process: entry.process,
      source: entry.source,
      detail: entry.detail,
      label: entry.label,
      jobStatus: entry.jobStatus,
    })),
  }
}

/**
 * @typedef {object} Candidate
 * @property {number} port
 * @property {boolean} listening
 * @property {string} url
 * @property {string | undefined} process
 * @property {'job' | 'output' | 'listener' | 'mixed'} source
 * @property {string | undefined} detail
 * @property {string | undefined} label
 * @property {string | undefined} jobStatus
 */

/**
 * Resolve the effective working directory of a live session.
 * @param ctx - host context.
 * @param sessionId - the session id.
 * @returns absolute directory, when known.
 */
function sessionCwd(ctx, sessionId) {
  let session
  try {
    session = ctx.get('sessions')?.get(sessionId)
  } catch {
    session = undefined
  }
  if (session === undefined) return undefined
  try {
    const resolved = ctx.get('workingDirectory')?.get(session)
    if (typeof resolved === 'string' && resolved !== '') return resolved
  } catch {
    /* fall through to the header */
  }
  const header = session.header?.cwd
  return typeof header === 'string' && header !== '' ? header : undefined
}

/**
 * Read the session's background jobs: their command lines and retained output.
 * @param ctx - host context.
 * @param sessionId - owning session.
 * @param candidates - accumulator.
 */
function collectJobPorts(ctx, sessionId, candidates) {
  let jobs
  try {
    jobs = ctx.get('jobs')
  } catch {
    return
  }
  if (jobs === undefined) return

  let views = []
  try {
    views = jobs.list(sessionId) ?? []
  } catch {
    return
  }

  for (const job of views) {
    if (job.owner !== undefined && job.owner !== sessionId) continue
    const status = typeof job.status === 'string' ? job.status : undefined
    const label = typeof job.label === 'string' ? job.label : undefined
    // A command line is only evidence when it STARTS a server: a `curl` that
    // merely mentions a port must not claim that port for this session.
    const serves = label !== undefined && looksLikeServerCommand(label)
    if (serves) {
      collectFromText(candidates, label, { status, label, source: 'job' })
    }
    const text = jobOutputText(jobs, job, sessionId)
    if (text !== undefined && text !== '') {
      // Output is only evidence when it reads like a server saying where it
      // listens; arbitrary tool output (an HTML dump, a JSON echo) is not.
      if (serves || looksLikeServerOutput(text)) {
        collectFromText(candidates, text, { status, label, source: 'output' })
      }
    }
  }
}

/** Commands that are conventionally responsible for opening a port. */
const SERVER_COMMAND = new RegExp(
  [
    '\\b(?:vite|next|nuxt|astro|remix|gatsby|parcel|webpack|nodemon|http-server|live-server)\\b',
    '\\bpython[0-9.]*\\s+-m\\s+http\\.server\\b',
    '\\b(?:uvicorn|gunicorn|hypercorn|waitress-serve)\\b',
    '\\bflask\\s+(?:run|--app)\\b',
    '\\b(?:django-admin|manage\\.py)\\s+runserver\\b',
    '\\brails\\s+(?:s|server)\\b',
    '\\bphp\\s+-S\\b',
    '\\b(?:ng|nest)\\s+serve\\b',
    '\\b(?:expo|react-native)\\s+start\\b',
    '\\b(?:npm|pnpm|yarn|bun)(?:\\s+run)?\\s+(?:dev|start|serve|preview|devserver)\\b',
    '\\bdeno\\s+(?:run|task)\\b',
    '\\bgo\\s+run\\b',
    '\\b(?:docker|docker-compose|podman)\\s+(?:compose\\s+)?(?:up|run|start)\\b',
    '\\bnode\\s+\\S*(?:server|app|index|main)\\.?[cm]?[jt]s\\b',
    '\\bjava\\s+-jar\\b',
    '\\bmvn\\s+spring-boot:run\\b',
    '\\b(?:dotnet|rails)\\s+(?:run|watch|server)\\b',
    '\\b(?:serve|preview)\\s+--',
  ].join('|'),
  'i',
)

/** Phrases a development server prints when it starts listening. */
const SERVER_OUTPUT = /(?:Local:|Network:|Listening on|listening at|Serving HTTP|ready in|Running on|running at|started server|Server started|http:\/\/localhost)/i

/**
 * Whether a command line is conventionally a server process.
 * @param label - the job's command text.
 * @returns the decision.
 */
function looksLikeServerCommand(label) {
  return SERVER_COMMAND.test(label)
}

/**
 * Whether output reads like a server announcing its address.
 * @param text - retained job output.
 * @returns the decision.
 */
function looksLikeServerOutput(text) {
  return SERVER_OUTPUT.test(text)
}

/**
 * Read one job's retained output ring without moving the model cursor.
 * @param jobs - registry service.
 * @param job - its projection.
 * @param sessionId - fenced caller.
 * @returns retained text, or undefined when unreadable.
 */
function jobOutputText(jobs, job, sessionId) {
  const total = typeof job.output?.total === 'number' ? job.output.total : 0
  const cached = outputCache.get(job.id)
  if (cached !== undefined && cached.total === total) return cached.text

  let text = ''
  try {
    const read = jobs.readAt(job.id, 0, sessionId)
    text = read.chunks.map((chunk) => chunk.text).join('')
  } catch {
    text = ''
  }
  if (text.length > MAX_JOB_TEXT) text = text.slice(-MAX_JOB_TEXT)
  outputCache.set(job.id, { total, text })
  if (outputCache.size > 256) {
    const firstKey = outputCache.keys().next().value
    if (firstKey !== undefined) outputCache.delete(firstKey)
  }
  return text
}

/**
 * Extract port candidates from one blob of shell text.
 * @param candidates - accumulator.
 * @param text - command line or output.
 * @param meta - job status and label carried onto each candidate.
 */
function collectFromText(candidates, text, meta) {
  if (typeof text !== 'string' || text === '') return

  // 1. Full URLs: the most trustworthy source, and the one worth opening.
  const urlPattern = /https?:\/\/[^\s"'`<>)\]}\\]+/g
  let match = urlPattern.exec(text)
  while (match !== null) {
    const absolute = normalizeLocalUrl(match[0])
    if (absolute !== undefined) {
      mergePort(candidates, absolute.port, {
        url: absolute.url,
        listening: false,
        process: undefined,
        source: meta.source,
        detail: undefined,
        label: meta.label,
        jobStatus: meta.status,
      })
    }
    match = urlPattern.exec(text)
  }

  // 2. Bare loopback host:port spellings.
  const hostPortPattern = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):(\d{2,5})\b/g
  match = hostPortPattern.exec(text)
  while (match !== null) {
    addBarePort(candidates, match[1], meta)
    match = hostPortPattern.exec(text)
  }

  // 3. Explicit flags and assignments.
  const explicitPatterns = [
    /--port[=\s]+(\d{2,5})\b/gi,
    /\bPORT\s*[=:]\s*["']?(\d{2,5})\b/gi,
    /http\.server\s+(\d{2,5})\b/gi,
    /\b(?:listen|listening|serving|serve|bound|running)\b[^\n]{0,40}?(\d{4,5})\b/gi,
  ]
  for (const pattern of explicitPatterns) {
    let hit = pattern.exec(text)
    while (hit !== null) {
      addBarePort(candidates, hit[1], meta)
      hit = pattern.exec(text)
    }
  }
}

/**
 * Add one bare port discovered next to shell text.
 * @param candidates - accumulator.
 * @param raw - captured digits.
 * @param meta - job metadata.
 */
function addBarePort(candidates, raw, meta) {
  const port = Number.parseInt(raw, 10)
  if (!isUsablePort(port)) return
  mergePort(candidates, port, {
    url: `http://localhost:${port}/`,
    listening: false,
    process: undefined,
    source: meta.source,
    detail: undefined,
    label: meta.label,
    jobStatus: meta.status,
  })
}

/**
 * Merge one observation into the per-port accumulator, keeping the richest url.
 * @param candidates - accumulator.
 * @param port - the port observed.
 * @param observation - what was learned.
 */
function mergePort(candidates, port, observation) {
  if (!isUsablePort(port)) return
  const existing = candidates.get(port)
  if (existing === undefined) {
    candidates.set(port, {
      port,
      listening: observation.listening === true,
      url: observation.url,
      process: observation.process,
      source: observation.source,
      detail: observation.detail,
      label: observation.label ?? undefined,
      jobStatus: observation.jobStatus,
    })
    return
  }
  if (observation.url !== undefined && /^https:\/\//i.test(observation.url)) existing.url = observation.url
  if (observation.listening === true) existing.listening = true
  if (observation.process !== undefined) existing.process = observation.process
  if (observation.detail !== undefined) existing.detail = observation.detail
  if (existing.label === undefined && observation.label !== undefined) existing.label = observation.label
  if (existing.jobStatus === undefined && observation.jobStatus !== undefined) existing.jobStatus = observation.jobStatus
  if (existing.source !== observation.source) existing.source = 'mixed'
}

/**
 * Reject reserved or implausible ports.
 * @param port - parsed candidate.
 * @returns whether it can be a local server port.
 */
function isUsablePort(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false
  return port >= MIN_DEV_PORT || port === 80 || port === 443
}

/**
 * Normalize an absolute URL to one this browser can open.
 * @param raw - matched URL text.
 * @returns the port and URL, or undefined for a non-local host.
 */
function normalizeLocalUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return undefined
  }
  const host = parsed.hostname.toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) return undefined
  const port = parsed.port !== '' ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80
  if (!isUsablePort(port)) return undefined
  parsed.hostname = 'localhost'
  return { port, url: parsed.toString() }
}

/**
 * Probe one loopback port with a real TCP connect.
 * @param port - candidate port.
 * @returns whether something accepts connections.
 */
async function probePort(port) {
  // A dev server bound only to `[::1]` (Vite's default on macOS) is still a
  // running port, so both loopback families count as alive.
  const results = await Promise.all([
    probeHost(port, '127.0.0.1'),
    probeHost(port, '::1'),
  ])
  return results.some(Boolean)
}

/**
 * Probe one address family.
 * @param port - candidate port.
 * @param host - loopback literal.
 * @returns whether something accepts connections.
 */
function probeHost(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

/**
 * @typedef {object} Listener
 * @property {number} port
 * @property {number} pid
 * @property {string} command
 * @property {string} url
 */

/**
 * Enumerate TCP listeners on this machine.
 * @returns listeners, empty when the platform tool is unavailable.
 */
async function listListeners() {
  try {
    return process.platform === 'win32' ? await netstatListeners() : await lsofListeners()
  } catch {
    return []
  }
}

/**
 * `lsof` listener scan used on macOS and Linux.
 * @returns listeners found.
 */
async function lsofListeners() {
  const stdout = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])
  /** @type {Listener[]} */
  const listeners = []
  let pid = 0
  let command = ''
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      pid = Number.parseInt(value, 10)
      command = ''
    } else if (tag === 'c') {
      command = value
    } else if (tag === 'n') {
      const port = portFromAddress(value)
      if (port === undefined || pid === 0) continue
      listeners.push({ pid, command, port, url: `http://localhost:${port}/` })
    }
  }
  return listeners
}

/**
 * `netstat` listener scan used on Windows.
 * @returns listeners found.
 */
async function netstatListeners() {
  const stdout = await run('netstat', ['-ano', '-p', 'tcp'])
  /** @type {Listener[]} */
  const listeners = []
  const seen = new Set()
  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 5) continue
    if (columns[0] !== 'TCP') continue
    if (!/LISTENING/i.test(columns[columns.length - 2])) continue
    const port = portFromAddress(columns[1])
    const pid = Number.parseInt(columns[columns.length - 1], 10)
    if (port === undefined || !Number.isInteger(pid)) continue
    const key = `${pid}:${port}`
    if (seen.has(key)) continue
    seen.add(key)
    listeners.push({ pid, command: `pid ${pid}`, port, url: `http://localhost:${port}/` })
  }
  return listeners
}

/**
 * Read the trailing port of an `lsof`/`netstat` address field.
 * @param address - for example `127.0.0.1:5173` or `[::1]:8080` or `*:3000`.
 * @returns the port, when it parses.
 */
function portFromAddress(address) {
  const match = /:(\d{1,5})$/.exec(address)
  if (match === null) return undefined
  const port = Number.parseInt(match[1], 10)
  return isUsablePort(port) ? port : undefined
}

/**
 * Keep the listeners whose working directory belongs to this session.
 * @param listeners - machine-wide listeners.
 * @param cwd - the session's working directory.
 * @returns attributed listeners.
 */
async function attributeListeners(listeners, cwd) {
  if (cwd === undefined || listeners.length === 0) return []
  const roots = await workspaceRoots(cwd)
  const pids = [...new Set(listeners.map((listener) => listener.pid))]
  const cwds = await lsofCwds(pids)
  const attributed = []
  for (const listener of listeners) {
    const processCwd = cwds.get(listener.pid)
    if (processCwd === undefined) continue
    if (!roots.some((root) => isInside(root, processCwd))) continue
    attributed.push({ ...listener, cwd: processCwd })
  }
  return attributed
}

/**
 * Both spellings of a working directory (macOS resolves `/tmp` to `/private/tmp`).
 * @param cwd - configured working directory.
 * @returns comparison roots.
 */
async function workspaceRoots(cwd) {
  const roots = new Set([path.resolve(cwd)])
  try {
    roots.add(await fs.realpath(cwd))
  } catch {
    /* the directory may be gone; the lexical form still stands */
  }
  return [...roots]
}

/**
 * Resolve the working directory of each listener process.
 * @param pids - process ids to inspect.
 * @returns pid to directory.
 */
async function lsofCwds(pids) {
  const result = new Map()
  if (process.platform === 'win32' || pids.length === 0) return result
  let stdout = ''
  try {
    stdout = await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'])
  } catch {
    return result
  }
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    if (line[0] === 'p') pid = Number.parseInt(line.slice(1), 10)
    else if (line[0] === 'n' && pid !== 0) result.set(pid, line.slice(1))
  }
  return result
}

/**
 * Whether a child path lives inside a root.
 * @param root - workspace directory.
 * @param candidate - process working directory.
 * @returns containment result.
 */
function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Run one bounded command and return its stdout.
 * @param command - executable name.
 * @param args - arguments.
 * @returns stdout text.
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null && (stdout === undefined || stdout === '')) {
          reject(error)
          return
        }
        resolve(stdout ?? '')
      },
    )
  })
}
