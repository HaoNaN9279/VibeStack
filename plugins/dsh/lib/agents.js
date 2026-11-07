/**
 * VibeStack agents: the session persona projection.
 *
 * DSH validates every stored event against a first-party type table, and only
 * tolerates an unknown type when its envelope carries `ignorable: true` —
 * something a live `Session.append()` cannot set. A plugin that invents event
 * types therefore makes the session unopenable after a restart, so this module
 * derives the projection from events the harness already writes:
 *
 * - `user/message`: the plugin's instructions message carries the roster in its
 *   `source` field, which never reaches the model;
 * - `command/run`: `/vibestack-agent <name>` is logged by the command executor
 *   before the handler runs, so the selection survives restarts.
 *
 * The client reads the projection through `useProjection('vibestack')`.
 */

import { createHash } from 'node:crypto'

/** Projection key readable from the client as `useProjection('vibestack')`. */
export const PROJECTION_KEY = 'vibestack'
/** Projection layout version; bump when fields or fold semantics change. */
export const PROJECTION_VERSION = 3
/** Command that selects the session persona. */
export const SELECT_COMMAND = 'vibestack-agent'
/** `source.kind` of every message this plugin injects. */
export const SOURCE_KIND = 'vibestack'

/** Message-source kinds that carry a roster. */
const ROSTER_VERSION = 1
/** Command names the executor may log for a selection. */
const SELECT_NAMES = new Set([SELECT_COMMAND, `/${SELECT_COMMAND}`])

const identitySchema = { parse: (value) => value }

const EMPTY_STATE = Object.freeze({
  agents: [],
  selected: null,
  active: false,
  project: '',
})

/**
 * Describe agents from a plan.
 * @param {Record<string, unknown>} plan - normalized resolve plan.
 * @returns {{name: string, description: string, mode: string, system: string, group: string}[]} agents in plan order.
 */
export function agentList(plan) {
  const agents = plan?.agents && typeof plan.agents === 'object' ? plan.agents : {}
  const list = []
  for (const [name, value] of Object.entries(agents)) {
    if (!value || typeof value !== 'object') continue
    if (typeof name !== 'string' || name.length === 0) continue
    list.push({
      name,
      description: typeof value.description === 'string' ? value.description : '',
      mode: typeof value.mode === 'string' ? value.mode : 'all',
      system: typeof value.system === 'string' ? value.system : '',
      group: typeof value.group === 'string' ? value.group : '',
      model: typeof value.model === 'string' ? value.model : '',
    })
  }
  return list
}

/**
 * Agents that can become a session persona (`subagent`-only agents cannot).
 * @param {{mode: string}[]} list - agent list.
 * @returns {{mode: string}[]} persona candidates.
 */
export function personaAgents(list) {
  return list.filter((agent) => agent.mode !== 'subagent')
}

/**
 * Strip host-only fields before publishing the roster.
 * @param {{name: string, description: string, mode: string, group?: string}[]} list - agent list.
 * @returns {{name: string, description: string, mode: string, group: string}[]} publishable rows.
 */
export function agentSummaries(list) {
  return list.map((agent) => ({
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    group: typeof agent.group === 'string' ? agent.group : '',
    model: typeof agent.model === 'string' ? agent.model : '',
  }))
}

/**
 * Choose the default persona: explicit preference, then `Athena`, then none.
 * @param {{name: string}[]} list - persona candidates.
 * @param {string} [preferred] - configured default agent name.
 * @returns {string | null} selected name.
 */
export function pickDefaultAgent(list, preferred = '') {
  const want = String(preferred ?? '').trim().toLowerCase()
  if (want.length > 0) {
    const found = list.find((agent) => agent.name.toLowerCase() === want)
    if (found) return found.name
  }
  const athena = list.find((agent) => agent.name.toLowerCase() === 'athena')
  return athena ? athena.name : null
}

/**
 * Compare two rosters by published fields.
 * @param {{name: string, description: string, mode: string, group?: string}[]} left - first roster.
 * @param {{name: string, description: string, mode: string, group?: string}[]} right - second roster.
 * @returns {boolean} true when nothing user-visible changed.
 */
export function sameRoster(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  return left.every((agent, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      agent.name === other.name &&
      agent.description === other.description &&
      agent.mode === other.mode &&
      (agent.group ?? '') === (other.group ?? '') &&
      (agent.model ?? '') === (other.model ?? '')
    )
  })
}

/**
 * Stable identity of one roster payload.
 *
 * Selection is deliberately excluded: switching personas must not count as a
 * roster change, or every switch would re-inject the instructions message.
 * @param {{name: string}[]} agents - published rows.
 * @param {string} project - project root reported by the resolver.
 * @param {string | null} defaultSelected - configured default persona.
 * @returns {string} short hex key.
 */
