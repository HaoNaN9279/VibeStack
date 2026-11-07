/** Model-layer Fetch route: GET snapshot and POST validation. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { MODELS_PATH, createModelsRoute } from '../lib/models-route.js'
import { VibeStackService } from '../lib/service.js'

/**
 * Create a route over a temporary config.
 * @returns {Promise<{route: object, service: VibeStackService, dir: string}>} wiring.
 */
async function routeWith() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibestack-route-'))
  const file = path.join(dir, 'config.json')
  await writeFile(file, JSON.stringify({ models: { layers: [{ id: 'fast', provider: 'p', model: 'm' }] } }), 'utf8')
  const service = new VibeStackService({ ctx: { get: () => undefined }, modelsFile: file })
  await service.reload()
  return { route: createModelsRoute({ service }), service, dir }
}

test('the route exposes the current layers', async () => {
  const { route, dir } = await routeWith()
  try {
    assert.equal(route.path, MODELS_PATH)
    assert.deepEqual(route.methods, ['GET', 'POST'])
    const response = await route.fetch(new Request('http://localhost/api/vibestack/models'))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.layers.map((layer) => layer.id), ['fast'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POST validates and writes, and rejects invalid JSON or layers', async () => {
  const { route, service, dir } = await routeWith()
  try {
    const valid = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        layers: [{ id: 'strong', label: '深度', provider: 'p', model: 'm2' }],
        default: 'strong',
      }),
    }))
    assert.equal(valid.status, 200)
    assert.equal(service.defaultLayer(), 'strong')

    const invalid = await route.fetch(new Request('http://localhost/api/vibestack/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layers: [{ id: 'BAD ID' }] }),
    }))
    assert.equal(invalid.status, 400)
    const payload = await invalid.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'layers-invalid')

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
