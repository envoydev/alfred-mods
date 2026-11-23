import {
  ATTACHMENT_TYPE,
  HIGH_SURROGATE_MAX,
  HIGH_SURROGATE_MIN,
  INFORMATIONAL_SUBTYPE,
  LOW_SURROGATE_MAX,
  LOW_SURROGATE_MIN,
  NESTED_MEMORY,
  NEWLINE,
  NON_ALPHANUMERIC,
  PROJECTS_FOLDER,
  SKIP_PREFIX,
  SKIP_TEXT,
  SYSTEM_TYPE,
  TRAILING_CR,
  TRAILING_SLASHES,
  TRANSCRIPT_SUFFIX,
  UTF8_ONE_BYTE_MAX,
  UTF8_THREE_BYTE_MAX,
  UTF8_TWO_BYTE_MAX,
} from './constants'
import type { ScanResult } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** UTF-8 byte length of a string, counted by code point; a lone surrogate counts 3. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit <= UTF8_ONE_BYTE_MAX) bytes += 1
    else if (unit <= UTF8_TWO_BYTE_MAX) bytes += 2
    else if (unit >= HIGH_SURROGATE_MIN && unit <= HIGH_SURROGATE_MAX) {
      const next = text.charCodeAt(index + 1)
      if (next >= LOW_SURROGATE_MIN && next <= LOW_SURROGATE_MAX) {
        bytes += 4
        index++
      } else bytes += 3
    } else if (unit <= UTF8_THREE_BYTE_MAX) bytes += 3
  }
  return bytes
}

/** Index of the first newline in a string of one character per byte, or -1. */
export function firstNewlineByte(binary: string): number {
  return binary.indexOf(NEWLINE)
}

/** The transcript file Claude Code derives for a session under a config folder. */
export function derivedTranscriptPath(configFolder: string, root: string, sessionId: string): string {
  const folder = root.replace(NON_ALPHANUMERIC, '-')
  const base = configFolder.replace(TRAILING_SLASHES, '')
  return `${base}/${PROJECTS_FOLDER}/${folder}/${sessionId}${TRANSCRIPT_SUFFIX}`
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function memoryPath(entry: Record<string, unknown>): string | undefined {
  const attachment = entry['attachment']
  if (!isRecord(attachment) || attachment['type'] !== NESTED_MEMORY) return undefined
  const path = attachment['path']
  return typeof path === 'string' ? path : undefined
}

function isSkipNotice(entry: Record<string, unknown>): boolean {
  const content = entry['content']
  return (
    entry['type'] === SYSTEM_TYPE &&
    entry['subtype'] === INFORMATIONAL_SUBTYPE &&
    typeof content === 'string' &&
    content.startsWith(SKIP_PREFIX) &&
    content.includes(SKIP_TEXT)
  )
}

/** Reads the whole lines of a chunk that starts on a line start; the unfinished tail is left. */
export function scanChunk(text: string): ScanResult {
  const lastNewline = text.lastIndexOf(NEWLINE)
  if (lastNewline < 0) return { consumedBytes: 0, hasNewline: false, paths: [], isSkipNoticed: false }
  const whole = text.slice(0, lastNewline + 1)
  const paths: string[] = []
  let isSkipNoticed = false
  for (const raw of whole.split(NEWLINE)) {
    const line = raw.replace(TRAILING_CR, '')
    const holdsMemory = line.includes(NESTED_MEMORY)
    const holdsSkip = line.includes(SKIP_TEXT)
    if (!holdsMemory && !holdsSkip) continue
    const entry = parseLine(line)
    if (!isRecord(entry)) continue
    if (holdsMemory && entry['type'] === ATTACHMENT_TYPE) {
      const path = memoryPath(entry)
      if (path !== undefined) paths.push(path)
    }
    if (holdsSkip && isSkipNotice(entry)) isSkipNoticed = true
  }
  return { consumedBytes: utf8Length(whole), hasNewline: true, paths, isSkipNoticed }
}
