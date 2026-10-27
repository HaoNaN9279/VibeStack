/**
 * The only boundary between this plugin and VibeStack: `vibe-stack resolve`.
 *
 * The plugin never scans capability groups, chooses versions, resolves
 * `extends`, or parses frontmatter. Every failure is reported as a warning and
 * an absent plan, so the mode still starts and DSH stays usable.
 */

import { execFile } from 'node:child_process'

/** Supported resolve API version. */
export const RESOLVE_SCHEMA_VERSION = 1

const MAX_BUFFER = 16 * 1024 * 1024

/**
 * Candidate executables, in priority order.
 * @param {string} configured - explicit path from row config.
 * @returns {string[]} non-empty candidates.
 */
export function cliCandidates(configured) {
  const candidates = [configured, process.env.VIBESTACK_CLI]
  if (process.platform === 'win32') candidates.push('vibe-stack.exe')
  candidates.push('vibe-stack')
  return [...new Set(candidates.filter((value) => typeof value === 'string' && value.length > 0))]
}

/**
 * Resolve the effective timeout, honouring the environment override.
 * @param {number} configured - row config value.
 * @returns {number} timeout in milliseconds.
 */
export function resolveTimeout(configured) {
  const raw = Number(process.env.VIBESTACK_RESOLVE_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw > 0) return raw
  return Number.isFinite(configured) && configured > 0 ? configured : 5000
}

/**
 * Parse and version-check resolve output.
 * @param {string} stdout - raw command output.
 * @returns {Record<string, unknown>} the validated plan envelope.
 * @throws {Error} when the payload is not JSON or uses another schema version.
 */
export function parsePlan(stdout) {
  let parsed
  try {
    parsed = JSON.parse(String(stdout ?? '').replace(/^\uFEFF/u, ''))
  } catch {
    throw new Error('response is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('response is not a JSON object')
  }
  if (parsed.schema_version !== RESOLVE_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version: ${String(parsed.schema_version)}`)
  }
  return parsed
}

/**
 * Normalise one plan into the fields the plugin maps.
 * @param {Record<string, unknown>} plan - validated resolve envelope.
 * @returns {Record<string, unknown>} plan with defensive defaults.
 */
export function normalizePlan(plan) {
  const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    ...plan,
    active: plan.active === true,
    project: typeof plan.project === 'string' ? plan.project : '',
    rules: list(plan.rules),
    skills: list(plan.skills),
    agents: record(plan.agents),
    commands: record(plan.commands),
    mcp: record(plan.mcp),
    warnings: list(plan.warnings).filter((item) => typeof item === 'string'),
  }
}

/**
 * Run `vibe-stack resolve --json --project <dir>`.
 * @param {string} projectDir - absolute session working directory.
 * @param {import('./config.js').DEFAULT_CONFIG} config - resolved plugin config.
 * @param {(command: string, args: string[], options: Record<string, unknown>) => Promise<{stdout: string, stderr: string}>} [execute] - injectable spawn.
 * @returns {Promise<{plan: Record<string, unknown> | null, warnings: string[]}>} plan or warnings.
 */
export async function resolvePlan(projectDir, config, execute = defaultExecute) {
  const args = ['resolve', '--json', '--project', projectDir]
  const options = { timeout: resolveTimeout(config.timeoutMs), maxBuffer: MAX_BUFFER }
  const warnings = []
  let lastError = ''
  for (const command of cliCandidates(config.command)) {
    let result
    try {
      result = await execute(command, args, options)
    } catch (error) {
      lastError = errorText(error)
      if (isMissingCommand(error)) continue
      break
    }
    try {
      const plan = normalizePlan(parsePlan(result.stdout))
      warnings.push(...plan.warnings)
      return { plan, warnings }
    } catch (error) {
      return { plan: null, warnings: [`vibe-stack resolve returned an invalid plan: ${errorText(error)}`] }
    }
  }
  return { plan: null, warnings: [`vibe-stack resolve failed: ${lastError || 'command not found'}`] }
}

/**
 * Default spawn implementation.
 * @param {string} command - executable.
 * @param {string[]} args - argv.
 * @param {{timeout: number, maxBuffer: number}} options - spawn limits.
 * @returns {Promise<{stdout: string, stderr: string}>} captured output.
 */
export function defaultExecute(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }))
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}

/**
 * Whether a spawn failure means the executable is absent.
 * @param {unknown} error - spawn failure.
 * @returns {boolean} true for ENOENT.
 */
export function isMissingCommand(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'ENOENT')
}

/**
 * Prefer captured stderr, then the error message.
 * @param {unknown} error - failure value.
 * @returns {string} human-readable text.
 */
export function errorText(error) {
  if (error && typeof error === 'object') {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    if (stderr) return stderr
  }
  if (error instanceof Error) return error.message
  return String(error)
}
