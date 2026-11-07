/**
 * Repair sessions written by VibeStack plugin ≤ 0.4.0.
 *
 * Two defects are repaired:
 *
 * 1. Releases ≤ 0.1.0 appended plugin-private session events (`vibestack/agents`,
 *    `vibestack/select`). DSH's stored-log reader only accepts an unknown event
 *    type when its envelope carries `ignorable: true`, and a live
 *    `Session.append()` cannot set that marker, so such a session fails to open
 *    with "contains event type ... unknown to this harness and not marked
 *    ignorable".
 * 2. Releases ≤ 0.4.0 also appended the instructions message as soon as the mode
 *    was selected. On a blank session that `user/message` became the first
 *    surface event, but DSH requires the first `system/message` to be the
 *    protected surface head, so reopening failed with "system/message requires
 *    a protected first surface head". That early message is redundant (the first
 *    pre-step publishes the same instructions after the system head), so the
 *    repair keeps its data as an `ignorable` `vibestack/roster` log record and
 *    removes it from the surface. Sequence numbers and every other record stay
 *    unchanged.
 *
 * The physical layout matters: DSH stores one independent Zstandard frame that
 * contains exactly the header line, followed by one frame per append batch. The
 * first frame must remain header-only, so the repair re-encodes the header and
 * the event body as separate frames instead of one big frame.
 *
 * Usage:
 *   node scripts/repair-session-events.mjs [<session dir | log file | sessions root> ...] [--write]
 *
 * Without arguments it scans `~/.dsh/sessions`. Without `--write` it only
 * reports what it would change.
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

/** Zstandard frame magic, little-endian `0xFD2FB528`. */
const ZSTD_MAGIC = 0xfd2fb528
/** Event types this plugin used to write. */
export const LEGACY_TYPES = Object.freeze(['vibestack/agents', 'vibestack/select'])
/** Log-only record produced from a pre-head early-roster message. */
export const REPAIRED_ROSTER_TYPE = 'vibestack/roster'
/** Event types that occupy the model-visible surface. */
const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
/** Checksummed frames, matching what the harness writes. */
const ZSTD_OPTIONS = Object.freeze({ params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } })

/**
 * Locate complete Zstandard frames without decompressing their blocks.
 *
 * The frame magic may appear inside compressed payloads, so a byte search is
 * unsafe; walk the frame header and block headers exactly like the reader does.
 * @param {Buffer} buffer - complete artifact bytes.
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}} frames in order, plus the start of an incomplete final frame.
 */
export function scanZstdFrames(buffer) {
  /** @type {{start: number, end: number}[]} */
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decompress every frame and decode the JSONL text once, so a UTF-8 character
 * split across frame boundaries cannot be mangled.
 * @param {Buffer} buffer - complete artifact bytes.
 * @returns {string} JSONL text including the trailing newline.
 */
export function decodeLog(buffer) {
  const { frames, tornStart } = scanZstdFrames(buffer)
  if (frames.length === 0) throw new Error('empty or header-less session log')
  if (tornStart !== undefined) throw new Error(`incomplete Zstandard frame at byte ${tornStart}`)
  /** @type {Buffer[]} */
  const parts = []
  for (const { start, end } of frames) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(start, end)))
    } catch (error) {
      throw new Error(`cannot decode Zstandard frame at byte ${start}: ${String(error)}`)
    }
  }
  const firstFrame = parts[0].toString('utf8')
  if (!firstFrame.endsWith('\n') || firstFrame.indexOf('\n') !== firstFrame.length - 1) {
    throw new Error('the first Zstandard frame is not exactly one header line')
  }
  const text = Buffer.concat(parts).toString('utf8')
  if (!text.endsWith('\n')) throw new Error('session log has a torn final record')
  return text
}

/**
 * Encode one header frame and one body frame. DSH requires the first frame to
 * contain exactly the header line; event batches may share one frame.
 * @param {string} header - header line without its newline.
 * @param {string[]} events - event lines without newlines.
 * @returns {Buffer} concatenated artifact bytes.
 */
