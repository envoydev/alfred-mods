// Plan and scores files: their parse, the plan view and the scores view. The contract is the README's 'Plan and score
import type { Finding, Plan, PlanChange, PlanStep, PlanView, Plans, ScoreRound, Scores, ScoresView, Severity, StepRow, StepStatus, StepTime, TaskItem, Watched } from './types'
// files', from the brief's 'Data contracts for the plan and scorer skills'. What a file requires makes it invalid when
// missing; an optional field that does not fit is dropped.

const STATUSES: readonly string[] = ['pending', 'in_progress', 'done', 'failed', 'blocked', 'skipped']
const KINDS: readonly string[] = ['created', 'step_added', 'step_changed', 'step_removed', 'integrated']
const SOURCES: readonly string[] = ['user', 'claude']
const SUBJECTS: readonly string[] = ['plan', 'diagnosis', 'reply']
const SEVERITIES: readonly string[] = ['BLOCKER', 'MATERIAL', 'MINOR']
const FINDING_STATUSES: readonly string[] = ['open', 'fixed', 'improved', 'wontfix']
const NOTE_MAX = 200

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const time = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// JSON after a leading byte-order mark; CRLF is JSON whitespace
function json(text: string): Obj | null {
  try {
    const value: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObj(value) ? value : null
  } catch {
    return null
  }
}

function stepOf(value: unknown): PlanStep | null {
  if (!isObj(value)) return null
  const id = str(value.id)
  const title = str(value.title)
  if (id === null || id === '' || title === null || typeof value.status !== 'string' || !STATUSES.includes(value.status)) return null
  const estimate = num(value.estimateMin) && value.estimateMin >= 0 ? value.estimateMin : null
  return { id, title, status: value.status as StepStatus, estimateMin: estimate, startedAt: time(value.startedAt), doneAt: time(value.doneAt) }
}

function changeOf(value: unknown): PlanChange | null {
  if (!isObj(value) || typeof value.kind !== 'string' || !KINDS.includes(value.kind) || typeof value.source !== 'string' || !SOURCES.includes(value.source)) return null
  const note = str(value.note)
  return {
    at: time(value.at), kind: value.kind as PlanChange['kind'], source: value.source as PlanChange['source'],
    step: str(value.step), note: note === null ? null : note.slice(0, NOTE_MAX),
  }
}

// null: the file breaks the contract
export function parsePlan(text: string): Plan | null {
  const value = json(text)
  if (value === null || value.version !== 1 || str(value.title) === null || !Array.isArray(value.steps) || value.steps.length === 0) return null
  const steps = value.steps.map(stepOf)
  if (steps.some(step => step === null)) return null
  const changes = Array.isArray(value.changes) ? value.changes.map(changeOf).filter((change): change is PlanChange => change !== null) : []
  return { title: value.title as string, updatedAt: time(value.updatedAt), steps: steps as PlanStep[], changes }
}

function findingOf(value: unknown): Finding | null {
  if (!isObj(value)) return null
  const text = str(value.text)
  if (text === null) return null
  return {
    id: str(value.id), text,
    severity: typeof value.severity === 'string' && SEVERITIES.includes(value.severity) ? (value.severity as Severity) : null,
    status: typeof value.status === 'string' && FINDING_STATUSES.includes(value.status) ? (value.status as Finding['status']) : null,
    by: str(value.by),
  }
}

function roundOf(value: unknown): ScoreRound | null {
  if (!isObj(value) || !num(value.round) || !Number.isInteger(value.round) || !num(value.total)) return null
  const criteria: Record<string, number> = {}
  if (isObj(value.criteria)) for (const [name, score] of Object.entries(value.criteria)) if (num(score)) criteria[name] = score
  const findings = Array.isArray(value.findings) ? value.findings.map(findingOf).filter((finding): finding is Finding => finding !== null) : []
  return { round: value.round, at: time(value.at), total: value.total, criteria, findings }
}

