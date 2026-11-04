/**
 * Bounded, session-scoped record of what the page reported.
 *
 * Console output, uncaught exceptions, browser log entries, and failed requests
 * arrive as protocol events. They are stored per target in a ring buffer so the
 * model can ask for the errors of the last interaction instead of watching a live
 * stream, and an incrementing id lets it read only what is new.
 * @module yujie-dsh-plugin-cdp/lib/cdp/events
 */

/** Kinds of collected entries. */
export const EVENT_KINDS = ['exception', 'console', 'log', 'network']

/** A bounded event log for one browser connection. */
export class EventLog {
  /**
   * @param {{ maxEvents?: number }} [options] - retention cap.
   */
  constructor(options = {}) {
    this.maxEvents = options.maxEvents ?? 500
    this.items = []
    this.seq = 0
    this.dropped = 0
  }

  /**
   * Append one entry.
   * @param {object} entry - the entry without id/time.
   * @returns {object} the stored entry with its id.
   */
  push(entry) {
    this.seq += 1
    const item = { id: this.seq, at: Date.now(), ...entry }
    this.items.push(item)
    if (this.items.length > this.maxEvents) {
      const excess = this.items.length - this.maxEvents
      this.items.splice(0, excess)
      this.dropped += excess
    }
    return item
  }

  /**
   * Read entries, newest last.
   * @param {{ sinceId?: number, level?: string, pattern?: string, limit?: number, targetId?: string }} [query] - filter.
   * @returns {{ items: object[], dropped: number, total: number }} the matching slice and counters.
   */
  read(query = {}) {
    const sinceId = query.sinceId ?? 0
    const limit = Math.max(1, Math.min(query.limit ?? 50, 500))
    const pattern = query.pattern?.trim().toLowerCase()
    const level = query.level?.trim().toLowerCase()
    let items = this.items.filter(item => item.id > sinceId)
    if (query.targetId !== undefined) items = items.filter(item => item.targetId === query.targetId)
    if (level !== undefined && level !== '') items = items.filter(item => (item.level ?? '').toLowerCase() === level)
    if (pattern !== undefined && pattern !== '') {
      items = items.filter(item => `${item.text ?? ''} ${item.detail ?? ''}`.toLowerCase().includes(pattern))
    }
    return { items: items.slice(-limit), dropped: this.dropped, total: this.items.length }
  }

  /** Drop every retained entry. */
  clear() {
    this.items = []
    this.dropped = 0
  }
}

/**
 * Flatten a remote object into one readable line fragment.
 * @param {any} object - a Runtime.RemoteObject.
 * @returns {string} its readable text.
 */
export function describeRemoteObject(object) {
  if (object === undefined || object === null) return 'undefined'
  if (typeof object.value === 'string') return object.value
  if (object.value !== undefined) return JSON.stringify(object.value)
  if (typeof object.unserializableValue === 'string') return object.unserializableValue
  if (typeof object.description === 'string') return object.description
  return object.type ?? 'unknown'
}

/**
 * Format an exception details payload into the stored entry.
 * @param {any} details - Runtime.ExceptionDetails.
 * @returns {{ kind: 'exception', level: 'error', text: string, detail: string, url: string, line: number, column: number, stack: string[] }} the entry.
 */
export function formatException(details) {
  const exception = details?.exception ?? {}
  const description = typeof exception.description === 'string' ? exception.description : describeRemoteObject(exception)
  const callFrames = (details?.stackTrace?.callFrames ?? []).slice(0, 8)
  const frames = callFrames.map(frame => {
    const location = frame.url === '' ? '<anonymous>' : frame.url
    return `${frame.functionName === '' ? '(anonymous)' : frame.functionName} @ ${location}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1}`
  })
  const firstUrl = callFrames.find(frame => typeof frame.url === 'string' && frame.url !== '')?.url ?? ''
  return {
    kind: 'exception',
    level: 'error',
    text: `${details?.text ?? 'Uncaught'} ${description.split('\n')[0]}`.trim(),
    detail: description,
    url: firstUrl,
    line: (callFrames[0]?.lineNumber ?? details?.lineNumber ?? 0) + 1,
    column: (callFrames[0]?.columnNumber ?? details?.columnNumber ?? 0) + 1,
    stack: frames,
  }
}

/**
 * Format a console call into the stored entry.
 * @param {any} event - Runtime.consoleAPICalled parameters.
 * @returns {{ kind: 'console', level: string, text: string, detail: string, stack: string[] }} the entry.
 */
export function formatConsole(event) {
  const args = (event?.args ?? []).map(describeRemoteObject)
  const level = event?.type === 'warning' ? 'warn' : String(event?.type ?? 'log')
  const frames = (event?.stackTrace?.callFrames ?? []).slice(0, 5).map(frame => {
    return `${frame.url === '' ? '<anonymous>' : frame.url}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1}`
  })
  return { kind: 'console', level, text: args.join(' ').slice(0, 2000), detail: args.join(' ').slice(0, 8000), stack: frames }
}

/**
 * Format a Log.entryAdded payload into the stored entry.
 * @param {any} entry - Log.Entry.
 * @returns {{ kind: 'log', level: string, text: string, detail: string, url: string }} the entry.
 */
export function formatLogEntry(entry) {
  return {
    kind: 'log',
    level: String(entry?.level ?? 'info'),
    text: String(entry?.text ?? '').slice(0, 2000),
    detail: String(entry?.text ?? '').slice(0, 8000),
    url: String(entry?.url ?? ''),
  }
}

/**
 * Format a failed request into the stored entry.
 * @param {any} event - Network.loadingFailed parameters.
 * @param {string} url - the request URL tracked from requestWillBeSent.
 * @returns {{ kind: 'network', level: 'error', text: string, detail: string, url: string }} the entry.
 */
export function formatNetworkFailure(event, url) {
  const errorText = String(event?.errorText ?? 'net::ERR_FAILED')
  const canceled = event?.canceled === true ? ' (canceled)' : ''
  return {
    kind: 'network',
    level: 'error',
    text: `request failed: ${errorText}${canceled} ${url}`.trim(),
    detail: `requestId=${String(event?.requestId ?? '')} type=${String(event?.type ?? '')} ${url}`.trim(),
    url,
  }
}

/**
 * Render one stored entry as a single line for the model.
 * @param {object} item - a stored entry.
 * @returns {string} the line.
 */
export function renderEvent(item) {
  const where = item.url === undefined || item.url === '' ? '' : ` (${item.url})`
  const line = `#${item.id} [${item.kind}${item.level === undefined ? '' : `/${item.level}`}] ${item.text}${where}`
  return item.stack === undefined || item.stack.length === 0 ? line : `${line}\n    ${item.stack.join('\n    ')}`
}
