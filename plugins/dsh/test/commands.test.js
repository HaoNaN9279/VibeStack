/** Command mapping: name grammar, filtering, and template rendering. */

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

test('commandEntries keeps usable commands only', () => {
  const entries = commandEntries({
    commands: {
      'auto-git-commit': { description: 'commit', template: 'do it' },
      Bad: { description: 'upper', template: 'x' },
      nodesc: { description: '  ', template: 'x' },
      notemplate: { description: 'd', template: '' },
    },
  })
  assert.deepEqual(entries.map((entry) => entry.name), ['auto-git-commit'])
})

test('commandEntries tolerates a missing commands object', () => {
  assert.deepEqual(commandEntries({}), [])
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
