/**
 * A dependency-free stand-in for `@deepseek-ai/dsh-tools`'s `defineTool`.
 *
 * A bundle installed from a linked workspace directory cannot resolve the
 * installation's `@deepseek-ai/*` packages, so the plugin carries its own tiny
 * compiler: it turns the author-facing property map into the raw JSON Schema the
 * Tool registry stores, and preserves the optional definition hooks.
 *
 * Supported author syntax is the subset this plugin uses: `type`, `description`,
 * `required: true` on a property, `enum`, `items`, `oneOf`, `additionalProperties`,
 * `title`, `default`, `examples`.
 * @module yujie-dsh-plugin-cdp/lib/tool
 */

/**
 * Compile one value node, hoisting property-level `required` flags into the
 * object's `required` array.
 * @param {any} node - author node.
 * @returns {any} raw JSON Schema node.
 */
function compileValue(node) {
  if (Array.isArray(node)) return node.map(compileValue)
  if (node === null || typeof node !== 'object') return node
  const out = {}
  const required = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'required') {
      if (Array.isArray(value)) {
        for (const name of value) required.push(String(name))
      }
      continue
    }
    if (key === 'properties' && value !== null && typeof value === 'object') {
      const properties = {}
      for (const [name, child] of Object.entries(value)) {
        if (child !== null && typeof child === 'object' && child.required === true) required.push(name)
        properties[name] = compileValue(child)
      }
      out.properties = properties
      continue
    }
    out[key] = compileValue(value)
  }
  if (required.length > 0) out.required = [...new Set(required)]
  return out
}

/**
 * Compile the implicit parameter object.
 * @param {Record<string, any>} map - per-property author nodes.
 * @returns {Record<string, any>} raw JSON Schema.
 */
function compileParameters(map) {
  const properties = {}
  const required = []
  for (const [name, spec] of Object.entries(map ?? {})) {
    if (spec !== null && typeof spec === 'object' && spec.required === true) required.push(name)
    properties[name] = compileValue(spec)
  }
  const schema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/**
 * Declare one model-facing tool.
 * @param {object} options - definition.
 * @param {string} options.name - tool name.
 * @param {string} options.description - model-facing description.
 * @param {Record<string, any>} options.parameters - per-property author nodes.
 * @param {{ schema: any, render: (args: any, value: any) => Array<object> }} options.output - output schema and renderer.
 * @param {(args: any, exec: any) => Promise<any>} options.execute - execution body.
 * @param {(args: any) => boolean} [options.isConcurrencySafe] - scheduler hint.
 * @param {(args: any) => object} [options.presentCall] - call card.
 * @param {(args: any, result: any) => object} [options.presentResult] - result card.
 * @param {number} [options.timeoutMs] - per-call deadline.
 * @returns {object} a registry-ready definition.
 */
export function defineTool(options) {
  if (typeof options?.name !== 'string' || options.name === '') throw new Error('defineTool: name is required')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${options.name}): execute is required`)
  if (typeof options.output?.render !== 'function') throw new Error(`defineTool(${options.name}): output.render is required`)
  const definition = {
    name: options.name,
    description: options.description ?? '',
    parameters: compileParameters(options.parameters),
    output: {
      schema: compileValue(options.output.schema ?? { type: 'object', additionalProperties: true }),
      render: (args, value) => options.output.render(args, value),
    },
    async execute(args, exec) {
      return await options.execute(args ?? {}, exec)
    },
  }
  if (options.isConcurrencySafe !== undefined) definition.isConcurrencySafe = (args) => options.isConcurrencySafe(args) === true
  if (options.presentCall !== undefined) definition.presentCall = (args) => options.presentCall(args)
  if (options.presentResult !== undefined) definition.presentResult = (args, result) => options.presentResult(args, result)
  if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) definition.timeoutMs = options.timeoutMs
  return definition
}