export function rosterKeyOf(agents, project, defaultSelected) {
  const payload = JSON.stringify({ agents, project, defaultSelected: defaultSelected ?? null })
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32)
}

/**
 * Build the roster payload carried by the instructions message source.
 * @param {{name: string, description: string, mode: string}[]} list - persona candidates.
 * @param {string | null} defaultSelected - configured default persona.
 * @param {string} project - project root reported by the resolver.
 * @returns {{version: number, key: string, agents: object[], project: string, defaultSelected: string | null}} payload.
 */
export function createRoster(list, defaultSelected, project) {
  const agents = agentSummaries(list)
  const wanted = typeof defaultSelected === 'string' && defaultSelected.length > 0 ? defaultSelected : null
  const where = typeof project === 'string' ? project : ''
  return {
    version: ROSTER_VERSION,
    key: rosterKeyOf(agents, where, wanted),
    agents,
    project: where,
    defaultSelected: wanted,
  }
}

/**
 * Read a roster out of one stored event.
 * @param {{type?: string, data?: unknown}} event - session event.
 * @returns {{agents: object[], project: string, defaultSelected: string | null} | null} roster, or null when the event carries none.
 */
export function rosterFromEvent(event) {
  if (event?.type !== 'user/message') return null
  const data = event.data
  if (!data || typeof data !== 'object') return null
  const source = data.source
  if (!source || typeof source !== 'object' || source.kind !== SOURCE_KIND) return null
  const roster = source.roster
  if (!roster || typeof roster !== 'object') return null
  const agents = []
  if (Array.isArray(roster.agents)) {
    for (const row of roster.agents) {
      if (!row || typeof row !== 'object') continue
      if (typeof row.name !== 'string' || row.name.length === 0) continue
      agents.push({
        name: row.name,
        description: typeof row.description === 'string' ? row.description : '',
        mode: typeof row.mode === 'string' ? row.mode : 'all',
        group: typeof row.group === 'string' ? row.group : '',
        model: typeof row.model === 'string' ? row.model : '',
      })
    }
  }
  return {
    agents,
    project: typeof roster.project === 'string' ? roster.project : '',
    defaultSelected: typeof roster.defaultSelected === 'string' ? roster.defaultSelected : null,
  }
}

/**
 * Keep the current persona when the new roster still offers it.
 * @param {string | null} current - current selection.
 * @param {{agents: {name: string}[], defaultSelected: string | null}} roster - published roster.
 * @returns {string | null} effective selection.
 */
function settleSelection(current, roster) {
  const names = new Set(roster.agents.map((agent) => agent.name))
  if (typeof current === 'string' && names.has(current)) return current
  if (typeof roster.defaultSelected === 'string' && names.has(roster.defaultSelected)) return roster.defaultSelected
  return null
}

/**
 * Build the session projection definition.
 * @returns {Record<string, unknown>} definition for `sessionProjections.register`.
 */
export function createProjectionDefinition() {
  /** @type {WeakMap<object, object>} */
  const views = new WeakMap()
  return {
    key: PROJECTION_KEY,
    stateVersion: PROJECTION_VERSION,
    stateSchema: identitySchema,
    init: () => ({ ...EMPTY_STATE }),
    apply(state, event) {
      const roster = rosterFromEvent(event)
      if (roster !== null) {
        const selected = settleSelection(state.selected, roster)
        const active = roster.agents.length > 0
        if (
          sameRoster(state.agents, roster.agents) &&
          state.selected === selected &&
          state.active === active &&
          state.project === roster.project
        ) {
          return state
        }
        return { agents: roster.agents, selected, active, project: roster.project }
      }
      if (event?.type === 'command/run') {
        const data = event.data
        if (!data || typeof data !== 'object') return state
        if (typeof data.name !== 'string' || !SELECT_NAMES.has(data.name)) return state
        const args = typeof data.args === 'string' ? data.args.trim().toLowerCase() : ''
        if (args.length === 0 || args === 'list') return state
        const match = state.agents.find((agent) => agent.name.toLowerCase() === args)
        if (match === undefined || state.selected === match.name) return state
        return { ...state, selected: match.name }
      }
      return state
    },
    wire: {
      viewSchema: identitySchema,
      view(state) {
        const cached = views.get(state)
        if (cached !== undefined) return cached
        const view = {
          agents: state.agents,
          selected: state.selected,
          active: state.active,
          project: state.project,
        }
        views.set(state, view)
        return view
      },
    },
  }
}
