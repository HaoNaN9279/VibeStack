/** Resolve boundary: parsing, validation, and failure-open behaviour. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cliCandidates,
  normalizePlan,
  parsePlan,
  resolvePlan,
  resolveTimeout,
} from '../lib/resolve.js'

const PLAN = {
  schema_version: 1,
  active: true,
  project: '/proj',
  rules: [{ name: 'global', path: '/repo/rules/00-global.md', group: 'core' }],
  skills: [{ name: 'caveman', path: '/repo/skills/caveman', description: 'x' }],
  agents: { Athena: { description: 'a', mode: 'all', system: '# Athena' } },
  commands: { run: { description: 'r', template: 'do $ARGUMENTS' } },
  mcp: { 'vibe:core_demo': { type: 'remote', url: 'https://example.test/mcp' } },
  warnings: ['group missing'],
}

/** @returns {{stdout: string, stderr: string}} */
function ok(plan) {
  return { stdout: JSON.stringify(plan), stderr: '' }
}

test('parsePlan accepts a versioned plan', () => {
  const plan = parsePlan(JSON.stringify(PLAN))
  assert.equal(plan.schema_version, 1)
  assert.equal(plan.active, true)
})

test('parsePlan strips a BOM', () => {
  const plan = parsePlan(`\uFEFF${JSON.stringify(PLAN)}`)
  assert.equal(plan.active, true)
})

test('parsePlan rejects broken JSON', () => {
  assert.throws(() => parsePlan('{'), /not valid JSON/)
})

test('parsePlan rejects another schema version', () => {
  assert.throws(() => parsePlan(JSON.stringify({ ...PLAN, schema_version: 2 })), /unsupported schema_version/)
})

test('normalizePlan fills defensive defaults', () => {
  const plan = normalizePlan({ schema_version: 1, active: true })
  assert.deepEqual(plan.rules, [])
  assert.deepEqual(plan.agents, {})
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.project, '')
})

test('normalizePlan keeps only string warnings', () => {
  const plan = normalizePlan({ schema_version: 1, warnings: ['a', 1, null] })
  assert.deepEqual(plan.warnings, ['a'])
})

test('cliCandidates puts the configured path first and wins on windows', () => {
  const candidates = cliCandidates('/custom/vibe-stack')
  assert.equal(candidates[0], '/custom/vibe-stack')
  assert.ok(candidates.includes('vibe-stack'))
  if (process.platform === 'win32') assert.ok(candidates.includes('vibe-stack.exe'))
})

test('resolveTimeout honours the environment override', () => {
  const previous = process.env.VIBESTACK_RESOLVE_TIMEOUT_MS
  process.env.VIBESTACK_RESOLVE_TIMEOUT_MS = '1234'
  try {
    assert.equal(resolveTimeout(5000), 1234)
  } finally {
    if (previous === undefined) delete process.env.VIBESTACK_RESOLVE_TIMEOUT_MS
    else process.env.VIBESTACK_RESOLVE_TIMEOUT_MS = previous
  }
})

test('resolvePlan returns the plan and forwards warnings', async () => {
  const calls = []
  const execute = async (command, args) => {
    calls.push([command, ...args])
    return ok(PLAN)
  }
  const result = await resolvePlan('/proj', { command: 'vibe-stack', timeoutMs: 5000 }, execute)
  assert.equal(result.plan?.active, true)
  assert.deepEqual(result.warnings, ['group missing'])
  assert.deepEqual(calls[0].slice(1), ['resolve', '--json', '--project', '/proj'])
})

test('resolvePlan fails open on a missing command', async () => {
  const execute = async () => {
    throw Object.assign(new Error('spawn vibe-stack ENOENT'), { code: 'ENOENT' })
  }
  const result = await resolvePlan('/proj', { command: '', timeoutMs: 5000 }, execute)
  assert.equal(result.plan, null)
  assert.match(result.warnings[0], /failed/)
})

test('resolvePlan fails open on invalid JSON', async () => {
  const execute = async () => ({ stdout: '{', stderr: '' })
  const result = await resolvePlan('/proj', { command: '', timeoutMs: 5000 }, execute)
  assert.equal(result.plan, null)
  assert.match(result.warnings[0], /invalid plan/)
})

test('resolvePlan falls back to the next candidate on ENOENT', async () => {
  const seen = []
  const execute = async (command) => {
    seen.push(command)
    if (seen.length === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return ok(PLAN)
  }
  const result = await resolvePlan('/proj', { command: '', timeoutMs: 5000 }, execute)
  assert.equal(result.plan?.active, true)
  assert.ok(seen.length >= 2)
})

test('resolvePlan stops after a non-ENOENT failure', async () => {
  let calls = 0
  const execute = async () => {
    calls += 1
    throw Object.assign(new Error('timeout'), { stderr: 'timed out' })
  }
  const result = await resolvePlan('/proj', { command: '', timeoutMs: 5000 }, execute)
  assert.equal(calls, 1)
  assert.match(result.warnings[0], /timed out/)
})
