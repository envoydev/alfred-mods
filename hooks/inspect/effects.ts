// The inspect folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { View } from './types'

const INITIAL_VIEW: View = { tab: 'now', shown: [], planSlug: null }
const viewAtom = atom({ plugin: 'alfred-mods', key: 'view' } as const, INITIAL_VIEW, { shape: 'view-3' })
export function readView($: EngineInterface) {
  return read($, viewAtom)
}
export function updateView($: EngineInterface, change: (value: View) => View) {
  return update($, viewAtom, change)
}
export function resetView($: EngineInterface) {
  return update($, viewAtom, () => INITIAL_VIEW)
}
