/**
 * Plugin configuration: defaults and defensive coercion.
 *
 * The row config comes from `cordis.patch.yml` or a user's profile patch, so
 * every value is treated as untrusted and unknown keys are ignored instead of
 * failing the mode.
 */

export const DEFAULT_CONFIG = Object.freeze({
  /** `false` turns this row into the client-only UI row. */
  host: true,
  /** Explicit `vibe-stack` executable. Empty means auto-discovery. */
  command: '',
  /** Resolve CLI timeout in milliseconds. */
  timeoutMs: 5000,
  /** Inject capability-group rules as workspace instructions. */
  rules: true,
  /** Expose capability-group skills to the agent. */
  skills: true,
  /** Register capability-group commands (and `/vibestack-agent`). */
  commands: true,
  /** Surface capability-group agents in the session picker. */
  agents: true,
  /** Mount capability-group MCP servers for this agent. */
  mcp: true,
  /** Upper bound for the rendered rules message. */
  maxRulesBytes: 65536,
  /** Preferred default agent name; empty falls back to `Athena`. */
  defaultAgent: '',
})

/**
 * Coerce a raw row config into the plugin's config shape.
 * @param {unknown} raw - config object from the composition.
 * @returns {typeof DEFAULT_CONFIG} resolved configuration.
 */
export function resolveConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  /** @type {Record<string, unknown>} */
  const config = { ...DEFAULT_CONFIG }
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
    const value = source[key]
    if (value === undefined || value === null) continue
    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') config[key] = value
      continue
    }
    if (typeof fallback === 'number') {
      if (Number.isFinite(value) && value > 0) config[key] = Math.floor(value)
      continue
    }
    if (typeof value === 'string') config[key] = value
  }
  return config
}
