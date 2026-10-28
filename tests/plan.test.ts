import { expect, test } from 'claude-code/testing'

import { parsePlan, parseScores, planView, scoresView, taskView, tasksAfter } from '../hooks/plan.ts'
import { FIVE, FIVE_OVERHEAD, FIVE_TIMES, MIN, NOW, PLAN_JSON, SCORES_JSON, planOf } from './plans.ts'
import type { Scores, TaskItem } from '../types'

// The plan example as an object, changed by `change` and written back as text
const planWith = (change: (p: Record<string, any>) => void): string => {
  const p = JSON.parse(PLAN_JSON) as Record<string, any>
  change(p)
  return JSON.stringify(p)
}
const scoresWith = (change: (s: Record<string, any>) => void): string => {
  const s = JSON.parse(SCORES_JSON) as Record<string, any>
  change(s)
  return JSON.stringify(s)
}

test("the brief's plan example parses", () => {
  const plan = parsePlan(PLAN_JSON)
  expect(plan?.title).toBe('Token refresh')
  expect(plan?.steps).toHaveLength(5)
  expect(plan?.steps[3]).toMatchObject({ id: 'S4', status: 'in_progress', estimateMin: 20, doneAt: null })
  expect(plan?.steps[0]?.doneAt).toBe(Date.parse('2026-10-27T13:40:00Z'))
  expect(plan?.changes[1]).toMatchObject({ kind: 'integrated', step: 'S2', source: 'user', note: 'Use sliding expiry, not fixed 15 min' })
})

test('a plan with CRLF and a byte-order mark parses', () => {
  expect(parsePlan('﻿' + PLAN_JSON.replace(/\n/g, '\r\n'))).toEqual(parsePlan(PLAN_JSON))
})

test('a plan missing what the contract requires is invalid', () => {
  expect(parsePlan(planWith(p => { p.version = 2 }))).toBe(null)
  expect(parsePlan(planWith(p => { delete p.title }))).toBe(null)
  expect(parsePlan(planWith(p => { p.steps = [] }))).toBe(null)
  expect(parsePlan(planWith(p => { p.steps[0].status = 'started' }))).toBe(null)
  expect(parsePlan(planWith(p => { p.steps[0].id = '' }))).toBe(null)
  expect(parsePlan('{"version":1,')).toBe(null)
})

test('optional fields that do not fit are dropped', () => {
  const plan = parsePlan(planWith(p => {
    p.steps[0].estimateMin = -3
    p.steps[1].startedAt = 'soon'
    p.changes.push({ at: '2026-10-27T14:06:00Z', kind: 'renamed', source: 'user' })
    p.changes.push({ at: '2026-10-27T14:07:00Z', kind: 'integrated', source: 'user', note: 'x'.repeat(250) })
  }))
  expect(plan?.steps[0]?.estimateMin).toBe(null)
  expect(plan?.steps[1]?.startedAt).toBe(null)
  expect(plan?.changes.map(c => c.kind)).toEqual(['created', 'integrated', 'integrated'])
  expect(plan?.changes[2]?.note).toHaveLength(200)
})

test("the brief's scores example parses, rounds in order", () => {
  const scores = parseScores(scoresWith(s => { s.rounds.reverse() }))
  expect(scores?.rounds.map(r => r.round)).toEqual([1, 2])
  expect(scores?.scale).toBe(100)
  expect(scores?.subject).toEqual({ kind: 'plan', ref: 'token-refresh' })
  expect(scores?.rounds[1]?.findings[0]).toEqual({ id: 'F2', text: 'No load test for refresh storm', severity: 'MATERIAL', status: null, by: null })
})

test('a scores file without its scale is invalid', () => {
  expect(parseScores(scoresWith(s => { delete s.scale }))).toBe(null)
  expect(parseScores(scoresWith(s => { s.scale = 0 }))).toBe(null)
  expect(parseScores(scoresWith(s => { s.subject.kind = 'essay' }))).toBe(null)
  expect(parseScores(scoresWith(s => { s.rounds[0].total = 'high' }))).toBe(null)
  const kept = parseScores(scoresWith(s => { s.rounds[0].criteria.risk = 'n/a' }))
  expect(kept?.rounds[0]?.criteria).toEqual({ correctness: 70, completeness: 80 })
})

