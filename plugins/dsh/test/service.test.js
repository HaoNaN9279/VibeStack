/** VibeStack model-layer service: catalog + bindings, validation, and save. */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { VibeStackService, API_VERSION, normalizeCatalog, saveModels } from '../lib/service.js'

/** Platform catalog fixture. */
const CATALOG = [
  { id: 'fast', label: '快速', kind: 'speed', rank: 1, description: 'quick' },
  { id: 'standard', label: '标准', kind: 'balanced', rank: 2, description: 'default' },
  { id: 'strong', label: '深度', kind: 'reasoning', rank: 3, description: 'deep' },
  { id: 'vision', label: '多模态', kind: 'multimodal', rank: 4, description: 'vision' },
]

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
 * @param {object[]} [catalog] - platform catalog.
 * @returns {Promise<{service: VibeStackService, dir: string, file: string}>} service and temp dir.
 */
async function serviceWith(document = {}, catalog = CATALOG) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibestack-service-'))
  const file = path.join(dir, 'config.json')
  await writeFile(file, JSON.stringify(document), 'utf8')
  const service = new VibeStackService({
    ctx: { get: () => undefined },
    modelsFile: file,
    logger: logger(),
    catalog,
  })
  await service.reload()
  return { service, dir, file }
}

test('an empty config exposes all four platform layers bound to DSH defaults', async () => {
  const { service, dir } = await serviceWith({})
  try {
    assert.deepEqual(service.listLayers().map((layer) => layer.id), ['fast', 'standard', 'strong', 'vision'])
    assert.equal(service.defaultLayer(), 'standard')
    assert.equal(service.resolveLayer('strong').model, 'deepseek-flash')
    assert.equal(service.resolveLayer('strong').provider, 'deepseek-account')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('project defaults fill every layer and override the default layer', async () => {
  const { service, dir } = await serviceWith({})
  try {
    const routes = Object.fromEntries(
      CATALOG.map((layer) => [
        layer.id,
        { provider: 'deepseek-account', model: 'deepseek-flash' },
      ]),
    )
    service.setPlatformBindings(routes, 'strong')
    await service.reload()
    assert.deepEqual(service.listLayers().map((layer) => layer.id), [
      'fast',
      'standard',
      'strong',
      'vision',
    ])
    assert.equal(service.defaultLayer(), 'strong')
    assert.equal(service.resolveLayer('vision').model, 'deepseek-flash')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('local bindings override project defaults one layer at a time', async () => {
  const { service, dir } = await serviceWith({
    models: { bindings: { dsh: { fast: { provider: 'local', model: 'small' } } } },
  })
  try {
    const routes = Object.fromEntries(
      CATALOG.map((layer) => [
        layer.id,
        { provider: 'deepseek-account', model: 'deepseek-flash' },
      ]),
    )
    service.setPlatformBindings(routes, 'standard')
    await service.reload()
    assert.deepEqual(service.listLayers().map((layer) => layer.id), [
      'fast',
      'standard',
      'strong',
      'vision',
    ])
    assert.equal(service.resolveLayer('fast').model, 'small')
    assert.equal(service.resolveLayer('standard').model, 'deepseek-flash')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('unbound platform layers stay listed but cannot be applied', async () => {
  const { service, dir } = await serviceWith({
    models: { bindings: { dsh: { fast: { provider: 'p', model: 'm1' } } } },
  })
  try {
    const catalog = service.listCatalog()
    assert.deepEqual(catalog.map((layer) => layer.id), ['fast', 'standard', 'strong', 'vision'])
    assert.equal(catalog.find((layer) => layer.id === 'fast').bound, true)
    assert.equal(catalog.find((layer) => layer.id === 'strong').bound, false)
    assert.equal(service.resolveLayer('strong'), undefined)
    assert.equal(service.hasLayer('strong'), true)
    assert.equal(service.defaultLayer(), 'fast')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the service exposes API v3 and DSH-only custom layers', async () => {
  const { service, dir } = await serviceWith({
    models: {
      default: 'my-fast',
      bindings: {
        dsh: {
          fast: { provider: 'p', model: 'm1' },
          strong: { provider: 'p', model: 'm2', reasoningEffort: 'high' },
        },
      },
      custom: {
        dsh: [{ id: 'my-fast', label: '我的快速', provider: 'p', model: 'm3' }],
      },
    },
  })
  try {
    assert.equal(service.apiVersion, API_VERSION)
    assert.equal(service.defaultLayer(), 'my-fast')
    assert.deepEqual(service.listLayers().map((layer) => layer.id), ['fast', 'strong', 'my-fast'])
    assert.equal(service.resolveLayer('strong').reasoningEffort, 'high')
    assert.equal(service.resolveLayer('my-fast').custom, true)
    assert.equal(service.hasModel('missing'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('save validates, writes bindings and custom layers, and reloads', async () => {
  const { service, dir } = await serviceWith({})
  try {
    const result = await saveModels(service, {
      bindings: { fast: { provider: 'p', model: 'm' }, strong: { provider: 'p', model: 'm2' } },
      custom: [{ id: 'my-fast', label: '我的快速', provider: 'p', model: 'm3' }],
      default: 'strong',
    })
    assert.equal(result.ok, true)
    assert.equal(service.defaultLayer(), 'strong')
    assert.equal(service.resolveLayer('fast').label, '快速')
    assert.equal(service.resolveLayer('my-fast').custom, true)

    const invalid = await saveModels(service, {
      bindings: { missing: { provider: 'p', model: 'm' } },
    })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.code, 'layers-invalid')
    assert.equal(service.defaultLayer(), 'strong')

    const shadow = await saveModels(service, {
      bindings: { fast: { provider: 'p', model: 'm' } },
      custom: [{ id: 'standard', provider: 'p', model: 'm' }],
    })
    assert.equal(shadow.ok, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('save accepts the legacy flat layers shape', async () => {
  const { service, dir } = await serviceWith({})
  try {
    const result = await saveModels(service, {
      layers: [{ id: 'fast', provider: 'p', model: 'm' }],
      default: 'fast',
    })
    assert.equal(result.ok, true)
    assert.equal(service.defaultLayer(), 'fast')
    assert.deepEqual(service.listLayers().map((layer) => layer.id), ['fast'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reload keeps the previous snapshot when the file is unreadable', async () => {
  const { service, dir, file } = await serviceWith({
    models: { bindings: { dsh: { fast: { provider: 'p', model: 'm' } } } },
  })
  try {
    await writeFile(file, '{', 'utf8')
    await service.reload()
    assert.deepEqual(service.listLayers().map((layer) => layer.id), ['fast'])
    assert.match(service.listWarnings().join('\n'), /cannot read/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('catalog reports missing routes as unroutable and skips unbound layers', async () => {
  const { service, dir } = await serviceWith({
    models: {
      bindings: {
        dsh: {
          fast: { provider: 'p', model: 'm' },
          strong: { provider: 'q', model: 'x' },
        },
      },
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
    assert.deepEqual(result.available.map((layer) => layer.id), ['fast'])
    assert.ok(result.unroutable.some((layer) => layer.id === 'strong'))
    assert.equal(result.unroutable.some((layer) => layer.id === 'standard'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('normalizeCatalog drops invalid and duplicate ids', () => {
  const warnings = []
  const layers = normalizeCatalog([
    { id: 'fast', label: '快速' },
    { id: 'BAD ID' },
    { id: 'fast', label: '重复' },
  ], warnings)
  assert.deepEqual(layers.map((layer) => layer.id), ['fast'])
  assert.match(warnings.join('\n'), /invalid id/)
  assert.match(warnings.join('\n'), /duplicate/)
})