export function parseScores(text: string): Scores | null {
  const value = json(text)
  if (value === null || value.version !== 1 || !isObj(value.subject) || !num(value.scale) || value.scale <= 0 || !Array.isArray(value.rounds)) return null
  const { kind, ref } = value.subject
  if (typeof kind !== 'string' || !SUBJECTS.includes(kind) || typeof ref !== 'string') return null
  const rounds = value.rounds.map(roundOf)
  if (rounds.some(round => round === null)) return null
  return {
    subject: { kind: kind as Scores['subject']['kind'], ref }, updatedAt: time(value.updatedAt), scale: value.scale,
    rounds: (rounds as ScoreRound[]).sort((first, second) => first.round - second.round),
  }
}


const MIN = 60_000
const STALE_MS = 20 * MIN
export const isFinishedStep = (step: PlanStep): boolean => step.status === 'done' || step.status === 'skipped'
// A plan is done when every step is, or when Alfred Code closed it
export const isPlanDone = (plan: Plan): boolean => typeof plan.completedAt === 'number' || plan.steps.every(isFinishedStep)

// A plan runs while it is begun and not done, and its file was written since this session began: a plan an earlier
// session left with a step in progress neither takes the band's line 1 nor this session's time. Alfred Code's named
// plan needs no fresh write: its status file naming it this session is the evidence.
export function isPlanRunning(file: Watched<Plan>, since: number | null): boolean {
  const plan = file.value
  if (plan === null || !plan.steps.some(step => step.status !== 'pending') || isPlanDone(plan)) return false
  return file.isNamed === true || (since !== null && file.mtimeMs >= since)
}

// Which plan the Plan tab shows (Decision 5): the pinned one while it parses; else Alfred Code's named plan; else the
// newest that runs; else the task list when it has items, so a plan an earlier session left never hides this session's; else the newest good plan
export function shownPlan(plans: Plans, pinned: string | null, hasTasks: boolean): Watched<Plan> | 'tasks' | null {
  const good = plans.planFiles.filter(file => file.value !== null)
  const newest = (list: Watched<Plan>[]): Watched<Plan> | null =>
    list.reduce<Watched<Plan> | null>((newestFile, file) => (newestFile === null || file.mtimeMs > newestFile.mtimeMs ? file : newestFile), null)
  const pin = pinned === null ? undefined : good.find(file => file.name === pinned)
  if (pin !== undefined) return pin
  // The plan Alfred Code's status file names comes before the rest, begun or not
  const named = plans.alfredFolder === null || plans.alfredFolder === undefined ? undefined : good.find(file => file.name === plans.alfredFolder?.name)
  if (named !== undefined) return named
  const running = newest(good.filter(file => isPlanRunning(file, plans.watchedSince)))
  if (running !== null) return running
  if (hasTasks) return 'tasks'
  return newest(good)
}

// Which plan this session's time goes to and the band draws: the pinned one only while it runs, so a plan pinned to
// read it never moves the time, or the band, away from the plan that runs
export function creditedPlan(plans: Plans, pinned: string | null, hasTasks: boolean): Watched<Plan> | 'tasks' | null {
  const pin = shownPlan(plans, pinned, hasTasks)
  return pinned === null || (pin !== null && pin !== 'tasks' && pin.name === pinned && isPlanRunning(pin, plans.watchedSince)) ? pin : shownPlan(plans, null, hasTasks)
}

