/**
 * The root `ctx.vibestack` service.
 *
 * It merges the platform model-layer catalog (read from
 * `vibe-stack models catalog --json`) with DSH's local bindings and DSH-only
 * custom layers. It never defines a platform layer id or label; an unbound
 * platform layer is listed but cannot be applied.
 */

import {
  DEFAULT_AGENT,
  defaultBindings,
  normalizeBinding,
  normalizeCustomLayers,
  readModels,
  resolveModelsPath,
  stateDigest,
  writeModels,
} from './bindings.js'

/** Service API version consumed by HNFlow and other plugins. */
export const API_VERSION = 3

/** Host-only write seam; not part of the public service surface. */
const WRITE_MODELS = Symbol('vibestack.writeModels')

/**
 * Write through the host-only seam.
 * @param {VibeStackService} service - layer service.
 * @param {{bindings?: unknown, custom?: unknown, default?: unknown, layers?: unknown}} input - proposed state.
 * @returns {Promise<object>} result.
 */
export function saveModels(service, input) {
  return service[WRITE_MODELS](input)
}

/**
 * Coerce the platform catalog into a defensive shape.
 * @param {unknown} raw - catalog layers.
 * @param {string[]} warnings - collector.
 * @returns {{id: string, label: string, description: string, kind: string, rank: number}[]} layers.
 */
export function normalizeCatalog(raw, warnings) {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push('model layer catalog must be an array')
    return []
  }
  const seen = new Set()
  const layers = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      warnings.push('catalog layer is not an object')
      continue
    }
    const source = /** @type {Record<string, unknown>} */ (item)
    const id = typeof source.id === 'string' ? source.id.trim() : ''
    if (id.length === 0 || id.length > 32 || !/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
      warnings.push(`catalog layer has invalid id: ${JSON.stringify(source.id ?? '')}`)
      continue
    }
    if (seen.has(id)) {
      warnings.push(`duplicate catalog layer id: ${id}`)
      continue
    }
    seen.add(id)
    layers.push({
      id,
      label: typeof source.label === 'string' && source.label.trim().length > 0
        ? source.label.trim()
        : id,
      description: typeof source.description === 'string' ? source.description : '',
      kind: typeof source.kind === 'string' ? source.kind : '',
      rank: Number.isFinite(source.rank) ? Number(source.rank) : layers.length + 1,
    })
  }
  return layers
}

/**
 * Model-layer service with an in-memory snapshot.
 */
export class VibeStackService {
  /** Private config path; never exposed on the service surface. */
  #file

  /**
   * @param {{ctx: Record<string, unknown>, modelsFile?: string, modelSelector?: string, logger?: object, catalog?: object[]}} options - wiring.
   */
  constructor(options) {
    this.ctx = options.ctx
    this.#file = resolveModelsPath(options.modelsFile)
    this.logger = options.logger
    this.modelSelector = options.modelSelector === 'replace' ? 'replace' : 'additive'
    this.catalogLayers = []
    this.bindings = defaultBindings()
    this.custom = []
    this.default = null
    this.warnings = []
    this.digest = stateDigest({ bindings: this.bindings, custom: this.custom, default: null })
    if (Array.isArray(options.catalog)) this.setCatalog(options.catalog)
  }

  /** Service contract version. */
  get apiVersion() {
    return API_VERSION
  }

  /**
   * Replace the platform catalog snapshot.
   * @param {unknown} raw - catalog layers.
   * @returns {{layers: object[], warnings: string[]}} applied snapshot.
   */
  setCatalog(raw) {
    const warnings = []
    this.catalogLayers = normalizeCatalog(raw, warnings)
    const platformIds = new Set(this.catalogLayers.map((layer) => layer.id))
    this.custom = this.custom.filter((layer) => {
      if (platformIds.has(layer.id)) {
        warnings.push(`custom layer ${layer.id} shadows a platform layer and was ignored`)
        return false
      }
      return true
    })
    this.warnings = [...this.warnings, ...warnings]
    for (const warning of warnings) this.logger?.warn?.(`vibestack: ${warning}`)
    this.digest = stateDigest({
      catalog: this.catalogLayers,
      bindings: this.bindings,
      custom: this.custom,
      default: this.default,
    })
    return { layers: this.listCatalog(), warnings: [...warnings] }
  }

