/**
 * Turning captured pixels into something the model can see.
 *
 * A screenshot is stored through the attachment service when the current route
 * accepts image input, which is how `read_image` works too. When it does not, the
 * bytes land in a temporary file and the tool returns its path instead, so the
 * result is never lost.
 * @module yujie-dsh-plugin-cdp/lib/media
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether the calling agent's current route declares image input.
 * @param {any} ctx - plugin context.
 * @param {any} exec - tool run context.
 * @returns {Promise<boolean>} true when an image block is safe to send.
 */
export async function imageRouteSupported(ctx, exec) {
  const llm = ctx.get('llm')
  const agent = exec?.agent
  if (llm === undefined || agent === undefined) return false
  let provider
  let model
  try {
    const config = agent.session?.requestHeader?.()?.config
    provider = config?.provider ?? agent.options?.provider
    model = config?.model ?? agent.options?.model
  } catch {
    return false
  }
  if (typeof provider !== 'string' || typeof model !== 'string') return false
  try {
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}

/**
 * Persist one screenshot and describe how the caller should present it.
 * @param {any} ctx - plugin context.
 * @param {any} exec - tool run context.
 * @param {{ data: Uint8Array, mediaType: string, width: number, height: number, name: string }} shot - captured image.
 * @returns {Promise<{ bytes: number, width: number, height: number, image?: object, path?: string }>} delivery facts.
 */
export async function deliverImage(ctx, exec, shot) {
  const bytes = shot.data.byteLength
  const attachments = ctx.get('attachments')
  if (attachments !== undefined && await imageRouteSupported(ctx, exec)) {
    try {
      const ref = await attachments.saveImage({ data: shot.data, mediaType: shot.mediaType, name: shot.name })
      return {
        bytes,
        width: ref.width ?? shot.width,
        height: ref.height ?? shot.height,
        image: {
          attachmentId: String(ref.attachmentId),
          mediaType: ref.mediaType ?? shot.mediaType,
          bytes: ref.bytes ?? bytes,
          width: ref.width ?? shot.width,
          height: ref.height ?? shot.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return await saveFallback(shot, bytes, reason)
    }
  }
  return await saveFallback(shot, bytes, 'the current model route does not accept image input')
}

/**
 * Write the image to the temporary directory when it cannot ride the message.
 * @param {{ data: Uint8Array, mediaType: string, width: number, height: number, name: string }} shot - captured image.
 * @param {number} bytes - byte length.
 * @param {string} reason - why the fallback ran.
 * @returns {Promise<{ bytes: number, width: number, height: number, path: string, reason: string }>} delivery facts.
 */
async function saveFallback(shot, bytes, reason) {
  const dir = join(tmpdir(), 'dsh-cdp', 'shots')
  await mkdir(dir, { recursive: true })
  const path = join(dir, shot.name)
  await writeFile(path, shot.data)
  return { bytes, width: shot.width, height: shot.height, path, reason }
}

/**
 * Build the content blocks for a delivered image.
 * @param {object} value - the tool value.
 * @returns {Array<object>} content blocks.
 */
export function imageBlocks(value) {
  if (value?.image === undefined) return []
  return [{
    type: 'image',
    attachment: {
      attachmentId: value.image.attachmentId,
      mediaType: value.image.mediaType,
      bytes: value.image.bytes,
      width: value.image.width,
      height: value.image.height,
      ...(value.image.name === undefined ? {} : { name: value.image.name }),
    },
  }]
}

/**
 * Human-readable byte size.
 * @param {number} bytes - byte count.
 * @returns {string} formatted size.
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Describe an image delivery in one line for the model.
 * @param {object} value - the tool value.
 * @returns {string} the description.
 */
export function describeImage(value) {
  const size = value.image === undefined
    ? `saved to ${value.path}${value.reason === undefined ? '' : ` (${value.reason})`}`
    : `${value.image.width}x${value.image.height}, ${formatBytes(value.image.bytes)}`
  return `screenshot: ${size}`
}
