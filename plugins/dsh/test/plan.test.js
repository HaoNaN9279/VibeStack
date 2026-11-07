/** Plan usability: historical `active` plus the VibeStack-mode Core rule. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planUsable, unusablePlanReason } from '../lib/plan.js'

test('planUsable accepts active plans', () => {
  assert.equal(planUsable({ active: true }), true)
})

test('planUsable accepts Core-only vibestack-mode plans', () => {
  assert.equal(planUsable({ active: false, mode: 'vibestack', core: { name: 'core' } }), true)
})

test('planUsable rejects missing, inactive project plans, and empty objects', () => {
  assert.equal(planUsable(null), false)
  assert.equal(planUsable(undefined), false)
  assert.equal(planUsable({}), false)
  assert.equal(planUsable({ active: false, mode: 'project' }), false)
})

test('unusablePlanReason explains the fallback', () => {
  assert.match(unusablePlanReason(null), /no plan/)
  assert.match(unusablePlanReason({ active: false, mode: 'project' }), /inactive plan/)
})
