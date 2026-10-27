/**
 * Capability-group skills as a DSH skill provider.
 *
 * The provider reports the paths the resolver validated; it never scans
 * capability-group directories and never decides which version wins. Skill
 * bodies are read on demand and frontmatter is stripped because the resolver
 * already validated and reported the metadata.
 */

import path from 'node:path'

import { stripFrontmatter } from './rules.js'

/** Provider name registered on `ctx.skills`. */
export const PROVIDER_NAME = 'vibestack'
/** Project-level rank: after `.dsh/skills` and `.agents/skills`, before custom roots. */
export const SKILL_RANK = 250

/**
 * Map resolved skills to provider-neutral candidates.
 * @param {Record<string, unknown>} plan - normalized resolve plan.
 * @returns {{name: string, description: string, directory: string}[]} unique candidates in plan order.
 */
export function skillCandidates(plan) {
  const seen = new Set()
  const candidates = []
  const skills = Array.isArray(plan?.skills) ? plan.skills : []
  for (const skill of skills) {
    if (!skill || typeof skill.name !== 'string' || typeof skill.path !== 'string') continue
    if (skill.name.length === 0 || skill.path.length === 0) continue
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    candidates.push({
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
      directory: skill.path,
    })
  }
  return candidates
}

/**
 * Build one DSH skill candidate.
 * @param {{name: string, description: string, directory: string}} entry - resolved skill.
 * @returns {Record<string, unknown>} provider candidate.
 */
export function toCandidate(entry) {
  const directory = entry.directory
  const file = path.join(directory, 'SKILL.md')
  return {
    name: entry.name,
    description: entry.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'vibestack',
    rank: SKILL_RANK,
    locator: { path: file, directory },
    resourceBase: { kind: 'directory', path: directory },
    path: file,
  }
}

/**
 * Create the provider object handed to `ctx.skills.registerProvider`.
 * @param {{getPlan: (cwd: string) => Promise<Record<string, unknown> | null>, read?: (file: string) => Promise<string>}} deps - plan lookup and reader.
 * @returns {{name: string, list: Function, get: Function}} provider.
 */
export function createSkillProvider(deps) {
  const read = deps.read ?? (async (file) => {
    const { readFile } = await import('node:fs/promises')
    return readFile(file, 'utf8')
  })
  return {
    name: PROVIDER_NAME,
    async list(options = {}) {
      const cwd = options?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) return []
      const plan = await deps.getPlan(cwd)
      if (!plan || plan.active !== true) return []
      return skillCandidates(plan).map(toCandidate)
    },
    async get(candidate) {
      const file = candidate?.locator?.path
      if (typeof file !== 'string' || file.length === 0) return undefined
      const text = await read(file)
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation ?? { modelInvocable: true, userInvocable: true },
        provider: PROVIDER_NAME,
        source: 'vibestack',
        resourceBase: candidate.resourceBase,
        path: file,
        content: stripFrontmatter(text),
      }
    },
  }
}

/**
 * Read the plugin's own skill bundle.
 * @param {string} text - raw `SKILL.md` content.
 * @returns {{name: string, description: string, content: string}} parsed skill.
 */
export function readSkillFile(text) {
  const value = String(text ?? '').replace(/^\uFEFF/u, '')
  const name = (value.match(/^name:\s*(.+)$/mu)?.[1] ?? '').trim()
  const description = (value.match(/^description:\s*(.+)$/mu)?.[1] ?? '').trim()
  return { name, description, content: stripFrontmatter(value) }
}
