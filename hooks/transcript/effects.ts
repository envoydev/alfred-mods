// The transcript folder's effects: the one reader of the main conversation's transcript file (spec 2026-11-23, D2),
// its $.state atom, and the module memory around it. The atom holds the session id, the offset and a flag, never the
// file's path, which holds the home folder.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { TranscriptNote, TranscriptReader, TranscriptState } from './types'
import { CHUNK_BYTES, CONFIG_FOLDER, FIRST_TAIL_BYTES, READ_EVERY_MS, RUN_BYTES, RUN_MS } from './constants'
import { notifyAll } from './notify'
import { derivedTranscriptPath, firstNewlineByte, scanChunk } from './lines'
import { ruleEntry } from '../context/rules'
import type { RuleEntry } from '../context/types'
import { linkEnds } from '../context/effects'
import { addPathRules, readSession } from '../session/effects'

const INITIAL_READER: TranscriptReader = { sessionId: null, offset: 0, isInLongLine: false }
const readerAtom = atom({ plugin: 'alfred-mods', key: 'transcript' } as const, INITIAL_READER, { shape: 'transcript-1' })
function readReader($: EngineInterface) {
  return read($, readerAtom)
}
function updateReader($: EngineInterface, change: (value: TranscriptReader) => TranscriptReader) {
  return update($, readerAtom, change)
}

// Module memory, which no other plugin reads, so no path reaches `$.state`. `generation` moves with each start-over: a
// run that began before it writes nothing. `lastTurnCount` is the session's turn count at the last run; `running` the
// run in progress, of which there is at most one. `wasRead` is whether the file was ever read by this process.
const readerMemory = {
  generation: 0, lastRunAt: null as number | null, lastTurnCount: null as number | null, running: null as Promise<void> | null,
  wasRead: false, isKnown: false, note: null as TranscriptNote | null, listeners: [] as (() => void)[],
}

// What the band asks: whether a transcript was read, and why not where it was not
export function transcriptState(): TranscriptState {
  return { isKnown: readerMemory.isKnown, note: readerMemory.note }
}

// A listener hears each run that finds a skip notice for this plugin in the transcript (spec D3)
export function onSkipNotice(listener: () => void): void {
  readerMemory.listeners.push(listener)
}

// A start-over: the reader begins again, and a run in flight ends with no write
export async function resetTranscript($: EngineInterface): Promise<void> {
  readerMemory.generation++
  readerMemory.lastRunAt = null
  readerMemory.lastTurnCount = null
  // What the old conversation's file showed says nothing of the new one's
  readerMemory.wasRead = false
  readerMemory.isKnown = false
  readerMemory.note = null
  await updateReader($, () => INITIAL_READER)
}

// The project root, where nested rules are read from; the working folder where the root is not known
function rootOf($: EngineInterface): Promise<string> {
  return $.session.root().catch(() => $.session.cwd())
}

