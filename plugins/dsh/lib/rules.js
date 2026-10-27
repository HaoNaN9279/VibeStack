/**
 * Rule rendering.
 *
 * VibeStack rules are workspace instructions, so they reach the model the way
 * `dsh-agent-instructions` delivers AGENTS.md: one persistent user-role
 * `<system-reminder>` message. Only the rule body is used; the resolver already
 * validated the frontmatter.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const CLOSING = '</system-reminder>'

/**
 * Remove a leading YAML frontmatter block.
 * @param {string} text - raw file content.
 * @returns {string} trimmed body without frontmatter.
 */
export function stripFrontmatter(text) {
  const value = String(text ?? '').replace(/^\uFEFF/u, '')
  if (!value.startsWith('---')) return value.trim()
  const close = value.indexOf('\n---', 3)
  if (close === -1) return value.trim()
  const bodyStart = value.indexOf('\n', close + 4)
  return (bodyStart === -1 ? '' : value.slice(bodyStart + 1)).trim()
}

/**
 * Neutralise a literal closing tag inside plugin-controlled framing.
 * @param {string} text - untrusted rule text.
 * @returns {string} text that cannot close the reminder early.
 */
export function escapeReminder(text) {
  return String(text ?? '').replaceAll(CLOSING, '&lt;/system-reminder&gt;')
}

/**
 * Hash rendered instructions for idempotent injection.
 * @param {string} text - rendered message body.
 * @returns {string} sha256 hex digest.
 */
export function digestOf(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

/**
 * Render the rules message for one plan.
 * @param {Record<string, unknown>} plan - normalized resolve plan.
 * @param {{read?: (file: string) => Promise<string>, maxBytes?: number}} [options] - injectable reader and budget.
 * @returns {Promise<{text: string, digest: string, paths: string[]} | null>} rendered rules, or null when empty.
 */
export async function renderRules(plan, options = {}) {
  const read = options.read ?? ((file) => readFile(file, 'utf8'))
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 65536
  const rules = Array.isArray(plan?.rules) ? plan.rules : []
  if (rules.length === 0) return null

  const header = [
    '<system-reminder>',
    "The following workspace instructions come from this project's VibeStack capability groups. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.",
  ]
  const footer = ['</system-reminder>']
  const parts = []
  let bytes = Buffer.byteLength(header.join('\n\n'), 'utf8') + Buffer.byteLength(footer[0], 'utf8')
  const paths = []

  for (const rule of rules) {
    if (!rule || typeof rule.path !== 'string' || rule.path.length === 0) continue
    let body
    try {
      body = stripFrontmatter(await read(rule.path))
    } catch {
      continue
    }
    if (body.length === 0) continue
    const label = rule.group ? `Instructions from: ${rule.path} (group: ${String(rule.group)})` : `Instructions from: ${rule.path}`
    const block = `${label}\n\n${escapeReminder(body)}`
    const size = Buffer.byteLength(block, 'utf8')
    if (bytes + size > maxBytes) {
      parts.push(`[VibeStack: remaining rules were omitted to stay within ${maxBytes} bytes]`)
      break
    }
    bytes += size
    parts.push(block)
    paths.push(rule.path)
  }

  if (parts.length === 0) return null
  const text = `${header.join('\n\n')}\n\n${parts.join('\n\n')}\n${footer[0]}`
  return { text, digest: digestOf(text), paths }
}
