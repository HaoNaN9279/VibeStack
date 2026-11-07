/**
 * The root `ctx.vibestack` service.
 *
 * It exposes model-layer resolution to the preset row and to other plugins
 * (HNFlow), and it owns reload/write through the settings route. It never
 * exposes the config file path, credentials, or DSH's model directory.
 */

import {
  layersDigest,
  readModels,
  resolveModelsPath,
  writeModels,
} from './layers.js'

/** Service API version consumed by HNFlow and other plugins. */
export const API_VERSION = 2

/** Host-only write seam; not part of the public service surface. */
const WRITE_MODELS = Symbol('vibestack.writeModels')

/**
 * Write through the host-only seam.
 * @param {VibeStackService} service - layer service.
 * @param {{layers?: unknown, default?: unknown}} input - proposed section.
 * @returns {Promise<object>} result.
 */
export function saveModels(service, input) {
  return service[WRITE_MODELS](input)
}

/**
 * Model-layer service with an in-memory snapshot.
 */
export class VibeStackService {
  /** Private config path; never exposed on the service surface. */
  #file

  /**
   * @param {{ctx: Record<string, unknown>, modelsFile?: string, logger?: object}} options - wiring.
   */
  constructor(options) {
    this.ctx = options.ctx
    this.#file = resolveModelsPath(options.modelsFile)
    this.logger = options.logger
    this.layers = []
    this.default = null
    this.warnings = []
    this.digest = layersDigest([])
  }

  /** Service contract version. */
  get apiVersion() {
    return API_VERSION
  }

  /**
   * Read the configured layers.
   * @returns {{id: string, label: string, provider: string, model: string, reasoningEffort?: string, description?: string}[]} copies.
   */
  listLayers() {
    return this.layers.map((layer) => ({ ...layer }))
  }

  /**
   * Resolve one layer by id.
   * @param {unknown} id - layer id.
   * @returns {object | undefined} copy or undefined.
   */
  resolveLayer(id) {
    const wanted = typeof id === 'string' ? id : String(id ?? '')
    const layer = this.layers.find((entry) => entry.id === wanted)
    return layer === undefined ? undefined : { ...layer }
  }

  /**
   * The configured default layer id.
   * @returns {string | null} id or null.
   */
  defaultLayer() {
    return this.default
  }

  /**
   * Whether a layer id exists.
   * @param {unknown} name - layer id.
   * @returns {boolean} true when defined.
   */
  hasModel(name) {
    return this.resolveLayer(name) !== undefined
  }

  /**
   * Latest load warnings.
   * @returns {string[]} warnings.
   */
  listWarnings() {
    return [...this.warnings]
  }

