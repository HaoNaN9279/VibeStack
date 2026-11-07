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
  PROJECTION_KEY,
  SELECT_COMMAND,
  agentList,
  createProjectionDefinition,
  createRoster,
  personaAgents,
  pickDefaultAgent,
} from './lib/agents.js'
import { commandEntries, renderTemplate } from './lib/commands.js'
import { resolveConfig } from './lib/config.js'
import { createUserMessage as createLocalUserMessage } from './lib/messages.js'
import { normalizeMcpEntries, syncMcpServers } from './lib/mcp.js'
import { createModelsRoute } from './lib/models-route.js'
import { planUsable, unusablePlanReason } from './lib/plan.js'
import { PlanCache } from './lib/plans.js'
import { resolvePlan as resolveProjectPlan } from './lib/resolve.js'
import { renderRules } from './lib/rules.js'
import { VibeStackService } from './lib/service.js'
import { createSkillProvider, readSkillFile, skillCandidates } from './lib/skills.js'

/** Plugin name shown in Loader diagnostics. */
export const name = 'vibestack'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const PERSONA_SECTION_ORDER = 10150
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
/** Management command for choosing a model layer. */
export const LAYER_COMMAND = 'vibestack-layer'

/**
 * Root row: provide `ctx.vibestack` and the model-layer settings route.
 * @param {Record<string, unknown>} ctx - Cordis plugin context.
 * @param {ReturnType<typeof resolveConfig>} config - resolved row config.
 * @returns {VibeStackService} the service instance.
 */
export function applyCore(ctx, config) {
  const logger = ctx.logger
  const service = new VibeStackService({
    ctx,
    modelsFile: config.modelsFile,
    logger,
  })
  try {
    if (typeof ctx.provide === 'function') ctx.provide('vibestack', service)
  } catch (error) {
    logger?.warn?.('vibestack: cannot provide ctx.vibestack: %o', error)
  }
  void service.reload()
  ctx.inject(['connection'], (scope) => {
    try {
      const registry = scope.connection?.fetch
      if (typeof registry?.register !== 'function') {
        logger?.warn?.('vibestack: no Fetch route registry; model settings stay file-only')
        return
      }
      registry.register(createModelsRoute({ service }))
    } catch (error) {
      logger?.warn?.('vibestack: cannot register the models route: %o', error)
    }
  })
  return service
}

/**
 * Register the VibeStack mode.
 * @param {Record<string, unknown>} ctx - Cordis plugin context.
 * @param {unknown} rawConfig - row config.
 * @param {{resolvePlan?: (cwd: string) => Promise<{plan: Record<string, unknown> | null, warnings: string[]}>}} [deps] - injectable seams for tests.
 * @returns {void}
 */