// The transcript's path as the engine gives it, or the one Claude Code derives where the call is missing or empty
// (older builds): `isDerived` for the second, which a missing file does not make unread. Null with no home folder.
async function pathOf($: EngineInterface, root: string, sessionId: string): Promise<{ path: string; isDerived: boolean } | null> {
  try {
    const given = (await $.session.info()).transcriptPath
    if (given !== '') return { path: given, isDerived: false }
  } catch {
    // A build without the call: the path is derived
  }
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? ''
  // Claude Code's home folder is os.homedir(): USERPROFILE on Windows, HOME elsewhere; an empty value is unset
  const profile = (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const home = profile === '' ? ((await $.env.get('HOME').catch(() => undefined)) ?? '') : profile
  const folder = configDir !== '' ? configDir : home === '' ? '' : `${home}/${CONFIG_FOLDER}`
  return folder === '' ? null : { path: derivedTranscriptPath(folder, root, sessionId), isDerived: true }
}

// Where a read of a session's file starts: at its first byte, or, past FIRST_TAIL_BYTES, that far from its end, inside
// a line, which is dropped
function startOf(size: number): Pick<TranscriptReader, 'offset' | 'isInLongLine'> {
  return size > FIRST_TAIL_BYTES ? { offset: size - FIRST_TAIL_BYTES, isInLongLine: true } : { offset: 0, isInLongLine: false }
}

// Reads from the saved offset until the file's end, RUN_BYTES or RUN_MS; each step is written only while this run is
// still the current conversation's
async function readRun($: EngineInterface): Promise<void> {
  const generation = readerMemory.generation
  const sessionId = await $.session.id()
  const isCurrent = async (): Promise<boolean> => generation === readerMemory.generation && sessionId === (await $.session.id())
  const root = await rootOf($)
  const found = await pathOf($, root, sessionId)
  // No file where it should be: not found until a file was read, unread after; a refused read is unread either way
  const markMissing = (): void => {
    readerMemory.isKnown = false
    readerMemory.note = readerMemory.wasRead ? 'unread' : 'not-found'
  }
  const markUnread = (): void => {
    readerMemory.isKnown = false
    readerMemory.note = 'unread'
  }
  if (found === null) return markMissing()
  if (!(await $.fs.exists(found.path))) {
    // A path the engine gave names a file it writes with the first message: not yet there is no failure
    if (found.isDerived || readerMemory.wasRead) return markMissing()
    readerMemory.isKnown = true
    readerMemory.note = null
    return
  }
  let size: number
  try {
    size = (await $.fs.stat(found.path)).size
  } catch {
    return markUnread()
  }
  const saved = await readReader($)
  // A new session starts at its file's first byte, or its tail; a file smaller than the offset was rewritten: from 0
  const isSame = saved.sessionId === sessionId
  let { offset, isInLongLine } = isSame ? (saved.offset <= size ? saved : { offset: 0, isInLongLine: false }) : startOf(size)
  const startedAt = await $.clock.now()
  let bytesRead = 0
  try {
    while (offset < size && bytesRead < RUN_BYTES && (await $.clock.now()) - startedAt < RUN_MS) {
      const length = Math.min(CHUNK_BYTES, size - offset)
      const entries: RuleEntry[] = []
      let isSkipNoticed = false
      if (isInLongLine) {
        const binary = atob((await $.fs.read(found.path, { as: 'bytes', offset, length })).base64)
        const newline = firstNewlineByte(binary)
        offset += newline < 0 ? binary.length : newline + 1
        isInLongLine = newline < 0
      } else {
        const scan = scanChunk(await $.fs.read(found.path, { offset, length }))
        // A whole chunk with no newline is one long line, skipped to its end; a shorter one is a line still being written
        if (!scan.hasNewline && length < CHUNK_BYTES) break
        offset += scan.hasNewline ? scan.consumedBytes : length
        isInLongLine = !scan.hasNewline
        isSkipNoticed = scan.isSkipNoticed
        for (const path of scan.paths) {
          const entry = ruleEntry(path, 'Project', root, linkEnds())
          if (entry !== null) entries.push(entry)
        }
      }
      bytesRead += length
      if (!(await isCurrent())) return
      if (entries.length > 0) await addPathRules($, entries)
      await updateReader($, () => ({ sessionId, offset, isInLongLine }))
      if (isSkipNoticed) notifyAll(readerMemory.listeners)
    }
  } catch {
    return markUnread()
  }
  if (!(await isCurrent())) return
  await updateReader($, () => ({ sessionId, offset, isInLongLine }))
  readerMemory.wasRead = true
  readerMemory.isKnown = true
  readerMemory.note = null
}

// Runs the reader when 30 s have passed since its last run or the session's turn count moved, one run at a time, and
// never rejects: a run that fails notes the transcript unread and the next tick tries again
export function readTranscriptIfDue($: EngineInterface, now: number): Promise<void> {
  if (readerMemory.running !== null) return Promise.resolve()
  const run = (async (): Promise<void> => {
    try {
      const turnCount = (await readSession($)).turnCount
      const isDue = readerMemory.lastRunAt === null || now - readerMemory.lastRunAt >= READ_EVERY_MS || turnCount !== readerMemory.lastTurnCount
      if (!isDue) return
      readerMemory.lastRunAt = now
      readerMemory.lastTurnCount = turnCount
      await readRun($)
    } catch {
      readerMemory.isKnown = false
      readerMemory.note = 'unread'
    }
  })().finally(() => {
    readerMemory.running = null
  })
  readerMemory.running = run
  return run
}
