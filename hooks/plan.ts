// Plan and scores files: their parse, the plan view and the scores view. The contract is the README's 'Plan and score
// files', from the brief's 'Data contracts for the plan and scorer skills'. What a file requires makes it invalid when
// missing; an optional field that does not fit is dropped.
import type { Finding, Plan, PlanChange, PlanStep, Plans, ScoreRound, Scores, Severity, StepStatus, StepTime, TaskItem, Watched } from '../types'

const STATUSES: readonly string[] = ['pending', 'in_progress', 'done', 'failed', 'blocked', 'skipped']
const KINDS: readonly string[] = ['created', 'step_added', 'step_changed', 'step_removed', 'integrated']
const SOURCES: readonly string[] = ['user', 'claude']
const SUBJECTS: readonly string[] = ['plan', 'diagnosis', 'reply']
const SEVERITIES: readonly string[] = ['BLOCKER', 'MATERIAL', 'MINOR']
const FINDING_STATUSES: readonly string[] = ['open', 'fixed', 'improved', 'wontfix']
const NOTE_MAX = 200

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// JSON after a leading byte-order mark; CRLF is JSON whitespace
function json(text: string): Obj | null {
  try {
    const v: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

function stepOf(v: unknown): PlanStep | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const title = str(v.title)
  if (id === null || id === '' || title === null || typeof v.status !== 'string' || !STATUSES.includes(v.status)) return null
  const estimate = num(v.estimateMin) && v.estimateMin >= 0 ? v.estimateMin : null
  return { id, title, status: v.status as StepStatus, estimateMin: estimate, startedAt: time(v.startedAt), doneAt: time(v.doneAt) }
}

function changeOf(v: unknown): PlanChange | null {
  if (!isObj(v) || typeof v.kind !== 'string' || !KINDS.includes(v.kind) || typeof v.source !== 'string' || !SOURCES.includes(v.source)) return null
  const note = str(v.note)
  return {
    at: time(v.at), kind: v.kind as PlanChange['kind'], source: v.source as PlanChange['source'],
    step: str(v.step), note: note === null ? null : note.slice(0, NOTE_MAX),
  }
}

// null: the file breaks the contract
export function parsePlan(text: string): Plan | null {
  const v = json(text)
  if (v === null || v.version !== 1 || str(v.title) === null || !Array.isArray(v.steps) || v.steps.length === 0) return null
  const steps = v.steps.map(stepOf)
  if (steps.some(s => s === null)) return null
  const changes = Array.isArray(v.changes) ? v.changes.map(changeOf).filter((c): c is PlanChange => c !== null) : []
  return { title: v.title as string, updatedAt: time(v.updatedAt), steps: steps as PlanStep[], changes }
}

function findingOf(v: unknown): Finding | null {
  if (!isObj(v)) return null
  const text = str(v.text)
  if (text === null) return null
  return {
    id: str(v.id), text,
    severity: typeof v.severity === 'string' && SEVERITIES.includes(v.severity) ? (v.severity as Severity) : null,
    status: typeof v.status === 'string' && FINDING_STATUSES.includes(v.status) ? (v.status as Finding['status']) : null,
    by: str(v.by),
  }
}

function roundOf(v: unknown): ScoreRound | null {
  if (!isObj(v) || !num(v.round) || !Number.isInteger(v.round) || !num(v.total)) return null
  const criteria: Record<string, number> = {}
  if (isObj(v.criteria)) for (const [name, score] of Object.entries(v.criteria)) if (num(score)) criteria[name] = score
  const findings = Array.isArray(v.findings) ? v.findings.map(findingOf).filter((f): f is Finding => f !== null) : []
  return { round: v.round, at: time(v.at), total: v.total, criteria, findings }
}

export function parseScores(text: string): Scores | null {
  const v = json(text)
  if (v === null || v.version !== 1 || !isObj(v.subject) || !num(v.scale) || v.scale <= 0 || !Array.isArray(v.rounds)) return null
  const { kind, ref } = v.subject
  if (typeof kind !== 'string' || !SUBJECTS.includes(kind) || typeof ref !== 'string') return null
  const rounds = v.rounds.map(roundOf)
  if (rounds.some(r => r === null)) return null
  return {
    subject: { kind: kind as Scores['subject']['kind'], ref }, updatedAt: time(v.updatedAt), scale: v.scale,
    rounds: (rounds as ScoreRound[]).sort((a, b) => a.round - b.round),
  }
}

export type StepRow = { step: PlanStep; actualMs: number; forecastMs: number | null; isShared: boolean; notes: string[] }
export type PlanView = {
  title: string; finished: number; total: number; percent: number
  running: StepRow[]; next: StepRow | null; lastFinished: StepRow | null; rows: StepRow[]
  workedMs: number; overheadMs: number; leftMs: number; totalMs: number
  ratio: number; isCalibrated: boolean; unestimated: number; isFinished: boolean; staleMs: number | null; planNotes: string[]
}

const MIN = 60_000
const STALE_MS = 20 * MIN
export const isFinishedStep = (s: PlanStep): boolean => s.status === 'done' || s.status === 'skipped'

// A plan runs while it is begun and not finished, and its file was written since this session began: a plan an
// earlier session left with a step in progress neither takes the band's line 1 nor this session's time
export function runs(w: Watched<Plan>, since: number | null): boolean {
  const plan = w.value
  return plan !== null && since !== null && w.mtimeMs >= since
    && plan.steps.some(s => s.status !== 'pending') && !plan.steps.every(isFinishedStep)
}

// Which plan the Plan tab shows (Decision 5): the pinned one while it parses; else the newest that runs; else the task
// list when it has items, so a plan an earlier session left never hides this session's; else the newest good plan
export function shownPlan(p: Plans, pinned: string | null, hasTasks: boolean): Watched<Plan> | 'tasks' | null {
  const good = p.plans.filter(w => w.value !== null)
  const newest = (list: Watched<Plan>[]): Watched<Plan> | null =>
    list.reduce<Watched<Plan> | null>((a, w) => (a === null || w.mtimeMs > a.mtimeMs ? w : a), null)
  const pin = pinned === null ? undefined : good.find(w => w.name === pinned)
  if (pin !== undefined) return pin
  const running = newest(good.filter(w => runs(w, p.since)))
  if (running !== null) return running
  if (hasTasks) return 'tasks'
  return newest(good)
}

// Which plan this session's time goes to and the band draws: the pinned one only while it runs, so a plan pinned to
// read it never moves the time, or the band, away from the plan that runs
export function creditedPlan(p: Plans, pinned: string | null, hasTasks: boolean): Watched<Plan> | 'tasks' | null {
  const pin = shownPlan(p, pinned, hasTasks)
  return pinned === null || (pin !== null && pin !== 'tasks' && pin.name === pinned && runs(pin, p.since)) ? pin : shownPlan(p, null, hasTasks)
}

// The brief's 'Time for the plan': finished steps' time, plus each other step's forecast (its estimate times this
// plan's ratio once 2 done steps have both an estimate and a time) or its time so far, whichever is larger, plus the
// main loop's overhead. A skipped step is finished, but says nothing of the estimates, so it never calibrates.
export function planView(plan: Plan, times: Record<string, StepTime>, overheadMs: number, liveMs: Record<string, number>, now: number): PlanView {
  const notes = (step: string | null): string[] =>
    plan.changes.filter(c => c.kind === 'integrated' && c.source === 'user' && c.note !== null && c.step === step).map(c => c.note as string)
  const actual = (s: PlanStep): number => (times[s.id]?.ms ?? 0) + (liveMs[s.id] ?? 0)
  const calibrating = plan.steps.filter(s => s.status === 'done' && s.estimateMin !== null && actual(s) > 0)
  const isCalibrated = calibrating.length >= 2
  const ratio = isCalibrated
    ? calibrating.reduce((n, s) => n + actual(s), 0) / calibrating.reduce((n, s) => n + (s.estimateMin as number) * MIN, 0)
    : 1
  const rows: StepRow[] = plan.steps.map(step => ({
    step, actualMs: actual(step),
    forecastMs: isFinishedStep(step) || step.estimateMin === null ? null : Math.round(step.estimateMin * MIN * ratio),
    isShared: times[step.id]?.isShared ?? false, notes: notes(step.id),
  }))
  const open = rows.filter(r => !isFinishedStep(r.step))
  const finishedRows = rows.filter(r => isFinishedStep(r.step))
  // The last finished: the newest `doneAt`, else the last in the plan's order
  const lastFinished = finishedRows.reduce<StepRow | null>((last, r) =>
    last === null || (r.step.doneAt ?? -Infinity) >= (last.step.doneAt ?? -Infinity) ? r : last, null)
  const isRunning = rows.some(r => r.step.status === 'in_progress')
  const stale = plan.updatedAt === null ? null : now - plan.updatedAt
  return {
    title: plan.title, finished: finishedRows.length, total: rows.length,
    percent: Math.round((finishedRows.length / rows.length) * 100),
    running: rows.filter(r => r.step.status === 'in_progress'), next: rows.find(r => r.step.status === 'pending') ?? null,
    lastFinished, rows,
    workedMs: rows.reduce((n, r) => n + r.actualMs, 0) + overheadMs, overheadMs,
    leftMs: open.reduce((n, r) => n + Math.max(0, (r.forecastMs ?? 0) - r.actualMs), 0),
    totalMs: finishedRows.reduce((n, r) => n + r.actualMs, 0) + open.reduce((n, r) => n + Math.max(r.forecastMs ?? 0, r.actualMs), 0) + overheadMs,
    ratio, isCalibrated, unestimated: open.filter(r => r.step.estimateMin === null).length,
    isFinished: open.length === 0, staleMs: isRunning && stale !== null && stale > STALE_MS ? stale : null, planNotes: notes(null),
  }
}

export type ScoresView = {
  scale: number; totals: { round: number; total: number }[]; delta: number | null
  criteria: { name: string; prev: number | null; last: number }[]
  severities: { severity: Severity; prev: number; last: number }[]
  fixed: Finding[]; improved: Finding[]; open: Finding[]; hasStatus: boolean
}

const SEVERITY_ORDER: readonly Severity[] = ['BLOCKER', 'MATERIAL', 'MINOR']

// Scorer rule 4: each round's total, the change per criterion and the count per severity, a fixed finding not
// counted; the fixed and improved lists only when the writer recognised findings across rounds and set a status.
export function scoresView(s: Scores): ScoresView | null {
  const last = s.rounds[s.rounds.length - 1]
  if (last === undefined) return null
  const prev = s.rounds[s.rounds.length - 2] ?? null
  const count = (r: ScoreRound | null, severity: Severity): number =>
    r === null ? 0 : r.findings.filter(f => f.severity === severity && f.status !== 'fixed').length
  const present = (r: ScoreRound | null, severity: Severity): boolean => r !== null && r.findings.some(f => f.severity === severity)
  return {
    scale: s.scale,
    totals: s.rounds.slice(-4).map(r => ({ round: r.round, total: r.total })),
    delta: prev === null ? null : last.total - prev.total,
    criteria: Object.entries(last.criteria).map(([name, score]) => ({ name, prev: prev?.criteria[name] ?? null, last: score })),
    severities: SEVERITY_ORDER.filter(v => present(prev, v) || present(last, v)).map(v => ({ severity: v, prev: count(prev, v), last: count(last, v) })),
    fixed: last.findings.filter(f => f.status === 'fixed'),
    improved: last.findings.filter(f => f.status === 'improved'),
    open: last.findings.filter(f => f.status === null || f.status === 'open'),
    hasStatus: last.findings.some(f => f.status !== null),
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
    return id === null || subject === null ? items : [...items, { id, subject, status: 'pending', ms: 0 }]
  }
  if (tool === 'TaskUpdate') {
    const id = str(input.taskId)
    if (input.status === 'deleted') return items.filter(t => t.id !== id)
    const status = typeof input.status === 'string' && TASK_STATUSES.includes(input.status) ? (input.status as TaskItem['status']) : null
    const subject = str(input.subject)
    return items.map(t => (t.id === id ? { ...t, status: status ?? t.status, subject: subject ?? t.subject } : t))
  }
  if (tool === 'TodoWrite') {
    if (!Array.isArray(input.todos)) return items
    return input.todos.filter(isObj).map((todo, i) => {
      const subject = str(todo.content) ?? ''
      const status = typeof todo.status === 'string' && TASK_STATUSES.includes(todo.status) ? (todo.status as TaskItem['status']) : 'pending'
      return { id: String(i), subject, status, ms: items.find(t => t.subject === subject)?.ms ?? 0 }
    })
  }
  return null
}

// The task list as a plan titled 'Tasks', with no estimates: once 3 are completed, the time left is their mean time
// times the items left (the brief's band row)
export function taskView(items: TaskItem[], liveMs: Record<string, number>): PlanView {
  const rows: StepRow[] = items.map(t => ({
    step: { id: t.id, title: t.subject, status: t.status === 'completed' ? 'done' : t.status, estimateMin: null, startedAt: null, doneAt: null },
    actualMs: t.ms + (liveMs[t.id] ?? 0), forecastMs: null, isShared: false, notes: [],
  }))
  const done = rows.filter(r => r.step.status === 'done')
  const open = rows.filter(r => r.step.status !== 'done')
  const workedMs = rows.reduce((n, r) => n + r.actualMs, 0)
  const leftMs = done.length >= 3 ? Math.round((done.reduce((n, r) => n + r.actualMs, 0) / done.length) * open.length) : 0
  return {
    title: 'Tasks', finished: done.length, total: rows.length, percent: rows.length === 0 ? 0 : Math.round((done.length / rows.length) * 100),
    running: rows.filter(r => r.step.status === 'in_progress'), next: rows.find(r => r.step.status === 'pending') ?? null,
    lastFinished: done[done.length - 1] ?? null, rows, workedMs, overheadMs: 0, leftMs, totalMs: workedMs + leftMs,
    ratio: 1, isCalibrated: true, unestimated: done.length >= 3 ? 0 : open.length,
    isFinished: rows.length > 0 && open.length === 0, staleMs: null, planNotes: [],
  }
}
