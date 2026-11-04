/**
 * Page-level operations expressed in CDP commands.
 *
 * Element addressing works in two layers. A snapshot walks the live document,
 * open shadow roots, and same-origin iframes, assigns each interactive element a
 * stable ref (`r1`, `r2`, …), and keeps the real element object in a page-side
 * registry. Later calls resolve the ref through that registry, so refs also reach
 * nodes that a plain CSS query cannot pierce; the ref attribute remains for
 * humans inspecting the page and for the selector fallback.
 * @module yujie-dsh-plugin-cdp/lib/cdp/page
 */

/** Attribute the snapshot writes so the page is inspectable by hand. */
export const REF_ATTRIBUTE = 'data-dsh-cdp-ref'

/** Page-side registry name holding the ref-to-element map for the latest snapshot. */
export const REF_REGISTRY = '__yujieCdpRefs'

/** Interactive elements the snapshot collects. */
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="textbox"]',
  '[contenteditable=""]', '[contenteditable="true"]', '[onclick]',
].join(',')

/**
 * Evaluate one expression and return its value.
 * @param {(method: string, params?: object) => Promise<any>} send - session command sender.
 * @param {string} expression - JavaScript source.
 * @param {{ awaitPromise?: boolean }} [options] - evaluation options.
 * @returns {Promise<any>} the returned value.
 */
export async function evaluate(send, expression, options = {}) {
  const result = await send('Runtime.evaluate', {
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

/** Read the page address, title, and viewport. */
export async function pageInfo(send) {
  return await evaluate(send, `(() => ({ url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, scrollY: scrollY, scrollX: scrollX, docHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0) }))()`)
}

/**
 * The snapshot program: it runs inside the page, so it must be self-contained.
 * @param {number} cap - element cap.
 * @returns {object} the snapshot.
 */
function collectSnapshot(cap) {
  const registryName = '__yujieCdpRefs'
  const refAttribute = 'data-dsh-cdp-ref'
  const selector = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"],[contenteditable=""],[contenteditable="true"],[onclick]'
  const registry = new Map()
  window[registryName] = registry
  const elements = []
  let index = 0

  const nameOf = (element) => {
    const aria = (element.getAttribute('aria-label') ?? '').trim()
    if (aria !== '') return aria
    const text = (element.innerText ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (text !== '') return text
    for (const attribute of ['placeholder', 'alt', 'title', 'name', 'aria-placeholder', 'data-testid', 'id']) {
      const value = (element.getAttribute(attribute) ?? '').trim()
      if (value !== '') return value
    }
    return ''
  }

  const roleOf = (element) => {
    const explicit = element.getAttribute('role')
    if (explicit !== null && explicit !== '') return explicit
    const tag = element.tagName
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON') return 'button'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'range') return type
      return 'textbox'
    }
    return ''
  }

  const frameOffset = (element) => {
    let x = 0
    let y = 0
    let win = element.ownerDocument === null ? null : element.ownerDocument.defaultView
    while (win !== null && win.frameElement !== null && win.frameElement !== undefined) {
      const frameRect = win.frameElement.getBoundingClientRect()
      x += frameRect.left + win.frameElement.clientLeft
      y += frameRect.top + win.frameElement.clientTop
      win = win.parent
    }
    return { x, y }
  }

  const record = (element, win, depth, inShadow) => {
    if (elements.length >= cap) return false
    const rect = element.getBoundingClientRect()
    const offset = frameOffset(element)
    if (rect.width < 2 || rect.height < 2) return true
    let style
    try {
      style = win.getComputedStyle(element)
    } catch {
      return true
    }
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return true
    if (rect.bottom < 0 || rect.top > win.innerHeight) return true
    index += 1
    const ref = `r${index}`
    try {
      element.setAttribute(refAttribute, ref)
    } catch {
      // a cross-origin document would throw here; same-origin frames only
    }
    registry.set(ref, element)
    const entry = {
      ref,
      tag: element.tagName.toLowerCase(),
      role: roleOf(element),
      name: nameOf(element),
      rect: { x: Math.round(rect.x + offset.x + rect.width / 2), y: Math.round(rect.y + offset.y + rect.height / 2), width: Math.round(rect.width), height: Math.round(rect.height) },
      inViewport: rect.top + offset.y >= 0 && rect.left + offset.x >= 0 && rect.bottom + offset.y <= window.innerHeight && rect.right + offset.x <= window.innerWidth,
      disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
      depth,
      inShadow: inShadow === true,
    }
    if (element.tagName === 'A') entry.href = String(element.getAttribute('href') ?? '')
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      entry.value = String(element.value ?? '').slice(0, 200)
      entry.inputType = String(element.getAttribute('type') ?? element.tagName.toLowerCase())
    }
    if (element.getAttribute('aria-expanded') !== null) entry.expanded = element.getAttribute('aria-expanded') === 'true'
    if (element.getAttribute('aria-checked') !== null) entry.checked = element.getAttribute('aria-checked') === 'true'
    elements.push(entry)
    return true
  }

  const visit = (doc, win, depth) => {
    if (doc === null || doc === undefined || depth > 2 || elements.length >= cap) return
    let nodes
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      return
    }
    for (const element of nodes) {
      if (elements.length >= cap) return
      record(element, win, depth, false)
    }
    if (depth > 0) return
    let hosts
    try {
      hosts = doc.querySelectorAll('*')
    } catch {
      hosts = []
    }
    for (const host of hosts) {
      if (elements.length >= cap) return
      const shadow = host.shadowRoot
      if (shadow === null || shadow === undefined) continue
      let shadowNodes
      try {
        shadowNodes = shadow.querySelectorAll(selector)
      } catch {
        continue
      }
      for (const element of shadowNodes) {
        if (elements.length >= cap) return
        record(element, win, depth, true)
      }
    }
    const frames = doc.querySelectorAll('iframe,frame')
    for (const frame of frames) {
      if (elements.length >= cap) return
      let inner
      try {
        inner = frame.contentDocument
      } catch {
        inner = null
      }
      if (inner === null || inner === undefined) continue
      visit(inner, frame.contentWindow ?? win, depth + 1)
    }
  }

  visit(document, window, 0)
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY },
    documentHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0),
    truncated: elements.length >= cap,
    elements,
  }
}

