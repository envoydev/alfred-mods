// The handoff folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Handoff } from './types'

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
