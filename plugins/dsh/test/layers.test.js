/** Model-layer config: validation, atomic read/write, and defaults. */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  normalizeLayers,
  readModels,
  resolveModelsPath,
  writeModels,
} from '../lib/layers.js'

/**
 * Create a temporary directory for one test.
 * @returns {Promise<string>} absolute path.
 */
async function tempDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'vibestack-layers-'))
}

test('resolveModelsPath expands ~ and defaults to the global config', () => {
  const fallback = resolveModelsPath('')
  assert.ok(fallback.endsWith(path.join('.config', 'vibestack', 'config.json')))
  assert.equal(resolveModelsPath('~/models.json'), path.join(os.homedir(), 'models.json'))
  assert.equal(resolveModelsPath('C:/tmp/models.json'), path.resolve('C:/tmp/models.json'))
})

test('normalizeLayers drops bad and duplicate ids and records reasons', () => {
  const warnings = []
  const layers = normalizeLayers([
    { id: 'fast', label: '快速', provider: 'p', model: 'm', reasoningEffort: 'low' },
    { id: 'BAD ID', provider: 'p', model: 'm' },
    { id: 'fast', provider: 'p', model: 'm' },
    { id: 'no-provider', model: 'm' },
    { id: 'strong', provider: 'p', model: 'm', description: 'deep' },
  ], warnings)
  assert.deepEqual(layers.map((layer) => layer.id), ['fast', 'strong'])
  assert.equal(layers[0].reasoningEffort, 'low')
  assert.equal(layers[1].description, 'deep')
  assert.equal(warnings.length, 3)
})

test('readModels returns empty defaults for a missing file', async () => {
  const dir = await tempDir()
  try {
    const result = await readModels(path.join(dir, 'config.json'))
    assert.deepEqual(result.layers, [])
    assert.equal(result.default, null)
    assert.deepEqual(result.warnings, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeModels preserves other config sections and is atomic-readable', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({ schema_version: 1, repository: 'D:/repo', models: { old: true } }), 'utf8')
    await writeModels(file, {
      layers: [{ id: 'fast', label: '快速', provider: 'p', model: 'm' }],
      default: 'fast',
    })
    const document = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(document.repository, 'D:/repo')
    assert.deepEqual(document.models.layers.map((layer) => layer.id), ['fast'])
    assert.equal(document.models.default, 'fast')
    assert.equal(document.models.old, true)
    const result = await readModels(file)
    assert.deepEqual(result.warnings, [])
    assert.equal(result.default, 'fast')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readModels warns about an unknown default and malformed layers', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'config.json')
  try {
    await writeFile(file, JSON.stringify({ models: { default: 'missing', layers: [{ id: 'fast', provider: 'p', model: 'm' }] } }), 'utf8')
    const result = await readModels(file)
    assert.equal(result.default, null)
    assert.match(result.warnings.join('\n'), /unknown layer/)
    await writeFile(file, JSON.stringify({ models: { layers: 'nope' } }), 'utf8')
    const malformed = await readModels(file)
    assert.match(malformed.warnings.join('\n'), /must be an array/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