/**
 * Collect the interactive snapshot.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ maxNodes?: number }} [options] - node cap.
 * @returns {Promise<any>} the snapshot value.
 */
export async function snapshotPage(send, options = {}) {
  const cap = Math.max(1, Math.min(options.maxNodes ?? 150, 500))
  return await evaluate(send, `(${collectSnapshot.toString()})(${cap})`)
}

/**
 * Resolve a tool's element locator into a CSS selector.
 * @param {{ ref?: string, selector?: string }} target - locator.
 * @returns {string} the CSS selector.
 */
export function selectorFor(target) {
  if (typeof target.ref === 'string' && target.ref.trim() !== '') return `[${REF_ATTRIBUTE}="${target.ref.trim()}"]`
  if (typeof target.selector === 'string' && target.selector.trim() !== '') return target.selector.trim()
  throw new Error('pass ref (from browser_snapshot) or selector')
}

/**
 * The page program that resolves a locator, scrolls it into view, and reports its
 * centre in top-level viewport coordinates, walking out of same-origin frames.
 * @param {{ ref?: string, selector?: string }} locator - element locator.
 * @returns {string} the expression.
 */
function measureProgram(locator) {
  const resolve = function resolveTarget(input) {
    const registry = window.__yujieCdpRefs
    if (input.ref !== undefined && registry !== undefined && registry.has(input.ref)) {
      return registry.get(input.ref)
    }
    if (input.ref !== undefined) {
      const byRef = document.querySelector(`[data-dsh-cdp-ref="${input.ref}"]`)
      if (byRef !== null) return byRef
    }
    if (input.selector !== undefined) return document.querySelector(input.selector)
    return null
  }
  return `(() => {
    const input = ${JSON.stringify(locator)};
    const node = (${resolve.toString()})(input);
    if (node === null || node === undefined) return null;
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = node.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let win = node.ownerDocument.defaultView;
    while (win !== null && win.frameElement !== null && win.frameElement !== undefined) {
      const frameRect = win.frameElement.getBoundingClientRect();
      x += frameRect.left + win.frameElement.clientLeft;
      y += frameRect.top + win.frameElement.clientTop;
      win = win.parent;
    }
    const hit = document.elementFromPoint(Math.round(x), Math.round(y));
    return {
      x: Math.round(x), y: Math.round(y),
      width: Math.round(rect.width), height: Math.round(rect.height),
      pageX: Math.round(x + window.scrollX), pageY: Math.round(y + window.scrollY),
      text: String(node.innerText ?? node.value ?? '').slice(0, 200),
      connected: node.isConnected !== false,
      hitMatches: hit !== null && (hit === node || node.contains(hit) || hit.contains(node)),
    };
  })()`
}

