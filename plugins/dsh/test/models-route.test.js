/** Model-layer Fetch route: catalog snapshot and binding validation. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { MODELS_PATH, createModelsRoute } from '../lib/models-route.js'
import { VibeStackService } from '../lib/service.js'

/** Platform catalog fixture. */
const CATALOG = [
  { id: 'fast', label: '快速', kind: 'speed', rank: 1 },
  { id: 'standard', label: '标准', kind: 'balanced', rank: 2 },
  { id: 'strong', label: '深度', kind: 'reasoning', rank: 3 },
  { id: 'vision', label: '多模态', kind: 'multimodal', rank: 4 },
]

/**
 * Create a route over a temporary config.
 * @param {object} [document] - initial config.
 * @returns {Promise<{route: object, service: VibeStackService, dir: string}>} wiring.
 */
async function routeWith(document = {
  models: { default: 'fast', bindings: { dsh: { fast: { provider: 'p', model: 'm' } } } },
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibestack-route-'))
  const file = path.join(dir, 'config.json')
  await writeFile(file, JSON.stringify(document), 'utf8')
  const service = new VibeStackService({
    ctx: { get: () => undefined },
    modelsFile: file,
    catalog: CATALOG,
  })
  await service.reload()
  return { route: createModelsRoute({ service }), service, dir }
}

test('the route exposes the platform catalog with binding status', async () => {
  const { route, dir } = await routeWith()
  try {
    assert.equal(route.path, MODELS_PATH)
    assert.deepEqual(route.methods, ['GET', 'POST'])
    const response = await route.fetch(new Request('http://localhost/api/vibestack/models'))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.layers.map((layer) => layer.id), ['fast', 'standard', 'strong', 'vision'])
    assert.equal(payload.layers.find((layer) => layer.id === 'fast').bound, true)
    assert.equal(payload.layers.find((layer) => layer.id === 'strong').bound, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POST validates bindings and custom layers, and rejects invalid input', async () => {
  const { route, service, dir } = await routeWith()
  try {
    const valid = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bindings: {
          fast: { provider: 'p', model: 'm' },
          strong: { provider: 'p', model: 'm2' },
        },
        custom: [{ id: 'my-fast', label: '我的快速', provider: 'p', model: 'm3' }],
        default: 'strong',
      }),
    }))
    assert.equal(valid.status, 200)
    assert.equal(service.defaultLayer(), 'strong')
    assert.equal(service.resolveLayer('my-fast').custom, true)

    const invalid = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bindings: { missing: { provider: 'p', model: 'm' } } }),
    }))
    assert.equal(invalid.status, 400)
    const payload = await invalid.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'layers-invalid')

    const shadow = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bindings: { fast: { provider: 'p', model: 'm' } },
        custom: [{ id: 'standard', provider: 'p', model: 'm' }],
      }),
    }))
    assert.equal(shadow.status, 400)

    const broken = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      body: '{',
    }))
    assert.equal(broken.status, 400)
    assert.equal((await broken.json()).code, 'invalid-json')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POST rejects a write while the platform catalog is unavailable', async () => {
  const { route, dir } = await routeWith({
    models: { bindings: { dsh: { fast: { provider: 'p', model: 'm' } } } },
  })
  try {
    const service = new VibeStackService({
      ctx: { get: () => undefined },
      modelsFile: path.join(dir, 'config.json'),
    })
    await service.reload()
    const emptyRoute = createModelsRoute({ service })
    const response = await emptyRoute.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bindings: { fast: { provider: 'p', model: 'm' } } }),
    }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'catalog-unavailable')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
