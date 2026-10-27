/**
 * VibeStack mode for DeepSeek Harness.
 *
 * The plugin is mounted as a child row of the `vibestack` agent preset, so every
 * registration it makes — instruction messages, skills, commands, MCP servers,
 * the persona section — lands in that agent's scope. No other working mode is
 * touched.
 *
 * The agent roster is published as soon as the preset is bound (mode selected
 * on a blank session, agent created, or session resumed), so the composer's
 * Agent menu exists before the first turn; `agent/pre-step` keeps it fresh.
 *
 * Everything here is failure-open: a missing CLI, a broken stack, an
 * unexpected payload, or an unavailable optional service degrades to a log line.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGENTS_EVENT,
  PROJECTION_KEY,
  SELECT_COMMAND,
  SELECT_EVENT,
  agentList,
  agentSummaries,
  createProjectionDefinition,
  personaAgents,
  pickDefaultAgent,
  sameRoster,
} from './lib/agents.js'
import { commandEntries, renderTemplate } from './lib/commands.js'
import { resolveConfig } from './lib/config.js'
import { createUserMessage } from './lib/messages.js'
import { normalizeMcpEntries, syncMcpServers } from './lib/mcp.js'
import { PlanCache } from './lib/plans.js'
import { resolvePlan as resolveProjectPlan } from './lib/resolve.js'
import { renderRules } from './lib/rules.js'
import { createSkillProvider, readSkillFile } from './lib/skills.js'

/** Plugin name shown in Loader diagnostics. */
export const name = 'vibestack'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const PERSONA_SECTION_ORDER = 10150
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
/** Preset id this plugin is mounted under; the projection and the client read it. */
const PRESET_ID = 'vibestack'

/**
 * Register the VibeStack mode.
 * @param {Record<string, unknown>} ctx - Cordis plugin context.
 * @param {unknown} rawConfig - row config.
 * @param {{resolvePlan?: (cwd: string) => Promise<{plan: Record<string, unknown> | null, warnings: string[]}>}} [deps] - injectable seams for tests.
 * @returns {void}
 */