/**
 * Resolve one element and report where to click it.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ ref?: string, selector?: string }} locator - element locator.
 * @returns {Promise<{ x: number, y: number, width: number, height: number, pageX: number, pageY: number, text: string }>} the measured element.
 */
export async function measureTarget(send, locator) {
  const measured = await evaluate(send, measureProgram(locator))
  if (measured === null || measured === undefined) {
    const described = locator.ref !== undefined ? `ref ${locator.ref}` : `selector ${locator.selector}`
    throw new Error(`no element matches ${described}; call browser_snapshot for fresh refs`)
  }
  return measured
}

/**
 * Dispatch a mouse click at viewport coordinates.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ x: number, y: number, button?: string, clickCount?: number }} options - click geometry.
 * @returns {Promise<void>} resolves after the click is dispatched.
 */
export async function clickAt(send, options) {
  const button = options.button ?? 'left'
  const clickCount = Math.max(1, options.clickCount ?? 1)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: options.x, y: options.y, button: 'none' })
  for (let index = 1; index <= clickCount; index += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: options.x, y: options.y, button, clickCount: index })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: options.x, y: options.y, button, clickCount: index })
  }
}

/**
 * Focus an element, clear it when asked, insert text, and optionally submit.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ ref?: string, selector?: string }} locator - element locator.
 * @param {{ text: string, clear?: boolean, submit?: boolean }} options - typing options.
 * @returns {Promise<{ value: string }>} the element value after typing.
 */
export async function typeTarget(send, locator, options) {
  const focusProgram = function focusTarget(input) {
    const registry = window.__yujieCdpRefs
    let node
    if (input.ref !== undefined && registry !== undefined && registry.has(input.ref)) node = registry.get(input.ref)
    if (node === undefined && input.ref !== undefined) node = document.querySelector(`[data-dsh-cdp-ref="${input.ref}"]`)
    if (node === undefined && input.selector !== undefined) node = document.querySelector(input.selector)
    if (node === undefined || node === null) return null
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    node.focus()
    return node.ownerDocument.activeElement === node
  }
  const focused = await evaluate(send, `(() => (${focusProgram.toString()})(${JSON.stringify(locator)}))()`)
  if (focused !== true) throw new Error('cannot focus the target element; it may be missing, disabled, or not focusable')
  if (options.clear === true) {
    const clearProgram = function clearTarget(input) {
      const registry = window.__yujieCdpRefs
      let node
      if (input.ref !== undefined && registry !== undefined && registry.has(input.ref)) node = registry.get(input.ref)
      if (node === undefined && input.ref !== undefined) node = document.querySelector(`[data-dsh-cdp-ref="${input.ref}"]`)
      if (node === undefined && input.selector !== undefined) node = document.querySelector(input.selector)
      if (node === undefined || node === null) return false
      if ('value' in node) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
        if (descriptor?.set !== undefined) descriptor.set.call(node, '')
        else node.value = ''
      } else {
        node.textContent = ''
      }
      node.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    await evaluate(send, `(() => (${clearProgram.toString()})(${JSON.stringify(locator)}))()`)
  }
  await send('Input.insertText', { text: options.text })
  if (options.submit === true) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  }
  const readProgram = function readTarget(input) {
    const registry = window.__yujieCdpRefs
    let node
    if (input.ref !== undefined && registry !== undefined && registry.has(input.ref)) node = registry.get(input.ref)
    if (node === undefined && input.ref !== undefined) node = document.querySelector(`[data-dsh-cdp-ref="${input.ref}"]`)
    if (node === undefined && input.selector !== undefined) node = document.querySelector(input.selector)
    if (node === undefined || node === null) return null
    return String(node.value ?? node.textContent ?? '')
  }
  const value = await evaluate(send, `(() => (${readProgram.toString()})(${JSON.stringify(locator)}))()`)
  return { value: value ?? '' }
}

