/** Platform model-layer catalog boundary: parsing and fail-open loading. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CATALOG_ARGS, loadCatalog, parseCatalog } from '../lib/catalog.js'

const PAYLOAD = {
  schema_version: 1,
  default: 'standard',
  layers: [
    { id: 'fast', label: '快速', description: 'quick', kind: 'speed', rank: 1 },
    { id: 'standard', label: '标准', description: 'default', kind: 'balanced', rank: 2 },
  ],
}

test('parseCatalog accepts the platform payload', () => {
  const catalog = parseCatalog(JSON.stringify(PAYLOAD))
  assert.deepEqual(catalog.layers.map((layer) => layer.id), ['fast', 'standard'])
  assert.equal(catalog.default, 'standard')
  assert.deepEqual(catalog.warnings, [])
})

test('parseCatalog rejects broken or unsupported payloads', () => {
  assert.throws(() => parseCatalog('{'))
  assert.throws(() => parseCatalog(JSON.stringify({ schema_version: 9, layers: [] })))
  assert.throws(() => parseCatalog(JSON.stringify({ schema_version: 1 })))
})

test('loadCatalog uses the catalog argv and falls back on failure', async () => {
  const calls = []
  const result = await loadCatalog('vibe-stack', async (command, args) => {
    calls.push([command, args])
    return { stdout: JSON.stringify(PAYLOAD), stderr: '' }
  })
  assert.deepEqual(calls, [['vibe-stack', [...CATALOG_ARGS]]])
  assert.equal(result.default, 'standard')
  assert.equal(result.layers.length, 2)

  const missing = await loadCatalog('missing', async () => {
    throw Object.assign(new Error('not found'), { code: 'ENOENT' })
  })
  assert.deepEqual(missing.layers, [])
  assert.match(missing.warnings.join('\n'), /failed/)
})
