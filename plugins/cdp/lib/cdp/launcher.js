/**
 * Browser discovery and launch over the DevTools protocol.
 *
 * Every browser the plugin starts gets its own `--user-data-dir`, so it never
 * touches the profile a human uses and a stale singleton lock cannot block a run.
 * Port 0 is preferred: the browser writes the real port into
 * `<userDataDir>/DevToolsActivePort`, which keeps the debugging surface off a
 * predictable port. Launching is one browser process per profile; a second
 * instance on the same directory exits 21 by design.
 * @module yujie-dsh-plugin-cdp/lib/cdp/launcher
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** macOS application bundles, keyed by the browser kind the tools accept. */
const MAC_PATHS = {
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
}

/** Linux executable names in preference order. */
const LINUX_NAMES = {
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
}

/** Windows install locations relative to `%PROGRAMFILES%`. */
const WIN_PATHS = {
  chrome: ['Google/Chrome/Application/chrome.exe'],
  edge: ['Microsoft/Edge/Application/msedge.exe'],
}

/** Browser kinds this plugin can drive. */
export const BROWSER_KINDS = ['chrome', 'edge']

/**
 * Resolve one browser executable.
 * @param {'chrome'|'edge'} kind - browser kind.
 * @returns {string | undefined} absolute executable path when present.
 */
export function findExecutable(kind) {
  if (process.platform === 'darwin') {
    const path = MAC_PATHS[kind]
    return path !== undefined && existsSync(path) ? path : undefined
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    for (const root of roots) {
      for (const relative of WIN_PATHS[kind] ?? []) {
        const path = join(root, ...relative.split('/'))
        if (existsSync(path)) return path
      }
    }
    return undefined
  }
  for (const name of LINUX_NAMES[kind] ?? []) {
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir === '') continue
      const path = join(dir, name)
      if (existsSync(path)) return path
    }
  }
  return undefined
}

/**
 * Pick a browser to launch, honouring an explicit kind and falling back to any installed one.
 * @param {'auto'|'chrome'|'edge'} [preferred] - requested kind.
 * @returns {{ kind: 'chrome'|'edge', executable: string }} the resolved browser.
 */
export function resolveBrowser(preferred = 'auto') {
  const order = preferred === 'auto' ? BROWSER_KINDS : [preferred]
  for (const kind of order) {
    const executable = findExecutable(kind)
    if (executable !== undefined) return { kind, executable }
  }
  throw new Error(`no supported browser found: install Google Chrome or Microsoft Edge, or pass an explicit browser executable by starting the browser yourself and attaching to its DevTools port`)
}

/**
 * The profile directory this plugin owns for a browser kind.
 * @param {'chrome'|'edge'} kind - browser kind.
 * @param {string} [root] - base directory; defaults to `<DSH_HOME|cwd>/.cdp-browser-profiles`.
 * @returns {string} absolute profile directory.
 */
export function profileDirFor(kind, root) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const base = root ?? join(home, 'cdp-browser-profiles')
  return join(base, kind)
}

/** GET a DevTools HTTP endpoint as JSON. */
async function httpJson(port, path, timeoutMs = 3000) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`DevTools endpoint ${path} answered HTTP ${response.status}`)
  return await response.json()
}

/**
 * Read `/json/version` from a listening DevTools port.
 * @param {number} port - debugging port.
 * @param {number} [timeoutMs] - request deadline.
 * @returns {Promise<{ browser: string, protocolVersion: string, webSocketDebuggerUrl: string }>} endpoint facts.
 */
export async function readVersion(port, timeoutMs = 3000) {
  const version = await httpJson(port, '/json/version', timeoutMs)
  if (typeof version.webSocketDebuggerUrl !== 'string') throw new Error(`DevTools port ${port} did not expose a browser websocket`)
  return {
    browser: String(version.Browser ?? ''),
    protocolVersion: String(version['Protocol-Version'] ?? ''),
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
  }
}

/**
 * Read `/json/list` from a listening DevTools port.
 * @param {number} port - debugging port.
 * @returns {Promise<Array<{ id: string, type: string, title: string, url: string }>>} every target the browser reports.
 */
export async function readTargets(port) {
  const list = await httpJson(port, '/json/list')
  if (!Array.isArray(list)) throw new Error(`DevTools port ${port} returned an unexpected target list`)
  return list.map(entry => ({
    id: String(entry.id ?? ''),
    type: String(entry.type ?? ''),
    title: String(entry.title ?? ''),
    url: String(entry.url ?? ''),
  }))
}

/**
 * Poll until a port answers `/json/version`.
 * @param {number} port - debugging port.
 * @param {number} timeoutMs - overall deadline.
 * @returns {Promise<Awaited<ReturnType<typeof readVersion>>>} endpoint facts.
 */
async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await readVersion(port, 1500)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 120))
    }
  }
  throw new Error(`the browser did not expose a DevTools endpoint on port ${port} within ${timeoutMs}ms${lastError === undefined ? '' : ` (${lastError.message})`}`)
}

/**
 * Read the port a port-0 launch picked, from the profile's `DevToolsActivePort` file.
 * A stale file from an earlier run is ignored unless its port actually answers.
 * @param {string} profileDir - the browser profile directory.
 * @param {number} timeoutMs - overall deadline.
 * @returns {Promise<number>} the listening DevTools port.
 */
async function waitForActivePortFile(profileDir, timeoutMs) {
  const file = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let port
    try {
      const text = await readFile(file, 'utf8')
      port = Number(text.split('\n')[0])
    } catch {
      // not written yet
    }
    if (Number.isInteger(port) && port > 0) {
      try {
        await readVersion(port, 800)
        return port
      } catch {
        // a stale port file from an earlier run; keep waiting for the live one
      }
    }
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  throw new Error(`the browser did not write a usable ${file} within ${timeoutMs}ms; it may have failed to start`)
}

