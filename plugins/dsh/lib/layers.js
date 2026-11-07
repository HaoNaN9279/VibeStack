/**
 * Model layers: user-owned named routes into DSH's model catalog.
 *
 * A layer is only `{id, label, provider, model, reasoningEffort?, description?}`.
 * It never contains credentials, and it is stored outside capability groups so
 * a shared group can reference `model: <layer>` without leaking machine routes.
 *
 * The global VibeStack config is `~/.config/vibestack/config.json`; its
 * `models` section is `{default, layers}`. Writes are atomic and preserve every
 * other section of the file.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Layer id grammar; also used by the resolver's `model:` syntax check. */
export const LAYER_ID = /^[a-z0-9][a-z0-9_-]*$/u
/** Maximum layer id length. */
export const MAX_LAYER_ID = 32
/** Default global config path below the home directory. */
export const CONFIG_RELATIVE = path.join('.config', 'vibestack', 'config.json')

/**
 * Built-in generic layer used when the user has not configured any layers.
 * It matches the DSH desktop default (`deepseek-account` / `deepseek-flash`).
 */
export const BUILTIN_LAYER = Object.freeze({
  id: 'flash',
  label: 'DeepSeek Flash（通用）',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  description: '未配置模型层时使用的通用模型适配',
})

/**
 * Append the built-in layer unless the user already defined the same id.
 * @param {object[]} layers - configured layers.
 * @returns {object[]} configured layers plus the generic fallback.
 */
export function withBuiltinLayer(layers) {
  if (layers.some((layer) => layer.id === BUILTIN_LAYER.id)) return layers
  return [...layers, { ...BUILTIN_LAYER }]
}

/**
 * Resolve the layer file path.
 * @param {string} [modelsFile] - row config override; `~` is expanded.
 * @returns {string} absolute path.
 */
export function resolveModelsPath(modelsFile = '') {
  const value = String(modelsFile ?? '').trim()
  if (value.length === 0) return path.join(os.homedir(), CONFIG_RELATIVE)
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return path.resolve(value)
}

/**
 * Coerce one raw layer into the public shape.
 * @param {unknown} raw - layer object.
 * @param {number} index - source index for diagnostics.
 * @param {string[]} warnings - collector.
 * @returns {{id: string, label: string, provider: string, model: string, reasoningEffort?: string, description?: string} | null} layer or null.
 */
export function normalizeLayer(raw, index, warnings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`layer #${index + 1} is not an object`)
    return null
  }
  const source = /** @type {Record<string, unknown>} */ (raw)
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (id.length === 0 || id.length > MAX_LAYER_ID || !LAYER_ID.test(id)) {
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
    label: typeof source.label === 'string' && source.label.trim().length > 0
      ? source.label.trim()
      : id,
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

/**
 * Validate and deduplicate a layer list.
 * @param {unknown} raw - raw layers array.
 * @param {string[]} warnings - collector.
 * @returns {{id: string, label: string, provider: string, model: string, reasoningEffort?: string, description?: string}[]} layers.
 */
export function normalizeLayers(raw, warnings) {
  const list = Array.isArray(raw) ? raw : []
  if (!Array.isArray(raw) && raw !== undefined) warnings.push('models.layers must be an array')
  const seen = new Set()
  const layers = []
  list.forEach((item, index) => {
    const layer = normalizeLayer(item, index, warnings)
    if (layer === null) return
    if (seen.has(layer.id)) {
      warnings.push(`duplicate layer id: ${layer.id}`)
      return
    }
    seen.add(layer.id)
    layers.push(layer)
  })
  return layers
}

/**
 * Read and normalize the models section.
 * @param {string} file - config path.
 * @returns {Promise<{layers: object[], default: string | null, warnings: string[]}>} models.
 */
export async function readModels(file) {
  const warnings = []
  let document = {}
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { layers: [], default: null, warnings }
    throw new Error(`cannot read ${file}: ${String(error?.message ?? error)}`)
  }
  try {
    document = JSON.parse(String(text).replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new Error(`cannot read ${file}: invalid JSON (${String(error?.message ?? error)})`)
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`cannot read ${file}: not a JSON object`)
  }
  const models = document.models
  if (models !== undefined && (models === null || typeof models !== 'object' || Array.isArray(models))) {
    warnings.push('models must be an object')
    return { layers: [], default: null, warnings }
  }
  const layers = normalizeLayers(models?.layers, warnings)
  const wanted = typeof models?.default === 'string' ? models.default.trim() : ''
  const defaultId = wanted.length > 0 && layers.some((layer) => layer.id === wanted) ? wanted : null
  if (wanted.length > 0 && defaultId === null) {
    warnings.push(`models.default references an unknown layer: ${wanted}`)
  }
  return { layers, default: defaultId, warnings }
}

/**
 * Write the models section atomically, preserving the rest of the config.
 * @param {string} file - config path.
 * @param {{layers: object[], default: string | null}} models - normalized models.
 * @returns {Promise<void>} resolves after the rename.
 */
export async function writeModels(file, models) {
  let document = {}
  try {
    const parsed = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) document = parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  document.models = {
    ...(typeof document.models === 'object' && document.models !== null ? document.models : {}),
    default: models.default ?? null,
    layers: models.layers,
  }
  if (document.schema_version === undefined) document.schema_version = 1
  const directory = path.dirname(file)
  await mkdir(directory, { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Hash one layer list for change detection.
 * @param {object[]} layers - layers.
 * @returns {string} short hash.
 */
export function layersDigest(layers) {
  return createHash('sha256').update(JSON.stringify(layers), 'utf8').digest('hex').slice(0, 16)
}
