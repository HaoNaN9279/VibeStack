/** The root core row: service registration and settings route wiring. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { apply } from '../index.js'

/** Platform catalog fixture. */
const CATALOG = [
  { id: 'fast', label: '快速', kind: 'speed', rank: 1 },
  { id: 'standard', label: '标准', kind: 'balanced', rank: 2 },
  { id: 'strong', label: '深度', kind: 'reasoning', rank: 3 },
  { id: 'vision', label: '多模态', kind: 'multimodal', rank: 4 },
]

/**
 * Build a root-like context with provide/inject/connection.
 * @returns {Record<string, any>} context and captures.
 */
function createCoreContext() {
  const provided = new Map()
  const routes = []
  const connection = { fetch: { register: (route) => { routes.push(route) } } }
  const ctx = {
    logger: { warn() {} },
    connection,
    get(name) {
      return name === 'connection' ? connection : undefined
    },
    provide(name, value) {
      provided.set(name, value)
      return () => provided.delete(name)
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
    effect() {
      return () => {}
    },
    on() {
      return () => {}
    },
  }
  return { ctx, provided, routes }
}

test('the core row provides ctx.vibestack and registers the models route', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibestack-core-'))
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({
      models: {
        default: 'standard',
        bindings: {
          dsh: {
            fast: { provider: 'p', model: 'flash' },
            standard: { provider: 'p', model: 'flash' },
            strong: { provider: 'p', model: 'flash' },
            vision: { provider: 'p', model: 'flash' },
          },
        },
      },
    }), 'utf8')
    const { ctx, provided, routes } = createCoreContext()
    apply(ctx, { role: 'core', modelsFile: file, modelSelector: 'replace' }, { catalog: CATALOG })
    const service = provided.get('vibestack')
    assert.ok(service)
    assert.equal(service.apiVersion, 3)
    assert.equal(service.modelSelector, 'replace')
    assert.deepEqual(routes.map((route) => route.path).sort(), [
      '/api/vibestack/models',
      '/api/vibestack/roster',
    ])
    const models = routes.find((route) => route.path === '/api/vibestack/models')
    const response = await models.fetch(new Request('http://localhost/api/vibestack/models'))
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.layers.map((layer) => layer.id), ['fast', 'standard', 'strong', 'vision'])
    assert.equal(payload.layers.every((layer) => layer.bound), true)
    assert.equal(payload.default, 'standard')
    assert.equal(payload.selector, 'replace')

    const roster = routes.find((route) => route.path === '/api/vibestack/roster')
    const missing = await roster.fetch(new Request('http://localhost/api/vibestack/roster'))
    assert.equal(missing.status, 400)
    const unknown = await roster.fetch(new Request('http://localhost/api/vibestack/roster?sessionId=missing'))
    assert.deepEqual(await unknown.json(), { ok: true, roster: null })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