/**
 * Read the readable text of the page or one element.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ selector?: string, limit?: number }} [options] - text options.
 * @returns {Promise<{ text: string, length: number, truncated: boolean, title: string, url: string }>} the text.
 */
export async function readText(send, options = {}) {
  const limit = Math.max(200, Math.min(options.limit ?? 8000, 40000))
  const program = function readPageText(input) {
    const node = input.selector === undefined ? document.body : document.querySelector(input.selector)
    if (node === null) return null
    const text = String(node.innerText ?? node.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
    return { title: document.title, url: location.href, text: text.slice(0, input.limit), length: text.length }
  }
  const value = await evaluate(send, `(() => (${program.toString()})(${JSON.stringify({ selector: options.selector, limit })}))()`)
  if (value === null || value === undefined) throw new Error(`no element matches selector ${options.selector}`)
  return { ...value, truncated: value.length > limit }
}

/**
 * Read the layout viewport in CSS pixels, in the same space as element rects.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @returns {Promise<{ width: number, height: number }>} the viewport size.
 */
async function readViewportSize(send) {
  try {
    const result = await send('Runtime.evaluate', { expression: '({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })', returnByValue: true })
    const value = result.result?.value
    if (value !== undefined && value.width > 0 && value.height > 0) {
      return { width: value.width, height: value.height, dpr: value.dpr > 0 ? value.dpr : 1 }
    }
  } catch {
    // fall through to metrics
  }
  const metrics = await send('Page.getLayoutMetrics')
  const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport ?? { clientWidth: 1280, clientHeight: 720 }
  return { width: Math.ceil(viewport.clientWidth), height: Math.ceil(viewport.clientHeight), dpr: 1 }
}

/**
 * Capture the page as image bytes.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ clip?: { x: number, y: number, width: number, height: number }, scale?: number, fullPage?: boolean, format?: 'png'|'jpeg', quality?: number, maxHeight?: number }} [options] - capture options.
 * @returns {Promise<{ data: Uint8Array, mediaType: string, width: number, height: number }>} image bytes and size.
 */
export async function capturePage(send, options = {}) {
  const format = options.format === 'jpeg' ? 'jpeg' : 'png'
  const params = { format, fromSurface: true }
  if (format === 'jpeg') params.quality = Math.max(1, Math.min(options.quality ?? 80, 100))
  const viewport = await readViewportSize(send)
  const deviceWidth = (options.clip?.width ?? viewport.width) * viewport.dpr
  const scale = options.maxWidth === undefined ? (options.scale ?? 1) : Math.min(1, options.maxWidth / Math.max(1, deviceWidth))
  if (options.clip !== undefined) {
    params.clip = { x: options.clip.x, y: options.clip.y, width: options.clip.width, height: options.clip.height, scale }
  } else if (options.fullPage !== true && scale !== 1) {
    params.clip = { x: 0, y: 0, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height), scale }
  }
  if (options.fullPage === true) {
    const metrics = await send('Page.getLayoutMetrics')
    const content = metrics.cssContentSize ?? metrics.contentSize
    const width = Math.max(1, Math.ceil(content.width))
    const height = Math.min(Math.max(1, Math.ceil(content.height)), options.maxHeight ?? 4000)
    params.clip = { x: 0, y: 0, width, height, scale }
    params.captureBeyondViewport = true
  }
  const result = await send('Page.captureScreenshot', params)
  const data = Buffer.from(result.data, 'base64')
  return { data, mediaType: format === 'jpeg' ? 'image/jpeg' : 'image/png', ...imageSize(data, format) }
}