export function apply(ctx, rawConfig, deps = {}) {
  const config = resolveConfig(rawConfig)
  // UI rows own no host behaviour.
  if (!config.host || config.role === 'ui') return
  // The root core row provides `ctx.vibestack` and the settings route; it must
  // not resolve projects or touch a session.
  if (config.role === 'core') {
    applyCore(ctx, config)
    return
  }

  const resolveFor = deps.resolvePlan ?? ((cwd) => resolveProjectPlan(cwd, config))
  const cache = new PlanCache(resolveFor)
  /** Namespace options applied to every command and skill. */
  const names = {
    prefix: config.namePrefix,
    maxLength: config.maxCommandNameLength,
    rank: config.skillRank,
  }
  /** @type {{commands: Map<string, string>, mcpStores: Set<Map<string, {signature: string, fiber: unknown}>>, mcpModule: unknown, warned: Set<string>, sessions: WeakMap<object, {digest: string, mcp: Map<string, {signature: string, fiber: unknown}>}>, defaults: WeakSet<object>, skills: WeakMap<object, Set<string>>}} */
  const state = {
    commands: new Map(),
    mcpStores: new Set(),
    mcpModule: null,
    warned: new Set(),
    sessions: new WeakMap(),
    defaults: new WeakSet(),
    skills: new WeakMap(),
  }

  /** @type {Record<string, Function> | undefined} */
  let commandsScope
  /** Cached DSH message factory: function, null (not tried), or false (unavailable). */
  let harnessUserMessage = null

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
   * Build a user message with the harness factory when it is reachable.
   *
   * The local fallback keeps tests and degraded compositions working; once the
   * harness module fails, later calls go straight to the fallback.
   * @param {Record<string, unknown>} input - message body.
   * @returns {Promise<object>} frozen user message.
   */
  const userMessage = async (input) => {
    if (typeof harnessUserMessage === 'function') return harnessUserMessage(input)
    if (harnessUserMessage !== false) {
      try {
        const module = await loadHarnessModule(ctx, '@deepseek-ai/dsh-llm')
        const factory = module?.createUserMessage
        if (typeof factory === 'function') {
          harnessUserMessage = factory
          return factory(input)
        }
      } catch {
        // Fall through to the local shape.
      }
      harnessUserMessage = false
    }
    return createLocalUserMessage(input)
  }

  /**
   * Read the root service without requiring it.
   * @returns {VibeStackService | undefined} service when the core row is mounted.
   */
  const layerService = () => {
    try {
      return ctx.get('vibestack')
    } catch {
      return undefined
    }
  }

  /**
   * Apply one model layer to a session.
   *
   * The layer only changes the route; failure never blocks the prompt or the
   * persona switch that asked for it.
   * @param {object} agent - agent handle carrying a session.
   * @param {unknown} layerId - layer id.
   * @param {string} source - diagnostic source (`agent` / `command` / `skill`).
   * @returns {Promise<{ok: boolean, code?: string, layer?: object}>} outcome.
   */
  const applyModelFor = async (agent, layerId, source) => {
    const id = typeof layerId === 'string' ? layerId.trim() : ''
    if (id.length === 0) return { ok: true }
    const service = layerService()
    if (service === undefined) {
      warn('vibestack: model layer %s ignored (%s): ctx.vibestack is unavailable', id, source)
      return { ok: false, code: 'layers-unavailable' }
    }
    const layer = service.resolveLayer(id)
    if (layer === undefined) {
      warn('vibestack: model layer %s ignored (%s): unknown layer', id, source)
      return { ok: false, code: 'layer-unknown' }
    }
    const controller = ctx.get('sessionController')
    if (typeof controller?.selectModel !== 'function') {
      warn('vibestack: model layer %s ignored (%s): sessionController.selectModel is unavailable', id, source)
      return { ok: false, code: 'model-selection-unavailable' }
    }
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      warn('vibestack: model layer %s ignored (%s): session has no id', id, source)
      return { ok: false, code: 'session-unavailable' }
    }
    try {
      await controller.selectModel({
        sessionId,
        provider: layer.provider,
        model: layer.model,
        ...(layer.reasoningEffort === undefined ? {} : { reasoningEffort: layer.reasoningEffort }),
      })
      return { ok: true, layer }
    } catch (error) {
      warn('vibestack: model layer %s could not be applied (%s): %o', id, source, error)
      return { ok: false, code: 'layer-unroutable', layer }
    }
  }

  /**
   * Find the layer that matches a session's current model projection.
   * @param {object} service - layer service.
   * @param {object | undefined} selection - projected `{provider, model, reasoningEffort?}`.
   * @returns {object | undefined} matching layer.
   */
  const layerForSelection = (service, selection) => {
    if (!selection || typeof selection !== 'object') return undefined
    return service.listLayers().find((layer) => (
      layer.provider === selection.provider &&
      layer.model === selection.model &&
      (layer.reasoningEffort ?? '') === (selection.reasoningEffort ?? '')
    ))
  }

  /**
   * Read the session's current model selection projection.
   * @param {object} session - agent session.
   * @returns {object | undefined} projected selection.
   */
  const selectionOf = (session) => {
    const projections = ctx.get('sessionProjections')
    try {
      const value = projections?.stateOf?.(session, 'modelSelection')
      return value?.next ?? value?.current ?? value
    } catch {
      return undefined
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
   * Whether the session already carries this exact instructions publication.
   * @param {object} session - agent session.
   * @param {string} digest - rendered rules digest.
   * @param {string} rosterKey - roster identity (empty when agents are off).
   * @returns {boolean} true when a matching message is already in history.
   */
  const surfaceHasPublication = (session, digest, rosterKey) => {
    const nodes = session?.surface?.nodes
    if (!Array.isArray(nodes) || typeof session?.eventAt !== 'function') return false
    for (const seq of [...nodes].reverse()) {
      const event = session.eventAt(seq)
      if (!event || event.type !== 'user/message') continue
      const source = event.data?.source
      if (!source || source.kind !== 'vibestack') continue
      if (source.digest !== digest) continue
      const published = typeof source.roster?.key === 'string' ? source.roster.key : ''
      if (published === rosterKey) return true
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
   * Read the session's persona: its own selection, else the configured default.
   *
   * The selection lives in the projection, which folds `/vibestack-agent`
   * invocations; a session that never selected one still runs the default.
   * @param {object} session - session handle.
   * @param {{name: string}[]} list - persona candidates for the current plan.
   * @returns {string | null} effective agent name.
   */
  const selectedOf = (session, list) => {
    const projections = ctx.get('sessionProjections')
    let state
    try {
      state = projections?.stateOf?.(session, PROJECTION_KEY)
    } catch {
      state = undefined
    }
    const current = typeof state?.selected === 'string' ? state.selected : null
    const personas = personaAgents(list)
    if (current !== null && personas.some((agent) => agent.name === current)) return current
    return pickDefaultAgent(personas, config.defaultAgent)
  }

  /**
   * Read the current workspace plan for a command invocation.
   * @param {object | undefined} agent - command agent handle.
   * @returns {Promise<{plan: Record<string, unknown> | null, cwd: string | null}>} current plan and cwd.
   */
  const currentPlanFor = async (agent) => {
    const session = agent?.session
    if (session === undefined || session === null) return { plan: null, cwd: null }
    const cwd = cwdOf(session)
    if (cwd === null) return { plan: null, cwd: null }
    const result = await cache.get(cwd)
    logWarnings(result.warnings)
    return { plan: result.plan, cwd }
  }

  /**
   * Register plan commands that are not registered yet.
   *
   * The canonical name is stable across projects, so a command is registered
   * once and the handler re-reads the current workspace before rendering. That
   * keeps a domain command from running in a project that does not activate its
   * group while Core commands remain available everywhere.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @returns {void}
   */
  const syncCommands = (plan) => {
    if (!config.commands || commandsScope === undefined) return
    const project = typeof plan.project === 'string' ? plan.project : ''
    const warnings = []
    const entries = commandEntries(plan, names, warnings)
    const skillNames = new Set(skillCandidates(plan, names).map((skill) => skill.name))
    for (const entry of entries) {
      if (skillNames.has(entry.canonical)) {
        warnings.push(`command ${entry.canonical} shadows a skill with the same name`)
      }
      if (state.commands.has(entry.canonical)) continue
      try {
        commandsScope.commands.register({
          name: entry.canonical,
          description: entry.description,
          input: { hint: '[arguments]' },
          handler: async (invocation) => {
            const agent = invocation?.agent
            const current = await currentPlanFor(agent)
            if (!planUsable(current.plan)) {
              return { kind: 'error', text: `VibeStack: ${unusablePlanReason(current.plan)}` }
            }
            const currentWarnings = []
            const live = commandEntries(current.plan, names, currentWarnings)
            logWarnings(currentWarnings)
            const entryNow = live.find((candidate) => candidate.canonical === entry.canonical)
            if (entryNow === undefined) {
              return {
                kind: 'error',
                text: `VibeStack: /${entry.canonical} 不属于当前工作区（未激活 ${entry.group} 能力组）`,
              }
            }
            const deliver = typeof agent?.followup === 'function'
              ? agent.followup.bind(agent)
              : typeof agent?.steer === 'function'
                ? agent.steer.bind(agent)
                : null
            if (deliver === null) {
              return { kind: 'error', text: 'VibeStack: 当前 Agent 不支持投递用户回合' }
            }
            if (config.applyModelOnCommand && entryNow.model.length > 0) {
              await applyModelFor(agent, entryNow.model, 'command')
            }
            const attachments = Array.isArray(invocation.attachments) ? invocation.attachments : []
            const text = renderTemplate(entryNow.template, invocation.rawInput)
            deliver(
              await userMessage({
                content: [...attachments, { type: 'text', text }],
                source: { kind: 'user' },
              }),
            )
            return { kind: 'success', text: `VibeStack: 已发送 /${entry.canonical}` }
          },
        })
        state.commands.set(entry.canonical, project)
      } catch (error) {
        state.commands.set(entry.canonical, project)
        warn('vibestack: cannot register command /%s: %o', entry.canonical, error)
      }
    }
    logWarnings(warnings)
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
   * Inject the instructions message for this step, once per digest and roster.
   *
   * The roster travels in the message `source`: the harness stores the message
   * as a `user/message` event, the client projection folds it, and the model
   * only sees the rule text. No plugin-owned event type is ever written.
   * @param {object} agent - agent handle.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @returns {Promise<Record<string, unknown> | null>} message to append, or null.
   */
  const injectInstructions = async (agent, plan) => {
    if (!config.rules) return null
    const rendered = await renderRules(plan, { maxBytes: config.maxRulesBytes })
    if (rendered === null) return null
    /** @type {{key: string, agents: object[], project: string, defaultSelected: string | null, version: number} | null} */
    let roster = null
    if (config.agents) {
      // Publish every agent so subagent sessions can inspect the full union;
      // the persona picker filters `mode: subagent` on both sides.
      const list = agentList(plan)
      const personas = personaAgents(list)
      roster = createRoster(list, pickDefaultAgent(personas, config.defaultAgent), plan.project)
    }
    const key = roster?.key ?? ''
    const stamp = `${rendered.digest}:${key}`
    const record = sessionStateFor(agent.session)
    if (record.digest === stamp) return null
    if (surfaceHasPublication(agent.session, rendered.digest, key)) {
      record.digest = stamp
      return null
    }
    record.digest = stamp
    const source = { kind: 'vibestack', form: 'instructions', digest: rendered.digest }
    if (roster !== null) source.roster = roster
    return userMessage({
      content: [{ type: 'text', text: rendered.text }],
      source,
    })
  }

  /**
   * Apply `models.default` once to a session that has no recorded selection.
   * @param {object} agent - agent handle.
   * @returns {Promise<void>} resolves after the attempt.
   */
  const applyDefaultLayer = async (agent) => {
    if (!config.applyDefaultLayer) return
    const service = layerService()
    if (service === undefined) return
    if (state.defaults.has(agent.session)) return
    state.defaults.add(agent.session)
    if (selectionOf(agent.session) !== undefined) return
    const id = service.defaultLayer()
    if (id === null || id === undefined || String(id).length === 0) return
    await applyModelFor(agent, id, 'default')
  }

  /**
   * Apply layers named by `/vibestack-...` skill tokens in this step's input.
   *
   * Best effort: `dsh-tool-skill` owns the actual skill injection; a layer may
   * take effect on the next request depending on listener order.
   * @param {object} agent - agent handle.
   * @param {Record<string, unknown>} plan - resolved plan.
   * @param {object[]} messages - messages offered to this step.
   * @returns {Promise<void>} resolves after each attempt.
   */
  const applySkillLayers = async (agent, plan, messages) => {
    if (!config.applyModelOnSkill || !Array.isArray(messages) || messages.length === 0) return
    const candidates = skillCandidates(plan, names).filter((skill) => skill.model.length > 0)
    if (candidates.length === 0) return
    let applied = state.skills.get(agent.session)
    if (applied === undefined) {
      applied = new Set()
      state.skills.set(agent.session, applied)
    }
    for (const message of messages) {
      if (message?.role !== 'user') continue
      const text = (Array.isArray(message.content) ? message.content : [])
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
      if (text.length === 0) continue
      const tokens = new Set(text.match(/\/[a-z0-9][a-z0-9_-]*/gu) ?? [])
      for (const skill of candidates) {
        if (applied.has(skill.name)) continue
        if (!tokens.has(`/${skill.name}`)) continue
        applied.add(skill.name)
        await applyModelFor(agent, skill.model, 'skill')
      }
    }
  }

  /**
   * Resolve the mode's work for one agent step.
   * @param {object} agent - agent handle.
   * @param {AbortSignal | undefined} signal - step signal.
   * @param {object[]} [messages] - messages offered to this step.
   * @returns {Promise<Record<string, unknown> | null>} message to add to the step.
   */
  const prepare = async (agent, signal, messages = []) => {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory?.ensure === undefined) return null
    const cwd = await workingDirectory.ensure(agent, signal)
    if (typeof cwd !== 'string' || cwd.length === 0) return null
    const result = await cache.get(cwd)
    logWarnings(result.warnings)
    const plan = result.plan
    if (!planUsable(plan)) return null
    syncCommands(plan)
    try {
      await syncMcp(plan, agent)
    } catch (error) {
      // An unavailable MCP server must not suppress rules, skills, commands or
      // the Agent roster; the step still starts with everything else.
      warn('vibestack: MCP sync failed: %o', error)
    }
    await applyDefaultLayer(agent)
    await applySkillLayers(agent, plan, messages)
    return injectInstructions(agent, plan)
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
          const cwd = cwdOf(agent.session)
          const plan = cwd === null ? null : cache.peek(cwd)
          if (!planUsable(plan)) return ''
          const list = agentList(plan)
          const selected = selectedOf(agent.session, list)
          if (selected === null) return ''
          const entry = list.find((candidate) => candidate.name === selected)
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
        createSkillProvider({
          getPlan: async (cwd) => (await cache.get(cwd)).plan,
          names,
          isUsable: planUsable,
        }),
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
        handler: async ({ agent, rawInput }) => {
          const cwd = cwdOf(agent.session)
          const result = cwd === null ? null : await cache.get(cwd)
          if (result !== null) logWarnings(result.warnings)
          const plan = result?.plan ?? null
          const agents = planUsable(plan) ? personaAgents(agentList(plan)) : []
          if (agents.length === 0) {
            return { kind: 'error', text: 'VibeStack: 当前项目没有可选 Agent（先在该项目激活能力组）' }
          }
          const input = String(rawInput ?? '').trim()
          if (input.length === 0 || input === 'list') {
            const names = agents.map((entry) => entry.name).join(', ')
            return { kind: 'success', text: `VibeStack agents: ${names}（当前：${selectedOf(agent.session, agents) ?? '未选择'}）` }
          }
          const match = agents.find((entry) => entry.name.toLowerCase() === input.toLowerCase())
          if (match === undefined) {
            return { kind: 'error', text: `VibeStack: 未找到 agent "${input}"` }
          }
          if (config.applyModelOnAgent && typeof match.model === 'string' && match.model.length > 0) {
            await applyModelFor(agent, match.model, 'agent')
          }
          // The command executor logs `command/run` before this handler runs, so
          // the projection already folded the new selection.
          return { kind: 'success', text: `VibeStack: 已切换 Agent 为 ${match.name}` }
        },
      })
    } catch (error) {
      warn('vibestack: cannot register /%s: %o', SELECT_COMMAND, error)
    }
    try {
      scope.commands.register({
        name: LAYER_COMMAND,
        description: '选择本会话的模型层（VibeStack 用户级路由）',
        input: { hint: '[layer 名称|list]' },
        handler: async ({ agent, rawInput }) => {
          const service = layerService()
          if (service === undefined) {
            return { kind: 'error', text: 'VibeStack: 模型层服务未加载（缺少 vibestack-core 行）' }
          }
          const layers = service.listLayers()
          if (layers.length === 0) {
            return { kind: 'error', text: 'VibeStack: 没有模型层（在设置页「VibeStack 模型层」配置）' }
          }
          const input = String(rawInput ?? '').trim()
          const current = layerForSelection(service, selectionOf(agent.session))
          if (input.length === 0 || input === 'list') {
            const names = layers.map((layer) => `${layer.id}（${layer.label}）`).join(', ')
            return {
              kind: 'success',
              text: `VibeStack layers: ${names}（当前：${current?.id ?? '未映射'}）`,
            }
          }
          const match = layers.find((layer) => layer.id.toLowerCase() === input.toLowerCase())
          if (match === undefined) {
            return { kind: 'error', text: `VibeStack: 未找到模型层 "${input}"` }
          }
          const applied = await applyModelFor(agent, match.id, 'layer-command')
          if (!applied.ok) {
            return { kind: 'error', text: `VibeStack: 无法应用模型层 ${match.id}（${applied.code}）` }
          }
          return { kind: 'success', text: `VibeStack: 已切换模型层为 ${match.id}（${match.label}）` }
        },
      })
    } catch (error) {
      warn('vibestack: cannot register /%s: %o', LAYER_COMMAND, error)
    }
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'reject' || signal?.aborted === true) return decision
      const message = await prepare(agent, signal, decision.messages ?? [])
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
