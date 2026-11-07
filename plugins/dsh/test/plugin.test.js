/** End-to-end host wiring with an in-memory Cordis-like context. */

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { apply } from '../index.js'
import { PROJECTION_VERSION, SELECT_COMMAND, SOURCE_KIND } from '../lib/agents.js'

const PROJECT = '/proj'
const OTHER_PROJECT = '/other'
/** A real rule file from this repository, so rendering exercises the fs path. */
const RULE = fileURLToPath(new URL('../../../capability-groups/core/0.1.0/rules/00-global.md', import.meta.url))
const DOMAIN_RULE = fileURLToPath(new URL('../../../capability-groups/domain/group-forge/0.1.0/rules/group-authoring.md', import.meta.url))

const PLAN = {
  schema_version: 2,
  active: true,
  mode: 'vibestack',
  project: PROJECT,
  core: { name: 'core', version: '0.1.0' },
  rules: [
    { name: 'global', path: RULE, group: 'core' },
    { name: 'group-authoring', path: DOMAIN_RULE, group: 'group-forge' },
  ],
  skills: [
    { name: 'caveman', path: '/repo/skills/caveman', description: 'terse', group: 'core' },
    { name: 'custom-group', path: '/repo/skills/custom-group', description: 'groups', group: 'group-forge', model: 'strong' },
  ],
  agents: {
    Athena: { description: 'planner', mode: 'all', system: '# Athena system', group: 'core' },
    Hermes: { description: 'worker', mode: 'primary', system: '# Hermes system', group: 'core' },
    Oracle: { description: 'reviewer', mode: 'all', system: '# Oracle system', group: 'group-forge', model: 'strong' },
    Researcher: { description: 'subtask', mode: 'subagent', system: '# Researcher system', group: 'group-forge' },
  },
  commands: {
    'auto-git-commit': { description: 'commit', template: 'commit $ARGUMENTS', group: 'core' },
    'group-new': { description: 'new group', template: 'forge $ARGUMENTS', group: 'group-forge', model: 'fast' },
  },
  mcp: {},
  warnings: [],
}

const CORE_ONLY_PLAN = {
  schema_version: 2,
  active: false,
  mode: 'vibestack',
  project: PROJECT,
  core: { name: 'core', version: '0.1.0' },
  rules: [{ name: 'global', path: RULE, group: 'core' }],
  skills: [{ name: 'caveman', path: '/repo/skills/caveman', description: 'terse', group: 'core' }],
  agents: { Athena: { description: 'planner', mode: 'all', system: '# Athena system', group: 'core' } },
  commands: { 'auto-git-commit': { description: 'commit', template: 'commit $ARGUMENTS', group: 'core' } },
  mcp: {},
  warnings: [],
}

/**
 * Build a session double that records whether the plugin appended anything.
 * @param {string} [preset] - preset the session runs, as the `agentPreset` projection reports it.
 * @returns {Record<string, any>} session double.
 */
let sessionSeq = 0

function createSession(preset = 'vibestack') {
  /** @type {{type: string, data: Record<string, unknown>}[]} */
  const events = []
  sessionSeq += 1
  return {
    id: 'session-' + sessionSeq,
    preset,
    events,
    surface: { nodes: [] },
    append(type, data) {
      events.push({ type, data })
      return events.length
    },
    eventAt(seq) {
      return events[seq - 1]
    },
  }
}

/**
 * Simulate the harness logging the step's injected messages into the session.
 * @param {Record<string, any>} session - session double.
 * @param {Record<string, any>} decision - step decision.
 * @returns {void}
 */
function recordMessages(session, decision) {
  for (const message of decision.messages ?? []) {
    session.events.push({ type: 'user/message', data: message })
  }
}

/**
 * Simulate the command executor logging a selection.
 * @param {Record<string, any>} session - session double.
 * @param {string} args - raw command input.
 * @returns {void}
 */
function logSelection(session, args) {
  session.events.push({ type: 'command/run', data: { commandId: 'c1', name: SELECT_COMMAND, args, source: { kind: 'user' } } })
}

/**
 * Build a Cordis-like context exposing the services the plugin uses.
 * @param {string} [cwd] - session working directory.
 * @returns {Record<string, any>} harness.
 */
