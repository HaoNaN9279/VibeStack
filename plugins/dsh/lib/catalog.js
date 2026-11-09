/**
 * Read the platform model-layer catalog from `vibe-stack models catalog --json`.
 *
 * The DSH core row runs before any project is resolved, so it cannot use the
 * resolve plan to learn the layer list. This module is the second read-only
 * boundary into the platform catalog and never contains layer definitions.
 */

import { execFile } from 'node:child_process'

import {
  cliCandidates,
  defaultExecute,
  errorText,
  isMissingCommand,
  resolveTimeout,
} from './resolve.js'

/** Catalog API version emitted by `vibe-stack models catalog --json`. */
export const CATALOG_SCHEMA_VERSION = 1
/** Catalog argv after the executable. */
export const CATALOG_ARGS = Object.freeze(['models', 'catalog', '--json'])

/**
 * Parse a catalog payload.
 * @param {string} stdout - raw command output.
 * @returns {{layers: object[], default: string | null, warnings: string[]}} catalog.
 * @throws {Error} when the payload is not a supported catalog.
 */
export function parseCatalog(stdout) {
  let parsed
  try {
    parsed = JSON.parse(String(stdout ?? '').replace(/^\uFEFF/u, ''))
  } catch {
    throw new Error('catalog response is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('catalog response is not a JSON object')
  }
  if (parsed.schema_version !== CATALOG_SCHEMA_VERSION) {
    throw new Error(`unsupported catalog schema_version: ${String(parsed.schema_version)}`)
  }
  if (!Array.isArray(parsed.layers)) throw new Error('catalog layers must be an array')
  const layers = []
  for (const item of parsed.layers) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    if (typeof item.id !== 'string' || item.id.length === 0) continue
    if (typeof item.label !== 'string' || item.label.length === 0) continue
    layers.push({
      id: item.id,
      label: item.label,
      description: typeof item.description === 'string' ? item.description : '',
      kind: typeof item.kind === 'string' ? item.kind : '',
      rank: Number.isFinite(item.rank) ? item.rank : layers.length + 1,
    })
  }
  const wanted = typeof parsed.default === 'string' ? parsed.default.trim() : ''
  return {
    layers,
    default: wanted.length > 0 ? wanted : null,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item) => typeof item === 'string')
      : [],
  }
}

/**
 * Run `vibe-stack models catalog --json` and return a defensive snapshot.
 * @param {string} configured - explicit executable from row config.
 * @param {(command: string, args: string[], options: Record<string, unknown>) => Promise<{stdout: string, stderr: string}>} [execute] - injectable spawn.
 * @param {number} [timeoutMs] - timeout override.
 * @returns {Promise<{layers: object[], default: string | null, warnings: string[]}>} catalog; empty on failure.
 */
export async function loadCatalog(configured = '', execute = defaultExecute, timeoutMs = 5000) {
  const options = {
    timeout: resolveTimeout(timeoutMs),
    maxBuffer: 16 * 1024 * 1024,
  }
  let lastError = ''
  for (const command of cliCandidates(configured)) {
    let result
    try {
      result = await execute(command, [...CATALOG_ARGS], options)
    } catch (error) {
      lastError = errorText(error)
      if (isMissingCommand(error)) continue
      break
    }
    try {
      return parseCatalog(result.stdout)
    } catch (error) {
      return {
        layers: [],
        default: null,
        warnings: [`vibe-stack models catalog returned an invalid payload: ${errorText(error)}`],
      }
    }
  }
  return {
    layers: [],
    default: null,
    warnings: [`vibe-stack models catalog failed: ${lastError || 'command not found'}`],
  }
}
