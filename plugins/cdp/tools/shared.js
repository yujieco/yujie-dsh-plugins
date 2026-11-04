/**
 * Shared plumbing for the CDP tools: session acquisition, screenshots, and the
 * small formatting helpers every tool uses.
 * @module yujie-dsh-plugin-cdp/tools/shared
 */
import { capturePage, captureSlices } from '../lib/cdp/page.js'
import { deliverImage, describeImage } from '../lib/media.js'

/**
 * Get the calling agent's session, launching a default browser when it is not connected yet.
 * @param {any} hub - the plugin hub.
 * @param {any} exec - tool run context.
 * @returns {Promise<any>} a live browser session.
 */
export async function ensureSession(hub, exec) {
  const session = hub.sessionFor(exec.agent)
  if (session.connected === false) await session.ensure({})
  return session
}

/**
 * Capture the page and deliver it as an image block or a file path.
 * @param {any} session - browser session.
 * @param {any} ctx - plugin context.
 * @param {any} exec - tool run context.
 * @param {object} config - plugin config.
 * @param {{ clip?: { x: number, y: number, width: number, height: number }, fullPage?: boolean, maxWidth?: number, format?: 'png'|'jpeg', quality?: number }} [options] - capture options.
 * @returns {Promise<{ delivered: object, width: number, height: number }>} delivery facts.
 */
export async function shoot(session, ctx, exec, config, options = {}) {
  const info = await session.info()
  const clip = options.clip
  const targetWidth = options.maxWidth ?? config.autoScreenshotMaxWidth ?? 1024
  const clipWidth = clip?.width ?? info.viewport.width
  const scale = clipWidth > targetWidth ? targetWidth / clipWidth : 1
  const shot = await capturePage(session.send.bind(session), {
    fullPage: options.fullPage === true && clip === undefined,
    clip,
    scale,
    format: options.format,
    quality: options.quality,
    maxHeight: config.maxCaptureHeight ?? 4000,
  })
  const extension = shot.mediaType === 'image/jpeg' ? 'jpg' : 'png'
  const name = `cdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const delivered = await deliverImage(ctx, exec, { ...shot, name })
  return { delivered, width: delivered.width, height: delivered.height }
}

/**
 * One-line page summary shared by several tool results.
 * @param {{ url?: string, title?: string }} info - page facts.
 * @returns {string} the line.
 */
export function describePage(info) {
  const title = info?.title === undefined || info.title === '' ? '(untitled)' : info.title
  return `${title} — ${info?.url ?? ''}`
}

/**
 * Join non-empty lines.
 * @param {Array<string | undefined | false>} lines - candidate lines.
 * @returns {string} the joined text.
 */
export function textOf(lines) {
  return lines.filter(line => typeof line === 'string' && line !== '').join('\n')
}

/**
 * Summarize a screenshot delivery for the tool result.
 * @param {{ delivered: object }} shot - capture result.
 * @returns {string} the line.
 */
export function describeShot(shot) {
  return describeImage(shot.delivered)
}

/**
 * Capture a tall page as several images, one per vertical slice.
 * @param {any} session - browser session.
 * @param {any} ctx - plugin context.
 * @param {any} exec - tool run context.
 * @param {object} config - plugin config.
 * @param {{ maxWidth?: number, sliceHeight?: number, maxSlices?: number, format?: 'png'|'jpeg', quality?: number }} [options] - slice options.
 * @returns {Promise<Array<object>>} one delivered image per slice.
 */
export async function shootSlices(session, ctx, exec, config, options = {}) {
  const targetWidth = options.maxWidth ?? config.autoScreenshotMaxWidth ?? 1024
  const info = await session.info()
  const scale = info.viewport.width > targetWidth ? targetWidth / info.viewport.width : 1
  const slices = await captureSlices(session.send.bind(session), {
    sliceHeight: options.sliceHeight ?? config.sliceHeight ?? 2400,
    maxSlices: options.maxSlices ?? config.maxSlices ?? 6,
    scale,
    format: options.format,
    quality: options.quality,
  })
  const delivered = []
  for (const [index, slice] of slices.entries()) {
    const extension = slice.mediaType === 'image/jpeg' ? 'jpg' : 'png'
    const name = `cdp-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}.${extension}`
    const result = await deliverImage(ctx, exec, { ...slice, name })
    delivered.push({ ...result, offsetY: slice.offsetY })
  }
  return delivered
}
