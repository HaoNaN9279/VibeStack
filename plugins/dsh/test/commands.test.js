/** Command mapping: name grammar, namespacing, filtering, and template rendering. */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { commandEntries, renderTemplate, validCommandName } from '../lib/commands.js'

test('validCommandName follows the DSH grammar', () => {
  assert.equal(validCommandName('auto-git-commit'), true)
  assert.equal(validCommandName('run_2'), true)
  assert.equal(validCommandName('Run'), false)
  assert.equal(validCommandName('2run'), false)
  assert.equal(validCommandName('has space'), false)
  assert.equal(validCommandName(''), false)
  assert.equal(validCommandName(7), false)
})

test('commandEntries namespaces names by group', () => {
  const entries = commandEntries({
    commands: {
      'auto-git-commit': { description: 'commit', template: 'do it', group: 'core' },
      'group-new': { description: 'new', template: 'x', group: 'group-forge' },
    },
  })
  assert.deepEqual(entries.map((entry) => entry.canonical), [
    'vibestack-core-auto-git-commit',
    'vibestack-group-forge-group-new',
  ])
  assert.deepEqual(entries.map((entry) => entry.group), ['core', 'group-forge'])
})

test('commandEntries normalises display names and drops unusable entries', () => {
  const warnings = []
  const entries = commandEntries({
    commands: {
      'auto-git-commit': { description: 'commit', template: 'do it', group: 'core' },
      Bad: { description: 'upper', template: 'x', group: 'core' },
      nodesc: { description: '  ', template: 'x', group: 'core' },
      notemplate: { description: 'd', template: '', group: 'core' },
      '***': { description: 'symbols', template: 'x', group: 'core' },
    },
  }, {}, warnings)
  assert.deepEqual(entries.map((entry) => entry.name), ['auto-git-commit', 'Bad'])
  assert.deepEqual(entries.map((entry) => entry.canonical), [
    'vibestack-core-auto-git-commit',
    'vibestack-core-bad',
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no usable name/)
})

test('commandEntries tolerates a missing commands object', () => {
  assert.deepEqual(commandEntries({}), [])
})

test('commandEntries hashes overly long canonical names', () => {
  const name = 'a'.repeat(60)
  const [entry] = commandEntries({
    commands: { [name]: { description: 'long', template: 'x', group: 'multi-agent-collaboration' } },
  })
  assert.ok(entry.canonical.length <= 48)
  assert.match(entry.canonical, /^vibestack-multi-agent-collab[a-z0-9-]*-[0-9a-f]{6}$/u)
})

test('renderTemplate substitutes $ARGUMENTS and positional args', () => {
  assert.equal(renderTemplate('make $1 with $2; all: $ARGUMENTS', 'Button blue'), 'make Button with blue; all: Button blue')
})

test('renderTemplate leaves missing positional args empty', () => {
  assert.equal(renderTemplate('a=$1 b=$2', 'only'), 'a=only b=')
})

test('renderTemplate keeps unsupported placeholders literal', () => {
  const template = "run !`git status` and read @notes.md"
  assert.equal(renderTemplate(template, ''), template)
})

test('renderTemplate handles an empty input', () => {
  assert.equal(renderTemplate('value: $ARGUMENTS.', '   '), 'value: .')
})
