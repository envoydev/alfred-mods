import { expect, test } from 'claude-code/testing'

import { parseAlfredScoring, parseAlfredStatus } from '../../hooks/plan/alfredplan'
import { planView, runs, scoresView } from '../../hooks/plan/plan'
import { SCORING_JSON, STATUS_JSON } from '../plans'

const status = (over: Record<string, unknown> = {}): string => JSON.stringify({ ...JSON.parse(STATUS_JSON), ...over })
const scoring = (over: Record<string, unknown> = {}): string => JSON.stringify({ ...JSON.parse(SCORING_JSON), ...over })
const task = (over: Record<string, unknown>) => ({ id: '9', title: 'T', status: 'todo', estimateMin: null, startedAt: null, doneAt: null, ...over })
const NOW = Date.parse('2026-11-13T11:45Z')

test('status.json reads as a plan: titles, ids, times to the minute, todo as pending', () => {
  const plan = parseAlfredStatus(STATUS_JSON)
  expect(plan).toMatchObject({ title: 'Waste bin (plannings)', updatedAt: Date.parse('2026-11-13T11:40:00Z'), changes: [] })
  expect(plan?.approvedAt).toBe(Date.parse('2026-11-13T09:55:00Z'))
  expect(plan?.completedAt).toBeNull()
  expect(plan?.steps).toEqual([
    { id: '1', title: 'Menu tile and its icon', status: 'blocked', estimateMin: 45, startedAt: Date.parse('2026-11-13T10:12:00Z'), doneAt: null },
    { id: '2', title: 'Load the deleted plannings', status: 'done', estimateMin: 80, startedAt: Date.parse('2026-11-13T10:40:00Z'), doneAt: Date.parse('2026-11-13T11:35:00Z') },
    { id: '3', title: 'Restore deleted plan books', status: 'in_progress', estimateMin: 105, startedAt: Date.parse('2026-11-13T11:36:00Z'), doneAt: null },
    { id: '4', title: 'SignalR load and restore', status: 'pending', estimateMin: 60, startedAt: null, doneAt: null },
  ])
})

test('status.json: an unknown schema, a missing title or task list, or a task out of contract fails the whole file', () => {
  expect(parseAlfredStatus('{"schema":1,"title":"Wa')).toBeNull()
  for (const over of [{ schema: 2 }, { schema: '1' }, { title: 7 }, { title: '' }, { tasks: [] }, { tasks: 'x' }]) {
    expect(parseAlfredStatus(status(over))).toBeNull()
  }
  for (const bad of [{ status: 'pending' }, { status: 'DONE' }, { id: '' }, { id: 3 }, { title: null }, { estimateMin: -5 }, { estimateMin: 2.5 }]) {
    expect(parseAlfredStatus(status({ tasks: [task(bad)] }))).toBeNull()
  }
  // Other fields are ignored, and an estimate may be null
  expect(parseAlfredStatus(status({ gate: 'passed', tasks: [task({ extra: 1 })] }))?.steps[0]).toMatchObject({ id: '9', estimateMin: null })
})

test('a plan not yet approved is awaiting approval; a completed plan is finished whatever its tasks say', () => {
  const awaiting = parseAlfredStatus(status({ approvedAt: null }))
  expect(awaiting !== null && planView(awaiting, {}, 0, {}, NOW).isAwaiting).toBe(true)
  const approved = parseAlfredStatus(STATUS_JSON)
  expect(approved !== null && planView(approved, {}, 0, {}, NOW)).toMatchObject({ isAwaiting: false, isFinished: false, finished: 1, total: 4 })
  const closed = parseAlfredStatus(status({ completedAt: '2026-11-13T12:00Z' }))
  expect(closed !== null && planView(closed, {}, 0, {}, NOW).isFinished).toBe(true)
})

test('scoring.json reads as the plan\'s scores, the severity counts per round kept', () => {
  const s = parseAlfredScoring(SCORING_JSON, 'waste-bin')
  expect(s).toMatchObject({ subject: { kind: 'plan', ref: 'waste-bin' }, scale: 100, released: 2, updatedAt: Date.parse('2026-11-13T11:13:00Z') })
  expect(s?.rounds.map(r => r.total)).toEqual([72, 85, 82])
  expect(s?.rounds[0]?.counts).toEqual({ BLOCKER: 1, MATERIAL: 3, MINOR: 2 })
})

test('scoring.json: an unknown schema, no scale, a bad round or a released round that is not there fails the file', () => {
  expect(parseAlfredScoring('{"schema":1', 'p')).toBeNull()
  for (const over of [{ schema: 2 }, { scale: 0 }, { scale: '100' }, { rounds: 'x' }, { released: 9 }, { released: 1.5 }, { rounds: [{ round: 1, total: 'x' }] }]) {
    expect(parseAlfredScoring(scoring(over), 'p')).toBeNull()
  }
  expect(parseAlfredScoring(scoring({ released: null }), 'p')?.released).toBeNull()
})

test('the score is the released round\'s, its arrow against the round graded just before it', () => {
  const s = parseAlfredScoring(SCORING_JSON, 'p')
  const v = s === null ? null : scoresView(s)
  expect(v).toMatchObject({ shown: { round: 2, total: 85 }, delta: 13, isGrading: false })
  // The counts per severity come from the rounds' own counts
  expect(v?.severities).toEqual([
    { severity: 'BLOCKER', prev: 1, last: 0 }, { severity: 'MATERIAL', prev: 3, last: 1 }, { severity: 'MINOR', prev: 2, last: 2 },
  ])
  const first = parseAlfredScoring(scoring({ released: 1 }), 'p')
  expect(first === null ? null : scoresView(first)).toMatchObject({ shown: { round: 1, total: 72 }, delta: null })
})

test('while grading runs (released null) the score is the newest round\'s, marked as grading', () => {
  const s = parseAlfredScoring(scoring({ released: null }), 'p')
  expect(s === null ? null : scoresView(s)).toMatchObject({ shown: { round: 3, total: 82 }, delta: -3, isGrading: true })
})

// The review's findings (2026-11-13), each reproduced before its fix
test('a plan Alfred Code closed no longer runs, whatever its tasks say', () => {
  const plan = parseAlfredStatus(status({ completedAt: '2026-11-13T12:00Z' }))
  if (plan === null) throw new Error('fixture')
  expect(runs({ name: 'p', mtimeMs: 10, size: 1, value: plan, isInvalid: false, isNamed: true }, 0)).toBe(false)
  expect(runs({ name: 'p', mtimeMs: 10, size: 1, value: plan, isInvalid: false }, 0)).toBe(false)
})

test('the named plan runs once begun even when its file was written before this session began', () => {
  const plan = parseAlfredStatus(STATUS_JSON)
  if (plan === null) throw new Error('fixture')
  expect(runs({ name: 'p', mtimeMs: 10, size: 1, value: plan, isInvalid: false, isNamed: true }, 1000)).toBe(true)
  expect(runs({ name: 'p', mtimeMs: 10, size: 1, value: plan, isInvalid: false }, 1000)).toBe(false)
})
