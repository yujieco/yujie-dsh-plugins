/**
 * Minimal CDP client over the runtime's global WebSocket (Node >= 22 / Electron >= 30).
 *
 * One connection speaks one websocket endpoint: a page endpoint, or a browser
 * endpoint whose commands carry a `sessionId` from `Target.attachToTarget`.
 * Commands are correlated by an incrementing id; events are dispatched by method
 * name with their originating session id, so a browser-level connection can serve
 * several tabs without a second socket.
 * @module yujie-dsh-plugin-cdp/lib/cdp/ws
 */

/** Default command deadline; a hung renderer must not stall the agent forever. */
export const DEFAULT_TIMEOUT_MS = 20000

/** A CDP command failure, carrying the protocol error code when the browser sent one. */
export class CdpCommandError extends Error {
  /**
   * @param {string} message - human-readable failure.
   * @param {{ code?: number, data?: string, method?: string }} [detail] - protocol detail.
   */
  constructor(message, detail = {}) {
    super(message)
    this.name = 'CdpCommandError'
    this.code = detail.code
    this.data = detail.data
    this.method = detail.method
  }
}

/** A websocket-backed CDP connection. */
export class CdpConnection {
  /**
   * @param {WebSocket} ws - an already open socket.
   * @param {{ timeoutMs?: number }} [options] - command deadline.
   */
  constructor(ws, options = {}) {
    this.ws = ws
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.seq = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
    this.closeListeners = new Set()
    ws.addEventListener('message', (event) => this.#onMessage(event))
    ws.addEventListener('close', () => this.#onClosed())
    ws.addEventListener('error', () => this.#onClosed())
  }

  /**
   * Open a connection to one CDP endpoint.
   * @param {string} url - `ws://` DevTools endpoint.
   * @param {{ timeoutMs?: number }} [options] - open and command deadline.
   * @returns {Promise<CdpConnection>} the connected client.
   */
  static async open(url, options = {}) {
    if (typeof WebSocket !== 'function') {
      throw new Error('this runtime has no global WebSocket; Node >= 22 is required to drive a browser over CDP')
    }
    const deadline = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out opening the CDP websocket: ${url}`)), deadline)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`cannot open the CDP websocket: ${url}`))
      }, { once: true })
    })
    return new CdpConnection(ws, options)
  }

  /**
   * Dispatch one protocol message.
   * @param {MessageEvent} event - websocket message.
   */
  #onMessage(event) {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error !== undefined) {
        pending.reject(new CdpCommandError(message.error.message || 'CDP command failed', {
          code: message.error.code,
          data: message.error.data,
          method: pending.method,
        }))
      } else {
        pending.resolve(message.result ?? {})
      }
      return
    }
    if (typeof message.method !== 'string') return
    const listeners = this.listeners.get(message.method)
    if (listeners === undefined) return
    for (const listener of [...listeners]) {
      try {
        listener(message.params ?? {}, message.sessionId)
      } catch {
        // A listener must never break protocol dispatch.
      }
    }
  }

  /** Reject everything still waiting and mark the connection unusable. */
  #onClosed() {
    if (this.closed) return
    this.closed = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new CdpCommandError(`the CDP connection closed before ${pending.method} answered`, { method: pending.method }))
      this.pending.delete(id)
    }
    for (const listener of [...this.closeListeners]) {
      try {
        listener()
      } catch {
        // ignore
      }
    }
  }

  /**
   * Send one command.
   * @param {string} method - CDP method name.
   * @param {Record<string, unknown>} [params] - command parameters.
   * @param {string} [sessionId] - target session for a browser-level connection.
   * @returns {Promise<any>} the command result.
   */
  send(method, params = {}, sessionId) {
    if (this.closed) {
      return Promise.reject(new CdpCommandError(`the CDP connection is closed (${method})`, { method }))
    }
    const id = ++this.seq
    const message = { id, method, params }
    if (sessionId !== undefined) message.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpCommandError(`CDP command timed out after ${this.timeoutMs}ms: ${method}`, { method }))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        this.ws.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  /**
   * Subscribe to one protocol event.
   * @param {string} method - event name such as `Runtime.exceptionThrown`.
   * @param {(params: any, sessionId?: string) => void} listener - called per event.
   * @returns {() => void} unsubscribe.
   */
  on(method, listener) {
    let listeners = this.listeners.get(method)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(method, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * Resolve on the first matching event.
   * @param {string} method - event name.
   * @param {(params: any, sessionId?: string) => boolean} [predicate] - event filter.
   * @param {number} [timeoutMs] - deadline.
   * @returns {Promise<any>} the matching event parameters.
   */
  waitFor(method, predicate = () => true, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${method}`))
      }, timeoutMs)
      const off = this.on(method, (params, sessionId) => {
        if (!predicate(params, sessionId)) return
        clearTimeout(timer)
        off()
        resolve(params)
      })
    })
  }

  /**
   * Register a close listener.
   * @param {() => void} listener - runs once when the socket closes.
   * @returns {() => void} unsubscribe.
   */
  onClose(listener) {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  /** Close the socket; in-flight commands reject. */
  close() {
    this.#onClosed()
    try {
      this.ws.close()
    } catch {
      // already closed
    }
  }
}
