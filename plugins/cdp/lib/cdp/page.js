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
    return {
      x: Math.round(x), y: Math.round(y),
      width: Math.round(rect.width), height: Math.round(rect.height),
      pageX: Math.round(x + window.scrollX), pageY: Math.round(y + window.scrollY),
      text: String(node.innerText ?? node.value ?? '').slice(0, 200),
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
 * Capture the page as image bytes.
 * @param {(method: string, params?: object) => Promise<any>} send - session sender.
 * @param {{ clip?: { x: number, y: number, width: number, height: number }, scale?: number, fullPage?: boolean, format?: 'png'|'jpeg', quality?: number, maxHeight?: number }} [options] - capture options.
 * @returns {Promise<{ data: Uint8Array, mediaType: string, width: number, height: number }>} image bytes and size.
 */
export async function capturePage(send, options = {}) {
  const format = options.format === 'jpeg' ? 'jpeg' : 'png'
  const scale = options.scale ?? 1
  const params = { format, fromSurface: true }
  if (format === 'jpeg') params.quality = Math.max(1, Math.min(options.quality ?? 80, 100))
  if (options.clip !== undefined) {
    params.clip = { x: options.clip.x, y: options.clip.y, width: options.clip.width, height: options.clip.height, scale }
  } else if (options.fullPage !== true && scale !== 1) {
    const metrics = await send('Page.getLayoutMetrics')
    const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport ?? { clientWidth: 1280, clientHeight: 720 }
    params.clip = { x: 0, y: 0, width: Math.ceil(viewport.clientWidth), height: Math.ceil(viewport.clientHeight), scale }
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
