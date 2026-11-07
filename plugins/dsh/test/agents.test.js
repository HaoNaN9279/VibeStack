/** Agent mapping: roster extraction, defaults, and the session projection. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PROJECTION_KEY,
  SELECT_COMMAND,
  SOURCE_KIND,
  agentList,
  agentSummaries,
  createProjectionDefinition,
  createRoster,
  personaAgents,
  pickDefaultAgent,
  rosterKeyOf,
  rosterFromEvent,
  sameRoster,
} from '../lib/agents.js'

const PLAN = {
  agents: {
    Athena: { description: 'planner', mode: 'all', system: '# Athena', group: 'core' },
    Hermes: { description: 'worker', mode: 'primary', system: '# Hermes', group: 'core' },
    helper: { description: 'child only', mode: 'subagent', system: '# helper', group: 'core' },
  },
}

/**
 * Build the instructions event the plugin writes each step.
 * @param {{key: string, agents: object[], project: string, defaultSelected: string | null}} roster - roster payload.
 * @returns {Record<string, unknown>} session event.
 */
function instructionsEvent(roster) {
  return {
    type: 'user/message',
    data: {
      source: { kind: SOURCE_KIND, form: 'instructions', digest: 'digest', roster },
    },
  }
}

/**
 * Build one `/vibestack-agent` invocation as the executor logs it.
 * @param {string} args - raw command input.
 * @returns {Record<string, unknown>} session event.
 */
function selectEvent(args) {
  return { type: 'command/run', data: { commandId: 'c1', name: SELECT_COMMAND, args, source: { kind: 'user' } } }
}

test('agentList describes every agent in plan order', () => {
  const list = agentList(PLAN)
  assert.deepEqual(list.map((agent) => agent.name), ['Athena', 'Hermes', 'helper'])
  assert.equal(list[0].system, '# Athena')
})

test('personaAgents excludes subagent-only agents', () => {
  assert.deepEqual(personaAgents(agentList(PLAN)).map((agent) => agent.name), ['Athena', 'Hermes'])
})

test('agentSummaries drops host-only fields but keeps the source group', () => {
  const summaries = agentSummaries(agentList(PLAN))
  assert.deepEqual(Object.keys(summaries[0]), ['name', 'description', 'mode', 'group'])
  assert.equal(summaries[0].group, 'core')
})

test('pickDefaultAgent prefers Athena, then the configured name', () => {
  const list = personaAgents(agentList(PLAN))
  assert.equal(pickDefaultAgent(list), 'Athena')
  assert.equal(pickDefaultAgent([{ name: 'Hermes' }]), null)
  assert.equal(pickDefaultAgent([{ name: 'Hermes' }], 'hermes'), 'Hermes')
  assert.equal(pickDefaultAgent(list, 'missing'), 'Athena')
  assert.equal(pickDefaultAgent([], ''), null)
})

test('sameRoster compares published fields only', () => {
  assert.equal(sameRoster([{ name: 'a', description: 'd', mode: 'all', group: 'core' }], [{ name: 'a', description: 'd', mode: 'all', group: 'core' }]), true)
  assert.equal(sameRoster([{ name: 'a', description: 'd', mode: 'all', group: 'core' }], [{ name: 'a', description: 'd', mode: 'primary', group: 'core' }]), false)
  assert.equal(sameRoster([{ name: 'a', description: 'd', mode: 'all', group: 'core' }], [{ name: 'a', description: 'd', mode: 'all', group: 'data' }]), false)
  assert.equal(sameRoster([], []), true)
  assert.equal(sameRoster(undefined, []), false)
})

test('createRoster publishes summaries and a stable key', () => {
  const list = personaAgents(agentList(PLAN))
  const roster = createRoster(list, 'Athena', '/proj')
  assert.equal(roster.version, 1)
  assert.deepEqual(roster.agents.map((agent) => agent.name), ['Athena', 'Hermes'])
  assert.equal(roster.agents[0].group, 'core')
  assert.equal(roster.project, '/proj')
  assert.equal(roster.defaultSelected, 'Athena')
  assert.equal(roster.key, rosterKeyOf(roster.agents, '/proj', 'Athena'))
  assert.notEqual(roster.key, rosterKeyOf(roster.agents, '/proj', 'Hermes'))
  assert.notEqual(roster.key, createRoster(list.slice(0, 1), 'Athena', '/proj').key)
})

