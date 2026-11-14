/** Inventory Fetch routes: session scoping, error codes and text truncation. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INVENTORY_PATH, INVENTORY_TEXT_PATH, createInventoryRoutes } from '../lib/inventory-route.js'

/**
 * A plan and file map the routes can answer from.
 * @returns {{plan: object, files: Record<string, string>}} fixture.
 */
function fixture() {
  const plan = {
    schema_version: 2,
    project: '/repo',
    mode: 'project',
    rules: [
      {
        name: 'global', id: 'core/global', path: '/repo/core/rules/00-global.md',
        group: 'core', module: '', scope: 'global', always: true, kind: 'rule',
        description: '全局规则',
      },
    ],
    skills: [],
    commands: {},
    agents: {
      Main: {
        name: 'Main', id: 'core/Main', group: 'core', module: '', mode: 'primary',
        description: '主智能体', system: 'You are Main.', system_path: '/repo/core/agents/main.md',
      },
    },
    mcp: {},
    names: { agents: { 'core/Main': 'Main' }, commands: {}, skills: {} },
    model_layers: [],
    model_default: 'standard',
    warnings: [],
    fingerprint: 'f',
  }
  return {
    plan,
    files: { '/repo/core/rules/00-global.md': '---\nname: global\n---\n全局规则正文。\n' },
  }
}

/**
 * Route pair over a fixed session.
 * @param {object} [options] - overrides.
 * @returns {Array<object>} routes.
 */
function routes(options = {}) {
  const { plan, files } = fixture()
  const read = async (file) => {
    if (!(file in files)) throw new Error(`missing ${file}`)
    return files[file]
  }
  return createInventoryRoutes({
    sessionFor: async (sessionId) => (sessionId === 's1' ? { plan, cwd: '' } : null),
    home: '/nonexistent/home',
    read,
    ...options,
  })
}

test('the list route answers a known session and rejects unknown or missing ids', async () => {
  const [list] = routes()
  assert.equal(list.path, INVENTORY_PATH)
  assert.deepEqual(list.methods, ['GET'])

  const ok = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}?sessionId=s1`))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  const payload = await ok.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.inventory.agent.name, 'Main')
  assert.equal(payload.inventory.cwd, '')
  assert.deepEqual(payload.inventory.sections.map((section) => section.kind), [
    'agents-md', 'persona', 'skills', 'commands', 'mcp', 'rules', 'agents',
  ])

  const missing = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}`))
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).code, 'missing-session')

  const unknown = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}?sessionId=other`))
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).code, 'missing-session')
})

test('a window without a host session passes its workspace as a hint', async () => {
  const seen = []
  const [list] = routes({
    sessionFor: async (sessionId, hint) => {
      seen.push([sessionId, hint])
      return hint === 'D:/workspace/Game' ? { plan: fixture().plan, cwd: '' } : null
    },
  })

  const hinted = await list.fetch(new Request(
    `http://localhost${INVENTORY_PATH}?sessionId=blank&cwd=${encodeURIComponent('D:/workspace/Game')}`,
  ))
  assert.equal(hinted.status, 200)
  assert.deepEqual(seen, [['blank', 'D:/workspace/Game']])

  const unhinted = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}?sessionId=blank`))
  assert.equal(unhinted.status, 404)
  assert.deepEqual(seen[1], ['blank', ''])
})

test('a coded session failure keeps its status, code and details', async () => {
  const [list] = routes({
    sessionFor: async () => {
      const failure = new Error('this window has no session on the host yet')
      failure.code = 'missing-session'
      failure.status = 409
      failure.details = { workingDirectory: false }
      throw failure
    },
  })

  const response = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}?sessionId=blank`))
  assert.equal(response.status, 409)
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'missing-session')
  assert.match(payload.message, /no session on the host/u)
  assert.deepEqual(payload.details, { workingDirectory: false })
})

test('an uncoded session failure becomes a 500 with its message', async () => {
  const [list] = routes({
    sessionFor: async () => {
      throw new Error('boom')
    },
  })

  const response = await list.fetch(new Request(`http://localhost${INVENTORY_PATH}?sessionId=s1`))
  assert.equal(response.status, 500)
  const payload = await response.json()
  assert.equal(payload.code, 'inventory-route-failed')
  assert.equal(payload.message, 'boom')
})

test('the text route returns one entry, truncates and rejects unknown ids', async () => {
  const [, text] = routes()
  assert.equal(text.path, INVENTORY_TEXT_PATH)

  const ok = await text.fetch(new Request(
    `http://localhost${INVENTORY_TEXT_PATH}?sessionId=s1&kind=rule&id=core/global`,
  ))
  assert.equal(ok.status, 200)
  const payload = await ok.json()
  assert.equal(payload.ok, true)
  assert.match(payload.text, /全局规则正文/u)
  assert.equal(payload.truncated, false)
  assert.equal(payload.path, '/repo/core/rules/00-global.md')

  const missing = await text.fetch(new Request(`http://localhost${INVENTORY_TEXT_PATH}?sessionId=s1`))
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).code, 'missing-entry')

  const unknown = await text.fetch(new Request(
    `http://localhost${INVENTORY_TEXT_PATH}?sessionId=s1&kind=rule&id=nope`,
  ))
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).code, 'unknown-entry')

  const traversal = await text.fetch(new Request(
    `http://localhost${INVENTORY_TEXT_PATH}?sessionId=s1&kind=rule&id=/repo/core/rules/00-global.md`,
  ))
  assert.equal(traversal.status, 404)
})

test('the text route clamps the payload to the configured byte budget', async () => {
  const [, text] = routes({ textBytes: 6 })
  const response = await text.fetch(new Request(
    `http://localhost${INVENTORY_TEXT_PATH}?sessionId=s1&kind=persona&id=core/Main`,
  ))
  const payload = await response.json()
  assert.equal(payload.truncated, true)
  assert.equal(payload.text, 'You ar')
})
