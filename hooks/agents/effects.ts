// The agents folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnStepInput, TurnStepResult } from 'claude-code'
import type { AgentRow, Loop } from './types'
import { addLoopStep, stepMarkOf, newRow, refreshAgents, upsertSpawn } from './agents'
import { countAgentType } from '../session/effects'
import type { HookInput, HookNext } from '../core/types'
import { addStepMark } from '../plan/effects'

const INITIAL_AGENTS: AgentRow[] = []
const agentsAtom = atom({ plugin: 'alfred-mods', key: 'agents' } as const, INITIAL_AGENTS, { shape: 'agents-2' })
export function readAgents($: EngineInterface) {
  return read($, agentsAtom)
}
function updateAgents($: EngineInterface, change: (value: AgentRow[]) => AgentRow[]) {
  return update($, agentsAtom, change)
}
export function resetAgents($: EngineInterface) {
  return update($, agentsAtom, () => INITIAL_AGENTS)
}

const INITIAL_LOOPS: Loop[] = []
const loopsAtom = atom({ plugin: 'alfred-mods', key: 'loops' } as const, INITIAL_LOOPS, { shape: 'loops-2' })
export function readLoops($: EngineInterface) {
  return read($, loopsAtom)
}
function updateLoops($: EngineInterface, change: (value: Loop[]) => Loop[]) {
  return update($, loopsAtom, change)
}
export function resetLoops($: EngineInterface) {
  return update($, loopsAtom, () => INITIAL_LOOPS)
}

// Calls of the main loop, and of agents whose spawn was seen; anything else is not counted
export async function isTrackedLoop($: EngineInterface, agentId: string | undefined): Promise<boolean> {
  return agentId === undefined || (await readAgents($)).some(row => row.id === agentId)
}

// Changes the row of an agent whose spawn was seen; an unknown id writes nothing
export async function updateAgentRow($: EngineInterface, id: string, fn: (agentRow: AgentRow) => AgentRow): Promise<void> {
  if (!(await readAgents($)).some(agentRow => agentRow.id === id)) return
  await updateAgents($, rows => rows.map(row => (row.id === id ? fn(row) : row)))
}

// An agent's step: its model and effort, its context as the sum the engine's own `context_tokens` uses, and how it
// stopped, so a report cut off at max_tokens is flagged (spec C4)
export async function trackAgentStep($: EngineInterface, e: TurnStepInput, step: TurnStepResult): Promise<void> {
  const stepUsage = step.usage
  const id = e.agentId ?? ''
  // A loop no spawn announced is counted apart (spec C3)
  if (!(await readAgents($)).some(agentRow => agentRow.id === id)) {
    const now = await $.clock.now()
    await updateLoops($, list => addLoopStep(list, id, stepUsage?.output_tokens ?? 0, now))
    return
  }
  await updateAgentRow($, id, row => ({
    ...row, model: e.model, effort: e.effort === undefined ? row.effort : String(e.effort),
    contextTokens: stepUsage === null
      ? row.contextTokens
      : stepUsage.input_tokens + stepUsage.cache_read_input_tokens + stepUsage.cache_creation_input_tokens + stepUsage.output_tokens,
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
    const isKnown = e.resume !== undefined && (await readAgents($)).some(agentRow => agentRow.id === id)
    if (!isKnown) await countAgentType($, row.type)
    await updateAgents($, rows => upsertSpawn(rows, row, e.resume !== undefined))
    await addStepMark($, stepMarkOf(row))
    // Its first step came before its spawn resolved: the loop is this agent's
    if ((await readLoops($)).some(loop => loop.id === id)) await updateLoops($, list => list.filter(loop => loop.id !== id))
  }
  return spawned
}

// A loop no spawn announced, done
export async function finishLoop($: EngineInterface, id: string): Promise<void> {
  await updateLoops($, list => list.map(loop => (loop.id === id ? { ...loop, isDone: true } : loop)))
}

// The live rows moved by the engine's agent list, written only on a change
export async function refreshLiveAgents($: EngineInterface, rows: AgentRow[], now: number): Promise<void> {
  const listed = await $.agent.list()
  if (JSON.stringify(refreshAgents(rows, listed, now)) !== JSON.stringify(rows)) {
    await updateAgents($, current => refreshAgents(current, listed, now))
  }
}