test('rosterFromEvent ignores messages that carry no roster', () => {
  assert.equal(rosterFromEvent({ type: 'user/message', data: { source: { kind: 'user' } } }), null)
  assert.equal(rosterFromEvent({ type: 'user/message', data: {} }), null)
  assert.equal(rosterFromEvent({ type: 'command/run', data: {} }), null)
  assert.equal(rosterFromEvent(undefined), null)
})

test('the projection publishes the roster carried by an instructions message', () => {
  const definition = createProjectionDefinition()
  assert.equal(definition.key, PROJECTION_KEY)

  const list = personaAgents(agentList(PLAN))
  let state = definition.init({}, 0)
  assert.deepEqual(state.agents, [])
  assert.equal(state.active, false)

  state = definition.apply(state, instructionsEvent(createRoster(list, 'Athena', '/proj')))
  assert.deepEqual(state.agents.map((agent) => agent.name), ['Athena', 'Hermes'])
  assert.equal(state.selected, 'Athena')
  assert.equal(state.active, true)
  assert.equal(state.project, '/proj')
})

test('the projection folds the selection from the logged command', () => {
  const definition = createProjectionDefinition()
  const roster = createRoster(personaAgents(agentList(PLAN)), 'Athena', '/proj')
  let state = definition.apply(definition.init({}, 0), instructionsEvent(roster))

  state = definition.apply(state, selectEvent('hermes'))
  assert.equal(state.selected, 'Hermes')

  const listed = definition.apply(state, selectEvent('list'))
  assert.equal(listed, state)

  const unknown = definition.apply(state, selectEvent('nobody'))
  assert.equal(unknown, state)

  const blank = definition.apply(state, selectEvent(''))
  assert.equal(blank, state)
})

test('the projection refuses a subagent-only persona', () => {
  const definition = createProjectionDefinition()
  const roster = createRoster(agentList(PLAN), 'Athena', '/proj')
  const state = definition.apply(definition.init({}, 0), instructionsEvent(roster))
  const after = definition.apply(state, selectEvent('helper'))
  assert.equal(after, state)
  assert.equal(after.selected, 'Athena')
})

test('the projection keeps a selection the next roster still offers', () => {
  const definition = createProjectionDefinition()
  const list = personaAgents(agentList(PLAN))
  let state = definition.apply(definition.init({}, 0), instructionsEvent(createRoster(list, 'Athena', '/proj')))
  state = definition.apply(state, selectEvent('Hermes'))

  state = definition.apply(state, instructionsEvent(createRoster(list, 'Athena', '/proj')))
  assert.equal(state.selected, 'Hermes')

  state = definition.apply(state, instructionsEvent(createRoster(list.slice(0, 1), 'Athena', '/proj')))
  assert.equal(state.selected, 'Athena')
})

test('repeating the same roster returns the identical state object', () => {
  const definition = createProjectionDefinition()
  const event = instructionsEvent(createRoster(personaAgents(agentList(PLAN)), 'Athena', '/proj'))
  const first = definition.apply(definition.init({}, 0), event)
  const second = definition.apply(first, event)
  assert.equal(first, second)
})

test('the wire view is cached per state', () => {
  const definition = createProjectionDefinition()
  const state = definition.apply(definition.init({}, 0), instructionsEvent(createRoster([], null, '/p')))
  const first = definition.wire.view(state)
  assert.equal(definition.wire.view(state), first)
  assert.deepEqual(first, { agents: [], selected: null, active: false, project: '/p' })
})

test('unrelated events leave the state untouched', () => {
  const definition = createProjectionDefinition()
  const state = definition.init({}, 0)
  assert.equal(definition.apply(state, { type: 'other' }), state)
  assert.equal(definition.apply(state, { type: 'command/run', data: { name: 'auto-git-commit', args: 'x' } }), state)
})