  /**
   * List every platform layer plus DSH-only custom layers, bound or not.
   * @returns {object[]} catalog rows.
   */
  listCatalog() {
    const rows = this.catalogLayers.map((layer) => {
      const binding = this.bindings[layer.id]
      return binding === undefined
        ? { ...layer, bound: false, custom: false }
        : {
            ...layer,
            provider: binding.provider,
            model: binding.model,
            ...(binding.reasoningEffort === undefined ? {} : { reasoningEffort: binding.reasoningEffort }),
            bound: true,
            custom: false,
          }
    })
    for (const layer of this.custom) {
      rows.push({
        ...layer,
        kind: 'custom',
        rank: layer.rank ?? 1000 + rows.length,
        bound: true,
        custom: true,
      })
    }
    return rows.map((layer) => ({ ...layer }))
  }

  /**
   * List only layers that can be applied to a session.
   * @returns {object[]} bound layers.
   */
  listLayers() {
    return this.listCatalog().filter((layer) => layer.bound === true)
  }

  /**
   * Resolve one appliable layer by id.
   * @param {unknown} id - layer id.
   * @returns {object | undefined} copy or undefined.
   */
  resolveLayer(id) {
    const wanted = typeof id === 'string' ? id : String(id ?? '')
    const layer = this.listLayers().find((entry) => entry.id === wanted)
    return layer === undefined ? undefined : { ...layer }
  }

  /**
   * Whether the catalog knows the layer, bound or not.
   * @param {unknown} id - layer id.
   * @returns {boolean} true when known.
   */
  hasLayer(id) {
    const wanted = typeof id === 'string' ? id : String(id ?? '')
    return this.listCatalog().some((entry) => entry.id === wanted)
  }

  /**
   * The effective default layer: configured, then standard, then first bound.
   * @returns {string | null} id or null.
   */
  defaultLayer() {
    const bound = this.listLayers()
    if (this.default !== null && bound.some((layer) => layer.id === this.default)) return this.default
    if (bound.some((layer) => layer.id === 'standard')) return 'standard'
    return bound[0]?.id ?? null
  }

  /**
   * Whether a layer id exists and is bound.
   * @param {unknown} name - layer id.
   * @returns {boolean} true when appliable.
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
   * Re-read bindings; keep the previous snapshot when the file is unreadable.
   * @returns {Promise<{layers: object[], default: string | null, warnings: string[]}>} snapshot.
   */
  async reload() {
    try {
      const reserved = new Set(this.catalogLayers.map((layer) => layer.id))
      const next = await readModels(this.#file, DEFAULT_AGENT, reserved)
      this.bindings = next.bindings
      this.custom = normalizeCustomLayers(next.custom, [], reserved)
      this.default = next.default
      this.warnings = [
        ...next.warnings,
        ...this.warnings.filter((warning) => !warning.startsWith('cannot load model layers')),
      ]
      this.digest = stateDigest({
        catalog: this.catalogLayers,
        bindings: this.bindings,
        custom: this.custom,
        default: this.default,
      })
      for (const warning of next.warnings) this.logger?.warn?.(`vibestack: ${warning}`)
      return { layers: this.listCatalog(), default: this.defaultLayer(), warnings: this.listWarnings() }
    } catch (error) {
      this.warnings = [`cannot load model layers: ${String(error?.message ?? error)}`]
      this.logger?.warn?.(`vibestack: ${this.warnings[0]}`)
      return { layers: this.listCatalog(), default: this.defaultLayer(), warnings: this.listWarnings() }
    }
  }

  /**
   * Validate a proposed state without writing it.
   * @param {{bindings?: unknown, custom?: unknown, default?: unknown, layers?: unknown}} input - proposed state.
   * @returns {{ok: boolean, bindings: object, custom: object[], default: string | null, warnings: string[], code?: string}} validation.
   */
  validate(input) {
    const warnings = []
    const platformIds = new Set(this.catalogLayers.map((layer) => layer.id))
    const bindings = {}
    let custom = []
    const proposed = input && typeof input === 'object' ? input : {}

    if (Array.isArray(proposed.layers)) {
      // Compatibility with the pre-platform-client shape: split the flat list
      // into platform bindings and DSH custom layers.
      const customRaw = []
      for (const item of proposed.layers) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          warnings.push('layer entry is not an object')
          continue
        }
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        const normalized = id === 'flash' ? 'fast' : id
        if (platformIds.has(normalized)) {
          const binding = normalizeBinding(item, normalized, warnings)
          if (binding !== null) bindings[normalized] = binding
        } else {
          customRaw.push({ ...item, id: normalized })
        }
      }
      custom = normalizeCustomLayers(customRaw, warnings, platformIds)
    } else {
      if (proposed.bindings === undefined) {
        for (const [id, binding] of Object.entries(this.bindings)) {
          if (platformIds.has(id)) bindings[id] = { ...binding }
        }
      } else if (!proposed.bindings || typeof proposed.bindings !== 'object' || Array.isArray(proposed.bindings)) {
        warnings.push('bindings must be an object')
      } else {
        for (const [rawId, value] of Object.entries(proposed.bindings)) {
          if (!platformIds.has(rawId)) {
            warnings.push(`unknown platform layer: ${rawId}`)
            continue
          }
          const binding = normalizeBinding(value, rawId, warnings)
          if (binding !== null) bindings[rawId] = binding
        }
      }
      if (proposed.custom !== undefined) {
        custom = normalizeCustomLayers(proposed.custom, warnings, platformIds)
      } else {
        custom = this.custom.map((layer) => ({ ...layer }))
      }
    }

