/**
 * yujie-dsh-plugin-cdp — drive Chrome or Edge over the Chrome DevTools Protocol.
 *
 * The Host half owns one browser hub: it launches or attaches a browser with an
 * isolated profile, keeps a page attached, collects console output, uncaught
 * exceptions, failed requests, and dialogs, and exposes ten model tools that
 * screenshot the page as an image and act on it by element ref.
 * @module yujie-dsh-plugin-cdp
 */
import { BrowserHub } from './lib/cdp/hub.js'
import { registerObserveTools } from './tools/observe.js'
import { registerActTools } from './tools/act.js'
import { registerPanelRoutes } from './lib/panel.js'

/** Stable plugin name. */
export const name = 'yujie-dsh-plugin-cdp'

/** The tools service must exist before the tools can be registered. */
export const inject = ['tools']

/**
 * Read a config value the Loader may hand over plainly or as a volatile reference.
 * @param {unknown} value - plain value or reference.
 * @param {unknown} fallback - value used when the reference is empty.
 * @returns {unknown} the current value.
 */
function readConfig(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      const current = value.get()
      return current === undefined || current === null ? fallback : current
    } catch {
      return fallback
    }
  }
  return value === undefined || value === null ? fallback : value
}

/**
 * Normalize config into plain values the hub can use.
 * @param {any} config - raw plugin config (plain or volatile references).
 * @returns {object} resolved config.
 */
function resolveConfig(config) {
  const read = (key, fallback) => readConfig(config?.[key], fallback)
  const userDataDir = read('userDataDir', '')
  return {
    browser: String(read('browser', 'auto')),
    headless: read('headless', false) === true,
    port: Number(read('port', 0)),
    userDataDir: typeof userDataDir === 'string' && userDataDir.trim() !== '' ? userDataDir : undefined,
    noSandbox: read('noSandbox', false) === true,
    disableExtensions: read('disableExtensions', true) !== false,
    autoScreenshot: read('autoScreenshot', false) === true,
    autoScreenshotMaxWidth: Number(read('autoScreenshotMaxWidth', 1024)),
    maxCaptureHeight: Number(read('maxCaptureHeight', 4000)),
    sliceHeight: Number(read('sliceHeight', 2400)),
    maxSlices: Number(read('maxSlices', 6)),
    commandTimeoutMs: Number(read('commandTimeoutMs', 20000)),
    navigationTimeoutMs: Number(read('navigationTimeoutMs', 20000)),
    launchTimeoutMs: Number(read('launchTimeoutMs', 20000)),
    clickSettleMs: Number(read('clickSettleMs', 120)),
    collectNetwork: read('collectNetwork', true) !== false,
    autoAcceptDialogs: read('autoAcceptDialogs', true) !== false,
    maxEvents: Number(read('maxEvents', 500)),
    maxSnapshotNodes: Number(read('maxSnapshotNodes', 150)),
    maxConsoleLines: Number(read('maxConsoleLines', 50)),
    sharing: String(read('sharing', 'perSession')),
  }
}

/**
 * Register the browser hub and every CDP tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {any} config - plugin config.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const hub = new BrowserHub(resolved)
  ctx.effect(() => () => hub.disposeAll().catch(() => {}), 'yujie-dsh-plugin-cdp: browser sessions')
  registerObserveTools(ctx, resolved, hub)
  registerActTools(ctx, resolved, hub)
  registerPanelRoutes(ctx, hub)
}