function createHarness(cwd = PROJECT) {
  const handlers = new Map()
  const services = {
    workingDirectory: {
      ensure: async (agent) => agent?.session?.cwd ?? cwd,
      get: (session) => session?.cwd ?? cwd,
    },
    sessionProjections: {
      definition: null,
      register(definition) {
        this.definition = definition
        return () => {}
      },
      stateOf(session, key) {
        if (key === 'agentPreset') return session.preset ?? null
        if (key === 'modelSelection') return session.modelSelection
        if (key !== 'vibestack' || this.definition === null) return undefined
        return session.events.reduce(
          (state, event) => this.definition.apply(state, event),
          this.definition.init({}, 0),
        )
      },
    },
    agents: {
      store: new Map(),
      get(id) {
        return this.store.get(id)
      },
    },
    systemPrompt: {
      sections: [],
      section(section) {
        this.sections.push(section)
        return () => {}
      },
    },
    skills: {
      provider: null,
      skill: null,
      registerProvider(factory) {
        this.provider = factory({ invalidate() {} })
        return () => {}
      },
      register(skill) {
        this.skill = skill
        return () => {}
      },
    },
    commands: {
      definitions: [],
      register(definition) {
        this.definitions.push(definition)
        return () => {}
      },
    },
    sessionController: {
      calls: [],
      async selectModel(request) {
        this.calls.push(request)
        return { selected: {} }
      },
    },
  }
  const ctx = {
    logger: { warn() {} },
    get(name) {
      return services[name]
    },
    on(name, handler) {
      handlers.set(name, handler)
      return () => {}
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
    effect() {
      return () => {}
    },
    plugin() {
      return { dispose: async () => {} }
    },
    ...services,
  }
  return { ctx, services, handlers, session: createSession() }
}

/**
 * Run one agent step through the plugin.
 * @param {Record<string, any>} harness - harness.
 * @param {Record<string, any>} session - session double.
 * @param {object[]} [messages] - messages offered by earlier listeners.
 * @returns {Promise<Record<string, any>>} step decision.
 */
async function step(harness, session, messages = []) {
  const handler = harness.handlers.get('agent/pre-step')
  const agent = { session, followup() {}, steer() {} }
  return await handler({ agent, signal: undefined }, async () => ({ kind: 'accept', messages }))
}

/**
 * Resolve stub returning the shared plan.
 * @returns {Promise<{plan: Record<string, unknown>, warnings: string[]}>} result.
 */
async function resolveOk() {
  return { plan: PLAN, warnings: [] }
}

test('the root UI row registers nothing on the host', () => {
  const harness = createHarness()
  apply(harness.ctx, { host: false }, { resolvePlan: resolveOk })
  assert.equal(harness.handlers.size, 0)
  assert.equal(harness.services.commands.definitions.length, 0)
  assert.equal(harness.services.skills.provider, null)
})

test('a step injects the instructions message once', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const first = await step(harness, harness.session)
  assert.equal(first.messages.length, 1)
  const message = first.messages[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, SOURCE_KIND)
  assert.match(message.content[0].text, /^<system-reminder>/)

  const second = await step(harness, harness.session)
  assert.deepEqual(second.messages, [])
})

test('the roster is Core plus the workspace groups, with source labels', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const decision = await step(harness, harness.session)
  const message = decision.messages[0]
  assert.deepEqual(message.source.roster.agents.map((agent) => agent.name), ['Athena', 'Hermes', 'Oracle', 'Researcher'])
  assert.deepEqual(message.source.roster.agents.map((agent) => agent.group), ['core', 'core', 'group-forge', 'group-forge'])
  assert.equal(message.source.roster.defaultSelected, 'Athena')
  assert.equal(message.source.roster.project, PROJECT)
  assert.equal(message.content[0].text.includes('"Athena"'), false)

  recordMessages(harness.session, decision)
  const state = harness.services.sessionProjections.stateOf(harness.session, 'vibestack')
  assert.deepEqual(state.agents.map((agent) => agent.name), ['Athena', 'Hermes', 'Oracle', 'Researcher'])
  assert.equal(state.selected, 'Athena')
})

test('an MCP mount failure does not suppress the instructions message', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, {
    resolvePlan: async () => ({
      plan: { ...PLAN, mcp: { 'vibe:core_demo': { type: 'remote', url: 'https://example.test/mcp' } } },
      warnings: [],
    }),
  })
  const decision = await step(harness, harness.session)
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /^<system-reminder>/)
})

test('the plugin never appends a session event of its own', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  await step(harness, harness.session)
  assert.deepEqual(harness.session.events, [])
})

test('plan commands are registered under the canonical namespace', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const names = harness.services.commands.definitions.map((definition) => definition.name)
  assert.ok(names.includes('vibestack-agent'))
  assert.ok(names.includes('vibestack-core-auto-git-commit'))
  assert.ok(names.includes('vibestack-group-forge-group-new'))
})