/**
 * Capture a tall page in vertical slices, one image per slice.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ sliceHeight?: number, maxSlices?: number, scale?: number, format?: 'png'|'jpeg', quality?: number }} [options] - slice options.
 * @returns {Promise<Array<{ data: Uint8Array, mediaType: string, width: number, height: number, offsetY: number }>>} the slices.
 */
export async function captureSlices(send, options = {}) {
  const sliceHeight = Math.max(200, options.sliceHeight ?? 2400)
  const maxSlices = Math.max(1, Math.min(options.maxSlices ?? 6, 12))
  const format = options.format === 'jpeg' ? 'jpeg' : 'png'
  const metrics = await send('Page.getLayoutMetrics')
  const content = metrics.cssContentSize ?? metrics.contentSize
  const width = Math.max(1, Math.ceil(content.width))
  const totalHeight = Math.max(1, Math.ceil(content.height))
  const slices = []
  for (let index = 0; index < maxSlices; index += 1) {
    const offsetY = index * sliceHeight
    if (offsetY >= totalHeight) break
    const height = Math.min(sliceHeight, totalHeight - offsetY)
    const params = {
      format,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: offsetY, width, height, scale: options.scale ?? 1 },
    }
    if (format === 'jpeg') params.quality = Math.max(1, Math.min(options.quality ?? 80, 100))
    const result = await send('Page.captureScreenshot', params)
    const data = Buffer.from(result.data, 'base64')
    slices.push({ data, mediaType: format === 'jpeg' ? 'image/jpeg' : 'image/png', ...imageSize(data, format), offsetY })
  }
  return slices
}

/**
 * Draw a coordinate grid over the page for pixel-level clicking.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {number} step - grid spacing in CSS pixels.
 * @returns {Promise<void>} resolves after the overlay is drawn.
 */
export async function drawGrid(send, step = 100) {
  const program = function paintGrid(spacing) {
    const previous = document.getElementById('__yujieCdpGrid')
    if (previous !== null) previous.remove()
    const layer = document.createElement('div')
    layer.id = '__yujieCdpGrid'
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;background-image:linear-gradient(to right,rgba(255,0,0,.28) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,0,0,.28) 1px,transparent 1px);background-size:' + spacing + 'px ' + spacing + 'px, ' + spacing + 'px ' + spacing + 'px'
    const labelStep = spacing * 2
    for (let y = 0; y < innerHeight; y += labelStep) {
      for (let x = 0; x < innerWidth; x += labelStep) {
        if (x === 0 && y === 0) continue
        const label = document.createElement('span')
        label.textContent = x + ',' + y
        label.style.cssText = 'position:absolute;left:' + (x + 3) + 'px;top:' + (y + 2) + 'px;font:600 11px/1 ui-monospace,SFMono-Regular,monospace;color:#b31414;background:rgba(255,255,255,.82);padding:1px 3px;border-radius:3px'
        layer.appendChild(label)
      }
    }
    document.documentElement.appendChild(layer)
    return true
  }
  await evaluate(send, `(() => (${program.toString()})(${Number(step) || 100}))()`)
}

/** Remove the coordinate grid overlay when present. */
export async function clearGrid(send) {
  await evaluate(send, `(() => { const layer = document.getElementById('__yujieCdpGrid'); if (layer !== null) layer.remove(); return true; })()`)
}

/**
 * Read the pixel size of a PNG or JPEG buffer without an image library.
 * @param {Uint8Array} data - image bytes.
 * @param {'png'|'jpeg'} format - image format.
 * @returns {{ width: number, height: number }} pixel size, or zeros when unknown.
 */
