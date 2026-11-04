/**
 * Browser sessions owned by the plugin.
 *
 * A hub keeps one browser session per agent (or one shared session) alive across
 * tool calls. A session holds the browser-level websocket, the flattened target
 * sessions for its tabs, a serial command queue so input never interleaves, and a
 * bounded event log fed by the protocol events of every attached target.
 * @module yujie-dsh-plugin-cdp/lib/cdp/hub
 */
import { CdpConnection } from './ws.js'
import { attachBrowser, launchBrowser, readTargets, readVersion, describeInstalledBrowsers } from './launcher.js'
import { EventLog, formatConsole, formatException, formatLogEntry, formatNetworkFailure } from './events.js'

/** Events every attached target reports through. */
const SUBSCRIBED_EVENTS = [
  'Runtime.exceptionThrown',
  'Runtime.consoleAPICalled',
  'Log.entryAdded',
  'Network.requestWillBeSent',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Page.javascriptDialogOpening',
  'Page.frameNavigated',
  'Target.targetDestroyed',
]

/** The plugin's browser hub: sessions keyed by agent. */
export class BrowserHub {
  /**
   * @param {object} config - resolved plugin config.
   */
  constructor(config) {
    this.config = config
    this.sessions = new Map()
  }

  /**
   * The session key for one agent.
   * @param {{ id?: string } | undefined} agent - calling agent.
   * @returns {string} session key.
   */
  keyFor(agent) {
    if (this.config.sharing === 'shared') return 'shared'
    return String(agent?.id ?? 'anonymous')
  }

  /**
   * Get or create the session for one agent.
   * @param {{ id?: string } | undefined} agent - calling agent.
   * @returns {BrowserSession} the session.
   */
  sessionFor(agent) {
    const key = this.keyFor(agent)
    let session = this.sessions.get(key)
    if (session === undefined || session.closed === true) {
      session = new BrowserSession(this, key, this.config)
      this.sessions.set(key, session)
    }
    return session
  }

  /**
   * Describe the browsers this machine can drive.
   * @returns {string} diagnostics line.
   */
  describeBrowsers() {
    return describeInstalledBrowsers()
  }

  /**
   * The live session for one key, if one exists.
   * @param {string} key - agent session key.
   * @returns {BrowserSession | undefined} the session, or undefined.
   */
  getExisting(key) {
    const session = this.sessions.get(key)
    return session === undefined || session.closed === true ? undefined : session
  }

  /** Close every browser this hub started. */
  async disposeAll() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map(session => session.close().catch(() => {})))
  }
}

/** One agent's browser session. */
export class BrowserSession {
  /**
   * @param {BrowserHub} hub - owning hub.
   * @param {string} key - session key.
   * @param {object} config - resolved plugin config.
   */
  constructor(hub, key, config) {
    this.hub = hub
    this.key = key
    this.config = config
    this.cdp = undefined
    this.port = undefined
    this.kind = undefined
    this.profileDir = undefined
    this.version = undefined
    this.launched = false
    this.stopBrowser = undefined
    this.sessions = new Map()
    this.currentTargetId = undefined
    this.log = new EventLog({ maxEvents: config.maxEvents ?? 500 })
    this.requests = new Map()
    this.inflight = 0
    this.chain = Promise.resolve()
    this.closed = false
  }

  /** Whether a live connection exists. */
  get connected() {
    return this.cdp !== undefined && this.cdp.closed === false
  }