test('running a plan command follows up with the rendered template', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find(
    (definition) => definition.name === 'vibestack-core-auto-git-commit',
  )
  const followed = []
  const steered = []
  const result = await command.handler({
    agent: {
      session: harness.session,
      followup: (message) => followed.push(message),
      steer: (message) => steered.push(message),
    },
    rawInput: 'fix tests',
    attachments: [],
  })
  assert.equal(result.kind, 'success')
  assert.equal(followed.length, 1)
  assert.equal(steered.length, 0)
  assert.equal(followed[0].content.at(-1).text, 'commit fix tests')
})

test('a command from a group not active in the current workspace is rejected', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: async (cwd) => ({ plan: cwd.includes('other') ? CORE_ONLY_PLAN : PLAN, warnings: [] }) })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find(
    (definition) => definition.name === 'vibestack-group-forge-group-new',
  )
  const otherSession = createSession()
  otherSession.cwd = OTHER_PROJECT
  const followed = []
  const result = await command.handler({
    agent: { session: otherSession, followup: (message) => followed.push(message) },
    rawInput: 'x',
    attachments: [],
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /不属于当前工作区/)
  assert.equal(followed.length, 0)
})

test('a Core-only vibestack-mode plan is usable without a project stack', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: async () => ({ plan: CORE_ONLY_PLAN, warnings: [] }) })
  const decision = await step(harness, harness.session)
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].source.roster.agents[0].name, 'Athena')
  const command = harness.services.commands.definitions.find(
    (definition) => definition.name === 'vibestack-core-auto-git-commit',
  )
  assert.ok(command)
})

test('a subagent session receives the same Core-plus-workspace roster', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const child = createSession()
  const decision = await step(harness, child)
  assert.deepEqual(decision.messages[0].source.roster.agents.map((agent) => agent.name), ['Athena', 'Hermes', 'Oracle', 'Researcher'])
  recordMessages(child, decision)
  const state = harness.services.sessionProjections.stateOf(child, 'vibestack')
  assert.equal(state.active, true)
  assert.deepEqual(state.agents.map((agent) => agent.name), ['Athena', 'Hermes', 'Oracle', 'Researcher'])
})

test('the agent selector reports the roster without writing events', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const command = harness.services.commands.definitions.find((definition) => definition.name === SELECT_COMMAND)
  const agent = { session: harness.session }

  const listed = await command.handler({ agent, rawInput: '' })
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /Athena/)
  assert.match(listed.text, /当前：Athena/)

  const switched = await command.handler({ agent, rawInput: 'oracle' })
  assert.equal(switched.kind, 'success')
  assert.match(switched.text, /Oracle/)

  const missing = await command.handler({ agent, rawInput: 'nobody' })
  assert.equal(missing.kind, 'error')

  assert.deepEqual(harness.session.events, [])
})

test('the persona section follows the logged selection', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const decision = await step(harness, harness.session)
  recordMessages(harness.session, decision)
  const section = harness.services.systemPrompt.sections[0]
  assert.equal(section.name, 'vibestack:agent')

  const agent = { session: harness.session }
  assert.match(section.text({ agent }), /# Athena system/)

  logSelection(harness.session, 'Oracle')
  assert.match(section.text({ agent }), /# Oracle system/)

  const command = harness.services.commands.definitions.find((definition) => definition.name === SELECT_COMMAND)
  const result = await command.handler({ agent, rawInput: 'Athena' })
  assert.equal(result.kind, 'success')
  logSelection(harness.session, 'Athena')
  assert.match(section.text({ agent }), /# Athena system/)
})

test('switching personas does not re-inject the instructions message', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const decision = await step(harness, harness.session)
  recordMessages(harness.session, decision)

  logSelection(harness.session, 'Oracle')
  const next = await step(harness, harness.session)
  assert.deepEqual(next.messages, [])

  const state = harness.services.sessionProjections.stateOf(harness.session, 'vibestack')
  assert.equal(state.selected, 'Oracle')
})

test('the skill provider exposes namespace-qualified plan skills', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  assert.ok(harness.services.skills.provider)
  assert.equal(harness.services.skills.provider.name, 'vibestack')
  const list = await harness.services.skills.provider.list({ cwd: PROJECT })
  assert.deepEqual(list.map((skill) => skill.name), ['vibestack-core-caveman', 'vibestack-group-forge-custom-group'])
})

test('the bundled skill is registered at apply time', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(harness.services.skills.skill?.name, 'vibestack')
  assert.ok(harness.services.skills.skill.content.length > 0)
})

test('a failed resolve leaves the step untouched', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: async () => ({ plan: null, warnings: ['vibe-stack resolve failed'] }) })
  const decision = await step(harness, harness.session)
  assert.deepEqual(decision.messages, [])
  assert.deepEqual(harness.session.events, [])
})

