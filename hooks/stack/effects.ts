// The stack folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'
import type { Stack } from './types'
import { statusPath } from '../handoff/handoff'
import { NO_FILE, STACK_TOASTS, UNREADABLE, fillReady, fillToast, parseStack } from './stack'
import { followStatusFile } from '../handoff/effects'

export const INITIAL_STACK: Stack = {
  state: 'none', reason: null, fullContext: null, model: null, window: null, resumeAt: null, noOffer: false, autoRun: null, scorer: null, autoCompact: null, plan: null,
  hasPrompt: false, updatedAt: null, readAt: null, ignored: [],
}
const stackAtom = atom({ plugin: 'alfred-mods', key: 'stack' } as const, INITIAL_STACK, { shape: 'stack-2' })
export function readStack($: EngineInterface) {
  return read($, stackAtom)
}
export function updateStack($: EngineInterface, change: (value: Stack) => Stack) {
  return update($, stackAtom, change)
}
export function resetStack($: EngineInterface) {
  return update($, stackAtom, () => INITIAL_STACK)
}

// The stack's resume prompt, in module memory only (Phase 5 spec 'Where values live'); `last`, the `stack` value the
// last read wrote, which a read inside `keepUntil` (10 s after a /clear, a resume or a fork) writes back when the new
// id has no file yet; `reading`, the read running, so reads never interleave; `reread`, the handler's one reread
export const stackMem = {
  prompt: null as string | null, last: null as Stack | null, keepUntil: 0, reading: Promise.resolve(false) as Promise<boolean>,
  reread: null as Timer | null,
}

// Alfred Code's scoring level while its status file is in use and scoring is on, which colours the band's score
export async function scoreLevel($: EngineInterface): Promise<number | null> {
  const s = await readStack($)
  return s.state === 'used' && s.scorer !== null && s.scorer.on ? s.scorer.level : null
}

// Reads run one at a time; each resolves to whether the session's status file exists
export function readStatus($: EngineInterface, keep = false): Promise<boolean> {
  const next = stackMem.reading.then(() => readStatusNow($, keep))
  stackMem.reading = next.catch(() => false)
  return next
}

// The stack's status file for this session, one read for both atoms. F8's stand-down (Decision 13): a missing or
// unreadable file is no file, unless `keep` or the window holds a stand-down across a /clear until a later read. The
// `stack` atom (Phase 5): no file, unreadable, ignored with Phase 4's reason, or used field by field.
export async function readStatusNow($: EngineInterface, keep: boolean): Promise<boolean> {
  const id = await $.session.id()
  const path = statusPath(id)
  const now = await $.clock.now()
  const inWindow = keep || now < stackMem.keepUntil
  let exists = false
  let text: string | null = null
  if (path !== null) {
    try {
      exists = await $.fs.exists(path)
      if (exists) text = await $.fs.read(path)
    } catch {
      text = null
    }
  }
  await writeStackFrom($, { exists, text, id, now, inWindow })
  await followStatusFile($, text, id, inWindow)
  return exists
}

// The `stack` atom from one read: inside the window a missing file writes back the last value and keeps the prompt;
// every other read writes its own value, and `last` with it
export async function writeStackFrom($: EngineInterface, r: { exists: boolean; text: string | null; id: string; now: number; inWindow: boolean }): Promise<void> {
  if (!r.exists && r.inWindow) {
    const last = stackMem.last
    if (last !== null) await updateStack($, s => (JSON.stringify(s) === JSON.stringify(last) ? s : last))
    return
  }
  const parsed = r.text === null ? null : parseStack(r.text, r.id)
  const base: Stack = { ...INITIAL_STACK, readAt: r.now }
  const next: Stack = !r.exists ? { ...base, reason: NO_FILE }
    : parsed === null ? { ...base, state: 'ignored', reason: UNREADABLE }
    : parsed.state === 'ignored' ? { ...base, state: 'ignored', reason: parsed.reason }
    : { ...base, ...parsed.fields, state: 'used', hasPrompt: parsed.prompt !== null }
  stackMem.prompt = parsed?.state === 'used' ? parsed.prompt : null
  stackMem.last = next
  await updateStack($, s => (JSON.stringify(s) === JSON.stringify(next) ? s : next))
}

// `f` in the ALFRED CODE section: the stack's resume prompt into an empty draft, never sent. A press from a frame drawn
// before the prompt went away or the file stopped owning the full context fills nothing (Decision 7).
// f, or '/inspect fill': what it did, which the press toasts and the command answers
export async function fillStack($: EngineInterface): Promise<string> {
  const text = stackMem.prompt
  if (!fillReady(await readStack($), text)) return STACK_TOASTS.gone
  if ((await $.prompt.read()).text.trim() !== '') return STACK_TOASTS.notEmpty
  return fillToast(await $.prompt.fill({ text }))
}
