// The rec folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { RecState } from './types'

const INITIAL_REC: RecState = { level: 'off', count: 0, note: null }
const recAtom = atom({ plugin: 'alfred-mods', key: 'rec' } as const, INITIAL_REC, { shape: 'rec-1' })
export function readRec($: EngineInterface) {
  return read($, recAtom)
}
export function updateRec($: EngineInterface, change: (value: RecState) => RecState) {
  return update($, recAtom, change)
}
export function resetRec($: EngineInterface) {
  return update($, recAtom, () => INITIAL_REC)
}
