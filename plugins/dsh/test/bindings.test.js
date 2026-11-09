/** DSH model-layer bindings: validation, legacy compatibility, and atomic writes. */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  defaultBindings,
  normalizeBindings,
  normalizeCustomLayers,
  readModels,
  resolveModelsPath,
  writeModels,
} from '../lib/bindings.js'

/**
 * Create a temporary directory for one test.
 * @returns {Promise<string>} absolute path.
 */
async function tempDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'vibestack-bindings-'))
}

test('resolveModelsPath expands ~ and defaults to the global config', () => {
  const fallback = resolveModelsPath('')
  assert.ok(fallback.endsWith(path.join('.config', 'vibestack', 'config.json')))
  assert.equal(resolveModelsPath('~/models.json'), path.join(os.homedir(), 'models.json'))
  assert.equal(resolveModelsPath('C:/tmp/models.json'), path.resolve('C:/tmp/models.json'))
})

test('normalizeBindings drops bad ids, duplicate entries, and incomplete routes', () => {
  const warnings = []
  const bindings = normalizeBindings([
    { id: 'fast', provider: 'p', model: 'm', reasoningEffort: 'low' },
    { id: 'BAD ID', provider: 'p', model: 'm' },
    { id: 'fast', provider: 'p', model: 'm2' },
    { id: 'no-provider', model: 'm' },
    { id: 'strong', provider: 'p', model: 'm' },
  ], warnings)
  assert.deepEqual(Object.keys(bindings), ['fast', 'strong'])
  assert.equal(bindings.fast.model, 'm2')
  assert.equal(bindings.fast.reasoningEffort, undefined)
  assert.match(warnings.join('\n'), /duplicate/)
  assert.match(warnings.join('\n'), /invalid layer id/)
})

test('normalizeCustomLayers rejects platform shadows and duplicates', () => {
  const warnings = []
  const layers = normalizeCustomLayers([
    { id: 'my-fast', label: '我的快速', provider: 'p', model: 'm' },
    { id: 'standard', provider: 'p', model: 'm' },
    { id: 'my-fast', provider: 'p', model: 'm' },
    { id: 'BAD ID', provider: 'p', model: 'm' },
    { id: 'no-provider', model: 'm' },
  ], warnings, new Set(['standard']))
  assert.deepEqual(layers.map((layer) => layer.id), ['my-fast'])
  assert.match(warnings.join('\n'), /shadows a platform layer/)
  assert.match(warnings.join('\n'), /duplicate custom layer/)
})

test('a missing file requests defaults derived from the platform catalog', async () => {
  const dir = await tempDir()
  try {
    const result = await readModels(path.join(dir, 'config.json'))
    assert.deepEqual(result.bindings, {})
    assert.equal(result.useDefaults, true)
    assert.deepEqual(result.custom, [])
    assert.equal(result.default, null)
    assert.deepEqual(result.warnings, [])
    const defaults = defaultBindings(['fast', 'standard', 'strong', 'vision'])
    assert.equal(defaults.standard.model, 'deepseek-flash')
    assert.equal(defaults.vision.provider, 'deepseek-account')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readModels reads bindings, custom layers, and a default', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({
      models: {
        default: 'strong',
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
    }), 'utf8')
    const result = await readModels(file)
    assert.equal(result.default, 'strong')
    assert.equal(result.bindings.fast.model, 'm1')
    assert.equal(result.bindings.strong.reasoningEffort, 'high')
    assert.deepEqual(result.custom.map((layer) => layer.id), ['my-fast'])
    assert.equal(result.useDefaults, false)
    assert.deepEqual(result.warnings, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readModels maps the legacy layers array and warns', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({
      models: {
        default: 'flash',
        layers: [{ id: 'flash', provider: 'p', model: 'm' }],
      },
    }), 'utf8')
    const result = await readModels(file)
    assert.equal(result.bindings.fast.model, 'm')
    assert.equal(result.warnings.some((warning) => warning.includes('legacy')), true)
    assert.equal(result.default, 'fast')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeModels preserves other config sections and writes bindings/custom', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({ schema_version: 1, repository: 'D:/repo', models: { old: true } }), 'utf8')
    await writeModels(file, {
      bindings: { fast: { provider: 'p', model: 'm' } },
      custom: [{ id: 'my-fast', label: '我的快速', provider: 'p', model: 'm' }],
      default: 'fast',
    })
    const document = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(document.repository, 'D:/repo')
    assert.equal(document.models.old, true)
    assert.deepEqual(Object.keys(document.models.bindings.dsh), ['fast'])
    assert.deepEqual(document.models.custom.dsh.map((layer) => layer.id), ['my-fast'])
    assert.equal(document.models.default, 'fast')
    const result = await readModels(file)
    assert.deepEqual(result.warnings, [])
    assert.equal(result.default, 'fast')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
