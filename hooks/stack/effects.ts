// The stack folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Stack } from './types'

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
