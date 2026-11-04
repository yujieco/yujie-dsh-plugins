/**
 * Host endpoints the right-sidebar panel polls.
 *
 * The panel lives in the Web client, so it needs a plain HTTP view of the browser
 * session: a small JSON status document and a PNG of the current viewport. Both
 * are read-only, session-keyed, and never launch a browser — the panel only shows
 * a session that already exists, which keeps an idle open tab from starting
 * Chrome.
 * @module yujie-dsh-plugin-cdp/lib/panel
 */
import { capturePage } from './cdp/page.js'

/** Route prefix this plugin owns. */
export const PANEL_PREFIX = '/plugin/cdp'

/** Screenshot cache window; the panel polls every two seconds. */
const SHOT_CACHE_MS = 800

/** Per-session last screenshot, keyed by session id + width. */
const shotCache = new Map()

/**
 * Register the panel's HTTP routes.
 * @param {any} ctx - plugin context.
 * @param {any} hub - the browser hub.
 */
export function registerPanelRoutes(ctx, hub) {
  ctx.inject(['webServer'], (child) => {
    child.effect(
      () => child.webServer.register({
        kind: 'prefix',
        path: PANEL_PREFIX,
        handler: (req, res) => {
          handlePanelRequest(hub, req, res).catch(error => {
            writeResponse(res, 500, 'text/plain; charset=utf-8', Buffer.from(String(error?.message ?? error)))
          })
        },
      }),
      'yujie-dsh-plugin-cdp: panel routes',
    )
  })
  ctx.effect(() => () => shotCache.clear(), 'yujie-dsh-plugin-cdp: panel cache')
}

/**
 * Write one response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {string} contentType - content type.
 * @param {Buffer} body - response body.
 */
function writeResponse(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Answer one panel request.
 * @param {any} hub - the browser hub.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @returns {Promise<void>} resolves after the response is written.
 */
async function handlePanelRequest(hub, req, res) {
  const url = new URL(req.url ?? '/', 'http://cdp.local')
  if (req.method !== 'GET') {
    writeResponse(res, 405, 'text/plain; charset=utf-8', Buffer.from('method not allowed'))
    return
  }
  const action = url.pathname.slice(PANEL_PREFIX.length + 1)
  const sessionKey = url.searchParams.get('session') ?? ''
  if (action === 'state') {
    writeResponse(res, 200, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(await readState(hub, sessionKey))))
    return
  }
  if (action === 'shot') {
    const shot = await readShot(hub, sessionKey, Number(url.searchParams.get('w') ?? 720))
    if (shot === undefined) {
      writeResponse(res, 204, 'text/plain; charset=utf-8', Buffer.alloc(0))
      return
    }
    writeResponse(res, 200, 'image/png', shot)
    return
  }
  writeResponse(res, 404, 'text/plain; charset=utf-8', Buffer.from('unknown cdp route'))
}

/**
 * Build the status document for one session.
 * @param {any} hub - the browser hub.
 * @param {string} sessionKey - agent session id.
 * @returns {Promise<object>} the status.
 */
async function readState(hub, sessionKey) {
  const session = hub.getExisting(sessionKey)
  if (session === undefined) {
    return { ok: true, connected: false, errors: [], pages: [], ts: Date.now() }
  }
  let pages = []
  try {
    pages = await session.listPages()
  } catch {
    pages = []
  }
  const errors = session.readEvents({ level: 'error', limit: 5 }).items.map(item => ({
    id: item.id,
    kind: item.kind,
    text: String(item.text ?? '').slice(0, 300),
    at: item.at,
  }))
  return {
    ok: true,
    connected: session.connected,
    browser: session.version?.browser ?? '',
    launched: session.launched === true,
    current: session.currentTargetId ?? '',
    pages,
    errors,
    ts: Date.now(),
  }
}

/**
 * Capture (or replay from a short cache) the current viewport as PNG.
 * @param {any} hub - the browser hub.
 * @param {string} sessionKey - agent session id.
 * @param {number} width - target image width.
 * @returns {Promise<Buffer | undefined>} the PNG, or undefined when no session is live.
 */
async function readShot(hub, sessionKey, width) {
  const session = hub.getExisting(sessionKey)
  if (session === undefined || session.connected !== true) return undefined
  const clamped = Math.max(320, Math.min(width, 1600))
  const cacheKey = `${sessionKey}:${clamped}`
  const cached = shotCache.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at < SHOT_CACHE_MS) return cached.data
  try {
    const info = await session.info()
    const scale = info.viewport.width > clamped ? clamped / info.viewport.width : 1
    const shot = await capturePage(session.send.bind(session), { scale, format: 'png' })
    shotCache.set(cacheKey, { at: Date.now(), data: shot.data })
    return shot.data
  } catch {
    return undefined
  }
}
