/** Session inventory: section order, rule scoping, budget and text lookup. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildInventory, inventoryText, selectAgent } from '../lib/inventory.js'

const HOME = '/nonexistent/home'

const HEADER = `\n<system-reminder>\nThe following VibeStack rules apply to this workspace. Follow them as project instructions.\n</system-reminder>\n`

/**
 * In-memory reader over a file map.
 * @param {Record<string, string>} files - absolute path to content.
 * @returns {(file: string) => Promise<string>} reader.
 */
function reader(files) {
  return async (file) => {
    if (!(file in files)) throw new Error(`missing ${file}`)
    return files[file]
  }
}

/** Minimal plan that mirrors the resolver's v2 shape. */
function planWith(overrides = {}) {
  const rules = [
    {
      name: 'global', id: 'core/global', path: '/repo/core/rules/00-global.md',
      group: 'core', module: '', scope: 'global', always: true, priority: 0, kind: 'rule',
      description: '全局规则',
    },
    {
      name: 'physics', id: 'game/battle/physics', path: '/repo/game/modules/battle/rules/physics.md',
      group: 'game', module: 'battle', scope: 'paths', paths: ['Assets/Battle/**'],
      always: true, priority: 0, kind: 'rule', description: '战斗规则',
    },
    {
      name: 'lazy', id: 'game/battle/lazy', path: '/repo/game/modules/battle/rules/lazy.md',
      group: 'game', module: 'battle', scope: 'paths', paths: ['Assets/Battle/**'],
      always: false, priority: 0, kind: 'rule', description: '按需规则',
    },
    {
      name: 'ui', id: 'game/ui/ugui', path: '/repo/game/modules/ui/rules/ugui.md',
      group: 'game', module: 'ui', scope: 'paths', paths: ['Assets/UI/**'],
      always: true, priority: 0, kind: 'rule', description: 'UGUI 规则',
    },
  ]
  return {
    schema_version: 2,
    project: '/repo',
    mode: 'project',
    rules,
    skills: [
      {
        name: 'core-skill', id: 'core/core-skill', path: '/repo/core/skills/core-skill',
        group: 'core', module: '', description: '核心技能',
      },
    ],
    commands: {
      build: {
        name: 'build', id: 'core/build', group: 'core', module: '', description: '构建',
        template_path: '/repo/core/commands/build.md', template: 'build it',
      },
    },
    agents: {
      Main: {
        name: 'Main', id: 'core/Main', group: 'core', module: '', mode: 'primary',
        description: '主智能体', model: 'strong', system: 'You are Main.', system_path: '/repo/core/agents/main.md',
      },
      'battle/EnemyAI': {
        name: 'EnemyAI', id: 'game/battle/EnemyAI', group: 'game', module: 'battle',
        mode: 'subagent', description: '敌人 AI', system: 'You are EnemyAI.', system_path: '/repo/game/modules/battle/agents/enemy.md',
      },
    },
    mcp: {
      'vibe:core_tools': { type: 'local', command: ['node', 'server.js'], enabled: true },
    },
    names: {
      agents: { 'core/Main': 'Main', 'game/battle/EnemyAI': 'battle/EnemyAI' },
      commands: { 'core/build': 'vibestack-core-build' },
      skills: { 'core/core-skill': 'vibestack-core-core-skill' },
    },
    model_layers: [{ id: 'fast' }, { id: 'standard' }, { id: 'strong' }],
    model_default: 'standard',
    warnings: [],
    fingerprint: 'abc123',
    ...overrides,
  }
}

/** File map backing the plan above. */
function files() {
  return {
    '/repo/core/rules/00-global.md': '---\nname: global\n---\n# 全局规则\n\n内容。\n',
    '/repo/game/modules/battle/rules/physics.md': '---\nname: physics\n---\n战斗物理规则。\n',
    '/repo/game/modules/ui/rules/ugui.md': '---\nname: ugui\n---\nUGUI 规则。\n',
    '/repo/core/skills/core-skill/SKILL.md': '---\nname: core-skill\n---\n技能正文。\n',
    '/repo/core/commands/build.md': '---\nname: build\n---\n构建模板。\n',
  }
}

test('sections follow the injection order and skipped rules collapse separately', async () => {
  const inventory = await buildInventory({
    plan: planWith(), home: HOME,
    cwd: '',
    read: reader(files()),
  })
  assert.equal(inventory.schema_version, 1)
  assert.deepEqual(inventory.sections.map((section) => section.kind), [
    'agents-md', 'persona', 'skills', 'commands', 'mcp', 'rules', 'rules-skipped', 'agents',
  ])
  assert.equal(inventory.sections.find((section) => section.kind === 'agents').collapsed, true)
  assert.equal(inventory.sections.find((section) => section.kind === 'rules-skipped').collapsed, true)
  const skipped = inventory.sections.find((section) => section.kind === 'rules-skipped')
  assert.deepEqual(skipped.items.map((entry) => entry.id).sort(), [
    'game/battle/lazy', 'game/battle/physics', 'game/ui/ugui',
  ])
})