export function encodeLog(header, events) {
  const headerFrame = zlib.zstdCompressSync(Buffer.from(`${header}\n`, 'utf8'), ZSTD_OPTIONS)
  if (events.length === 0) return headerFrame
  const body = Buffer.from(`${events.join('\n')}\n`, 'utf8')
  return Buffer.concat([headerFrame, zlib.zstdCompressSync(body, ZSTD_OPTIONS)])
}

/**
 * Add the ignorable marker to one JSONL record when it is a legacy plugin event.
 * @param {string} line - one JSONL record without its newline.
 * @returns {{line: string, changed: boolean}} repaired line.
 */
function repairLine(line) {
  if (!line.startsWith('{')) return { line, changed: false }
  let event
  try {
    event = JSON.parse(line)
  } catch {
    throw new Error('cannot parse an event record; refusing to rewrite a corrupt log')
  }
  if (event === null || typeof event !== 'object') return { line, changed: false }
  if (!LEGACY_TYPES.includes(event.type)) return { line, changed: false }
  if (event.ignorable === true) return { line, changed: false }
  if (event.ignorable !== undefined) throw new Error(`event type "${event.type}" has an invalid ignorable marker`)
  // Put the marker first so no byte of the original record is re-serialized;
  // JSON object order is not observable to the reader.
  const repaired = `{"ignorable":true,${line.slice(1)}`
  const check = JSON.parse(repaired)
  if (check.type !== event.type || check.ignorable !== true) {
    throw new Error(`cannot add the ignorable marker to event type "${event.type}"`)
  }
  return { line: repaired, changed: true }
}

/**
 * Turn one pre-head early-roster message into a log-only record.
 *
 * It keeps the original data (including `source.roster`) so the plugin can still
 * project the Agent menu, but it is no longer a surface event.
 * @param {Record<string, unknown>} event - surface event preceding the first system/message.
 * @returns {Record<string, unknown>} converted event.
 */
function convertPreHeadEvent(event) {
  const data = event.data
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data.source : undefined
  const roster = source && typeof source === 'object' ? source.roster : undefined
  if (
    event.type !== 'user/message' ||
    !roster ||
    typeof roster !== 'object' ||
    Array.isArray(roster) ||
    source.kind !== 'vibestack'
  ) {
    throw new Error(
      `surface event "${String(event.type)}" at seq ${String(event.seq)} precedes the first system/message and is not a VibeStack roster; refusing to rewrite it`,
    )
  }
  if (event.sourceEventSeqs !== undefined) {
    throw new Error(`pre-head surface event at seq ${String(event.seq)} carries sourceEventSeqs; refusing to rewrite it`)
  }
  const { surfaceOp, ...rest } = event
  return { ...rest, type: REPAIRED_ROSTER_TYPE, ignorable: true }
}

/**
 * Repair one artifact in memory.
 * @param {Buffer} buffer - original artifact bytes.
 * @returns {{buffer: Buffer, changed: number} | null} null when the log needs no repair.
 */