const view = (plan = FIVE, times = FIVE_TIMES, live: Record<string, number> = {}) => planView(plan, times, FIVE_OVERHEAD, live, NOW)
const near = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-9
const row = (v: ReturnType<typeof view>, id: string) => v.rows.find(r => r.step.id === id)

test("the brief's mockup reads from the plan and its times", () => {
  const v = view()
  expect(v).toMatchObject({ finished: 3, total: 5, percent: 60, isCalibrated: true, leftMs: 1_800_000, totalMs: 6_120_000, workedMs: 4_320_000 })
  expect(near(v.ratio, 1.2)).toBe(true)
  expect(row(v, 'S4')?.forecastMs).toBe(1_440_000)
  expect(row(v, 'S5')?.forecastMs).toBe(1_080_000)
  expect(v.running.map(r => r.step.id)).toEqual(['S4'])
  expect(v.next?.step.id).toBe('S5')
  expect(v.lastFinished?.step.id).toBe('S3')
  expect(row(v, 'S2')?.notes).toEqual(['Use sliding expiry, not fixed 15 min'])
})

test('with one finished step the raw estimates show, uncalibrated', () => {
  const v = view(planOf({ S2: 'pending', S3: 'pending', S4: 'pending' }))
  expect(v.isCalibrated).toBe(false)
  expect(v.ratio).toBe(1)
  expect(row(v, 'S2')?.forecastMs).toBe(20 * MIN)
})

test('a step without an estimate adds nothing and is counted', () => {
  const v = view(planOf({ S5: { estimateMin: null } }))
  expect(v.unestimated).toBe(1)
  expect(row(v, 'S5')?.forecastMs).toBe(null)
  expect(v.leftMs).toBe(12 * MIN)
})

test('two running steps share the live time each was given', () => {
  const v = view(planOf({ S5: 'in_progress' }), FIVE_TIMES, { S4: 60_000, S5: 60_000 })
  expect(row(v, 'S4')?.actualMs).toBe(13 * MIN)
  expect(row(v, 'S5')?.actualMs).toBe(MIN)
})

test('a skipped step does not calibrate', () => {
  const s6 = { id: 'S6', title: 'Docs', status: 'skipped' as const, estimateMin: 15, startedAt: null, doneAt: null }
  const v = view(planOf({}, [s6]), { ...FIVE_TIMES, S6: { ms: 2 * MIN, isShared: false } })
  expect(near(v.ratio, 1.2)).toBe(true)
  expect(view(planOf({ S2: 'skipped', S3: 'pending', S4: 'pending' })).isCalibrated).toBe(false)
})

test('a plan is finished when every step is done or skipped', () => {
  const v = view(planOf({ S4: 'done', S5: 'skipped' }))
  expect(v.isFinished).toBe(true)
  expect(v.percent).toBe(100)
  expect(view(planOf({ S4: 'done', S5: 'failed' })).isFinished).toBe(false)
})

test('a step reopened keeps its time and the plan is no longer finished', () => {
  const v = view(planOf({ S3: 'in_progress', S4: 'done', S5: 'done' }), { ...FIVE_TIMES, S5: { ms: 18 * MIN, isShared: false } })
  expect(row(v, 'S3')?.actualMs).toBe(12 * MIN)
  expect(v.isFinished).toBe(false)
  // The ratio over S1, S2, S4 and S5: (18 + 24 + 12 + 18) over (15 + 20 + 20 + 15) minutes
  expect(row(v, 'S3')?.forecastMs).toBe(Math.round(10 * MIN * (72 / 70)))
})

test('an update over 20 minutes old while a step runs is stale', () => {
  const at = (minutesAgo: number, plan = FIVE) => planView({ ...plan, updatedAt: NOW - minutesAgo * MIN }, FIVE_TIMES, 0, {}, NOW).staleMs
  expect(at(21)).toBe(1_260_000)
  expect(at(19)).toBe(null)
  expect(at(30, planOf({ S4: 'done' }))).toBe(null)
})

const scores = (change: (s: Record<string, any>) => void = () => {}) => scoresView(parseScores(scoresWith(change)) as Scores)

