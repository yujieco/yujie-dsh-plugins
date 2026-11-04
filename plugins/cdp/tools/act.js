/**
 * Action tools: click, type, evaluate, and open this Harness GUI for front-end
 * debugging.
 * @module yujie-dsh-plugin-cdp/tools/act
 */
import { defineTool } from '../lib/tool.js'
import { clickAt, measureTarget, typeTarget } from '../lib/cdp/page.js'
import { imageBlocks } from '../lib/media.js'
import { describePage, describeShot, ensureSession, shoot, textOf } from './shared.js'

/** Output properties shared by the tools that may return a screenshot. */
const IMAGE_PROPERTIES = {
  width: { type: 'number' },
  height: { type: 'number' },
  bytes: { type: 'number' },
  image: { type: 'object', additionalProperties: true, description: 'Image attachment metadata when the screenshot rides the message.' },
  path: { type: 'string', description: 'Temporary file path when no image block could be attached.' },
  reason: { type: 'string', description: 'Why the screenshot fell back to a file path.' },
}

/** Cap a value so one evaluation cannot flood the context. */
function serializeValue(value) {
  const LIMIT = 20000
  if (value === undefined) return { result: 'null', truncated: false }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return { result: String(value), truncated: false }
  if (typeof value === 'string') {
    return value.length > LIMIT ? { result: value.slice(0, LIMIT), truncated: true } : { result: value, truncated: false }
  }
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return text.length > LIMIT ? { result: text.slice(0, LIMIT), truncated: true } : { result: text, truncated: false }
}

/**
 * Register the action tools.
 * @param {any} ctx - plugin context.
 * @param {object} config - resolved plugin config.
 * @param {any} hub - the browser hub.
 */