export function repairLog(buffer) {
  const text = decodeLog(buffer)
  const lines = text.slice(0, -1).split('\n')
  if (lines.length === 0) throw new Error('session log has no header line')
  const header = lines[0]
  const rawEvents = lines.slice(1)
  const parsed = rawEvents.map((line) => {
    if (!line.startsWith('{')) return null
    try {
      return JSON.parse(line)
    } catch {
      throw new Error('cannot parse an event record; refusing to rewrite a corrupt log')
    }
  })
  const firstSystem = parsed.findIndex(
    (event) => event !== null && typeof event === 'object' && event.type === 'system/message',
  )
  let changed = 0
  const events = rawEvents.map((line, index) => {
    const event = parsed[index]
    if (event === null || typeof event !== 'object') return line
    if (LEGACY_TYPES.includes(event.type)) {
      const result = repairLine(line)
      if (result.changed) changed += 1
      return result.line
    }
    // Any surface event before the first system/message makes the log fail its
    // protected-head invariant. The only writer here was the early VibeStack
    // roster message; preserve its payload as a log-only record.
    if (firstSystem !== -1 && index < firstSystem && SURFACE_TYPES.has(event.type)) {
      changed += 1
      return JSON.stringify(convertPreHeadEvent(event))
    }
    return line
  })
  if (changed === 0) return null
  const encoded = encodeLog(header, events)
  // Re-read the bytes we are about to publish and require every record to be
  // exactly what the repair intended.
  const checkText = decodeLog(encoded)
  const checkLines = checkText.slice(0, -1).split('\n')
  if (checkLines[0] !== header) throw new Error('repair changed the header line')
  const expected = [header, ...events]
  if (checkLines.length !== expected.length) throw new Error('repair changed the record count')
  for (let index = 0; index < expected.length; index += 1) {
    if (checkLines[index] !== expected[index]) throw new Error(`repair changed record ${index}`)
  }
  const { frames } = scanZstdFrames(encoded)
  if (frames.length === 0) throw new Error('repair produced no frames')
  const headerFrame = zlib.zstdDecompressSync(encoded.subarray(frames[0].start, frames[0].end)).toString('utf8')
  if (headerFrame !== `${header}\n`) throw new Error('repair did not keep the header in its own frame')
  return { buffer: encoded, changed }
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
 * @param {string[]} targets - files, session directories, or a sessions root.
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

/**
 * Atomically replace a log, so a crash never leaves a partially written file.
 * @param {string} file - destination path.
 * @param {Buffer} buffer - repaired artifact bytes.
 * @returns {void}
 */
function writeAtomic(file, buffer) {
  const tmp = `${file}.repair-${process.pid}-${Date.now()}.tmp`
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    writeFileSync(fd, buffer)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tmp, file)
        return
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code
        if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 20) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // The destination is unchanged; a leftover temp file is harmless.
    }
    throw error
  }
}

/**
 * Repair one log file.
 * @param {string} file - log path.
 * @param {{write: boolean}} options - whether to publish the repaired bytes.
 * @returns {{changed: number, applied: boolean}} repair outcome.
 */
export function repairFile(file, options) {
  const before = statSync(file, { bigint: true })
  const original = readFileSync(file)
  const result = repairLog(original)
  if (result === null) return { changed: 0, applied: false }
  if (!options.write) return { changed: result.changed, applied: false }
  const after = statSync(file, { bigint: true })
  if (after.size !== before.size || after.mtimeNs !== before.mtimeNs) {
    throw new Error('log changed while it was being repaired; close DSH and retry')
  }
  const backup = `${file}.bak`
  if (!existsSync(backup)) copyFileSync(file, backup)
  writeAtomic(file, result.buffer)
  return { changed: result.changed, applied: true }
}

/**
 * Expand a leading `~` and resolve the default sessions root.
 * @param {string} target - user-supplied path.
 * @returns {string} absolute path.
 */
function expandTarget(target) {
  if (target === '~') return os.homedir()
  if (target.startsWith('~/') || target.startsWith('~\\')) return path.join(os.homedir(), target.slice(2))
  return target
}

/**
 * CLI entry point.
 * @param {string[]} argv - arguments after the script name.
 * @returns {number} process exit code.
 */
export function main(argv) {
  const write = argv.includes('--write')
  const targets = argv.filter((arg) => arg !== '--write')
  if (targets.length === 0) targets.push(path.join(os.homedir(), '.dsh', 'sessions'))
  let files
  try {
    files = logFiles(targets.map(expandTarget))
  } catch (error) {
    console.error(`cannot resolve sessions: ${String(error)}`)
    return 2
  }
  let repairedFiles = 0
  let repairedEvents = 0
  let failures = 0
  for (const file of files) {
    const label = `${path.basename(path.dirname(file))}/${path.basename(file)}`
    try {
      const result = repairFile(file, { write })
      if (result.changed === 0) {
        console.log(`${label}: no repairable records`)
        continue
      }
      repairedFiles += 1
      repairedEvents += result.changed
      console.log(`${label}: ${result.changed} record(s) need repair`)
      if (result.applied) console.log(`${label}: repaired (backup: ${path.basename(file)}.bak)`)
    } catch (error) {
      failures += 1
      console.error(`${label}: ${String(error)}`)
    }
  }
  const verb = write ? 'repaired' : 'to repair'
  console.log(`\n${repairedFiles} file(s), ${repairedEvents} event(s) ${verb}.`)
  if (!write && repairedFiles > 0) console.log('Re-run with --write to apply.')
  return failures === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
