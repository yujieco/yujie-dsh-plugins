/**
 * Host half of the custom system prompt bundle.
 *
 * Registers one ordered prompt section that renders the user's prompt text at the
 * very start of every assembled system prompt, right after the fixed harness
 * identity (order -1000). The prompt and its on/off switch are volatile Config
 * fields: the Web page writes them through the Host settings service, the Loader
 * updates these references in place, and the section text provider reads them
 * afresh on every assembly, so no plugin reload is needed.
 */
import z from '@deepseek-ai/schemastery'

/** Section sits directly after the fixed harness identity (order -1000). */
const SECTION_ORDER = -999

/** Section name owned by this bundle. */
const SECTION_NAME = 'custom:injected-system-prompt'

/**
 * Read a config value that the Loader may hand over either plainly or as a
 * volatile reference.
 * @param {unknown} value - plain value or volatile reference.
 * @param {unknown} fallback - value used when the reference has no value.
 * @returns the current value, or the fallback.
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
 * The text this bundle contributes to the system prompt; an empty string makes
 * prompt assembly drop the section, which is the off state.
 * @param {{ prompt?: unknown, enabled?: unknown }} config - plugin config.
 * @returns the injected prompt text.
 */
function injectedText(config) {
  if (readConfig(config.enabled, true) === false) return ''
  const text = readConfig(config.prompt, '')
  return typeof text === 'string' ? text.trim() : ''
}

/** Stable plugin name used by the Loader and diagnostics. */
export const name = 'yujie-dsh-plugin-system-prompt'

/**
 * Editable configuration. Both fields are volatile, which is what exposes them
 * to the Host settings service and its Config-derived forms.
 */
export const Config = z.object({
  prompt: z.string().default('').volatile(),
  enabled: z.boolean().default(true).volatile(),
})

/**
 * Register the prompt section on the `systemPrompt` registry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ prompt?: unknown, enabled?: unknown }} config - plugin config.
 */
export function apply(ctx, config) {
  ctx.inject(['systemPrompt'], (child) => {
    const systemPrompt = child.systemPrompt
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return
    const read = () => injectedText(config)
    child.effect(
      () => systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        // User text may legitimately contain `{{...}}`; never interpolate it.
        interpolate: false,
        text: read,
      }),
      'yujie-dsh-plugin-system-prompt: system prompt section',
    )
  })
}