export function imageSize(data, format) {
  try {
    if (format === 'png') {
      const view = Buffer.from(data)
      if (view.length >= 24) return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) }
      return { width: 0, height: 0 }
    }
    const view = Buffer.from(data)
    let offset = 2
    while (offset + 9 < view.length) {
      if (view[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = view[offset + 1]
      const length = view.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: view.readUInt16BE(offset + 5), width: view.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
    return { width: 0, height: 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

/** The selector list is exported for diagnostics. */
export const interactiveSelector = INTERACTIVE_SELECTOR

/**
 * Install the visible control layer: a cursor the automation moves before it
 * clicks. It lives in a fixed overlay with `pointer-events: none`, so it never
 * changes what the page can hit.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @returns {Promise<void>} resolves after the layer exists.
 */
export async function installControlOverlay(send) {
  const program = function installOverlay() {
    if (document.getElementById('__yujieControlLayer') !== null) return true
    const layer = document.createElement('div')
    layer.id = '__yujieControlLayer'
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden'
    const cursor = document.createElement('div')
    cursor.id = '__yujieCursor'
    cursor.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-120px,-120px);will-change:transform;filter:drop-shadow(0 3px 7px rgba(0,0,0,.45)) drop-shadow(0 0 10px rgba(59,110,246,.85))'
    cursor.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M5 3l23 13.7-9.6 1.9 5.6 11-4.4 2.1-5.6-11.1-6 5.9z" fill="#1f6bff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
    layer.appendChild(cursor)
    document.documentElement.appendChild(layer)
    window.__yujieCursorPos = { x: -120, y: -120 }
    return true
  }
  await evaluate(send, `(() => (${program.toString()})())()`)
}

/**
 * Animate the visible cursor to one point.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {number} x - viewport x.
 * @param {number} y - viewport y.
 * @param {number} [durationMs] - travel time.
 * @returns {Promise<void>} resolves when the animation ends.
 */
export async function moveCursor(send, x, y, durationMs = 260) {
  const program = function moveTo(input) {
    const cursor = document.getElementById('__yujieCursor')
    if (cursor === null) return Promise.resolve(false)
    cursor.style.transition = 'transform ' + input.duration + 'ms cubic-bezier(.22,.61,.36,1)'
    cursor.style.transform = 'translate(' + input.x + 'px,' + input.y + 'px)'
    window.__yujieCursorPos = { x: input.x, y: input.y }
    return new Promise(resolve => setTimeout(() => resolve(true), input.duration + 20))
  }
  const moved = await evaluate(send, `(() => (${program.toString()})(${JSON.stringify({ x, y, duration: durationMs })}))()`, { awaitPromise: true })
  if (moved !== true) throw new Error('the control overlay is not installed')
}

/**
 * Draw a click ripple, and optionally a small label, at one point.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {number} x - viewport x.
 * @param {number} y - viewport y.
 * @param {string} [label] - short action label such as `click`.
 * @returns {Promise<void>} resolves after the ripple is scheduled.
 */
export async function rippleAt(send, x, y, label) {
  const program = function ripple(input) {
    const layer = document.getElementById('__yujieControlLayer')
    if (layer === null) return false
    const dot = document.createElement('div')
    dot.style.cssText = 'position:absolute;left:' + input.x + 'px;top:' + input.y + 'px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid rgba(59,110,246,.95);background:rgba(59,110,246,.18)'
    layer.appendChild(dot)
    dot.animate([
      { transform: 'scale(.35)', opacity: 1 },
      { transform: 'scale(2.1)', opacity: 0 },
    ], { duration: 1800, easing: 'cubic-bezier(.2,.6,.3,1)' })
    setTimeout(() => dot.remove(), 1900)
    if (input.label !== undefined && input.label !== '') {
      const tag = document.createElement('div')
      tag.textContent = input.label
      tag.style.cssText = 'position:absolute;left:' + (input.x + 18) + 'px;top:' + (input.y + 16) + 'px;font:600 11px/1 ui-monospace,SFMono-Regular,monospace;color:#fff;background:rgba(17,24,39,.9);padding:3px 6px;border-radius:5px'
      layer.appendChild(tag)
      setTimeout(() => tag.remove(), 2000)
    }
    return true
  }
  await evaluate(send, `(() => (${program.toString()})(${JSON.stringify({ x, y, label })}))()`)
}

/**
 * Remove the visible control layer.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @returns {Promise<void>} resolves after removal.
 */
export async function clearControlOverlay(send) {
  await evaluate(send, `(() => { const layer = document.getElementById('__yujieControlLayer'); if (layer !== null) layer.remove(); return true; })()`)
}
