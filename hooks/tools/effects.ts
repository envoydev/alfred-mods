// The tools folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Failure, Quiet, ToolStat } from './types'

const INITIAL_STATS: Record<string, ToolStat> = {}
const statsAtom = atom({ plugin: 'alfred-mods', key: 'stats' } as const, INITIAL_STATS, { shape: 'stats-1' })
export function readStats($: EngineInterface) {
  return read($, statsAtom)
}
export function updateStats($: EngineInterface, change: (value: Record<string, ToolStat>) => Record<string, ToolStat>) {
  return update($, statsAtom, change)
}
export function resetStats($: EngineInterface) {
  return update($, statsAtom, () => INITIAL_STATS)
}

const INITIAL_FAILURES: Failure[] = []
const failuresAtom = atom({ plugin: 'alfred-mods', key: 'failures' } as const, INITIAL_FAILURES, { shape: 'failures-1' })
export function readFailures($: EngineInterface) {
  return read($, failuresAtom)
}
export function updateFailures($: EngineInterface, change: (value: Failure[]) => Failure[]) {
  return update($, failuresAtom, change)
}
export function resetFailures($: EngineInterface) {
  return update($, failuresAtom, () => INITIAL_FAILURES)
}

const INITIAL_BLOCKERS: Record<string, number> = {}
const blockersAtom = atom({ plugin: 'alfred-mods', key: 'blockers' } as const, INITIAL_BLOCKERS, { shape: 'blockers-1' })
export function readBlockers($: EngineInterface) {
  return read($, blockersAtom)
}
export function updateBlockers($: EngineInterface, change: (value: Record<string, number>) => Record<string, number>) {
  return update($, blockersAtom, change)
}
export function resetBlockers($: EngineInterface) {
  return update($, blockersAtom, () => INITIAL_BLOCKERS)
}

const INITIAL_QUIET: Quiet = { isOn: false }
const quietAtom = atom({ plugin: 'alfred-mods', key: 'quiet' } as const, INITIAL_QUIET, { shape: 'quiet-1' })
export function readQuiet($: EngineInterface) {
  return read($, quietAtom)
}
export function updateQuiet($: EngineInterface, change: (value: Quiet) => Quiet) {
  return update($, quietAtom, change)
}
export function resetQuiet($: EngineInterface) {
  return update($, quietAtom, () => INITIAL_QUIET)
}