    let defaultId = proposed.default === undefined
      ? this.default
      : typeof proposed.default === 'string'
        ? proposed.default.trim()
        : null
    if (defaultId !== null && defaultId.length === 0) defaultId = null
    if (defaultId !== null && !platformIds.has(defaultId) && !custom.some((layer) => layer.id === defaultId)) {
      warnings.push(`default references an unknown layer: ${defaultId}`)
    }
    return {
      ok: warnings.length === 0,
      bindings,
      custom,
      default: defaultId,
      warnings,
      ...(warnings.length === 0 ? {} : { code: 'layers-invalid' }),
    }
  }

  /**
   * Validate, write, and reload a state document.
   * @param {{bindings?: unknown, custom?: unknown, default?: unknown, layers?: unknown}} input - proposed state.
   * @returns {Promise<{ok: boolean, layers: object[], default: string | null, warnings: string[], code?: string}>} result.
   */
  async [WRITE_MODELS](input) {
    if (this.catalogLayers.length === 0) {
      return {
        ok: false,
        layers: this.listCatalog(),
        default: this.defaultLayer(),
        warnings: ['platform model layer catalog is unavailable; restart after `vibe-stack` is installed'],
        code: 'catalog-unavailable',
      }
    }
    const validated = this.validate(input)
    if (!validated.ok) {
      return {
        ok: false,
        layers: this.listCatalog(),
        default: this.defaultLayer(),
        warnings: validated.warnings,
        code: validated.code,
      }
    }
    try {
      await writeModels(this.#file, {
        bindings: validated.bindings,
        custom: validated.custom.map((layer) => ({
          id: layer.id,
          label: layer.label,
          ...(layer.description ? { description: layer.description } : {}),
          provider: layer.provider,
          model: layer.model,
          ...(layer.reasoningEffort ? { reasoningEffort: layer.reasoningEffort } : {}),
        })),
        default: validated.default,
      })
    } catch (error) {
      return {
        ok: false,
        layers: this.listCatalog(),
        default: this.defaultLayer(),
        warnings: [`cannot write model layers: ${String(error?.message ?? error)}`],
        code: 'write-failed',
      }
    }
    await this.reload()
    return {
      ok: true,
      layers: this.listCatalog(),
      default: this.defaultLayer(),
      warnings: this.listWarnings(),
    }
  }

  /**
   * Optionally check bound layers against DSH's live model catalog.
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
    for (const layer of this.listLayers()) {
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
