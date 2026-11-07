/** The root core row: service registration and settings route wiring. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { apply } from '../index.js'

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
        default: 'strong',
        layers: [{ id: 'strong', label: '深度', provider: 'p', model: 'm' }],
      },
    }), 'utf8')
    const { ctx, provided, routes } = createCoreContext()
    apply(ctx, { role: 'core', modelsFile: file, modelSelector: 'replace' })
    const service = provided.get('vibestack')
    assert.ok(service)
    assert.equal(service.apiVersion, 2)
    assert.equal(service.modelSelector, 'replace')
    assert.equal(routes.length, 1)
    assert.equal(routes[0].path, '/api/vibestack/models')
    const response = await routes[0].fetch(new Request('http://localhost/api/vibestack/models'))
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.layers.map((layer) => layer.id), ['strong', 'flash'])
    assert.equal(payload.default, 'strong')
    assert.equal(payload.selector, 'replace')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
