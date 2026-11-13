// The handoff folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Handoff, SaveResult } from './types'

const INITIAL_HANDOFF: Handoff = {
  mode: 'ask', threshold: 80, point: null, handled: null, isAskUp: false, lastSave: null, alfred: { state: 'none', reason: null },
}
const handoffAtom = atom({ plugin: 'alfred-mods', key: 'handoff' } as const, INITIAL_HANDOFF, { shape: 'handoff-1' })
export function readHandoff($: EngineInterface) {
  return read($, handoffAtom)
}
export function updateHandoff($: EngineInterface, change: (value: Handoff) => Handoff) {
  return update($, handoffAtom, change)
}
export function resetHandoff($: EngineInterface) {
  return update($, handoffAtom, () => INITIAL_HANDOFF)
}

// F8's memory outside $.state: whether the stack stood F8 down, which outlives a /clear until a read of the new id's
// file says otherwise (the stack writes it in its own SessionStart hook, which may run after the mod's); whether a
// compaction re-arms the steps; the model and window the compaction point was read for; the save running, which a
// second request joins; the step the last save was made at, which c does not save again; and the last save's time,
// which arms the resume prompt and which a /clear does not reset
export const handoffMem = {
  stoodDown: false, rearm: false, pointKey: null as string | null, saving: null as Promise<SaveResult> | null,
  savedStep: null as number | null, armedAt: null as number | null,
  // The reads of the compaction point that gave no breakdown, for one model and window
  pointMiss: { key: null as string | null, count: 0 },
}

// After a compaction that stands
export async function rearmAfterCompaction($: EngineInterface): Promise<void> {
  // F8's next reading sets the handled step to the highest at or under it, so a compaction under the threshold re-arms
  handoffMem.rearm = true
  await updateHandoff($, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
}
