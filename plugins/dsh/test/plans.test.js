/** Plan cache: reuse, invalidation, concurrent dedupe, and sync peek. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { PlanCache } from '../lib/plans.js'

/**
 * Create a project directory with a stack file.
 * @param {string} content - stack JSON.
 * @returns {Promise<string>} project directory.
 */
async function project(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vst-plan-'))
  await mkdir(path.join(dir, '.vibestack'), { recursive: true })
  await writeFile(path.join(dir, '.vibestack', 'stack.json'), content, 'utf8')
  return dir
}

test('an active plan is reused while the stack stamp is unchanged', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  let builds = 0
  const cache = new PlanCache(async () => {
    builds += 1
    return { plan: { active: true, project: dir }, warnings: [] }
  })
  await cache.get(dir)
  await cache.get(dir)
  assert.equal(builds, 1)
})

test('a changed stack file forces a new resolution', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  let builds = 0
  const cache = new PlanCache(async () => {
    builds += 1
    return { plan: { active: true, project: dir }, warnings: [] }
  })
  await cache.get(dir)
  await writeFile(path.join(dir, '.vibestack', 'stack.json'), '{"schema_version":1,"groups":[],"agents":[]}', 'utf8')
  await cache.get(dir)
  assert.equal(builds, 2)
})

test('an inactive plan is reused inside the ttl', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  let builds = 0
  let clock = 1000
  const cache = new PlanCache(
    async () => {
      builds += 1
      return { plan: { active: false }, warnings: [] }
    },
    { now: () => clock },
  )
  await cache.get(dir)
  clock += 1000
  await cache.get(dir)
  assert.equal(builds, 1)
  clock += 60_000
  await cache.get(dir)
  assert.equal(builds, 2)
})

test('concurrent reads share one resolution', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  let builds = 0
  const cache = new PlanCache(async () => {
    builds += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { plan: { active: true }, warnings: [] }
  })
  await Promise.all([cache.get(dir), cache.get(dir), cache.get(dir)])
  assert.equal(builds, 1)
})

test('peek returns a cached plan without resolving', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  const cache = new PlanCache(async () => ({ plan: { active: true, project: dir }, warnings: [] }))
  assert.equal(cache.peek(dir), null)
  await cache.get(dir)
  assert.equal(cache.peek(dir)?.active, true)
})

test('peek ignores a stale entry', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  const cache = new PlanCache(async () => ({ plan: { active: true }, warnings: [] }))
  await cache.get(dir)
  await writeFile(path.join(dir, '.vibestack', 'stack.json'), '{"schema_version":1,"groups":[],"agents":["x"]}', 'utf8')
  assert.equal(cache.peek(dir), null)
})

test('clear drops cached plans', async () => {
  const dir = await project('{"schema_version":1,"groups":[]}')
  let builds = 0
  const cache = new PlanCache(async () => {
    builds += 1
    return { plan: { active: true }, warnings: [] }
  })
  await cache.get(dir)
  cache.clear()
  await cache.get(dir)
  assert.equal(builds, 2)
})