test('an inactive project-mode plan leaves the step untouched', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: async () => ({ plan: { active: false, mode: 'project' }, warnings: [] }) })
  const decision = await step(harness, harness.session)
  assert.deepEqual(decision.messages, [])
  assert.deepEqual(harness.session.events, [])
})

test('agents can be disabled by config', async () => {
  const harness = createHarness()
  apply(harness.ctx, { agents: false }, { resolvePlan: resolveOk })
  const decision = await step(harness, harness.session)
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].source.roster, undefined)
  assert.equal(harness.services.systemPrompt.sections.length, 0)
})

test('a repeat step reuses the resolve result', async () => {
  const harness = createHarness()
  let calls = 0
  apply(harness.ctx, {}, {
    resolvePlan: async () => {
      calls += 1
      return { plan: PLAN, warnings: [] }
    },
  })
  await step(harness, harness.session)
  await step(harness, harness.session)
  assert.equal(calls, 1)
})

test('the plugin registers the step and early-roster listeners', () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  assert.deepEqual(
    [...harness.handlers.keys()].sort(),
    ['agent-preset/selected', 'agent/created', 'agent/pre-step', 'session/event'],
  )
})

test('the roster is appended as soon as the preset is selected', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const handler = harness.handlers.get('session/event')
  await handler(harness.session, {
    type: 'agent-preset/selected',
    data: { agentPreset: 'vibestack' },
  })
  const appended = harness.session.events.find((event) => event.type === 'user/message')
  assert.ok(appended)
  assert.equal(appended.data.source.kind, 'vibestack')
  assert.ok(appended.data.source.roster)
  assert.deepEqual(
    appended.data.source.roster.agents.map((agent) => agent.name),
    ['Athena', 'Hermes', 'Oracle', 'Researcher'],
  )
})

/**
 * Build a minimal in-memory layer service.
 * @param {{defaultId?: string | null}} [options] - default layer.
 * @returns {Record<string, any>} service.
 */
function layerService(options = {}) {
  const layers = [
    { id: 'strong', label: '深度', provider: 'p', model: 'm-strong', reasoningEffort: 'high' },
    { id: 'fast', label: '快速', provider: 'p', model: 'm-fast' },
  ]
  return {
    layers,
    listLayers() {
      return layers.map((layer) => ({ ...layer }))
    },
    resolveLayer(id) {
      const found = layers.find((layer) => layer.id === id)
      return found ? { ...found } : undefined
    },
    defaultLayer() {
      return options.defaultId ?? null
    },
  }
}

test('selecting an Agent applies its model layer', async () => {
  const harness = createHarness()
  harness.services.vibestack = layerService()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find((definition) => definition.name === SELECT_COMMAND)
  const result = await command.handler({ agent: { session: harness.session }, rawInput: 'Oracle' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(harness.services.sessionController.calls.at(-1), {
    sessionId: harness.session.id,
    provider: 'p',
    model: 'm-strong',
    reasoningEffort: 'high',
  })
})

test('a command applies its model layer before followup', async () => {
  const harness = createHarness()
  harness.services.vibestack = layerService()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find(
    (definition) => definition.name === 'vibestack-group-forge-group-new',
  )
  const followed = []
  await command.handler({
    agent: { session: harness.session, followup: (message) => followed.push(message) },
    rawInput: 'x',
    attachments: [],
  })
  assert.equal(followed.length, 1)
  assert.equal(harness.services.sessionController.calls.at(-1).model, 'm-fast')
})

test('a skill token applies its model layer during pre-step', async () => {
  const harness = createHarness()
  harness.services.vibestack = layerService()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session, [
    { role: 'user', content: [{ type: 'text', text: '/vibestack-group-forge-custom-group' }] },
  ])
  assert.equal(harness.services.sessionController.calls.at(-1).model, 'm-strong')
})

test('the default layer applies once to a fresh session', async () => {
  const harness = createHarness()
  harness.services.vibestack = layerService({ defaultId: 'strong' })
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  await step(harness, harness.session)
  assert.equal(harness.services.sessionController.calls.length, 1)
  assert.equal(harness.services.sessionController.calls[0].model, 'm-strong')
})

test('the layer command lists and applies configured layers', async () => {
  const harness = createHarness()
  harness.services.vibestack = layerService()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find((definition) => definition.name === 'vibestack-layer')
  const listed = await command.handler({ agent: { session: harness.session }, rawInput: 'list' })
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /strong/)
  const applied = await command.handler({ agent: { session: harness.session }, rawInput: 'fast' })
  assert.equal(applied.kind, 'success')
  assert.equal(harness.services.sessionController.calls.at(-1).model, 'm-fast')
})

test('the projection version was bumped for the group field', () => {
  assert.equal(PROJECTION_VERSION, 3)
})
