/**
 * Capability-group commands as DSH slash commands.
 *
 * DSH command names are a fixed lowercase grammar, and command handlers run
 * directly against the agent. A VibeStack command is a prompt template, so the
 * handler renders the template and submits it as a normal user message.
 */

/** DSH command-name grammar. */
export const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/**
 * Whether a name can be registered on DSH.
 * @param {unknown} name - candidate name.
 * @returns {boolean} true when the grammar accepts it.
 */
export function validCommandName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 64 && COMMAND_NAME.test(name)
}

/**
 * Extract selectable command definitions from a plan.
 * @param {Record<string, unknown>} plan - normalized resolve plan.
 * @returns {{name: string, description: string, template: string}[]} usable commands.
 */
export function commandEntries(plan) {
  const commands = plan?.commands && typeof plan.commands === 'object' ? plan.commands : {}
  const entries = []
  for (const [name, value] of Object.entries(commands)) {
    if (!validCommandName(name)) continue
    if (!value || typeof value !== 'object') continue
    const description = typeof value.description === 'string' ? value.description.trim() : ''
    const template = typeof value.template === 'string' ? value.template : ''
    if (description.length === 0 || template.length === 0) continue
    entries.push({ name, description, template })
  }
  return entries
}

/**
 * Substitute DSH-supported template placeholders.
 *
 * `$ARGUMENTS` and `$1`..`$9` are supported. `` !`cmd` `` and `@file` are left
 * untouched: this adapter does not run shells or expand file references.
 * @param {string} template - command body from the capability group.
 * @param {string} rawInput - everything the user typed after the command name.
 * @returns {string} rendered prompt text.
 */
export function renderTemplate(template, rawInput) {
  const input = String(rawInput ?? '').trim()
  const args = input.length === 0 ? [] : input.split(/\s+/u)
  return String(template ?? '')
    .replaceAll('$ARGUMENTS', input)
    .replace(/\$([1-9])/gu, (_match, digit) => args[Number(digit) - 1] ?? '')
}
