/** Canonical name generation: slugs, prefixes, length limits, and grammar. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canonicalName,
  shortHash,
  slug,
  validCommandName,
  validSkillName,
} from '../lib/names.js'

test('slug normalises case, spaces, underscores, and symbols', () => {
  assert.equal(slug('VibeStack Core'), 'vibestack-core')
  assert.equal(slug('multi_agent collaboration'), 'multi-agent-collaboration')
  assert.equal(slug('--A  B--'), 'a-b')
  assert.equal(slug('中文'), '')
})

test('canonicalName joins prefix, group, and name', () => {
  assert.equal(canonicalName('vibestack', 'core', 'auto-git-commit'), 'vibestack-core-auto-git-commit')
  assert.equal(canonicalName('', 'group-forge', 'group new'), 'vibestack-group-forge-group-new')
  assert.equal(canonicalName('vibestack', 'core', '***'), '')
})

test('canonicalName truncates with a stable hash', () => {
  const name = 'a'.repeat(60)
  const value = canonicalName('vibestack', 'multi-agent-collaboration', name, { maxLength: 48 })
  assert.ok(value.length <= 48)
  assert.match(value, /^vibestack-multi-agent-collab[a-z0-9-]*-[0-9a-f]{6}$/u)
  assert.equal(value, canonicalName('vibestack', 'multi-agent-collaboration', name, { maxLength: 48 }))
})

test('shortHash is stable and length-bounded', () => {
  assert.equal(shortHash('x'), shortHash('x'))
  assert.equal(shortHash('x', 4).length, 4)
})

test('canonical names satisfy the DSH grammars', () => {
  const command = canonicalName('vibestack', 'core', 'auto-git-commit')
  const skill = canonicalName('vibestack', 'core', 'custom-skill')
  assert.equal(validCommandName(command), true)
  assert.equal(validSkillName(skill), true)
  assert.equal(validCommandName('VibeStack-core-x'), false)
  assert.equal(validSkillName('has_underscore'), false)
})