  /**
   * Re-read the config file; keep the previous snapshot when it is unreadable.
   * @returns {Promise<{layers: object[], default: string | null, warnings: string[]}>} snapshot.
   */
  async reload() {
    try {
      const next = await readModels(this.#file)
      this.layers = next.layers
      this.default = next.default
      this.warnings = next.warnings
      this.digest = layersDigest(next.layers)
      for (const warning of next.warnings) this.logger?.warn?.(`vibestack: ${warning}`)
      return { layers: this.listLayers(), default: this.default, warnings: this.listWarnings() }
    } catch (error) {
      this.warnings = [`cannot load model layers: ${String(error?.message ?? error)}`]
      this.logger?.warn?.(`vibestack: ${this.warnings[0]}`)
      return { layers: this.listLayers(), default: this.default, warnings: this.listWarnings() }
    }
  }

  /**
   * Validate a proposed models document without writing it.
   * @param {{layers?: unknown, default?: unknown}} input - proposed section.
   * @returns {{ok: boolean, layers: object[], default: string | null, warnings: string[], code?: string}} validation.
   */
  validate(input) {
    const warnings = []
    const layers = []
    const seen = new Set()
    const raw = Array.isArray(input?.layers) ? input.layers : []
    if (input?.layers !== undefined && !Array.isArray(input.layers)) {
      return { ok: false, layers: [], default: null, warnings: ['layers must be an array'], code: 'layers-invalid' }
    }
    for (const [index, item] of raw.entries()) {
      const layer = normalizeProposed(item, index, warnings)
      if (layer === null) continue
      if (seen.has(layer.id)) {
        warnings.push(`duplicate layer id: ${layer.id}`)
        continue
      }
      seen.add(layer.id)
      layers.push(layer)
    }
    const wanted = typeof input?.default === 'string' ? input.default.trim() : ''
    const defaultId = wanted.length > 0 && seen.has(wanted) ? wanted : null
    if (wanted.length > 0 && defaultId === null) warnings.push(`default references an unknown layer: ${wanted}`)
    return {
      ok: warnings.length === 0,
      layers,
      default: defaultId,
      warnings,
      ...(warnings.length === 0 ? {} : { code: 'layers-invalid' }),
    }
  }

  /**
   * Validate, write, and reload a models document.
   * @param {{layers?: unknown, default?: unknown}} input - proposed section.
   * @returns {Promise<{ok: boolean, layers: object[], default: string | null, warnings: string[], code?: string}>} result.
   */
  async [WRITE_MODELS](input) {
    const validated = this.validate(input)
    if (!validated.ok) return validated
    try {
      await writeModels(this.#file, { layers: validated.layers, default: validated.default })
    } catch (error) {
      return {
        ok: false,
        layers: this.listLayers(),
        default: this.default,
        warnings: [`cannot write model layers: ${String(error?.message ?? error)}`],
        code: 'write-failed',
      }
    }
    await this.reload()
    return { ok: true, layers: this.listLayers(), default: this.default, warnings: this.listWarnings() }
  }

  /**
   * Optionally check layers against DSH's live model catalog.
   * @param {AbortSignal} [signal] - optional cancellation.
   * @returns {Promise<{available: object[], unroutable: object[], error?: string}>} catalog check.
   */
  async catalog(signal) {
    signal?.throwIfAborted?.()
    const llm = this.ctx.get?.('llm')
    if (!llm || typeof llm.listProviders !== 'function') {
      return { available: [], unroutable: [], error: 'llm service unavailable' }
    }
    const available = []
    const unroutable = []
    for (const layer of this.layers) {
      try {
        const providers = llm.listProviders()
        const provider = providers.find((entry) => entry.id === layer.provider)
        if (!provider) throw new Error(`unknown provider: ${layer.provider}`)
        const models = await llm.listModels(layer.provider)
        const model = models.find((entry) => entry.id === layer.model)
        if (!model) throw new Error(`unknown model: ${layer.model}`)
        if (layer.reasoningEffort !== undefined && typeof llm.resolveModelInfo === 'function') {
          const info = await llm.resolveModelInfo(layer.provider, layer.model)
          const efforts = info?.reasoning?.efforts ?? []
          if (efforts.length > 0 && !efforts.some((effort) => effort.id === layer.reasoningEffort)) {
            throw new Error(`unknown reasoning effort: ${layer.reasoningEffort}`)
          }
        }
        available.push({ ...layer })
      } catch (error) {
        unroutable.push({ ...layer, reason: String(error?.message ?? error) })
      }
    }
    return { available, unroutable }
  }
}

/**
 * Strict layer validation for a proposed write.
 * @param {unknown} raw - proposed layer.
 * @param {number} index - position.
 * @param {string[]} warnings - collector.
 * @returns {object | null} layer or null.
 */
function normalizeProposed(raw, index, warnings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`layer #${index + 1} is not an object`)
    return null
  }
  const source = /** @type {Record<string, unknown>} */ (raw)
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (id.length === 0 || id.length > 32 || !/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
    warnings.push(`layer #${index + 1} has invalid id: ${JSON.stringify(source.id ?? '')}`)
    return null
  }
  const provider = typeof source.provider === 'string' ? source.provider.trim() : ''
  const model = typeof source.model === 'string' ? source.model.trim() : ''
  if (provider.length === 0 || model.length === 0) {
    warnings.push(`layer ${id} needs provider and model`)
    return null
  }
  const layer = {
    id,
    label: typeof source.label === 'string' && source.label.trim().length > 0 ? source.label.trim() : id,
    provider,
    model,
  }
  if (typeof source.reasoningEffort === 'string' && source.reasoningEffort.trim().length > 0) {
    layer.reasoningEffort = source.reasoningEffort.trim()
  }
  if (typeof source.description === 'string' && source.description.trim().length > 0) {
    layer.description = source.description.trim()
  }
  return layer
}