export function apply(ctx, rawConfig, deps = {}) {
  const config = resolveConfig(rawConfig)
  // The root row exists only so the client half is always available; it owns no
  // host behaviour and must not touch any session.
  if (!config.host) return

  const resolveFor = deps.resolvePlan ?? ((cwd) => resolveProjectPlan(cwd, config))
  const cache = new PlanCache(resolveFor)
  /** @type {{commands: Map<string, string>, mcpStores: Set<Map<string, {signature: string, fiber: unknown}>>, mcpModule: unknown, warned: Set<string>, sessions: WeakMap<object, {digest: string, mcp: Map<string, {signature: string, fiber: unknown}>}>}} */
  const state = {
    commands: new Map(),
    mcpStores: new Set(),
    mcpModule: null,
    warned: new Set(),
    sessions: new WeakMap(),
  }

  /** @type {Record<string, Function> | undefined} */
  let commandsScope

  const logger = ctx.logger
  const warn = (message, ...args) => {
    try {
      logger?.warn?.(message, ...args)
    } catch {
      // Logging must never break the mode.
    }
  }

  /**
   * Log each distinct resolver warning once.
   * @param {string[]} warnings - resolver warnings.
   * @returns {void}
   */
  const logWarnings = (warnings) => {
    for (const message of warnings) {
      if (state.warned.has(message)) continue
      state.warned.add(message)
      warn('vibestack: %s', message)
    }
  }

  /**
   * Read the plugin's own per-session state record.
   * @param {object} session - agent session.
   * @returns {{digest: string, mcp: Map<string, {signature: string, fiber: unknown}>}} mutable record.
   */
  const sessionStateFor = (session) => {
    let record = state.sessions.get(session)
    if (record === undefined) {
      record = { digest: '', mcp: new Map() }
      state.sessions.set(session, record)
      state.mcpStores.add(record.mcp)
    }
    return record
  }

  /**
   * Whether the session already carries the same rendered instructions.
   * @param {object} session - agent session.
   * @param {string} digest - rendered digest.
   * @returns {boolean} true when a matching message is already in history.
   */
  const surfaceHasDigest = (session, digest) => {
    const nodes = session?.surface?.nodes
    if (!Array.isArray(nodes) || typeof session?.eventAt !== 'function') return false
    for (const seq of [...nodes].reverse()) {
      const event = session.eventAt(seq)
      if (!event || event.type !== 'user/message') continue
      const source = event.data?.source
      if (source && source.kind === 'vibestack' && source.digest === digest) return true
    }
    return false
  }

  /**
   * Read the session's effective working directory.
   * @param {object} session - session handle.
   * @returns {string | null} absolute directory, or null when unknown.
   */
  const cwdOf = (session) => {
    const workingDirectory = ctx.get('workingDirectory')
    let cwd
    try {
      cwd = workingDirectory?.get?.(session)
    } catch {
      return null
    }
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : null
  }

  /**
   * Read the preset a session currently runs.
   * @param {object} session - session handle.
   * @returns {string | null} preset id, or null when the projection is absent.
   */
  const presetOf = (session) => {
    const projections = ctx.get('sessionProjections')
    try {
      const value = projections?.stateOf?.(session, 'agentPreset')
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }

  /**
   * Append the roster projection when the project's agents changed.
   * @param {object} session - session handle.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @returns {void}
   */
  const publishAgents = (session, plan) => {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return
    const list = personaAgents(agentList(plan))
    const agents = agentSummaries(list)
    const project = typeof plan.project === 'string' ? plan.project : ''
    const current = projections.stateOf(session, PROJECTION_KEY)
    const selected = current?.selected ?? pickDefaultAgent(list, config.defaultAgent)
    if (
      current !== undefined &&
      sameRoster(current.agents, agents) &&
      current.selected === selected &&
      current.active === true &&
      current.project === project
    ) {
      return
    }
    try {
      session.append(AGENTS_EVENT, { agents, selected, active: true, project })
    } catch (error) {
      warn('vibestack: cannot publish agents: %o', error)
    }
  }

  /** Sessions with a roster publish already in flight. */
  const hydrating = new WeakSet()

  /**
   * Publish the roster before the first turn.
   *
   * The mode is selectable while a session is still blank, and the composer's
   * Agent menu is driven by the projection alone, so it must exist as soon as
   * the preset is bound — not only once `agent/pre-step` runs.
   * @param {object} session - session handle.
   * @returns {Promise<void>} resolves after the projection was appended.
   */
  const hydrate = (session) => {
    if (!config.agents || session === undefined || session === null) return Promise.resolve()
    if (hydrating.has(session)) return Promise.resolve()
    hydrating.add(session)
    return (async () => {
      try {
        const cwd = cwdOf(session)
        if (cwd === null) return
        const result = await cache.get(cwd)
        logWarnings(result.warnings)
        const plan = result.plan
        if (plan === null || plan.active !== true) return
        publishAgents(session, plan)
      } catch (error) {
        warn('vibestack: cannot publish the agent roster: %o', error)
      } finally {
        hydrating.delete(session)
      }
    })()
  }

  /**
   * Register plan commands that are not registered yet.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @returns {void}
   */
  const syncCommands = (plan) => {
    if (!config.commands || commandsScope === undefined) return
    const project = typeof plan.project === 'string' ? plan.project : ''
    for (const entry of commandEntries(plan)) {
      const owner = state.commands.get(entry.name)
      if (owner !== undefined) {
        if (owner !== project) {
          warn('vibestack: command /%s from %s ignored; already registered by %s', entry.name, project, owner)
        }
        continue
      }
      try {
        commandsScope.commands.register({
          name: entry.name,
          description: entry.description,
          input: { hint: '[arguments]' },
          handler: (invocation) => {
            const attachments = Array.isArray(invocation.attachments) ? invocation.attachments : []
            const text = renderTemplate(entry.template, invocation.rawInput)
            invocation.agent.steer(
              createUserMessage({
                content: [...attachments, { type: 'text', text }],
                source: { kind: 'user' },
              }),
            )
            return { kind: 'success', text: `VibeStack: ran /${entry.name}` }
          },
        })
        state.commands.set(entry.name, project)
      } catch (error) {
        state.commands.set(entry.name, project)
        warn('vibestack: cannot register command /%s: %o', entry.name, error)
      }
    }
  }

  /**
   * Reconcile the session's mounted MCP servers with its plan.
   *
   * Mounting happens under the agent's own context when the runtime exposes it,
   * so two sessions of the same preset generation with different projects do not
   * fight over one shared mount table.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @param {object} agent - agent handle.
   * @returns {Promise<void>} resolves after reconciliation.
   */
  const syncMcp = async (plan, agent) => {
    if (!config.mcp) return
    const entries = normalizeMcpEntries(plan.mcp)
    const mountCtx = agent.ctx ?? ctx
    const store = sessionStateFor(agent.session).mcp
    await syncMcpServers(mountCtx, store, entries, async () => {
      if (state.mcpModule !== null) return state.mcpModule
      state.mcpModule = await loadHarnessModule(ctx, MCP_CLIENT_PACKAGE)
      return state.mcpModule
    })
  }

  /**
   * Inject the rules message for this step, once per digest.
   * @param {object} agent - agent handle.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @returns {Promise<Record<string, unknown> | null>} message to append, or null.
   */
  const injectRules = async (agent, plan) => {
    if (!config.rules) return null
    const rendered = await renderRules(plan, { maxBytes: config.maxRulesBytes })
    if (rendered === null) return null
    const record = sessionStateFor(agent.session)
    if (record.digest === rendered.digest) return null
    record.digest = rendered.digest
    if (surfaceHasDigest(agent.session, rendered.digest)) return null
    return createUserMessage({
      content: [{ type: 'text', text: rendered.text }],
      source: { kind: 'vibestack', form: 'instructions', digest: rendered.digest },
    })
  }

  /**
   * Resolve the mode's work for one agent step.
   * @param {object} agent - agent handle.
   * @param {AbortSignal | undefined} signal - step signal.
   * @returns {Promise<Record<string, unknown> | null>} message to add to the step.
   */
  const prepare = async (agent, signal) => {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory?.ensure === undefined) return null
    const cwd = await workingDirectory.ensure(agent, signal)
    if (typeof cwd !== 'string' || cwd.length === 0) return null
    const result = await cache.get(cwd)
    logWarnings(result.warnings)
    const plan = result.plan
    if (plan === null || plan.active !== true) return null
    if (config.agents) publishAgents(agent.session, plan)
    syncCommands(plan)
    await syncMcp(plan, agent)
    return injectRules(agent, plan)
  }

  ctx.inject(['sessionProjections'], (scope) => {
    if (!config.agents) return
    try {
      scope.sessionProjections.register(createProjectionDefinition())
    } catch (error) {
      warn('vibestack: cannot register the agent projection: %o', error)
    }
  })

  ctx.inject(['systemPrompt'], (scope) => {
    if (!config.agents) return
    try {
      scope.systemPrompt.section({
        name: 'vibestack:agent',
        order: PERSONA_SECTION_ORDER,
        text: (assembly) => {
          const agent = assembly?.agent
          if (agent === undefined) return ''
          const projections = ctx.get('sessionProjections')
          const selected = projections?.stateOf(agent.session, PROJECTION_KEY)?.selected
          if (typeof selected !== 'string' || selected.length === 0) return ''
          const workingDirectory = ctx.get('workingDirectory')
          const cwd = workingDirectory?.get?.(agent.session)
          const plan = typeof cwd === 'string' && cwd.length > 0 ? cache.peek(cwd) : null
          const entry = agentList(plan).find((candidate) => candidate.name === selected)
          if (entry === undefined || entry.system.trim().length === 0) return ''
          return `You are acting as the VibeStack agent "${entry.name}".\n\n${entry.system.trim()}`
        },
      })
    } catch (error) {
      warn('vibestack: cannot register the agent section: %o', error)
    }
  })

  ctx.inject(['skills'], (scope) => {
    if (!config.skills) return
    try {
      scope.skills.registerProvider(() =>
        createSkillProvider({ getPlan: async (cwd) => (await cache.get(cwd)).plan }),
      )
    } catch (error) {
      warn('vibestack: cannot register the skill provider: %o', error)
    }
    void (async () => {
      try {
        const text = await readFile(path.join(PLUGIN_DIR, 'skills', 'vibestack', 'SKILL.md'), 'utf8')
        const skill = readSkillFile(text)
        if (skill.name.length === 0 || skill.description.length === 0) return
        scope.skills.register({ name: skill.name, description: skill.description, content: skill.content })
      } catch (error) {
        warn('vibestack: cannot load the bundled skill: %o', error)
      }
    })()
  })

  ctx.inject(['commands'], (scope) => {
    if (!config.commands) return
    commandsScope = scope
    try {
      scope.commands.register({
        name: SELECT_COMMAND,
        description: '选择本会话的 VibeStack Agent（人设）',
        input: { hint: '[agent 名称|list]' },
        handler: ({ agent, rawInput }) => {
          const projections = ctx.get('sessionProjections')
          const current = projections?.stateOf(agent.session, PROJECTION_KEY)
          const agents = Array.isArray(current?.agents) ? current.agents : []
          if (agents.length === 0) {
            return { kind: 'error', text: 'VibeStack: 当前项目没有可选 Agent（先在该项目激活能力组）' }
          }
          const input = String(rawInput ?? '').trim()
          if (input.length === 0 || input === 'list') {
            const names = agents.map((entry) => entry.name).join(', ')
            return { kind: 'success', text: `VibeStack agents: ${names}（当前：${current.selected ?? '未选择'}）` }
          }
          const match = agents.find((entry) => entry.name.toLowerCase() === input.toLowerCase())
          if (match === undefined) {
            return { kind: 'error', text: `VibeStack: 未找到 agent "${input}"` }
          }
          if (current.selected === match.name) {
            return { kind: 'success', text: `VibeStack: 当前已是 ${match.name}` }
          }
          agent.session.append(SELECT_EVENT, { id: match.name })
          return { kind: 'success', text: `VibeStack: 已切换 Agent 为 ${match.name}` }
        },
      })
    } catch (error) {
      warn('vibestack: cannot register /%s: %o', SELECT_COMMAND, error)
    }
  })

  ctx.on('session/event', (session, event) => {
    if (!config.agents) return undefined
    if (event?.type !== 'agent-preset/selected') return undefined
    if (event.data?.agentPreset !== PRESET_ID) return undefined
    return hydrate(session)
  })

  ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
    if (!config.agents) return undefined
    if (agentPreset !== PRESET_ID) return undefined
    let session
    try {
      session = ctx.get('agents')?.get?.(sessionId)?.session ?? ctx.get('sessions')?.get?.(sessionId)
    } catch {
      return undefined
    }
    if (session === undefined || session === null) return undefined
    return hydrate(session)
  })

  ctx.on('agent/created', (payload) => {
    if (!config.agents) return undefined
    const session = payload?.agent?.session
    if (session === undefined || session === null) return undefined
    if (presetOf(session) !== PRESET_ID) return undefined
    // Creation is a serial dispatch; do not make it wait for a CLI round trip.
    void hydrate(session)
    return undefined
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'reject' || signal?.aborted === true) return decision
      const message = await prepare(agent, signal)
      if (message === null) return decision
      return { ...decision, messages: [...(decision.messages ?? []), message] }
    } catch (error) {
      warn('vibestack: pre-step failed: %o', error)
      return decision
    }
  })

  ctx.effect(() => () => {
    for (const store of state.mcpStores) {
      for (const mounted of store.values()) {
        void Promise.resolve(mounted.fiber?.dispose?.()).catch(() => {})
      }
      store.clear()
    }
    state.mcpStores.clear()
    cache.clear()
  }, 'vibestack: release cached plans and MCP servers')
}

/**
 * Import a harness package the way the Loader does, falling back to plain ESM.
 *
 * A linked bundle lives outside the harness `node_modules`, so a bare import may
 * not resolve through Node alone. The Loader's internal importer applies the
 * harness resolution rules; the plain import keeps the module usable in tests.
 * @param {Record<string, unknown>} ctx - plugin context.
 * @param {string} specifier - package specifier.
 * @returns {Promise<Record<string, unknown>>} module namespace.
 */
async function loadHarnessModule(ctx, specifier) {
  const loader = ctx.get('loader')
  const internal = loader?.internal
  if (typeof internal?.import === 'function') {
    try {
      return await internal.import(specifier, new URL('./', import.meta.url).href, {})
    } catch {
      // Fall through to the plain resolver.
    }
  }
  return await import(specifier)
}
