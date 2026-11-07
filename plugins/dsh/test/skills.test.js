/** Skill provider: candidate mapping, namespacing, lazy body load, and bundled skill parsing. */

import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import {
  PROVIDER_NAME,
  SKILL_RANK,
  createSkillProvider,
  readSkillFile,
  skillCandidates,
  toCandidate,
} from '../lib/skills.js'

const PLAN = {
  active: true,
  skills: [
    { name: 'caveman', path: '/repo/skills/caveman', description: 'terse mode', group: 'core' },
    { name: 'caveman', path: '/repo/skills/caveman-2', description: 'duplicate', group: 'core' },
    { name: 'start-work', path: '/repo/skills/start-work', description: 'multi', group: 'multi-agent-collaboration' },
    { name: 'bad', path: 42 },
  ],
}

test('skillCandidates dedupes by canonical name and drops malformed rows', () => {
  const candidates = skillCandidates(PLAN)
  assert.deepEqual(candidates.map((item) => item.name), [
    'vibestack-core-caveman',
    'vibestack-multi-agent-collaboration-start-work',
  ])
  assert.equal(candidates[0].directory, '/repo/skills/caveman')
  assert.equal(candidates[0].description, 'terse mode')
  assert.equal(candidates[0].originalName, 'caveman')
})

test('toCandidate matches the DSH provider contract', () => {
  const candidate = toCandidate({ name: 'vibestack-core-caveman', description: 'd', directory: '/repo/skills/caveman' })
  assert.equal(candidate.name, 'vibestack-core-caveman')
  assert.equal(candidate.provider, PROVIDER_NAME)
  assert.equal(candidate.rank, SKILL_RANK)
  assert.equal(candidate.path, path.join('/repo/skills/caveman', 'SKILL.md'))
  assert.deepEqual(candidate.locator, {
    path: path.join('/repo/skills/caveman', 'SKILL.md'),
    directory: '/repo/skills/caveman',
  })
  assert.deepEqual(candidate.resourceBase, { kind: 'directory', path: '/repo/skills/caveman' })
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
})

test('the provider lists candidates for an active plan', async () => {
  const provider = createSkillProvider({ getPlan: async () => PLAN })
  const list = await provider.list({ cwd: '/proj' })
  assert.equal(list.length, 2)
  assert.equal(list[0].name, 'vibestack-core-caveman')
})

test('the provider lists a vibeStack-mode plan without active=true', async () => {
  const provider = createSkillProvider({
    getPlan: async () => ({ active: false, mode: 'vibestack', skills: PLAN.skills }),
    isUsable: (plan) => plan?.mode === 'vibestack',
  })
  const list = await provider.list({ cwd: '/proj' })
  assert.equal(list.length, 2)
})

test('the provider lists nothing without a cwd or an inactive plan', async () => {
  const provider = createSkillProvider({ getPlan: async () => ({ active: false }) })
  assert.deepEqual(await provider.list({}), [])
  assert.deepEqual(await provider.list({ cwd: '/proj' }), [])
})

test('the provider loads and strips the skill body', async () => {
  const provider = createSkillProvider({
    getPlan: async () => PLAN,
    read: async () => '---\nname: caveman\ndescription: d\n---\n\n# Body',
  })
  const [candidate] = await provider.list({ cwd: '/proj' })
  const skill = await provider.get(candidate, {})
  assert.equal(skill.name, 'vibestack-core-caveman')
  assert.equal(skill.provider, PROVIDER_NAME)
  assert.equal(skill.content, '# Body')
})

test('the provider returns undefined for a candidate without a locator', async () => {
  const provider = createSkillProvider({ getPlan: async () => PLAN })
  assert.equal(await provider.get({ name: 'x' }, {}), undefined)
})

test('readSkillFile parses the bundled skill', () => {
  const skill = readSkillFile('---\nname: vibestack\ndescription: d\n---\n\n# VibeStack')
  assert.deepEqual(skill, { name: 'vibestack', description: 'd', content: '# VibeStack' })
})