// The brief's 'Time for the plan': finished steps' time, plus each other step's forecast (its estimate times this
// plan's ratio once 2 done steps have both an estimate and a time) or its time so far, whichever is larger, plus the
// main loop's overhead. A skipped step is finished, but says nothing of the estimates, so it never calibrates.
export function planView(plan: Plan, times: Record<string, StepTime>, overheadMs: number, liveMs: Record<string, number>, now: number): PlanView {
  const notes = (step: string | null): string[] =>
    plan.changes.filter(planChange => planChange.kind === 'integrated' && planChange.source === 'user' && planChange.note !== null && planChange.step === step)
      .map(change => change.note as string)
  const actual = (step: PlanStep): number => (times[step.id]?.ms ?? 0) + (liveMs[step.id] ?? 0)
  const calibrating = plan.steps.filter(step => step.status === 'done' && step.estimateMin !== null && actual(step) > 0)
  const isCalibrated = calibrating.length >= 2
  const ratio = isCalibrated
    ? calibrating.reduce((total, step) => total + actual(step), 0) / calibrating.reduce((total, step) => total + (step.estimateMin as number) * MIN, 0)
    : 1
  const rows: StepRow[] = plan.steps.map(step => ({
    step, actualMs: actual(step),
    forecastMs: isFinishedStep(step) || step.estimateMin === null ? null : Math.round(step.estimateMin * MIN * ratio),
    isShared: times[step.id]?.isShared ?? false, notes: notes(step.id),
  }))
  const open = rows.filter(row => !isFinishedStep(row.step))
  const finishedRows = rows.filter(row => isFinishedStep(row.step))
  // The last finished: the newest `doneAt`, else the last in the plan's order
  const lastFinished = finishedRows.reduce<StepRow | null>((last, row) =>
    last === null || (row.step.doneAt ?? -Infinity) >= (last.step.doneAt ?? -Infinity) ? row : last, null)
  const isRunning = rows.some(row => row.step.status === 'in_progress')
  const stale = plan.updatedAt === null ? null : now - plan.updatedAt
  return {
    title: plan.title, finished: finishedRows.length, total: rows.length,
    percent: Math.round((finishedRows.length / rows.length) * 100),
    running: rows.filter(row => row.step.status === 'in_progress'), next: rows.find(row => row.step.status === 'pending') ?? null,
    lastFinished, rows,
    workedMs: rows.reduce((total, row) => total + row.actualMs, 0) + overheadMs, overheadMs,
    leftMs: open.reduce((total, row) => total + Math.max(0, (row.forecastMs ?? 0) - row.actualMs), 0),
    totalMs: finishedRows.reduce((total, row) => total + row.actualMs, 0)
      + open.reduce((total, row) => total + Math.max(row.forecastMs ?? 0, row.actualMs), 0) + overheadMs,
    ratio, isCalibrated, unestimated: open.filter(row => row.step.estimateMin === null).length,
    isFinished: open.length === 0 || typeof plan.completedAt === 'number', isAwaiting: plan.approvedAt === null, staleMs: isRunning && stale !== null && stale > STALE_MS ? stale : null, planNotes: notes(null),
  }
}


const SEVERITY_ORDER: readonly Severity[] = ['BLOCKER', 'MATERIAL', 'MINOR']

// Scorer rule 4: each round's total, the change per criterion and the count per severity, a fixed finding not
// counted; the fixed and improved lists only when the writer recognised findings across rounds and set a status.
export function scoresView(scores: Scores): ScoresView | null {
  // Alfred Code's released round, else the newest; the arrow against the round graded just before it
  const at = typeof scores.released === 'number' ? scores.rounds.findIndex(round => round.round === scores.released) : -1
  const shownIndex = at >= 0 ? at : scores.rounds.length - 1
  const last = scores.rounds[shownIndex]
  if (last === undefined) return null
  const prev = scores.rounds[shownIndex - 1] ?? null
  const count = (round: ScoreRound | null, severity: Severity): number =>
    round === null ? 0 : round.counts !== undefined ? round.counts[severity] ?? 0
      : round.findings.filter(finding => finding.severity === severity && finding.status !== 'fixed').length
  const present = (round: ScoreRound | null, severity: Severity): boolean =>
    round !== null && (round.counts !== undefined ? round.counts[severity] !== undefined : round.findings.some(finding => finding.severity === severity))
  return {
    scale: scores.scale,
    totals: scores.rounds.slice(-4).map(round => ({ round: round.round, total: round.total })),
    shown: { round: last.round, total: last.total }, isGrading: scores.released === null,
    delta: prev === null ? null : last.total - prev.total,
    criteria: Object.entries(last.criteria).map(([name, score]) => ({ name, prev: prev?.criteria[name] ?? null, last: score })),
    severities: SEVERITY_ORDER.filter(severity => present(prev, severity) || present(last, severity))
      .map(value => ({ severity: value, prev: count(prev, value), last: count(last, value) })),
    fixed: last.findings.filter(finding => finding.status === 'fixed'),
    improved: last.findings.filter(finding => finding.status === 'improved'),
    open: last.findings.filter(finding => finding.status === null || finding.status === 'open'),
    hasStatus: last.findings.some(finding => finding.status !== null),
  }
}

const TASK_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