  /**
   * Serialize one state-changing operation.
   * @template T
   * @param {() => Promise<T>} operation - work to run alone.
   * @returns {Promise<T>} the operation result.
   */
  enqueue(operation) {
    const run = this.chain.then(operation, operation)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Make sure a browser is reachable and a page is attached.
   * @param {{ browser?: 'auto'|'chrome'|'edge', headless?: boolean, port?: number, userDataDir?: string, startupUrl?: string, attachPort?: number, noSandbox?: boolean, disableExtensions?: boolean }} [options] - launch or attach options.
   * @returns {Promise<BrowserSession>} this session.
   */
  async ensure(options = {}) {
    if (this.connected) return this
    if (this.closed) throw new Error('this browser session was closed; call browser_launch again')
    if (Number.isInteger(options.attachPort) && options.attachPort > 0) {
      await this.connect(options.attachPort, undefined)
      return this
    }
    const launched = await launchBrowser({
      browser: options.browser ?? this.config.browser,
      headless: options.headless ?? this.config.headless,
      port: options.port ?? this.config.port ?? 0,
      userDataDir: options.userDataDir ?? this.config.userDataDir,
      startupUrl: options.startupUrl ?? 'about:blank',
      noSandbox: options.noSandbox ?? this.config.noSandbox,
      disableExtensions: options.disableExtensions ?? this.config.disableExtensions,
      launchTimeoutMs: this.config.launchTimeoutMs ?? 20000,
    })
    this.launched = launched.attached !== true
    this.stopBrowser = launched.stop
    this.kind = launched.kind
    this.profileDir = launched.profileDir
    await this.connect(launched.port, launched.version)
    this.stderrTail = launched.stderrTail
    return this
  }

  /**
   * Open the browser-level connection and attach a page.
   * @param {number} port - DevTools port.
   * @param {Awaited<ReturnType<typeof readVersion>> | undefined} [knownVersion] - version already read.
   * @returns {Promise<void>} resolves when a page is attached.
   */
  async connect(port, knownVersion) {
    const version = knownVersion ?? await readVersion(port)
    this.port = port
    this.version = version
    this.cdp = await CdpConnection.open(version.webSocketDebuggerUrl, { timeoutMs: this.config.commandTimeoutMs ?? 20000 })
    this.cdp.onClose(() => {
      this.sessions.clear()
      this.currentTargetId = undefined
    })
    this.#subscribe()
    const pages = (await readTargets(port)).filter(target => target.type === 'page')
    const preferred = pages.find(page => page.url !== 'about:blank') ?? pages[0]
    if (preferred === undefined) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' })
      await this.attach(created.targetId)
    } else {
      await this.attach(preferred.id)
    }
  }

