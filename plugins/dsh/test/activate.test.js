/** Auto-initialisation: a VibeStack workspace gets `.vibestack/stack.json` on first resolve. */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  activateAndResolve,
  ensureStack,
  initArgs,
  stackExists,
  stackPath,
} from '../lib/activate.js'

/**
 * Create a real project directory.
 * @param {import('node:test').TestContext} t - test context.
 * @param {string} [prefix] - directory prefix.
 * @returns {string} absolute directory.
 */
function project(t, prefix = 'vibestack-auto-') {
  const created = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(created, { recursive: true, force: true }))
  return created
}

/**
 * A config with the mode that owns workspaces.
 * @param {Record<string, unknown>} [extra] - overrides.
 * @returns {Record<string, unknown>} resolved config shape.
 */
function config(extra = {}) {
  return { resolveMode: 'vibestack', autoActivate: true, command: '', timeoutMs: 5000, ...extra }
}

/**
 * Spawn stub that "runs init": it writes the activation file.
 * @param {string[]} calls - collected argv lists.
 * @returns {(command: string, args: string[], options: Record<string, unknown>) => Promise<{stdout: string, stderr: string}>} stub.
 */
function runner(calls) {
  return async (command, args) => {
    calls.push([command, ...args])
    const index = args.indexOf('--project')
    const directory = index === -1 ? '' : args[index + 1]
    mkdirSync(join(directory, '.vibestack'), { recursive: true })
    writeFileSync(join(directory, '.vibestack', 'stack.json'), '{"schema_version":2}\n', 'utf8')
    return { stdout: 'created\n', stderr: '' }
  }
}

test('the activation file is the marker of an initialised project', (t) => {
  const dir = project(t)
  assert.equal(stackExists(dir), false)
  assert.equal(stackPath(dir), join(dir, '.vibestack', 'stack.json'))

  mkdirSync(join(dir, '.vibestack'))
  writeFileSync(stackPath(dir), '{}', 'utf8')
  assert.equal(stackExists(dir), true)
})

test('a missing project is initialised with the CLI global option first', async (t) => {
  const dir = project(t)
  const calls = []
  const result = await ensureStack(dir, config(), runner(calls))

  assert.deepEqual(result, { created: true })
  assert.deepEqual(initArgs(dir), ['--project', dir, 'init'])
  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /^vibe-stack(\.exe)?$/u)
  assert.deepEqual(calls[0].slice(1), ['--project', dir, 'init'])
  assert.equal(existsSync(stackPath(dir)), true)
})

test('an initialised project is left untouched', async (t) => {
  const dir = project(t)
  mkdirSync(join(dir, '.vibestack'))
  writeFileSync(stackPath(dir), '{}', 'utf8')
  const calls = []

  const result = await ensureStack(dir, config(), runner(calls))
  assert.deepEqual(result, { created: false })
  assert.deepEqual(calls, [])
})

test('project mode and disabled auto-activation never write', async (t) => {
  const calls = []
  const created = project(t)
  assert.deepEqual(await ensureStack(created, config({ resolveMode: 'project' }), runner(calls)), {
    created: false,
    skipped: true,
  })
  assert.deepEqual(await ensureStack(created, config({ autoActivate: false }), runner(calls)), {
    created: false,
    skipped: true,
  })
  assert.deepEqual(calls, [])
  assert.equal(stackExists(created), false)
})

test('concurrent resolves of one workspace spawn init once', async (t) => {
  const dir = project(t)
  const calls = []
  const slow = async (command, args) => {
    calls.push([command, ...args])
    await new Promise((resolve) => setTimeout(resolve, 10))
    mkdirSync(join(dir, '.vibestack'), { recursive: true })
    writeFileSync(stackPath(dir), '{}', 'utf8')
    return { stdout: '', stderr: '' }
  }

  const [first, second] = await Promise.all([
    ensureStack(dir, config(), slow),
    ensureStack(dir, config(), slow),
  ])
  assert.deepEqual(first, { created: true })
  assert.deepEqual(second, { created: true })
  assert.equal(calls.length, 1)
})

test('a failing CLI is reported instead of thrown', async (t) => {
  const dir = project(t)
  const failed = async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EPERM', stderr: 'denied' })
  }
  assert.deepEqual(await ensureStack(dir, config(), failed), { created: false, error: 'denied' })

  const missing = async () => {
    throw Object.assign(new Error('not found'), { code: 'ENOENT' })
  }
  assert.deepEqual(await ensureStack(dir, config(), missing), {
    created: false,
    error: 'command not found',
  })
})

test('activation happens before the plan is read', async (t) => {
  const dir = project(t)
  const calls = []
  const seen = []
  const result = await activateAndResolve(dir, config(), {
    execute: runner(calls),
    resolvePlan: async (directory) => {
      seen.push(stackExists(directory))
      return { plan: { active: true }, warnings: ['w1'] }
    },
  })

  assert.deepEqual(seen, [true])
  assert.equal(result.activation.created, true)
  assert.equal(result.plan.active, true)
  assert.deepEqual(result.warnings, ['w1'])
})

test('a failed activation still returns the plan with a warning', async (t) => {
  const dir = project(t)
  const failed = async () => {
    throw Object.assign(new Error('no cli'), { code: 'ENOENT' })
  }
  const result = await activateAndResolve(dir, config(), {
    execute: failed,
    resolvePlan: async () => ({ plan: null, warnings: [] }),
  })

  assert.equal(result.activation.created, false)
  assert.equal(result.plan, null)
  assert.match(result.warnings[0], /cannot initialise stack\.json/u)
})