test('the rules section keeps injected, indexed and omitted in plan order', async () => {
  const inventory = await buildInventory({
    plan: planWith(), home: HOME,
    cwd: 'Assets/Battle',
    read: reader(files()),
  })
  const rules = inventory.sections.find((section) => section.kind === 'rules')
  assert.deepEqual(rules.items.map((entry) => [entry.id, entry.status]), [
    ['core/global', 'injected'],
    ['game/battle/physics', 'injected'],
    ['game/battle/lazy', 'indexed'],
  ])
  assert.equal(inventory.sections.some((section) => section.kind === 'rules-skipped'), true)
})

test('the host instruction section leads and the persona follows it', async () => {
  const inventory = await buildInventory({ plan: planWith(), home: HOME, cwd: '', read: reader(files()) })
  assert.equal(inventory.agent.name, 'Main')
  assert.equal(inventory.agent.model, 'strong')
  assert.equal(inventory.model.default, 'standard')
  assert.deepEqual(inventory.model.catalog, ['fast', 'standard', 'strong'])
  const persona = inventory.sections.find((section) => section.kind === 'persona')
  assert.equal(persona.items.length, 1)
  assert.equal(persona.items[0].kind, 'persona')
  assert.equal(persona.items[0].current, true)
  assert.match(persona.items[0].summary, /You are Main\./u)
  const roster = inventory.sections.find((section) => section.kind === 'agents')
  assert.equal(roster.items.find((entry) => entry.name === 'EnemyAI').module, 'battle')
})

test('an explicit agent wins, and an unknown agent produces an empty persona', async () => {
  const chosen = await buildInventory({ plan: planWith(), home: HOME, agent: 'EnemyAI', read: reader(files()) })
  assert.equal(chosen.agent.name, 'EnemyAI')
  assert.equal(chosen.agent.id, 'game/battle/EnemyAI')
  assert.equal(selectAgent(planWith(), 'main').name, 'Main')
  const missing = await buildInventory({ plan: planWith(), home: HOME, agent: 'nobody', read: reader(files()) })
  assert.deepEqual(missing.agent, {})
  assert.equal(missing.sections.find((section) => section.kind === 'persona').items.length, 0)
})

test('the budget reports the rendered size and marks overflow as omitted', async () => {
  const inventory = await buildInventory({
    plan: planWith(), home: HOME,
    cwd: '',
    maxRulesBytes: Buffer.byteLength(HEADER, 'utf8') + 20,
    read: reader(files()),
  })
  const rules = inventory.sections.find((section) => section.kind === 'rules')
  assert.equal(rules.items.every((entry) => entry.status === 'omitted'), true)
  assert.equal(inventory.budget.limit > 0, true)
  assert.equal(inventory.budget.omitted > 0, true)
})

test('skills and commands report host names and sizes', async () => {
  const inventory = await buildInventory({ plan: planWith(), home: HOME, read: reader(files()) })
  const skills = inventory.sections.find((section) => section.kind === 'skills')
  assert.equal(skills.items[0].host_name, 'vibestack-core-core-skill')
  assert.equal(skills.items[0].summary, '核心技能')
  assert.equal(skills.items[0].path, '/repo/core/skills/core-skill/SKILL.md')
  const commands = inventory.sections.find((section) => section.kind === 'commands')
  assert.equal(commands.items[0].host_name, 'vibestack-core-build')
  assert.equal(commands.items[0].bytes > 0, true)
})

test('inventoryText resolves entries from the plan by id only', async () => {
  const plan = planWith()
  const read = reader(files())
  const rule = await inventoryText({ plan, home: HOME, cwd: 'Assets/Battle', kind: 'rule', id: 'game/battle/physics', read })
  assert.match(rule.text, /战斗物理规则/u)
  assert.equal(rule.path, '/repo/game/modules/battle/rules/physics.md')
  const skill = await inventoryText({ plan, home: HOME, kind: 'skill', id: 'core/core-skill', read })
  assert.match(skill.text, /技能正文/u)
  const command = await inventoryText({ plan, home: HOME, kind: 'command', id: 'core/build', read })
  assert.match(command.text, /构建模板/u)
  const persona = await inventoryText({ plan, home: HOME, kind: 'persona', id: 'core/Main', read })
  assert.equal(persona.text, 'You are Main.')
  const missing = await inventoryText({ plan, home: HOME, kind: 'rule', id: '/etc/passwd', read })
  assert.equal(missing, null)
})
