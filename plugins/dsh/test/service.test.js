/** VibeStack model-layer service: snapshot, validation, save, and catalog checks. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { VibeStackService, API_VERSION, saveModels } from '../lib/service.js'

/**
 * Read-only test logger.
 * @returns {{warnings: string[], warn(message: string): void}} logger.
 */
function logger() {
  return {
    warnings: [],
    warn(message) {
      this.warnings.push(String(message))
    },
  }
}

/**
 * Create a service over a temporary config file.
 * @param {object} [document] - initial config.
 * @returns {Promise<{service: VibeStackService, dir: string}>} service and temp dir.
 */
async function serviceWith(document = { models: { layers: [] } }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibestack-service-'))
  const file = path.join(dir, 'config.json')
  await writeFile(file, JSON.stringify(document), 'utf8')
  const service = new VibeStackService({
    ctx: { get: () => undefined },
    modelsFile: file,
    logger: logger(),
  })
  await service.reload()
  return { service, dir, file }
}

test('an empty config exposes the built-in DeepSeek Flash layer', async () => {
  const { service, dir } = await serviceWith({ models: { layers: [] } })
  try {
    assert.deepEqual(service.listLayers().map((layer) => layer.id), ['flash'])
    assert.equal(service.defaultLayer(), 'flash')
    assert.equal(service.resolveLayer('flash').model, 'deepseek-flash')
    assert.equal(service.resolveLayer('flash').provider, 'deepseek-account')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the service exposes API v2 and layer lookup', async () => {
  const { service, dir } = await serviceWith({
    models: {
      default: 'strong',
      layers: [
        { id: 'fast', label: '快速', provider: 'p', model: 'm1' },
        { id: 'strong', label: '深度', provider: 'p', model: 'm2', reasoningEffort: 'high' },
      ],
    },
  })
  try {
    assert.equal(service.apiVersion, API_VERSION)
    assert.equal(service.defaultLayer(), 'strong')
    assert.equal(service.listLayers().length, 2)
    assert.equal(service.resolveLayer('strong').reasoningEffort, 'high')
    assert.equal(service.hasModel('missing'), false)
    assert.equal(service.listWarnings().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('save validates, writes, and reloads', async () => {
  const { service, dir } = await serviceWith()
  try {
    const result = await saveModels(service, {
      layers: [{ id: 'fast', label: '快速', provider: 'p', model: 'm' }],
      default: 'fast',
    })
    assert.equal(result.ok, true)
    assert.equal(service.defaultLayer(), 'fast')
    assert.equal(service.resolveLayer('fast').label, '快速')
    const invalid = await saveModels(service, { layers: [{ id: 'BAD ID', provider: '', model: '' }] })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.code, 'layers-invalid')
    assert.equal(service.defaultLayer(), 'fast')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reload keeps the previous snapshot when the file is unreadable', async () => {
  const { service, dir, file } = await serviceWith({
    models: { layers: [{ id: 'fast', provider: 'p', model: 'm' }] },
  })
  try {
    await writeFile(file, '{', 'utf8')
    await service.reload()
    assert.equal(service.listLayers().length, 1)
    assert.match(service.listWarnings().join('\n'), /cannot read/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('catalog reports missing layers as unroutable', async () => {
  const { service, dir } = await serviceWith({
    models: {
      layers: [
        { id: 'known', provider: 'p', model: 'm' },
        { id: 'unknown', provider: 'q', model: 'x' },
      ],
    },
  })
  try {
    service.ctx = {
      get: () => ({
        listProviders: () => [{ id: 'p' }],
        listModels: async () => [{ id: 'm' }],
        resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
      }),
    }
    const result = await service.catalog()
    assert.deepEqual(result.available.map((layer) => layer.id), ['known'])
    assert.deepEqual(result.unroutable.map((layer) => layer.id), ['unknown'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
