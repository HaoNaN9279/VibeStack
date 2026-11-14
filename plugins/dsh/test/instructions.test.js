/** Host workspace instruction chain: order, labels, dedupe and text lookup. */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import {
  BASE_INSTRUCTION_FILES,
  INSTRUCTION_SECTION_TITLE,
  LOCAL_INSTRUCTION_FILES,
  PROJECT_ROOT_MARKER,
  hostInstructions,
} from '../lib/instructions.js'

const roots = []

/**
 * Build an isolated home and project tree.
 * @returns {Promise<{home: string, project: string}>} absolute roots.
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibestack-instructions-'))
  roots.push(root)
  const home = path.join(root, 'home')
  const project = path.join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(path.join(project, PROJECT_ROOT_MARKER), { recursive: true })
  return { home, project }
}

/**
 * Write one file, creating parent directories.
 * @param {string} file - absolute path.
 * @param {string} text - content.
 * @returns {Promise<void>} resolves once written.
 */
async function put(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
}

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

test('the chain runs user-global first, then the project root down to the directory', async () => {
  const { home, project } = await fixture()
  await put(path.join(home, '.dsh', 'AGENTS.md'), '# Global DSH\n\nglobal.\n')
  await put(path.join(home, '.agents', 'AGENTS.md'), '# Global agents\n\nagents.\n')
  await put(path.join(project, 'AGENTS.md'), '# Root rules\n\nroot.\n')
  await put(path.join(project, 'CLAUDE.md'), '# Root claude\n\nclaude.\n')
  await put(path.join(project, 'Assets', 'AGENTS.md'), '# Assets rules\n\nassets.\n')
  await put(path.join(project, 'Assets', 'Battle', 'AGENTS.local.md'), '# Battle local\n\nlocal.\n')

  const items = await hostInstructions({ project, cwd: 'Assets/Battle', home })
  assert.deepEqual(items.map((entry) => entry.name), [
    '~/.dsh/AGENTS.md',
    '~/.agents/AGENTS.md',
    'AGENTS.md',
    'CLAUDE.md',
    'Assets/AGENTS.md',
    'Assets/Battle/AGENTS.local.md',
  ])
  assert.deepEqual(items.map((entry) => entry.scope), [
    'global', 'global', 'global', 'global', 'paths', 'paths',
  ])
  assert.equal(items.every((entry) => entry.kind === 'agents-md'), true)
  assert.equal(items.every((entry) => entry.group === 'host'), true)
  assert.equal(items.every((entry) => entry.status === 'injected'), true)
  assert.equal(items[0].summary, 'Global DSH')
  assert.equal(INSTRUCTION_SECTION_TITLE, 'Workspace instructions (AGENTS.md)')
  assert.deepEqual(BASE_INSTRUCTION_FILES, ['AGENTS.md', 'CLAUDE.md'])
  assert.deepEqual(LOCAL_INSTRUCTION_FILES, ['AGENTS.local.md', 'CLAUDE.local.md'])
})

test('a repeat of the same trimmed content is reported but not injected again', async () => {
  const { home, project } = await fixture()
  await put(path.join(project, 'AGENTS.md'), '# Duplicate\n\nsame body.\n')
  await put(path.join(project, 'Assets', 'CLAUDE.md'), '\n# Duplicate\n\nsame body.\n\n')

  const items = await hostInstructions({ project, cwd: 'Assets', home })
  assert.deepEqual(items.map((entry) => entry.status), ['injected', 'skipped'])
  assert.match(items[1].description, /Same content as AGENTS\.md/u)
})

test('blank files disappear and a plain directory without a project marker still works', async () => {
  const { home } = await fixture()
  const loose = path.join(path.dirname(home), 'loose')
  await mkdir(loose, { recursive: true })
  await put(path.join(loose, 'AGENTS.md'), '   \n\n')
  const items = await hostInstructions({ project: loose, home })
  assert.deepEqual(items, [])
})

test('withText returns the body, truncates by bytes and stays addressable by id', async () => {
  const { home, project } = await fixture()
  await put(path.join(project, 'AGENTS.md'), '# Root\n\nbody.\n')
  const full = await hostInstructions({ project, home, withText: true })
  assert.equal(full[0].text, '# Root\n\nbody.\n')
  assert.equal(full[0].truncated, false)
  const clipped = await hostInstructions({ project, home, withText: true, textLimit: 4 })
  assert.equal(clipped[0].truncated, true)
  assert.equal(Buffer.byteLength(clipped[0].text, 'utf8') <= 4, true)

  const id = full[0].id
  const again = await hostInstructions({ project, home, withText: true })
  assert.equal(again.find((entry) => entry.id === id).text, '# Root\n\nbody.\n')
})
