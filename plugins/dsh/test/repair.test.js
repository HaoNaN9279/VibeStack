/** Legacy session-log repair: marker insertion, frame layout, idempotence. */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { LEGACY_TYPES, decodeLog, encodeLog, repairFile, repairLog, scanZstdFrames } from '../scripts/repair-session-events.mjs'

const HEADER = {
  type: 'session',
  version: 4,
  id: 'session-repair',
  createdAt: 1,
  cwd: 'D:\\workspace\\VibeStack',
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: 'vibestack',
}

const EVENTS = [
  { type: 'permission/preset', seq: 0, time: 2, data: { preset: 'workspace-write' } },
  { type: 'agent-preset/selected', seq: 1, time: 3, data: { agentPreset: 'vibestack' } },
  { type: 'vibestack/agents', seq: 2, time: 4, data: { agents: [{ name: 'Athena', mode: 'all' }], selected: 'Athena' } },
  { type: 'vibestack/select', seq: 3, time: 5, data: { name: 'Hermes' } },
  { type: 'user/message', seq: 4, time: 6, data: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
]

/**
 * Build a log with one header frame and one frame per event, like DSH writes.
 * @param {object[]} events - event records.
 * @param {{mergeHeader?: boolean}} [options] - force the broken single-frame layout when `mergeHeader` is set.
 * @returns {Buffer} artifact bytes.
 */
function buildLog(events, options = {}) {
  const header = `${JSON.stringify(HEADER)}\n`
  const lines = events.map((event) => `${JSON.stringify(event)}\n`)
  if (options.mergeHeader) {
    return zlib.zstdCompressSync(Buffer.from(header + lines.join(''), 'utf8'), {
      params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
    })
  }
  const frames = [header, ...lines].map((text) =>
    zlib.zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }),
  )
  return Buffer.concat(frames)
}

/**
 * Decode one frame independently.
 * @param {Buffer} buffer - artifact bytes.
 * @param {{start: number, end: number}} frame - frame range.
 * @returns {string} plaintext.
 */
function frameText(buffer, frame) {
  return zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
}

test('marks legacy events and leaves every other record byte-identical', () => {
  const original = buildLog(EVENTS)
  const result = repairLog(original)
  assert.ok(result)
  assert.equal(result.changed, 2)

  const text = decodeLog(result.buffer)
  assert.ok(text.endsWith('\n'))
  const lines = text.slice(0, -1).split('\n')
  assert.equal(lines.length, 1 + EVENTS.length)
  assert.equal(lines[0], JSON.stringify(HEADER))

  const repaired = lines.slice(1).map((line) => JSON.parse(line))
  for (const [index, event] of repaired.entries()) {
    assert.equal(event.seq, index)
    assert.equal(event.type, EVENTS[index].type)
    assert.deepEqual(event.data, EVENTS[index].data)
    assert.equal(event.time, EVENTS[index].time)
    const legacy = LEGACY_TYPES.includes(event.type)
    assert.equal(event.ignorable, legacy ? true : undefined)
  }
  for (const [index, line] of lines.slice(1).entries()) {
    if (LEGACY_TYPES.includes(EVENTS[index].type)) continue
    assert.equal(line, JSON.stringify(EVENTS[index]))
  }
})

test('keeps the header in its own first frame', () => {
  const result = repairLog(buildLog(EVENTS))
  assert.ok(result)
  const { frames, tornStart } = scanZstdFrames(result.buffer)
  assert.equal(tornStart, undefined)
  assert.equal(frames.length, 2)
  assert.equal(frameText(result.buffer, frames[0]), `${JSON.stringify(HEADER)}\n`)
  const body = frameText(result.buffer, frames[1])
  assert.ok(body.endsWith('\n'))
  assert.equal(body.slice(0, -1).split('\n').length, EVENTS.length)
})

test('is idempotent', () => {
  const first = repairLog(buildLog(EVENTS))
  assert.ok(first)
  assert.equal(repairLog(first.buffer), null)
})

test('leaves a clean log untouched', () => {
  const clean = EVENTS.filter((event) => !LEGACY_TYPES.includes(event.type))
  assert.equal(repairLog(buildLog(clean)), null)
})

test('refuses a log whose header is not an independent first frame', () => {
  assert.throws(() => repairLog(buildLog(EVENTS, { mergeHeader: true })), /first Zstandard frame/)
})

test('refuses a torn tail instead of rewriting it', () => {
  const buffer = buildLog(EVENTS)
  const torn = Buffer.concat([buffer, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])])
  assert.throws(() => repairLog(torn), /incomplete Zstandard frame/)
})

test('refuses a torn final record instead of adding a newline', () => {
  const options = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
  const header = zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(HEADER)}\n`, 'utf8'), options)
  const body = zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(EVENTS[0])}\n{"type":"vibestack/agents"`, 'utf8'), options)
  assert.throws(() => repairLog(Buffer.concat([header, body])), /torn final record/)
})

test('writes a backup and replaces the file atomically', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vibestack-repair-'))
  try {
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    const original = buildLog(EVENTS)
    writeFileSync(file, original)
    const result = repairFile(file, { write: true })
    assert.equal(result.changed, 2)
    assert.equal(result.applied, true)
    assert.deepEqual(readFileSync(`${file}.bak`), original)
    assert.equal(repairFile(file, { write: true }).changed, 0)
    assert.equal(repairLog(readFileSync(file)), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('encodeLog round-trips a header-only artifact', () => {
  const buffer = encodeLog(JSON.stringify(HEADER), [])
  assert.deepEqual(scanZstdFrames(buffer).frames.length, 1)
  assert.equal(decodeLog(buffer), `${JSON.stringify(HEADER)}\n`)
})