test("the brief's scores read as its mockup", () => {
  const v = scores()
  expect(v?.totals).toEqual([{ round: 1, total: 68 }, { round: 2, total: 81 }])
  expect(v?.delta).toBe(13)
  expect(v?.criteria).toEqual([
    { name: 'correctness', prev: 70, last: 80 }, { name: 'risk', prev: 50, last: 80 }, { name: 'completeness', prev: 80, last: 80 },
  ])
  expect(v?.severities).toEqual([{ severity: 'BLOCKER', prev: 1, last: 0 }, { severity: 'MATERIAL', prev: 0, last: 1 }])
  expect(v?.open.map(f => f.id)).toEqual(['F2'])
  expect(v?.hasStatus).toBe(false)
  expect(v?.fixed).toEqual([])
  expect(v?.improved).toEqual([])
})

test('with ids reused and statuses set, the fixed list names the step that fixed it', () => {
  const v = scores(s => {
    s.rounds[1].findings = [
      { id: 'F1', text: 'No migration rollback', severity: 'BLOCKER', status: 'fixed', by: 'S3' },
      { id: 'F2', text: 'No load test for refresh storm', severity: 'MATERIAL', status: 'open' },
    ]
  })
  expect(v?.hasStatus).toBe(true)
  expect(v?.fixed.map(f => [f.id, f.by])).toEqual([['F1', 'S3']])
  expect(v?.open.map(f => f.id)).toEqual(['F2'])
  expect(v?.severities).toEqual([{ severity: 'BLOCKER', prev: 1, last: 0 }, { severity: 'MATERIAL', prev: 0, last: 1 }])
})

test("a fresh grader's round, with no matching ids, reads as new findings", () => {
  const v = scores(s => {
    s.rounds[1].findings = [{ id: 'G1', text: 'One', severity: 'MINOR' }, { id: 'G2', text: 'Two' }]
  })
  expect(v?.hasStatus).toBe(false)
  expect(v?.open.map(f => f.id)).toEqual(['G1', 'G2'])
  expect(v?.fixed).toEqual([])
})

test('only the last 4 totals show, and a lone round has no change', () => {
  const six = scores(s => {
    s.rounds = [1, 2, 3, 4, 5, 6].map(n => ({ round: n, total: 60 + n, criteria: {}, findings: [] }))
  })
  expect(six?.totals.map(t => t.round)).toEqual([3, 4, 5, 6])
  const one = scores(s => { s.rounds = [s.rounds[0]] })
  expect(one?.delta).toBe(null)
  expect(one?.criteria.every(c => c.prev === null)).toBe(true)
  expect(scores(s => { s.rounds = [] })).toBe(null)
})

const item = (id: string, status: TaskItem['status'], minutes = 0): TaskItem => ({ id, subject: `Task ${id}`, status, ms: minutes * MIN })

test("the task list's time left is the mean of 3 completed", () => {
  const v = taskView([item('1', 'completed', 2), item('2', 'completed', 4), item('3', 'completed', 6), item('4', 'in_progress'), item('5', 'pending')], {})
  expect(v).toMatchObject({ title: 'Tasks', finished: 3, total: 5, leftMs: 8 * MIN, isCalibrated: true })
  expect(v.running.map(r => r.step.id)).toEqual(['4'])
  const two = taskView([item('1', 'completed', 2), item('2', 'completed', 4), item('3', 'pending'), item('4', 'pending'), item('5', 'pending')], {})
  expect(two).toMatchObject({ leftMs: 0, unestimated: 3 })
})

test('the task tools keep the task list', () => {
  const created = tasksAfter([], 'TaskCreate', { subject: 'Write tests' }, { task: { id: '1', subject: 'Write tests' } })
  expect(created).toEqual([{ id: '1', subject: 'Write tests', status: 'pending', ms: 0 }])
  const started = tasksAfter(created ?? [], 'TaskUpdate', { taskId: '1', status: 'in_progress' }, null)
  expect(started?.[0]?.status).toBe('in_progress')
  expect(tasksAfter(started ?? [], 'TaskUpdate', { taskId: '1', status: 'deleted' }, null)).toEqual([])
  expect(tasksAfter([], 'Read', {}, null)).toBe(null)
  const listed = tasksAfter([{ id: '0', subject: 'A', status: 'in_progress', ms: 60_000 }], 'TodoWrite',
    { todos: [{ content: 'A', status: 'completed', activeForm: 'Doing A' }, { content: 'B', status: 'pending', activeForm: 'Doing B' }] }, null)
  expect(listed).toEqual([{ id: '0', subject: 'A', status: 'completed', ms: 60_000 }, { id: '1', subject: 'B', status: 'pending', ms: 0 }])
})
