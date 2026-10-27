/** Config coercion: defaults, type guards, and the root-row switch. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CONFIG, resolveConfig } from '../lib/config.js'

test('resolveConfig returns defaults for an empty config', () => {
  assert.deepEqual(resolveConfig(undefined), { ...DEFAULT_CONFIG })
  assert.deepEqual(resolveConfig(null), { ...DEFAULT_CONFIG })
  assert.deepEqual(resolveConfig('nope'), { ...DEFAULT_CONFIG })
})

test('resolveConfig keeps well-typed values', () => {
  const config = resolveConfig({
    host: false,
    command: 'C:/tools/vibe-stack.exe',
    timeoutMs: 2500,
    rules: false,
    mcp: false,
    maxRulesBytes: 1024,
    defaultAgent: 'Hermes',
  })
  assert.equal(config.host, false)
  assert.equal(config.command, 'C:/tools/vibe-stack.exe')
  assert.equal(config.timeoutMs, 2500)
  assert.equal(config.rules, false)
  assert.equal(config.mcp, false)
  assert.equal(config.maxRulesBytes, 1024)
  assert.equal(config.defaultAgent, 'Hermes')
})

test('resolveConfig ignores mistyped values', () => {
  const config = resolveConfig({
    host: 'no',
    timeoutMs: -5,
    rules: 0,
    maxRulesBytes: 'big',
    defaultAgent: 42,
    unknown: 'ignored',
  })
  assert.equal(config.host, DEFAULT_CONFIG.host)
  assert.equal(config.timeoutMs, DEFAULT_CONFIG.timeoutMs)
  assert.equal(config.rules, DEFAULT_CONFIG.rules)
  assert.equal(config.maxRulesBytes, DEFAULT_CONFIG.maxRulesBytes)
  assert.equal(config.defaultAgent, DEFAULT_CONFIG.defaultAgent)
  assert.equal('unknown' in config, false)
})

test('timeouts are floored to integers', () => {
  assert.equal(resolveConfig({ timeoutMs: 1500.7 }).timeoutMs, 1500)
})
