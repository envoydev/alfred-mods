// The agents folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnStepInput, TurnStepResult } from 'claude-code'
import type { AgentRow, Loop } from './types'
import { addLoopStep, markOf, newRow, upsertSpawn } from './agents'
import { countAgentType } from '../session/effects'
import type { HookInput, HookNext } from '../core/types'
import { addMark } from '../plan/effects'

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

// Calls of the main loop, and of agents whose spawn was seen; anything else is not counted
export async function isCounted($: EngineInterface, agentId: string | undefined): Promise<boolean> {
  return agentId === undefined || (await readAgents($)).some(r => r.id === agentId)
}

// Changes the row of an agent whose spawn was seen; an unknown id writes nothing
export async function updateRow($: EngineInterface, id: string, fn: (r: AgentRow) => AgentRow): Promise<void> {
  if (!(await readAgents($)).some(r => r.id === id)) return
  await updateAgents($, rows => rows.map(r => (r.id === id ? fn(r) : r)))
}

// An agent's step: its model and effort, its context as the sum the engine's own `context_tokens` uses, and how it
// stopped, so a report cut off at max_tokens is flagged (spec C4)
export async function agentStep($: EngineInterface, e: TurnStepInput, step: TurnStepResult): Promise<void> {
  const u = step.usage
  const id = e.agentId ?? ''
  // A loop no spawn announced is counted apart (spec C3)
  if (!(await readAgents($)).some(r => r.id === id)) {
    const now = await $.clock.now()
    await updateLoops($, list => addLoopStep(list, id, u?.output_tokens ?? 0, now))
    return
  }
  await updateRow($, id, r => ({
    ...r, model: e.model, effort: e.effort === undefined ? r.effort : String(e.effort),
    contextTokens: u === null ? r.contextTokens : u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens,
    lastStop: step.stopReason ?? null,
  }))
}

export async function trackSpawn($: EngineInterface, e: HookInput<'agent.spawn'>, next: HookNext<'agent.spawn'>) {
  const spawned = await next(e)
  if (spawned.deny !== undefined) return spawned
  const id = e.resume?.agentId ?? spawned.agentId
  if (id !== undefined) {
    const now = await $.clock.now()
    const row = newRow({
      id, parentId: e.parentAgentId ?? null, type: e.subagentType, description: e.description, prompt: e.prompt,
      isTeammate: e.isTeammate === true, model: spawned.model,
    }, now)
    // A dispatch is a new row: a resume of a kept one runs that row again (upsertSpawn's own test)
    const isKnown = e.resume !== undefined && (await readAgents($)).some(r => r.id === id)
    if (!isKnown) await countAgentType($, row.type)
    await updateAgents($, rows => upsertSpawn(rows, row, e.resume !== undefined))
    await addMark($, markOf(row))
    // Its first step came before its spawn resolved: the loop is this agent's
    if ((await readLoops($)).some(l => l.id === id)) await updateLoops($, list => list.filter(l => l.id !== id))
  }
  return spawned
}
