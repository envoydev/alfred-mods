// The agents folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { AgentRow, Loop } from './types'

const INITIAL_AGENTS: AgentRow[] = []
const agentsAtom = atom({ plugin: 'alfred-mods', key: 'agents' } as const, INITIAL_AGENTS, { shape: 'agents-2' })
export function readAgents($: EngineInterface) {
  return read($, agentsAtom)
}
export function updateAgents($: EngineInterface, change: (value: AgentRow[]) => AgentRow[]) {
  return update($, agentsAtom, change)
}
export function resetAgents($: EngineInterface) {
  return update($, agentsAtom, () => INITIAL_AGENTS)
}

const INITIAL_LOOPS: Loop[] = []
const loopsAtom = atom({ plugin: 'alfred-mods', key: 'loops' } as const, INITIAL_LOOPS, { shape: 'loops-1' })
export function readLoops($: EngineInterface) {
  return read($, loopsAtom)
}
export function updateLoops($: EngineInterface, change: (value: Loop[]) => Loop[]) {
  return update($, loopsAtom, change)
}
export function resetLoops($: EngineInterface) {
  return update($, loopsAtom, () => INITIAL_LOOPS)
}
