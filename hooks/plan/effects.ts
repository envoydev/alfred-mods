// The plan folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Credit, Plans, TaskItem } from './types'

const INITIAL_PLANS: Plans = { plans: [], scores: [], times: {}, overhead: {}, finished: {}, toasted: [], since: null, alfred: null }
const plansAtom = atom({ plugin: 'alfred-mods', key: 'plans' } as const, INITIAL_PLANS, { shape: 'plans-2' })
export function readPlans($: EngineInterface) {
  return read($, plansAtom)
}
export function updatePlans($: EngineInterface, change: (value: Plans) => Plans) {
  return update($, plansAtom, change)
}
export function resetPlans($: EngineInterface) {
  return update($, plansAtom, () => INITIAL_PLANS)
}

const INITIAL_CREDIT: Credit = { slices: {}, mine: {} }
const creditAtom = atom({ plugin: 'alfred-mods', key: 'credit' } as const, INITIAL_CREDIT, { shape: 'credit-1' })
export function readCredit($: EngineInterface) {
  return read($, creditAtom)
}
export function updateCredit($: EngineInterface, change: (value: Credit) => Credit) {
  return update($, creditAtom, change)
}
export function resetCredit($: EngineInterface) {
  return update($, creditAtom, () => INITIAL_CREDIT)
}

const INITIAL_TASKS: TaskItem[] = []
const tasksAtom = atom({ plugin: 'alfred-mods', key: 'tasks' } as const, INITIAL_TASKS, { shape: 'tasks-1' })
export function readTasks($: EngineInterface) {
  return read($, tasksAtom)
}
export function updateTasks($: EngineInterface, change: (value: TaskItem[]) => TaskItem[]) {
  return update($, tasksAtom, change)
}
export function resetTasks($: EngineInterface) {
  return update($, tasksAtom, () => INITIAL_TASKS)
}
