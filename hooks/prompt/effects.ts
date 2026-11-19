// The prompt folder's $.state atom, made, read and updated here alone: `claude plugin validate` refuses an atom handed to
// another module. Change the shape tag when the stored fields change: it declines what an earlier version stored.
// A prompt's or an attachment's text goes nowhere but this atom: never `$.store`, a log or a file.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'
import type { HookInput, HookNext } from '../core/types'
import type { PromptRecord } from './types'
import { EMPTY_RECORD, FLUSH_MS } from './constants'
import { addPart, partOf, startRecord } from './record'
import { noteKitLine } from '../kit/effects'
import { KIT_HOOK_EVENT } from '../kit/constants'

const promptAtom = atom({ plugin: 'alfred-mods', key: 'prompt' } as const, EMPTY_RECORD, { shape: 'prompt-1' })

// The record as the hooks build it, and the flush waiting to write it. A resume re-asks every earlier attachment, so the
// atom is written once per FLUSH_MS, and at once at a turn start and a reset; both are lost with a reload, which keeps
// $.state and starts a record afresh at the next turn.
const promptMemory = { record: EMPTY_RECORD, flush: null as Timer | null }

export function readPrompt($: EngineInterface): Promise<PromptRecord> {
  return read($, promptAtom)
}

function dropFlush(): void {
  promptMemory.flush?.cancel()
  promptMemory.flush = null
}

async function writeRecord($: EngineInterface, record: PromptRecord): Promise<void> {
  dropFlush()
  promptMemory.record = record
  await update($, promptAtom, () => record)
}

// A start-over (a /clear, a resume, a branch): the record and any flush waiting for it are dropped
export function resetPrompt($: EngineInterface): Promise<void> {
  return writeRecord($, EMPTY_RECORD)
}

// A main turn began: a new record, written at once
export function startTurnRecord($: EngineInterface, typedChars: number, now: number): Promise<void> {
  return writeRecord($, startRecord(typedChars, now))
}

function scheduleFlush($: EngineInterface): void {
  if (promptMemory.flush !== null) return
  promptMemory.flush = $.clock.after(FLUSH_MS, () => {
    promptMemory.flush = null
    update($, promptAtom, () => promptMemory.record).catch(() => undefined)
  })
}

// What the engine answers is returned as it came, whatever the recording does: a failure after `next(e)` answered is the
// mod's own, so it is swallowed here (the text goes in no log) and the engine's answer stands. A subagent's attachment is
// not the main turn's. The kit line goes to the kit folder before the part is added, so the cap can never cost its values.
export async function recordAttachment($: EngineInterface, e: HookInput<'prompt.attachment'>, next: HookNext<'prompt.attachment'>) {
  const result = await next(e)
  if (e.agentId !== undefined) return result
  try {
    const now = await $.clock.now()
    const text = result.text
    if (e.origin.kind === 'hook' && e.origin.event === KIT_HOOK_EVENT && text !== null) await noteKitLine($, text, now)
    promptMemory.record = addPart(promptMemory.record, partOf(e.type, e.origin, text, now))
    scheduleFlush($)
  } catch {
    // the mod's own recording failed: the engine's answer stands
  }
  return result
}
