/** MCP mapping: namespace sanitising, entry normalising, and mounting. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeMcpEntries, normalizeMcpEntry, sanitizeServerName, syncMcpServers } from '../lib/mcp.js'

test('sanitizeServerName produces a DSH-safe namespace', () => {
  assert.equal(sanitizeServerName('vibe:core_demo'), 'vibe_core_demo')
  assert.equal(sanitizeServerName('vibe:codegraph'), 'vibe_codegraph')
  const named = sanitizeServerName('vibe:group/with spaces.and:colons')
  assert.match(named, /^[A-Za-z0-9_-]{1,32}$/u)
})

test('sanitizeServerName truncates long names with a stable suffix', () => {
  const long = `vibe:${'x'.repeat(60)}`
  const first = sanitizeServerName(long)
  const second = sanitizeServerName(long)
  assert.equal(first, second)
  assert.ok(first.length <= 32)
  assert.match(first, /^[A-Za-z0-9_-]+$/u)
})

test('a remote entry becomes a streamable-http config', () => {
  const entry = normalizeMcpEntry('vibe:core_ctx', {
    type: 'remote',
    url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer x' },
  })
  assert.equal(entry.serverName, 'vibe_core_ctx')
  assert.deepEqual(entry.config, {
    serverName: 'vibe_core_ctx',
    transport: 'streamable-http',
    url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer x' },
    failOnStartupError: false,
  })
})

test('a local entry becomes a stdio config', () => {
  const entry = normalizeMcpEntry('vibe:core_cg', {
    type: 'local',
    command: ['codegraph', 'serve', '--mcp'],
    env: { A: '1' },
  })
  assert.deepEqual(entry.config, {
    serverName: 'vibe_core_cg',
    transport: 'stdio',
    command: 'codegraph',
    args: ['serve', '--mcp'],
    env: { A: '1' },
    failOnStartupError: false,
  })
})

test('disabled and malformed entries are skipped', () => {
  assert.equal(normalizeMcpEntry('vibe:x', { enabled: false, type: 'remote', url: 'u' }), null)
  assert.equal(normalizeMcpEntry('vibe:x', { type: 'remote' }), null)
  assert.equal(normalizeMcpEntry('vibe:x', { type: 'local', command: [] }), null)
  assert.equal(normalizeMcpEntry('vibe:x', null), null)
})

test('normalizeMcpEntries maps every usable entry', () => {
  const entries = normalizeMcpEntries({
    'vibe:a_one': { type: 'remote', url: 'https://a' },
    'vibe:b_two': { type: 'local', command: 'run' },
    'vibe:c_off': { type: 'remote', url: 'https://c', enabled: false },
  })
  assert.deepEqual(entries.map((entry) => entry.serverName), ['vibe_a_one', 'vibe_b_two'])
  assert.equal(entries[1].config.command, 'run')
  assert.deepEqual(entries[1].config.args, [])
})

/**
 * Minimal plugin context for mount reconciliation.
 * @returns {Record<string, unknown>} fake ctx with mount bookkeeping.
 */
function fakeCtx() {
  const mounted = []
  const disposed = []
  return {
    mounted,
    disposed,
    logger: { warn() {} },
    plugin(module, config) {
      mounted.push({ module, config })
      return {
        dispose: async () => {
          disposed.push(config.serverName)
        },
      }
    },
  }
}

test('syncMcpServers mounts each desired entry once', async () => {
  const ctx = fakeCtx()
  const store = new Map()
  const entries = normalizeMcpEntries({
    'vibe:a_one': { type: 'remote', url: 'https://a' },
    'vibe:b_two': { type: 'local', command: ['run'] },
  })
  const module = { name: 'fake-mcp-client' }
  await syncMcpServers(ctx, store, entries, async () => module)
  assert.equal(ctx.mounted.length, 2)
  assert.equal(store.size, 2)
  await syncMcpServers(ctx, store, entries, async () => module)
  assert.equal(ctx.mounted.length, 2)
})

test('syncMcpServers disposes removed and changed servers', async () => {
  const ctx = fakeCtx()
  const store = new Map()
  const module = { name: 'fake-mcp-client' }
  await syncMcpServers(
    ctx,
    store,
    normalizeMcpEntries({
      'vibe:a_one': { type: 'remote', url: 'https://a' },
      'vibe:b_two': { type: 'remote', url: 'https://b' },
    }),
    async () => module,
  )
  await syncMcpServers(
    ctx,
    store,
    normalizeMcpEntries({ 'vibe:b_two': { type: 'remote', url: 'https://b2' } }),
    async () => module,
  )
  assert.deepEqual(ctx.disposed.sort(), ['vibe_a_one', 'vibe_b_two'].sort())
  assert.equal(store.size, 1)
  assert.equal(ctx.mounted.at(-1).config.url, 'https://b2')
})

test('syncMcpServers keeps working when the client package is unavailable', async () => {
  const ctx = fakeCtx()
  const store = new Map()
  const entries = normalizeMcpEntries({ 'vibe:a_one': { type: 'remote', url: 'https://a' } })
  await syncMcpServers(ctx, store, entries, async () => {
    throw new Error('module not found')
  })
  assert.equal(store.size, 0)
  assert.equal(ctx.mounted.length, 0)
})
