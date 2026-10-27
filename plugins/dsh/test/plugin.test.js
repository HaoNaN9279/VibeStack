/** End-to-end host wiring with an in-memory Cordis-like context. */

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { apply } from '../index.js'
import { AGENTS_EVENT, SELECT_EVENT } from '../lib/agents.js'

const PROJECT = '/proj'
/** A real rule file from this repository, so rendering exercises the fs path. */
const RULE = fileURLToPath(new URL('../../../capability-groups/core/0.1.0/rules/00-global.md', import.meta.url))

const PLAN = {
  schema_version: 1,
  active: true,
  project: PROJECT,
  rules: [{ name: 'global', path: RULE, group: 'core' }],
  skills: [{ name: 'caveman', path: '/repo/skills/caveman', description: 'terse', group: 'core' }],
  agents: {
    Athena: { description: 'planner', mode: 'all', system: '# Athena system' },
    Hermes: { description: 'worker', mode: 'primary', system: '# Hermes system' },
  },
  commands: { 'auto-git-commit': { description: 'commit', template: 'commit $ARGUMENTS' } },
  mcp: {},
  warnings: [],
}

/**
 * Build a session whose surface records appended events.
 * @returns {Record<string, unknown>} session double.
 */
function createSession() {
  const events = []
  const nodes = []
  return {
    events,
    surface: { nodes },
    append(type, data) {
      events.push({ type, data })
      nodes.push(events.length)
      return events.length
    },
    eventAt(seq) {
      return events[seq - 1]
    },
  }
}

/**
 * Build a Cordis-like context exposing the services the plugin uses.
 * @param {{readRule?: (file: string) => Promise<string>}} [options] - seams.
 * @returns {Record<string, any>} harness.
 */
function createHarness(options = {}) {
  const handlers = new Map()
  const services = {
    workingDirectory: {
      ensure: async () => PROJECT,
      get: () => PROJECT,
    },
    sessionProjections: {
      definition: null,
      register(definition) {
        this.definition = definition
        return () => {}
      },
      stateOf(session, key) {
        if (key !== 'vibestack' || this.definition === null) return undefined
        return session.events.reduce(
          (state, event) => this.definition.apply(state, event),
          this.definition.init({}, 0),
        )
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
  return { ctx, services, handlers, session: createSession(), options }
}

/**
 * Run one agent step through the plugin.
 * @param {Record<string, any>} harness - harness.
 * @param {object} session - session double.
 * @returns {Promise<Record<string, any>>} step decision.
 */
async function step(harness, session) {
  const handler = harness.handlers.get('agent/pre-step')
  const agent = { session, steer() {} }
  return await handler({ agent, signal: undefined }, async () => ({ kind: 'accept', messages: [] }))
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

test('a step injects the rules message once per digest', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  const first = await step(harness, harness.session)
  assert.equal(first.messages.length, 1)
  const message = first.messages[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'vibestack')
  assert.match(message.content[0].text, /^<system-reminder>/)

  const second = await step(harness, harness.session)
  assert.deepEqual(second.messages, [])
})

test('the roster projection defaults to Athena', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const event = harness.session.events.find((item) => item.type === AGENTS_EVENT)
  assert.ok(event)
  assert.equal(event.data.selected, 'Athena')
  assert.deepEqual(event.data.agents.map((agent) => agent.name), ['Athena', 'Hermes'])
  assert.equal(event.data.active, true)
})

test('plan commands and the agent selector are registered', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const names = harness.services.commands.definitions.map((definition) => definition.name)
  assert.ok(names.includes('vibestack-agent'))
  assert.ok(names.includes('auto-git-commit'))
})

test('running a plan command steers the rendered template', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find((definition) => definition.name === 'auto-git-commit')
  const steered = []
  const result = command.handler({
    agent: { steer: (message) => steered.push(message) },
    rawInput: 'fix tests',
    attachments: [],
  })
  assert.equal(result.kind, 'success')
  assert.equal(steered.length, 1)
  assert.equal(steered[0].content.at(-1).text, 'commit fix tests')
})

test('the agent selector writes the session projection', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const command = harness.services.commands.definitions.find((definition) => definition.name === 'vibestack-agent')
  const agent = { session: harness.session, steer() {} }

  const listed = command.handler({ agent, rawInput: '' })
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /Athena/)

  const switched = command.handler({ agent, rawInput: 'hermes' })
  assert.equal(switched.kind, 'success')
  assert.ok(harness.session.events.some((event) => event.type === SELECT_EVENT && event.data.id === 'Hermes'))

  const missing = command.handler({ agent, rawInput: 'nobody' })
  assert.equal(missing.kind, 'error')
})

test('the persona section follows the selection', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  await step(harness, harness.session)
  const section = harness.services.systemPrompt.sections[0]
  assert.equal(section.name, 'vibestack:agent')

  const agent = { session: harness.session }
  assert.match(section.text({ agent }), /# Athena system/)

  const command = harness.services.commands.definitions.find((definition) => definition.name === 'vibestack-agent')
  command.handler({ agent, rawInput: 'Hermes' })
  assert.match(section.text({ agent }), /# Hermes system/)
})

test('the skill provider exposes plan skills', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: resolveOk })
  assert.ok(harness.services.skills.provider)
  assert.equal(harness.services.skills.provider.name, 'vibestack')
  const list = await harness.services.skills.provider.list({ cwd: PROJECT })
  assert.deepEqual(list.map((skill) => skill.name), ['caveman'])
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
  assert.equal(harness.session.events.length, 0)
})

test('an inactive plan leaves the step untouched', async () => {
  const harness = createHarness()
  apply(harness.ctx, {}, { resolvePlan: async () => ({ plan: { active: false }, warnings: [] }) })
  const decision = await step(harness, harness.session)
  assert.deepEqual(decision.messages, [])
  assert.equal(harness.session.events.length, 0)
})

test('agents can be disabled by config', async () => {
  const harness = createHarness()
  apply(harness.ctx, { agents: false }, { resolvePlan: resolveOk })
  const decision = await step(harness, harness.session)
  assert.equal(decision.messages.length, 1)
  assert.equal(harness.session.events.length, 0)
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
