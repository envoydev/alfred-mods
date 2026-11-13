// The rec folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Level, RecState } from './types'

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

// The REC level the model was last told of, in module memory: the person's next prompt carries the note while the
// level differs (Decision 11)
export const noteMem = { told: 'off' as Level }

// REC's private words and the home folder, in module memory only: never in $.state, a log or a file
// `compiled` names the level, words and home mask.ts holds, which a reload starts over at off
export const recMem = { words: [] as string[], home: null as string | null, compiled: JSON.stringify(['off', [], null]) }