  /** Subscribe the session-level protocol events once per connection. */
  #subscribe() {
    const cdp = this.cdp
    if (cdp === undefined) return
    const targetOf = sessionId => this.#targetOf(sessionId)
    cdp.on('Runtime.exceptionThrown', (params, sessionId) => {
      this.log.push({ targetId: targetOf(sessionId), ...formatException(params.exceptionDetails) })
    })
    cdp.on('Runtime.consoleAPICalled', (params, sessionId) => {
      this.log.push({ targetId: targetOf(sessionId), ...formatConsole(params) })
    })
    cdp.on('Log.entryAdded', (params, sessionId) => {
      this.log.push({ targetId: targetOf(sessionId), ...formatLogEntry(params.entry) })
    })
    cdp.on('Network.requestWillBeSent', (params, sessionId) => {
      const url = String(params?.request?.url ?? '')
      this.requests.set(params.requestId, url)
      this.inflight += 1
      void sessionId
    })
    cdp.on('Network.loadingFinished', (params) => {
      this.requests.delete(params.requestId)
      this.inflight = Math.max(0, this.inflight - 1)
    })
    cdp.on('Network.loadingFailed', (params, sessionId) => {
      const url = this.requests.get(params.requestId) ?? ''
      this.requests.delete(params.requestId)
      this.inflight = Math.max(0, this.inflight - 1)
      this.log.push({ targetId: targetOf(sessionId), ...formatNetworkFailure(params, url) })
    })
    cdp.on('Page.javascriptDialogOpening', (params, sessionId) => {
      this.log.push({
        targetId: targetOf(sessionId),
        kind: 'dialog',
        level: 'warn',
        text: `${params.type}: ${String(params.message ?? '').slice(0, 500)}`,
        detail: 'the plugin answered this dialog automatically',
      })
      if (this.config.autoAcceptDialogs === false) return
      void cdp.send('Page.handleJavaScriptDialog', { accept: true }, sessionId ?? undefined).catch(() => {})
    })
    cdp.on('Target.targetDestroyed', (params) => {
      this.sessions.delete(params.targetId)
      if (this.currentTargetId === params.targetId) this.currentTargetId = undefined
    })
    cdp.on('Page.frameNavigated', () => {
      // The address and title are read on demand; navigation events only keep the log honest.
    })
  }

  /**
   * Map a protocol session id back to its target id.
   * @param {string | undefined} sessionId - flattened session id.
   * @returns {string | undefined} the target id.
   */
  #targetOf(sessionId) {
    if (sessionId === undefined) return this.currentTargetId
    for (const [targetId, id] of this.sessions) {
      if (id === sessionId) return targetId
    }
    return this.currentTargetId
  }

  /**
   * Attach to one page target and enable the domains the tools rely on.
   * @param {string} targetId - page target.
   * @returns {Promise<void>} resolves once attached.
   */
  async attach(targetId) {
    if (this.cdp === undefined) throw new Error('no browser connection; call browser_launch first')
    const existing = this.sessions.get(targetId)
    if (existing !== undefined) {
      this.currentTargetId = targetId
      return
    }
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    this.sessions.set(targetId, sessionId)
    this.currentTargetId = targetId
    const run = (method, params) => this.cdp.send(method, params ?? {}, sessionId)
    await run('Runtime.enable')
    await run('Page.enable')
    await run('Log.enable')
    if (this.config.collectNetwork !== false) {
      await run('Network.enable', { maxTotalBufferSize: 10000000, maxResourceBufferSize: 5000000 })
    }
  }

  /**
   * Send a command into the current target session.
   * @param {string} method - CDP method.
   * @param {object} [params] - parameters.
   * @returns {Promise<any>} the command result.
   */
  async send(method, params = {}) {
    if (this.cdp === undefined) throw new Error('no browser connection; call browser_launch first')
    if (this.currentTargetId === undefined) await this.useFirstPage()
    const sessionId = this.sessions.get(this.currentTargetId)
    if (sessionId === undefined) throw new Error('the selected page is gone; call browser_pages to list pages')
    return await this.cdp.send(method, params, sessionId)
  }

  /** Attach the first available page, creating one when the browser has none. */
  async useFirstPage() {
    const pages = await this.listPages()
    if (pages.length === 0) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' })
      await this.attach(created.targetId)
      return
    }
    await this.attach(pages[0].id)
  }

  /**
   * List page targets.
   * @returns {Promise<Array<{ id: string, title: string, url: string, current: boolean }>>} pages.
   */
  async listPages() {
    if (this.port === undefined) throw new Error('no browser connection; call browser_launch first')
    const targets = (await readTargets(this.port)).filter(target => target.type === 'page')
    return targets.map(target => ({ ...target, current: target.id === this.currentTargetId }))
  }

  /**
   * Open a new page and make it current.
   * @param {string} [url] - first address.
   * @returns {Promise<{ id: string }>} the new target.
   */
  async newPage(url = 'about:blank') {
    if (this.cdp === undefined) throw new Error('no browser connection; call browser_launch first')
    const created = await this.cdp.send('Target.createTarget', { url })
    await this.attach(created.targetId)
    return { id: created.targetId }
  }

  /**
   * Close one page.
   * @param {string} targetId - target to close.
   * @returns {Promise<void>} resolves when closed.
   */
  async closePage(targetId) {
    if (this.cdp === undefined) throw new Error('no browser connection; call browser_launch first')
    await this.cdp.send('Target.closeTarget', { targetId })
    this.sessions.delete(targetId)
    if (this.currentTargetId === targetId) this.currentTargetId = undefined
  }

  /**
   * Select one page as current.
   * @param {string} targetId - target to select.
   * @returns {Promise<void>} resolves when attached.
   */
  async selectPage(targetId) {
    await this.attach(targetId)
  }

  /**
   * Navigate the current page and wait for its load event.
   * @param {string} url - destination.
   * @param {{ waitUntil?: 'load'|'networkIdle', timeoutMs?: number }} [options] - wait policy.
   * @returns {Promise<{ url: string, title: string, timedOut: boolean }>} the settled page.
   */
  async navigate(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.navigationTimeoutMs ?? 20000
    const sessionId = this.sessions.get(this.currentTargetId)
    if (sessionId === undefined) throw new Error('no page attached; call browser_pages first')
    const load = this.cdp.waitFor('Page.loadEventFired', (_params, sid) => sid === sessionId, timeoutMs).catch(() => 'timeout')
    const result = await this.send('Page.navigate', { url })
    if (typeof result.errorText === 'string' && result.errorText !== '') throw new Error(`navigation failed: ${result.errorText}`)
    const loaded = await load
    const timedOut = loaded === 'timeout'
    if (options.waitUntil === 'networkIdle') await this.waitForQuiet(timeoutMs)
    const info = await this.info()
    return { ...info, timedOut }
  }

  /**
   * Wait until no request is in flight for a short quiet window.
   * @param {number} timeoutMs - overall deadline.
   * @returns {Promise<boolean>} whether the page went quiet.
   */
  async waitForQuiet(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    let quietSince = undefined
    while (Date.now() < deadline) {
      if (this.inflight === 0) {
        quietSince ??= Date.now()
        if (Date.now() - quietSince >= 300) return true
      } else {
        quietSince = undefined
      }
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    return false
  }

  /**
   * Read the current page address, title, and viewport.
   * @returns {Promise<{ url: string, title: string, viewport: { width: number, height: number }, dpr: number, docHeight: number }>} page facts.
   */
  async info() {
    const value = await this.evaluate(`(() => ({ url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, docHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0) }))()`)
    return value
  }

  /**
   * Evaluate JavaScript in the current page.
   * @param {string} expression - source.
   * @param {{ awaitPromise?: boolean }} [options] - evaluation options.
   * @returns {Promise<any>} the returned value.
   */
  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise === true,
      userGesture: true,
    })
    if (result.exceptionDetails !== undefined) {
      const details = result.exceptionDetails
      const text = details.exception?.description ?? details.text ?? 'evaluation failed'
      throw new Error(`page evaluation failed: ${text}`)
    }
    return result.result?.value
  }

  /**
   * Read collected events.
   * @param {Parameters<EventLog['read']>[0]} [query] - filter.
   * @returns {ReturnType<EventLog['read']>} matching entries.
   */
  readEvents(query) {
    return this.log.read(query)
  }

  /**
   * A one-line state summary for tools and diagnostics.
   * @returns {object} state facts.
   */
  state() {
    return {
      connected: this.connected,
      kind: this.kind,
      port: this.port,
      profileDir: this.profileDir,
      browser: this.version?.browser,
      launched: this.launched,
      pages: this.sessions.size,
      currentTargetId: this.currentTargetId ?? null,
    }
  }

  /** Close the connection, then the browser when this plugin started it. */
  async close() {
    if (this.closed) return
    this.closed = true
    const browserStop = this.stopBrowser
    this.stopBrowser = undefined
    // Ask the browser to exit itself first: this also covers a session whose
    // launching process handle was lost to a plugin reload.
    if (this.cdp !== undefined && this.cdp.closed === false) {
      await this.cdp.send('Browser.close').catch(() => {})
    }
    try {
      this.cdp?.close()
    } catch {
      // already closed
    }
    this.cdp = undefined
    this.sessions.clear()
    this.currentTargetId = undefined
    if (browserStop !== undefined) await browserStop().catch(() => {})
  }

  /**
   * Re-attach after the browser closed underneath us, or throw a clear error.
   * @param {object} options - launch options.
   * @returns {Promise<BrowserSession>} a live session.
   */
  async recover(options) {
    await this.close().catch(() => {})
    this.closed = false
    this.sessions.clear()
    return await this.ensure(options)
  }
}

/** Attach to an already running browser without launching one. */
export async function attachToPort(port) {
  return await attachBrowser(port)
}