/** Keep the tail of a child's stderr for diagnostics. */
class StderrTail {
  constructor() {
    this.text = ''
  }

  /**
   * @param {Buffer} chunk - stderr bytes.
   */
  push(chunk) {
    this.text = (this.text + chunk.toString('utf8')).slice(-4000)
  }

  /** @returns {string} the retained tail. */
  get() {
    return this.text.trim()
  }
}

/**
 * Launch a browser with an isolated profile and a DevTools endpoint.
 * @param {object} options - launch options.
 * @param {'auto'|'chrome'|'edge'} options.browser - requested browser kind.
 * @param {boolean} [options.headless] - run without a visible window.
 * @param {number} [options.port] - debugging port; 0 picks a free one.
 * @param {string} [options.userDataDir] - profile directory.
 * @param {string} [options.startupUrl] - first page to open.
 * @param {boolean} [options.noSandbox] - add `--no-sandbox` (needed only inside an outer sandbox).
 * @param {boolean} [options.disableExtensions] - load no extensions.
 * @param {number} [options.launchTimeoutMs] - how long to wait for the endpoint.
 * @param {number} [options.windowSize] - `--window-size` value.
 * @returns {Promise<{ kind: 'chrome'|'edge', executable: string, port: number, profileDir: string, version: Awaited<ReturnType<typeof readVersion>>, stderrTail: () => string, stop: () => Promise<void> }>} the running browser.
 */
export async function launchBrowser(options) {
  const { kind, executable } = resolveBrowser(options.browser ?? 'auto')
  const profileDir = options.userDataDir ?? profileDirFor(kind)
  await mkdir(profileDir, { recursive: true })
  const controlled = await livePortForProfile(profileDir)
  if (controlled !== undefined) {
    // A browser from an earlier run (or another session) already owns this profile:
    // reuse it instead of failing on the profile singleton.
    return {
      kind,
      executable,
      port: controlled,
      profileDir,
      version: await readVersion(controlled),
      attached: true,
      stderrTail: () => '',
      stop: async () => {},
    }
  }
  await rm(join(profileDir, 'DevToolsActivePort'), { force: true }).catch(() => {})
  const port = options.port ?? 0
  const timeoutMs = options.launchTimeoutMs ?? 20000
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-breakpad',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    `--window-size=${options.windowSize ?? '1280,900'}`,
  ]
  if (options.headless !== false) {
    args.push('--headless=new', '--disable-gpu')
  }
  if (options.disableExtensions !== false) {
    args.push('--disable-extensions', '--disable-component-extensions-with-background-pages')
  }
  if (options.noSandbox === true) {
    args.push('--no-sandbox')
  }
  args.push(options.startupUrl ?? 'about:blank')

  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false })
  const stderr = new StderrTail()
  child.stderr?.on('data', chunk => stderr.push(chunk))
  const exit = new Promise(resolve => child.once('exit', code => resolve(code)))
  let stopped = false

  const stop = async () => {
    if (stopped) return
    stopped = true
    try {
      child.kill('SIGTERM')
    } catch {
      // already gone
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }, 3000)
    await exit
    clearTimeout(timer)
  }

  const resolveEndpoint = async () => {
    const resolvedPort = port === 0 ? await waitForActivePortFile(profileDir, timeoutMs) : port
    return { port: resolvedPort, version: await waitForPort(resolvedPort, timeoutMs) }
  }

  try {
    const endpoint = await Promise.race([
      resolveEndpoint(),
      exit.then(code => {
        throw new Error(`the browser exited with code ${code} before exposing a DevTools endpoint`)
      }),
    ])
    const resolvedPort = endpoint.port
    const version = endpoint.version
    child.once('exit', code => {
      if (!stopped) stopped = true
      void code
    })
    return { kind, executable, port: resolvedPort, profileDir, version, stderrTail: () => stderr.get(), stop }
  } catch (error) {
    await stop()
    const tail = stderr.get()
    throw new Error(`${error.message}${tail === '' ? '' : `\nbrowser stderr:\n${tail}`}`)
  }
}

/**
 * Attach to a browser that already exposes a DevTools port.
 * @param {number} port - debugging port.
 * @returns {Promise<{ port: number, version: Awaited<ReturnType<typeof readVersion>>, stop: () => Promise<void> }>} the existing browser.
 */
export async function attachBrowser(port) {
  const version = await readVersion(port)
  return {
    port,
    version,
    stop: async () => {
      // An attached browser belongs to whoever started it.
    },
  }
}

/** Synchronous existence check used by the diagnostics message. */
export function describeInstalledBrowsers() {
  return BROWSER_KINDS.map(kind => {
    const executable = findExecutable(kind)
    return executable === undefined ? `${kind}: not found` : `${kind}: ${executable}`
  }).join('; ')
}

/** Read a launch's recorded DevTools port without launching, when the profile has one. */
export function readRecordedPort(profileDir) {
  try {
    const text = readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8')
    const port = Number(text.split('\n')[0])
    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

/**
 * The DevTools port of a browser already running against this profile, when one answers.
 * @param {string} profileDir - profile directory.
 * @returns {Promise<number | undefined>} live port, or undefined when the profile is free.
 */
export async function livePortForProfile(profileDir) {
  const port = readRecordedPort(profileDir)
  if (port === undefined) return undefined
  try {
    await readVersion(port, 800)
    return port
  } catch {
    return undefined
  }
}
