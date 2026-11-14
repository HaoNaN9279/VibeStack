/** Session directory resolution: live session, recorded observation, client hint, deployment fallback. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  diagnoseSessionCwd,
  existingDirectory,
  resolveSessionCwd,
  workspaceDirectoryOf,
} from '../lib/session-cwd.js'

/**
 * Create a real directory that the resolver can accept.
 * @param {import('node:test').TestContext} t - test context.
 * @param {string} prefix - directory prefix.
 * @returns {string} absolute directory.
 */
function directory(t, prefix) {
  const created = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(created, { recursive: true, force: true }))
  return created
}

/**
 * Build a plugin context with only the services a case needs.
 * @param {object} services - service name to value.
 * @returns {{get: (name: string) => unknown}} context.
 */
function context(services) {
  return { get: (name) => services[name] }
}

test('a live session reads its directory from the working directory service', async (t) => {
  const live = directory(t, 'vibestack-live-')
  const session = { id: 's1' }
  const ctx = context({
    sessions: { get: (id) => (id === 's1' ? session : undefined) },
    workingDirectory: { get: () => live, defaultDirectory: live },
  })
  assert.equal(await resolveSessionCwd(ctx, 's1'), live)
})

test('a window without an agent instance uses the recorded observation', async (t) => {
  const recorded = directory(t, 'vibestack-recorded-')
  let disposed = 0
  const ctx = context({
    sessions: { get: () => undefined },
    workingDirectory: { get: () => null, defaultDirectory: recorded },
    sessionQuery: {
      observeSession: async (id) => {
        assert.equal(id, 's2')
        return {
          projections: { values: { workingDirectory: recorded } },
          header: { cwd: recorded },
          dispose: () => {
            disposed += 1
          },
        }
      },
    },
  })
  assert.equal(await resolveSessionCwd(ctx, 's2'), recorded)
  assert.equal(disposed, 1)
})

test('the observation header supplies a directory when no projection is set', async (t) => {
  const header = directory(t, 'vibestack-header-')
  const ctx = context({
    sessions: { get: () => undefined },
    sessionQuery: {
      observeSession: async () => ({ projections: { values: {} }, header: { cwd: header } }),
    },
  })
  assert.equal(await resolveSessionCwd(ctx, 's3'), header)
})

test('a client hint resolves a window with no host session at all', async (t) => {
  const workspace = directory(t, 'vibestack-hint-')
  const ctx = context({
    sessions: { get: () => undefined },
    sessionQuery: {
      observeSession: async () => {
        throw new Error('session not found')
      },
    },
  })
  assert.equal(await resolveSessionCwd(ctx, 's4', workspace), resolve(workspace))
})

test('a relative or missing hint is ignored', async (t) => {
  const ctx = context({
    sessions: { get: () => undefined },
    sessionQuery: { observeSession: async () => ({ projections: { values: {} } }) },
  })
  assert.equal(await resolveSessionCwd(ctx, 's5', 'relative/path'), null)
  assert.equal(await resolveSessionCwd(ctx, 's5', join(tmpdir(), 'vibestack-does-not-exist-xyz')), null)
})

test('a file is not accepted as a hint', async (t) => {
  const dir = directory(t, 'vibestack-file-')
  const ctx = context({})
  assert.equal(await resolveSessionCwd(ctx, 's6', join(dir, 'missing.txt')), null)
})

test('an unrecorded session falls back to the deployment directory', async (t) => {
  const deploy = directory(t, 'vibestack-deploy-')
  const ctx = context({
    sessions: { get: () => undefined },
    workingDirectory: { defaultDirectory: deploy },
    sessionQuery: {
      observeSession: async () => {
        throw new Error('session not found')
      },
    },
  })
  assert.equal(await resolveSessionCwd(ctx, 's7'), deploy)
})

test('an empty session id or unknown services resolve to null', async () => {
  assert.equal(await resolveSessionCwd(context({}), ''), null)
  assert.equal(await resolveSessionCwd(context({}), 's8'), null)
  assert.equal(await resolveSessionCwd(undefined, 's8'), null)
})

test('a throwing working directory read falls through to the observation', async (t) => {
  const recorded = directory(t, 'vibestack-throw-')
  const ctx = context({
    sessions: { get: () => ({ id: 's9' }) },
    workingDirectory: {
      get: () => {
        throw new Error('not ready')
      },
      defaultDirectory: recorded,
    },
    sessionQuery: { observeSession: async () => ({ projections: { values: { workingDirectory: recorded } } }) },
  })
  assert.equal(await resolveSessionCwd(ctx, 's9'), recorded)
})

test('diagnoseSessionCwd reports which services the plugin can see', () => {
  assert.deepEqual(diagnoseSessionCwd(context({})), {
    workingDirectory: false,
    sessions: false,
    sessionQuery: false,
  })
  assert.deepEqual(
    diagnoseSessionCwd(context({ workingDirectory: {}, sessions: {}, sessionQuery: {} })),
    { workingDirectory: true, sessions: true, sessionQuery: true },
  )
  assert.deepEqual(diagnoseSessionCwd(undefined), {
    workingDirectory: false,
    sessions: false,
    sessionQuery: false,
  })
})

test('existingDirectory normalizes absolute directories and rejects everything else', (t) => {
  const dir = directory(t, 'vibestack-existing-')
  assert.equal(existingDirectory(dir), resolve(dir))
  assert.equal(existingDirectory(''), null)
  assert.equal(existingDirectory('relative/dir'), null)
  assert.equal(existingDirectory(undefined), null)
  assert.equal(existingDirectory(join(dir, 'nope')), null)
})

test('the workspace store maps a session id to the workspace the host lists', (t) => {
  const home = directory(t, 'vibestack-dsh-')
  const workspace = directory(t, 'vibestack-store-')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify({
      unit: 1,
      global: { defaultWorkspaceId: 'w1', workspaceIds: ['w1', 'w2'] },
      tables: {
        workspaces: {
          w1: { path: workspace, sessionIds: ['session-a', 'session-b'] },
          w2: { path: join(workspace, 'other'), sessionIds: ['session-c'] },
        },
      },
    }),
  )
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  assert.equal(workspaceDirectoryOf('session-b'), workspace)
  assert.equal(workspaceDirectoryOf('session-c'), join(workspace, 'other'))
  assert.equal(workspaceDirectoryOf('session-unknown'), undefined)
})

test('a broken workspace store is ignored instead of throwing', (t) => {
  const home = directory(t, 'vibestack-broken-')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), '{not json')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  assert.equal(workspaceDirectoryOf('session-a'), undefined)
})

test('the workspace store resolves a window with no service at all', async (t) => {
  const home = directory(t, 'vibestack-dsh-')
  const workspace = directory(t, 'vibestack-owned-')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify({ tables: { workspaces: { w: { path: workspace, sessionIds: ['session-owned'] } } } }),
  )
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  assert.equal(await resolveSessionCwd(context({}), 'session-owned'), workspace)
})
