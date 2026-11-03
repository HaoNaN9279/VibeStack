/**
 * Repair sessions written by VibeStack plugin ≤ 0.1.0.
 *
 * Those releases appended plugin-private session events (`vibestack/agents`,
 * `vibestack/select`). DSH's stored-log reader only accepts an unknown event
 * type when its envelope carries `ignorable: true`, and a live `Session.append()`
 * cannot set that marker, so such a session fails to open with
 * "contains event type ... unknown to this harness and not marked ignorable".
 *
 * This script adds that marker in place. Sequence numbers stay contiguous, so
 * the log remains valid; only the envelope gains one field.
 *
 * Usage:
 *   node repair-session-events.mjs <session.v4.jsonl.zstd | session dir> [--write]
 *
 * Without `--write` it reports what it would change.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** Event types this plugin used to write. */
const LEGACY_TYPES = ['vibestack/agents', 'vibestack/select']

/**
 * Decode every zstd frame the log stores.
 * @param {Buffer} buffer - raw log file.
 * @returns {string} concatenated JSONL text.
 */
function decodeFrames(buffer) {
  const offsets = []
  let cursor = 0
  while (true) {
    const at = buffer.indexOf(MAGIC, cursor)
    if (at < 0) break
    offsets.push(at)
    cursor = at + MAGIC.length
  }
  if (offsets.length === 0) throw new Error('not a zstd frame sequence')
  const parts = []
  for (const [index, start] of offsets.entries()) {
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    parts.push(zlib.zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
  }
  return parts.join('')
}

/**
 * Add the ignorable marker to one JSONL line when it is a legacy plugin event.
 * @param {string} line - one JSONL record.
 * @returns {{line: string, changed: boolean}} result.
 */
function repairLine(line) {
  for (const type of LEGACY_TYPES) {
    const prefix = `{"type":"${type}"`
    if (!line.startsWith(prefix)) continue
    if (line.includes('"ignorable":true')) return { line, changed: false }
    return { line: `${prefix},"ignorable":true${line.slice(prefix.length)}`, changed: true }
  }
  return { line, changed: false }
}

/**
 * Collect every session log under one directory tree.
 * @param {string} dir - directory to walk.
 * @returns {string[]} log paths.
 */
function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.name.endsWith('.jsonl.zstd')) files.push(full)
  }
  return files
}

/**
 * Resolve the log files named on the command line.
 * @param {string[]} targets - files or session directories.
 * @returns {string[]} log paths.
 */
function logFiles(targets) {
  const files = []
  for (const target of targets) {
    const full = path.resolve(target)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const argv = process.argv.slice(2)
const write = argv.includes('--write')
const targets = argv.filter((arg) => arg !== '--write')
if (targets.length === 0) {
  console.error('usage: node repair-session-events.mjs <session dir | log file> [--write]')
  process.exit(2)
}

let repairedFiles = 0
let repairedEvents = 0
for (const file of logFiles(targets)) {
  const text = decodeFrames(readFileSync(file))
  const lines = text.split('\n')
  let changed = 0
  const output = lines.map((line) => {
    if (line.trim().length === 0) return line
    const result = repairLine(line)
    if (result.changed) changed += 1
    return result.line
  })
  const label = path.basename(path.dirname(file)) + '/' + path.basename(file)
  if (changed === 0) {
    console.log(`${label}: no legacy events`)
    continue
  }
  repairedFiles += 1
  repairedEvents += changed
  console.log(`${label}: ${changed} event(s) need the ignorable marker`)
  if (!write) continue
  const backup = `${file}.bak`
  if (!existsSync(backup)) writeFileSync(backup, readFileSync(file))
  const encoded = zlib.zstdCompressSync(Buffer.from(output.join('\n'), 'utf8'))
  writeFileSync(file, encoded)
  console.log(`${label}: repaired (backup: ${path.basename(backup)})`)
}

const verb = write ? 'repaired' : 'to repair'
console.log(`\n${repairedFiles} file(s), ${repairedEvents} event(s) ${verb}.`)
if (!write && repairedFiles > 0) console.log('Re-run with --write to apply.')
