/**
 * VibeStack agents: the session persona projection.
 *
 * The Agent picker reads one client-visible session projection; the host writes
 * it when a plan resolves and when the user selects an agent. Only display
 * fields travel through the session log — the agent's `system` text stays in
 * the host plan cache and is applied as a scoped system-prompt section.
 */

/** Projection key readable from the client as `useProjection('vibestack')`. */
export const PROJECTION_KEY = 'vibestack'
/** Projection layout version. */
export const PROJECTION_VERSION = 1
/** Command that selects the session persona. */
export const SELECT_COMMAND = 'vibestack-agent'
/** Event that publishes the project's agent roster. */
export const AGENTS_EVENT = 'vibestack/agents'
/** Event that records the selected agent. */
export const SELECT_EVENT = 'vibestack/select'

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
 * @returns {{name: string, description: string, mode: string, system: string}[]} agents in plan order.
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
 * @param {{name: string, description: string, mode: string}[]} list - agent list.
 * @returns {{name: string, description: string, mode: string}[]} publishable rows.
 */
export function agentSummaries(list) {
  return list.map((agent) => ({
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
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
 * @param {{name: string, description: string, mode: string}[]} left - first roster.
 * @param {{name: string, description: string, mode: string}[]} right - second roster.
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
      agent.mode === other.mode
    )
  })
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
      if (event.type === AGENTS_EVENT) {
        const data = event.data && typeof event.data === 'object' ? event.data : {}
        const agents = Array.isArray(data.agents) ? data.agents : []
        const requested = typeof data.selected === 'string' ? data.selected : state.selected
        const selected = agents.some((agent) => agent?.name === requested) ? requested : null
        const active = data.active === true
        const project = typeof data.project === 'string' ? data.project : ''
        if (sameRoster(state.agents, agents) && state.selected === selected && state.active === active && state.project === project) {
          return state
        }
        return { agents, selected, active, project }
      }
      if (event.type === SELECT_EVENT) {
        const id = event.data && typeof event.data.id === 'string' ? event.data.id : null
        if (state.selected === id) return state
        const selected = state.agents.some((agent) => agent?.name === id) ? id : null
        if (selected === state.selected) return state
        return { ...state, selected }
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
