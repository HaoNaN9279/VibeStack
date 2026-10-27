/** Agent mapping: roster extraction, defaults, and the session projection. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENTS_EVENT,
  PROJECTION_KEY,
  SELECT_EVENT,
  agentList,
  agentSummaries,
  createProjectionDefinition,
  personaAgents,
  pickDefaultAgent,
  sameRoster,
} from '../lib/agents.js'

const PLAN = {
  agents: {
    Athena: { description: 'planner', mode: 'all', system: '# Athena' },
    Hermes: { description: 'worker', mode: 'primary', system: '# Hermes' },
    helper: { description: 'child only', mode: 'subagent', system: '# helper' },
  },
}

test('agentList describes every agent in plan order', () => {
  const list = agentList(PLAN)
  assert.deepEqual(list.map((agent) => agent.name), ['Athena', 'Hermes', 'helper'])
  assert.equal(list[0].system, '# Athena')
})

test('personaAgents excludes subagent-only agents', () => {
  assert.deepEqual(personaAgents(agentList(PLAN)).map((agent) => agent.name), ['Athena', 'Hermes'])
})

test('agentSummaries drops host-only fields', () => {
  const summaries = agentSummaries(agentList(PLAN))
  assert.deepEqual(Object.keys(summaries[0]), ['name', 'description', 'mode'])
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
  assert.equal(sameRoster([{ name: 'a', description: 'd', mode: 'all' }], [{ name: 'a', description: 'd', mode: 'all' }]), true)
  assert.equal(sameRoster([{ name: 'a', description: 'd', mode: 'all' }], [{ name: 'a', description: 'd', mode: 'primary' }]), false)
  assert.equal(sameRoster([], []), true)
  assert.equal(sameRoster(undefined, []), false)
})

test('the projection publishes the roster and keeps the selection', () => {
  const definition = createProjectionDefinition()
  assert.equal(definition.key, PROJECTION_KEY)
  let state = definition.init({}, 0)
  assert.deepEqual(state.agents, [])

  state = definition.apply(state, {
    type: AGENTS_EVENT,
    data: {
      agents: [{ name: 'Athena', description: 'p', mode: 'all' }],
      selected: 'Athena',
      active: true,
      project: '/proj',
    },
  })
  assert.equal(state.selected, 'Athena')
  assert.equal(state.active, true)

  state = definition.apply(state, { type: SELECT_EVENT, data: { id: 'Athena' } })
  assert.equal(state.selected, 'Athena')

  state = definition.apply(state, { type: SELECT_EVENT, data: { id: 'Unknown' } })
  assert.equal(state.selected, null)
})

test('repeating the same roster returns the identical state object', () => {
  const definition = createProjectionDefinition()
  const payload = {
    agents: [{ name: 'Athena', description: 'p', mode: 'all' }],
    selected: 'Athena',
    active: true,
    project: '/proj',
  }
  const first = definition.apply(definition.init({}, 0), { type: AGENTS_EVENT, data: payload })
  const second = definition.apply(first, { type: AGENTS_EVENT, data: payload })
  assert.equal(first, second)
})

test('the wire view is cached per state', () => {
  const definition = createProjectionDefinition()
  const state = definition.apply(definition.init({}, 0), {
    type: AGENTS_EVENT,
    data: { agents: [], selected: null, active: true, project: '/p' },
  })
  const first = definition.wire.view(state)
  assert.equal(definition.wire.view(state), first)
  assert.deepEqual(first, { agents: [], selected: null, active: true, project: '/p' })
})

test('unrelated events leave the state untouched', () => {
  const definition = createProjectionDefinition()
  const state = definition.init({}, 0)
  assert.equal(definition.apply(state, { type: 'other' }), state)
})
