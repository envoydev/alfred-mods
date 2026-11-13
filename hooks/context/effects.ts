// The context folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Parts } from './types'
import { NO_PARTS } from './parts'

const INITIAL_PARTS: Parts = NO_PARTS
const partsAtom = atom({ plugin: 'alfred-mods', key: 'parts' } as const, INITIAL_PARTS, { shape: 'parts-1' })
export function readParts($: EngineInterface) {
  return read($, partsAtom)
}
export function updateParts($: EngineInterface, change: (value: Parts) => Parts) {
  return update($, partsAtom, change)
}
export function resetParts($: EngineInterface) {
  return update($, partsAtom, () => INITIAL_PARTS)
}
