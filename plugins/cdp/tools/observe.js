/**
 * Observation tools: start or attach a browser, manage pages, navigate, look at
 * the screen, list interactive elements, and read collected errors.
 * @module yujie-dsh-plugin-cdp/tools/observe
 */
import { defineTool } from '../lib/tool.js'
import { clearGrid, drawGrid, measureTarget, readText, snapshotPage } from '../lib/cdp/page.js'
import { renderEvent } from '../lib/cdp/events.js'
import { imageBlocks } from '../lib/media.js'
import { describePage, describeShot, ensureSession, shoot, shootSlices, textOf } from './shared.js'

/** Shared output shape for tools that may return an image. */
const IMAGE_PROPERTIES = {
  width: { type: 'number' },
  height: { type: 'number' },
  bytes: { type: 'number' },
  image: {
    type: 'object',
    additionalProperties: true,
    description: 'Image attachment metadata when the screenshot rides the message.',
  },
  path: { type: 'string', description: 'Temporary file path when no image block could be attached.' },
  reason: { type: 'string', description: 'Why the screenshot fell back to a file path.' },
}

/**
 * Register the observation tools.
 * @param {any} ctx - plugin context.
 * @param {object} config - resolved plugin config.
 * @param {any} hub - the browser hub.
 */
export function registerObserveTools(ctx, config, hub) {
  ctx.tools.register(defineTool({
    name: 'browser_launch',
    description: 'Start a controlled Chrome or Edge instance with its own profile and a DevTools endpoint, or attach to a browser that already exposes one. Idempotent: a live session is reused.',
    parameters: {
      browser: { type: 'string', description: 'chrome, edge, or auto (default: plugin config, then chrome).' },
      headless: { type: 'boolean', description: 'Run without a visible window. Default: plugin config.' },
      port: { type: 'number', description: 'DevTools port. Default 0 picks a free port and reads it from the profile.' },
      userDataDir: { type: 'string', description: 'Profile directory. Default: a plugin-owned directory under DSH_HOME.' },
      url: { type: 'string', description: 'First page to open.' },
      attachPort: { type: 'number', description: 'Attach to an already running browser on this DevTools port instead of launching.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          browser: { type: 'string' },
          kind: { type: 'string' },
          port: { type: 'number' },
          connected: { type: 'boolean' },
          currentTargetId: { type: 'string' },
          profileDir: { type: 'string', description: 'The isolated profile this browser uses.' },
          launched: { type: 'boolean' },
          headless: { type: 'boolean' },
          page: { type: 'object', additionalProperties: true },
          pages: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const pages = (value.pages ?? []).map(page => `- ${page.current === true ? '[current] ' : ''}"${page.title}" ${page.url}`)
        return [{
          type: 'text',
          text: textOf([
            `${value.browser ?? 'browser'} (${value.kind}) — ${value.launched === true ? 'launched' : 'attached'} on port ${value.port}`,
            value.profileDir === undefined ? '' : `profile: ${value.profileDir} (isolated; the human profile is never touched)`,
            value.page === undefined ? '' : `reading: ${describePage(value.page)}`,
            pages.length === 0 ? '' : `pages:\n${pages.join('\n')}`,
          ]),
        }]
      },
    },
    async execute(args, exec) {
      const session = hub.sessionFor(exec.agent)
      if (session.connected === true) {
        const pages = await session.listPages()
        return { ok: true, ...session.state(), headless: config.headless, pages, launched: session.launched }
      }
      await session.ensure({
        browser: args.browser,
        headless: args.headless,
        port: args.port,
        userDataDir: args.userDataDir,
        startupUrl: args.url,
        attachPort: args.attachPort,
        noSandbox: config.noSandbox,
      })
      const pages = await session.listPages()
      const page = await session.info()
      return { ok: true, ...session.state(), headless: config.headless, pages, page }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_pages',
    description: 'List the browser pages, open a new one, select one as current, or close one.',
    parameters: {
      action: { type: 'string', description: 'list, new, select, or close. Default list.' },
      targetId: { type: 'string', description: 'Target id for select or close.' },
      url: { type: 'string', description: 'Address for a new page.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string' },
          currentTargetId: { type: 'string' },
          pages: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const pages = (value.pages ?? []).map(page => `- ${page.current === true ? '[current] ' : ''}${page.id} "${page.title}" ${page.url}`)
        return [{ type: 'text', text: pages.length === 0 ? 'no pages' : pages.join('\n') }]
      },
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const action = (args.action ?? 'list').trim().toLowerCase()
      if (action === 'new') {
        await session.newPage(args.url ?? 'about:blank')
      } else if (action === 'select') {
        if (typeof args.targetId !== 'string' || args.targetId === '') throw new Error('select needs targetId; call browser_pages with action list first')
        await session.selectPage(args.targetId)
      } else if (action === 'close') {
        if (typeof args.targetId !== 'string' || args.targetId === '') throw new Error('close needs targetId')
        await session.closePage(args.targetId)
      } else if (action !== 'list') {
        throw new Error(`unknown action ${action}; use list, new, select, or close`)
      }
      const pages = await session.listPages()
      const current = pages.find(page => page.current === true)
      return { ok: true, action, pages, currentTargetId: current?.id ?? '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Navigate the current page to a URL, wait for the load event (optionally until the network goes quiet), and return a screenshot of the settled page.',
    parameters: {
      url: { type: 'string', required: true, description: 'Destination URL.' },
      waitUntil: { type: 'string', description: 'load (default) or networkIdle.' },
      timeoutMs: { type: 'number', description: 'Load deadline in milliseconds.' },
      screenshot: { type: 'boolean', description: 'Return a screenshot. Default true.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          timedOut: { type: 'boolean' },
          viewport: { type: 'object', additionalProperties: true },
          width: { type: 'number' },
          height: { type: 'number' },
          bytes: { type: 'number' },
          ...IMAGE_PROPERTIES,
        },
      },
      render: (_args, value) => {
        const head = `${describePage(value)}${value.timedOut === true ? ' (load event timed out; the page may still be loading)' : ''}`
        const shot = value.image === undefined && value.path === undefined ? [] : [describeShot({ delivered: value })]
        return [{ type: 'text', text: textOf([head, ...shot]) }, ...imageBlocks(value)]
      },
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const page = await session.navigate(args.url, { waitUntil: args.waitUntil, timeoutMs: args.timeoutMs })
      const value = { ok: true, url: page.url, title: page.title, viewport: page.viewport, timedOut: page.timedOut === true }
      if (args.screenshot === false || config.autoScreenshot === false) return value
      const shot = await shoot(session, ctx, exec, config, { maxWidth: config.autoScreenshotMaxWidth })
      return { ...value, ...shot.delivered }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture what the browser currently shows: the viewport, the whole page, or one element. Returns the image itself so you can look at it.',
    parameters: {
      fullPage: { type: 'boolean', description: 'Capture the whole scrollable page instead of the viewport.' },
      ref: { type: 'string', description: 'Element ref from browser_snapshot (for example r3).' },
      selector: { type: 'string', description: 'CSS selector of the element to capture.' },
      maxWidth: { type: 'number', description: 'Downscale so the image is at most this wide. Default from plugin config.' },
      format: { type: 'string', description: 'png (default) or jpeg.' },
      quality: { type: 'number', description: 'JPEG quality 1-100.' },
      grid: { type: 'boolean', description: 'Draw a 100px coordinate grid with labels before capturing, for pixel-level clicking.' },
      gridStep: { type: 'number', description: 'Grid spacing in CSS pixels. Default 100.' },
      slices: { type: 'boolean', description: 'With fullPage, capture the page as vertical slices instead of one capped image.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          bytes: { type: 'number' },
          ...IMAGE_PROPERTIES,
          count: { type: 'number' },
          images: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const blocks = [{
          type: 'text',
          text: value.images !== undefined && value.images.length > 0
            ? textOf([
              `${describePage(value)} — ${value.count} slices`,
              ...value.images.map((slice, index) => `slice ${index + 1}: from y=${slice.offsetY ?? 0}, ${slice.width ?? 0}x${slice.height ?? 0}, ${slice.image === undefined ? `saved to ${slice.path}` : `${Math.round((slice.bytes ?? 0) / 1024)} KB`}`),
            ])
            : textOf([`${describePage(value)} — ${describeShot({ delivered: value })}`]),
        }]
        if (Array.isArray(value.images)) {
          for (const slice of value.images) blocks.push(...imageBlocks(slice))
        } else {
          blocks.push(...imageBlocks(value))
        }
        return blocks
      },
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const info = await session.info()
      const hasLocator = (typeof args.ref === 'string' && args.ref !== '') || (typeof args.selector === 'string' && args.selector !== '')
      let clip
      if (hasLocator) {
        const measured = await measureTarget(session.send.bind(session), { ref: args.ref, selector: args.selector })
        clip = { x: measured.pageX, y: measured.pageY, width: measured.width, height: measured.height }
      }
      const useGrid = args.grid === true
      if (useGrid) await drawGrid(session.send.bind(session), args.gridStep ?? 100)
      try {
        if (args.fullPage === true && clip === undefined && args.slices === true) {
          const slices = await shootSlices(session, ctx, exec, config, {
            maxWidth: args.maxWidth ?? config.autoScreenshotMaxWidth,
            format: args.format === 'jpeg' ? 'jpeg' : 'png',
            quality: args.quality,
          })
          return { ok: true, url: info.url, title: info.title, count: slices.length, images: slices }
        }
        const shot = await shoot(session, ctx, exec, config, {
          clip,
          fullPage: args.fullPage === true && clip === undefined,
          maxWidth: args.maxWidth ?? config.autoScreenshotMaxWidth,
          format: args.format === 'jpeg' ? 'jpeg' : 'png',
          quality: args.quality,
        })
        return { ok: true, url: info.url, title: info.title, ...shot.delivered }
      } finally {
        if (useGrid) await clearGrid(session.send.bind(session)).catch(() => {})
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: 'List the interactive elements of the page with stable refs, roles, accessible names, click coordinates, and values. Use the refs with browser_click and browser_type.',
    parameters: {
      maxNodes: { type: 'number', description: 'Maximum elements to return. Default 150.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          count: { type: 'number' },
          truncated: { type: 'boolean' },
          viewport: { type: 'object', additionalProperties: true },
          documentHeight: { type: 'number' },
          elements: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const elements = (value.elements ?? []).map(element => {
          const geometry = `@(${element.rect?.x ?? 0},${element.rect?.y ?? 0})`
          const flags = [
            element.inViewport === true ? '' : 'offscreen',
            element.disabled === true ? 'disabled' : '',
            element.inShadow === true ? 'shadow' : '',
            (element.depth ?? 0) > 0 ? 'frame' : '',
            element.value === undefined || element.value === '' ? '' : `value="${element.value}"`,
          ].filter(Boolean)
          return `[${element.ref}] ${element.role ?? element.tag} "${element.name ?? ''}" ${geometry}${flags.length === 0 ? '' : ` ${flags.join(' ')}`}`
        })
        const head = textOf([
          describePage(value),
          `${value.count ?? elements.length} interactive elements, viewport ${value.viewport?.width ?? '?'}x${value.viewport?.height ?? '?'}${value.truncated === true ? ' (truncated)' : ''}`,
        ])
        return [{ type: 'text', text: textOf([head, elements.join('\n')]) }]
      },
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const snapshot = await snapshotPage(session.send.bind(session), { maxNodes: args.maxNodes ?? config.maxSnapshotNodes ?? 150 })
      return {
        ok: true,
        url: snapshot.url,
        title: snapshot.title,
        count: snapshot.elements.length,
        truncated: snapshot.truncated,
        viewport: snapshot.viewport,
        documentHeight: snapshot.documentHeight,
        elements: snapshot.elements,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_console',
    description: 'Read collected console messages, uncaught exceptions, failed requests, and dialogs. Use sinceId to read only entries that appeared after the previous call, and level=error to focus on failures.',
    parameters: {
      sinceId: { type: 'number', description: 'Only entries with a larger id than this.' },
      level: { type: 'string', description: 'Filter by level, for example error or warn.' },
      pattern: { type: 'string', description: 'Case-insensitive text filter over the entry.' },
      limit: { type: 'number', description: 'Maximum entries, newest last. Default 50.' },
      clear: { type: 'boolean', description: 'Drop the retained entries after reading.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          count: { type: 'number' },
          total: { type: 'number' },
          dropped: { type: 'number' },
          lastId: { type: 'number' },
          lines: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? 'no console entries matched'
          : textOf([
            `${value.count} entries (retained ${value.total}${value.dropped > 0 ? `, ${value.dropped} dropped` : ''})`,
            ...value.lines,
          ]),
      }],
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const read = session.readEvents({
        sinceId: args.sinceId,
        level: args.level,
        pattern: args.pattern,
        limit: args.limit ?? config.maxConsoleLines ?? 50,
      })
      if (args.clear === true) session.log.clear()
      return {
        ok: true,
        count: read.items.length,
        total: read.total,
        dropped: read.dropped,
        lastId: read.items.at(-1)?.id ?? args.sinceId ?? 0,
        lines: read.items.map(renderEvent),
      }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'browser_read',
    description: 'Read the readable text of the page or of one element as plain text, without an image. Cheapest way to inspect content, verify assertions, or skim long pages.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to read instead of the whole page.' },
      limit: { type: 'number', description: 'Maximum characters. Default 8000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          length: { type: 'number' },
          truncated: { type: 'boolean' },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: textOf([
          `${describePage(value)} — ${value.length ?? 0} chars${value.truncated === true ? ' (truncated)' : ''}`,
          value.text ?? '',
        ]),
      }],
    },
    async execute(args, exec) {
      const session = await ensureSession(hub, exec)
      const page = await readText(session.send.bind(session), { selector: args.selector, limit: args.limit })
      return { ok: true, url: page.url, title: page.title, length: page.length, truncated: page.truncated, text: page.text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close',
    description: 'Close the browser this session started, or detach from the attached one, and drop its DevTools connection and collected errors. The next page tool starts a fresh browser.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          closed: { type: 'boolean' },
          browser: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.closed === true ? `closed ${value.browser ?? 'the browser session'}` : 'no live browser session to close',
      }],
    },
    async execute(_args, exec) {
      const session = hub.sessionFor(exec.agent)
      const browser = session.version?.browser
      const closed = session.connected === true || session.launched === true
      await session.close()
      return { ok: true, closed, browser }
    },
  }))
}