// The task list after a settled main-loop call of a task tool (Decision 14); null for any other tool. TodoWrite
// replaces the list, each item's id its index, and an item whose subject was there before keeps its time.
export function tasksAfter(items: TaskItem[], tool: string, input: Record<string, unknown>, result: unknown): TaskItem[] | null {
  if (tool === 'TaskCreate') {
    const task = isObj(result) && isObj(result.task) ? result.task : null
    const id = task === null ? null : str(task.id)
    const subject = str(task?.subject) ?? str(input.subject)
    return id === null || subject === null ? items : [...items, { id, subject, status: 'pending', workedMs: 0 }]
  }
  if (tool === 'TaskUpdate') {
    const id = str(input.taskId)
    if (input.status === 'deleted') return items.filter(task => task.id !== id)
    const status = typeof input.status === 'string' && TASK_STATUSES.includes(input.status) ? (input.status as TaskItem['status']) : null
    const subject = str(input.subject)
    return items.map(task => (task.id === id ? { ...task, status: status ?? task.status, subject: subject ?? task.subject } : task))
  }
  if (tool === 'TodoWrite') {
    if (!Array.isArray(input.todos)) return items
    return input.todos.filter(isObj).map((todo, i) => {
      const subject = str(todo.content) ?? ''
      const status = typeof todo.status === 'string' && TASK_STATUSES.includes(todo.status) ? (todo.status as TaskItem['status']) : 'pending'
      return { id: String(i), subject, status, workedMs: items.find(listed => listed.subject === subject)?.workedMs ?? 0 }
    })
  }
  return null
}

// The task list as a plan titled 'Tasks', with no estimates: once 3 are completed, the time left is their mean time
// times the items left (the brief's band row)
export function taskView(items: TaskItem[], liveMs: Record<string, number>): PlanView {
  const rows: StepRow[] = items.map(task => ({
    step: { id: task.id, title: task.subject, status: task.status === 'completed' ? 'done' : task.status, estimateMin: null, startedAt: null, doneAt: null },
    actualMs: task.workedMs + (liveMs[task.id] ?? 0), forecastMs: null, isShared: false, notes: [],
  }))
  const done = rows.filter(row => row.step.status === 'done')
  const open = rows.filter(row => row.step.status !== 'done')
  const workedMs = rows.reduce((total, row) => total + row.actualMs, 0)
  const leftMs = done.length >= 3 ? Math.round((done.reduce((total, row) => total + row.actualMs, 0) / done.length) * open.length) : 0
  return {
    title: 'Tasks', finished: done.length, total: rows.length, percent: rows.length === 0 ? 0 : Math.round((done.length / rows.length) * 100),
    running: rows.filter(row => row.step.status === 'in_progress'), next: rows.find(row => row.step.status === 'pending') ?? null,
    lastFinished: done[done.length - 1] ?? null, rows, workedMs, overheadMs: 0, leftMs, totalMs: workedMs + leftMs,
    ratio: 1, isCalibrated: true, unestimated: done.length >= 3 ? 0 : open.length,
    isFinished: rows.length > 0 && open.length === 0, staleMs: null, planNotes: [], isAwaiting: false,
  }
}

export const taskStatusKey = (items: TaskItem[]): string => JSON.stringify(items.map(task => [task.id, task.status]))

export const stepStatusKey = (files: Watched<Plan>[]): string =>
  JSON.stringify(files.map(file => [file.name, file.value?.steps.map(step => [step.id, step.status]) ?? null]))

export const FINISH_SHOWN_MS = 10 * 60_000

// The user's notes in `after` that `before` lacks, each counted by its time, step and text, so two alike are two
export function newUserNotes(before: PlanChange[], after: PlanChange[]): PlanChange[] {
  const idOf = (note: PlanChange): string => JSON.stringify([note.at, note.step, note.note])
  const isNote = (note: PlanChange): boolean => note.kind === 'integrated' && note.source === 'user' && note.note !== null
  const left = new Map<string, number>()
  for (const note of before.filter(isNote)) left.set(idOf(note), (left.get(idOf(note)) ?? 0) + 1)
  return after.filter(isNote).filter(change => {
    const count = left.get(idOf(change)) ?? 0
    if (count > 0) left.set(idOf(change), count - 1)
    return count === 0
  })
}

// The folders the stack writes plans and scores to
export const PLANS_DIR = '.claude/session-inspector/plans'
export const SCORES_DIR = '.claude/session-inspector/scores'