export function registerActTools(ctx, config, hub) {
  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click a page element by snapshot ref or CSS selector, or click raw viewport coordinates. Returns a screenshot of the result by default.',
    parameters: {
      ref: { type: 'string', description: 'Element ref from browser_snapshot, for example r3.' },
      selector: { type: 'string', description: 'CSS selector of the element.' },
      x: { type: 'number', description: 'Viewport x coordinate when clicking a position.' },
      y: { type: 'number', description: 'Viewport y coordinate when clicking a position.' },
      button: { type: 'string', description: 'left (default), right, or middle.' },
      clickCount: { type: 'number', description: 'Number of clicks. Default 1.' },
      screenshot: { type: 'boolean', description: 'Return a screenshot after clicking. Default true.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          x: { type: 'number' },
          y: { type: 'number' },
          url: { type: 'string' },
          title: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          bytes: { type: 'number' },
          ...IMAGE_PROPERTIES,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: textOf([
          `clicked (${value.x},${value.y}) — ${describePage(value)}`,
          value.image === undefined && value.path === undefined ? '' : describeShot({ delivered: value }),
        ]),
      }, ...imageBlocks(value)],
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      let x = args.x
      let y = args.y
      const hasCoordinates = typeof x === 'number' && typeof y === 'number'
      if (!hasCoordinates) {
        if ((typeof args.ref !== 'string' || args.ref === '') && (typeof args.selector !== 'string' || args.selector === '')) {
          throw new Error('pass ref (from browser_snapshot), selector, or x and y coordinates')
        }
        const measured = await measureTarget(session.send.bind(session), { ref: args.ref, selector: args.selector })
        x = measured.x
        y = measured.y
      }
      await clickAt(session.send.bind(session), { x, y, button: args.button, clickCount: args.clickCount })
      await new Promise(resolve => setTimeout(resolve, config.clickSettleMs ?? 120))
      const info = await session.info()
      const value = { ok: true, x, y, url: info.url, title: info.title }
      if (args.screenshot === false || config.autoScreenshot === false) return value
      const shot = await shoot(session, ctx, exec, config, { maxWidth: config.autoScreenshotMaxWidth })
      return { ...value, ...shot.delivered }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_type',
    description: 'Focus an element and type text into it, optionally clearing it first and pressing Enter afterwards.',
    parameters: {
      ref: { type: 'string', description: 'Element ref from browser_snapshot.' },
      selector: { type: 'string', description: 'CSS selector of the input.' },
      text: { type: 'string', required: true, description: 'Text to type.' },
      clear: { type: 'boolean', description: 'Clear the field before typing.' },
      submit: { type: 'boolean', description: 'Press Enter after typing.' },
      screenshot: { type: 'boolean', description: 'Return a screenshot afterwards. Default false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          selector: { type: 'string' },
          value: { type: 'string' },
          submitted: { type: 'boolean' },
          url: { type: 'string' },
          title: { type: 'string' },
          ...IMAGE_PROPERTIES,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: textOf([
          `typed into ${value.selector ?? 'element'}; value is now "${value.value ?? ''}"${value.submitted === true ? ' and Enter was pressed' : ''} — ${describePage(value)}`,
          value.image === undefined && value.path === undefined ? '' : describeShot({ delivered: value }),
        ]),
      }, ...imageBlocks(value)],
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const locator = { ref: args.ref, selector: args.selector }
      if ((typeof args.ref !== 'string' || args.ref === '') && (typeof args.selector !== 'string' || args.selector === '')) {
        throw new Error('pass ref (from browser_snapshot) or selector for the field to type into')
      }
      const targetLabel = typeof args.ref === 'string' && args.ref !== '' ? `ref ${args.ref}` : String(args.selector)
      const typed = await typeTarget(session.send.bind(session), locator, {
        text: args.text,
        clear: args.clear === true,
        submit: args.submit === true,
      })
      await new Promise(resolve => setTimeout(resolve, config.clickSettleMs ?? 120))
      const info = await session.info()
      const value = { ok: true, selector: targetLabel, value: typed.value, submitted: args.submit === true, url: info.url, title: info.title }
      if (args.screenshot !== true || config.autoScreenshot === false) return value
      const shot = await shoot(session, ctx, exec, config, { maxWidth: config.autoScreenshotMaxWidth })
      return { ...value, ...shot.delivered }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_evaluate',
    description: 'Evaluate JavaScript in the current page and return the value. Use it for assertions, reading state, or scrolling; prefer refs and the other tools for interaction.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JavaScript expression or IIFE.' },
      awaitPromise: { type: 'boolean', description: 'Wait for a returned promise. Default false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          result: { type: 'string', description: 'The serialized return value.' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.result ?? 'null'}${value.truncated === true ? '\n…(truncated)' : ''}`,
      }],
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const value = await session.evaluate(args.expression, { awaitPromise: args.awaitPromise === true })
      return { ok: true, ...serializeValue(value) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_open_dsh',
    description: 'Open this Harness web GUI in the controlled browser with a valid access token, then return a screenshot. Useful for watching the front end you are developing and reading its console errors.',
    parameters: {
      path: { type: 'string', description: 'Path under the GUI origin, for example / or /settings.' },
      screenshot: { type: 'boolean', description: 'Return a screenshot after loading. Default true.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          url: { type: 'string', description: 'The opened URL without its token.' },
          title: { type: 'string' },
          ...IMAGE_PROPERTIES,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: textOf([
          `opened ${describePage(value)}`,
          value.image === undefined && value.path === undefined ? '' : describeShot({ delivered: value }),
        ]),
      }, ...imageBlocks(value)],
    },
    async execute(args, exec) {
      const connection = ctx.get('connection')
      const webApp = ctx.get('webApp')
      if (connection === undefined || webApp === undefined) throw new Error('this deployment has no web GUI to open')
      const base = webApp.getAdvertisedUrl()
      const path = typeof args.path === 'string' && args.path !== '' ? args.path : '/'
      const target = new URL(path, base)
      const authenticated = connection.authenticatedUrl(target.href)
      const session = await ensureSession(hub, exec)
      const page = await session.navigate(authenticated, { waitUntil: 'load' })
      const value = { ok: true, url: authenticated.replace(/([?&])token=[^&]*/u, '$1token=***'), title: page.title }
      if (args.screenshot === false || config.autoScreenshot === false) return value
      const shot = await shoot(session, ctx, exec, config, { maxWidth: config.autoScreenshotMaxWidth })
      return { ...value, ...shot.delivered }
    },
  }))
}
