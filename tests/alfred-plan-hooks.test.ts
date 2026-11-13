import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shownPlan } from '../hooks/plan.js'
import type { Plans } from '../types'
import { START, engine, stubAll, watchState } from './kit.js'
import type { FileStub } from './kit.js'
import { PLAN_JSON, SCORING_JSON, STATUS_JSON } from './plans.js'

// The plan folder the Alfred Code status file names (alfred-code's plan folder contract, the user's ruling of
// 2026-11-13): read only through that field, so a project without Alfred Code reads exactly what it read before
const STATUS = '.claude/session-inspector/status/s1.json'
const FOLDER = '.alfred/docs/work/plans/waste-bin'
const PLAN_STATUS = `${FOLDER}/status.json`
const PLAN_SCORING = `${FOLDER}/scoring.json`
const JSON_PLAN = '.claude/session-inspector/plans/token-refresh.json'
const MIN = 60_000

const session = (plan: string | null): FileStub => ({
  text: JSON.stringify({ schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-11-13T11:40:00Z', scorer: { on: true, level: 80, rounds: 3 }, plan }),
  mtimeMs: 1,
})
const statusWith = (over: Record<string, unknown>, mtimeMs = 2): FileStub => ({ text: JSON.stringify({ ...JSON.parse(STATUS_JSON), ...over }), mtimeMs })

async function start($: Engine, on: On, files: Record<string, FileStub>) {
  const kit = stubAll(on, { files, now: 1000 })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  return { ...kit, p: (): Plans => state.get('plans') as Plans }
}

test('the folder the status file names is read: its status.json as a plan, its scoring.json as that plan\'s scores', async ($, on) => {
  const { p } = await start($, on, {
    [STATUS]: session(`${FOLDER}/`), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 }, [PLAN_SCORING]: { text: SCORING_JSON, mtimeMs: 2 },
  })
  const plan = p().plans.find(w => w.name === 'waste-bin')
  expect(plan).toMatchObject({ isInvalid: false, value: { title: 'Waste bin (plannings)' } })
  expect(plan?.value?.steps.map(s => s.status)).toEqual(['blocked', 'done', 'in_progress', 'pending'])
  expect(p().scores.find(w => w.name === 'waste-bin')?.value).toMatchObject({ subject: { kind: 'plan', ref: 'waste-bin' }, released: 2 })
  expect(p().alfred).toEqual({ name: 'waste-bin', folder: FOLDER })
})

test('without the status file\'s plan the folder is never touched, and the project\'s own plans read as before', async ($, on) => {
  const { p, files } = await start($, on, {
    [STATUS]: session(null), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 }, [JSON_PLAN]: { text: PLAN_JSON, mtimeMs: 2 },
  })
  expect(p().plans.map(w => w.name)).toEqual(['token-refresh'])
  expect(p().alfred).toBeNull()
  expect([...files.lists, ...files.reads].some(path => path.includes('.alfred'))).toBe(false)
})

test('the named plan is shown first, over a running plan of the project\'s own folder and over the task list', async ($, on) => {
  const { p } = await start($, on, {
    [STATUS]: session(FOLDER), [PLAN_STATUS]: statusWith({ approvedAt: null, tasks: [{ id: '1', title: 'T', status: 'todo', estimateMin: null, startedAt: null, doneAt: null }] }),
    [JSON_PLAN]: { text: PLAN_JSON, mtimeMs: 5000 },
  })
  const shown = shownPlan(p(), null, true)
  expect(shown !== 'tasks' && shown?.name).toBe('waste-bin')
  // A pinned plan still wins
  const pinned = shownPlan(p(), 'token-refresh', true)
  expect(pinned !== 'tasks' && pinned?.name).toBe('token-refresh')
})

test('a change Alfred Code writes is read on the 30-second poll; a file that will not parse keeps the last good read', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  const third = () => p().plans.find(w => w.name === 'waste-bin')?.value?.steps[2]?.status
  files.current[PLAN_STATUS] = statusWith({ tasks: JSON.parse(STATUS_JSON).tasks.map((t: { id: string }) => (t.id === '3' ? { ...t, status: 'done', doneAt: '2026-11-13T12:00Z' } : t)) }, 3)
  await clock.advance(30_000)
  expect(third()).toBe('done')
  files.current[PLAN_STATUS] = { text: '{"schema":1,"tit', mtimeMs: 4 }
  await clock.advance(30_000)
  expect(p().plans.find(w => w.name === 'waste-bin')).toMatchObject({ isInvalid: true })
  expect(third()).toBe('done')
  files.current[PLAN_STATUS] = statusWith({ schema: 2 }, 5)
  await clock.advance(30_000)
  expect(p().plans.find(w => w.name === 'waste-bin')).toMatchObject({ isInvalid: true })
})

test('a plan completed as the status file lets it go stays for 10 minutes, then leaves; one let go unfinished leaves at once', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[PLAN_STATUS] = statusWith({ completedAt: '2026-11-13T12:00Z' }, 3)
  files.current[STATUS] = session(null)
  await clock.advance(30_000)
  expect(p().alfred).toEqual({ name: 'waste-bin', folder: FOLDER })
  expect(p().finished['waste-bin']).toBeDefined()
  await clock.advance(10 * MIN)
  expect(p().alfred).toBeNull()
  expect(p().plans.some(w => w.name === 'waste-bin')).toBe(false)
})

test('a plan the status file lets go unfinished leaves at the next read', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = session(null)
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfred).toBeNull()
  expect(p().plans.some(w => w.name === 'waste-bin')).toBe(false)
})

test('a status file that will not read keeps the named plan; only a readable file letting it go drops it', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = { text: '{"schema":1,"sess', mtimeMs: 3 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfred).toEqual({ name: 'waste-bin', folder: FOLDER })
  files.current[STATUS] = { text: JSON.stringify({ ...JSON.parse(session(FOLDER).text), plan: '../x' }), mtimeMs: 4 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfred).toEqual({ name: 'waste-bin', folder: FOLDER })
})

test('a switch to another plan folder never shows the old plan under the new name', async ($, on) => {
  const OTHER = '.alfred/docs/work/plans/other'
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = session(OTHER)
  files.current[`${OTHER}/status.json`] = { text: '{"schema":1,"tit', mtimeMs: 5 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  const other = p().plans.find(w => w.name === 'other')
  expect(other === undefined || other.value === null).toBe(true)
})

// A plan of the project's own folder that shares the plan folder's name (the review's deferred minor, 2026-11-13)
const OWN_SAME = '.claude/session-inspector/plans/waste-bin.json'
const ownSame = (status: string): FileStub => ({
  text: JSON.stringify({ version: 1, title: 'Own plan', updatedAt: '2026-11-13T10:00:00Z', steps: [{ id: 'S1', title: 'One', status }] }), mtimeMs: 2,
})

test('a plan of the project\'s own folder with the same name stays while the named folder has no status.json', async ($, on) => {
  const { p } = await start($, on, { [STATUS]: session(FOLDER), [OWN_SAME]: ownSame('in_progress') })
  expect(p().plans.find(w => w.name === 'waste-bin')?.value?.title).toBe('Own plan')
  expect(p().alfred).toBeNull()
})

test('the first read of a named folder never takes the same-named own plan as its last state', async ($, on) => {
  const { p, files, clock, toasts } = await start($, on, { [STATUS]: session(null), [OWN_SAME]: ownSame('in_progress') })
  files.current[STATUS] = session(FOLDER)
  files.current[PLAN_STATUS] = statusWith({ completedAt: '2026-11-13T12:00Z' }, 3)
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().plans.find(w => w.name === 'waste-bin')?.value?.title).toBe('Waste bin (plannings)')
  expect(toasts.some(t => t.startsWith('Plan done'))).toBe(false)
})
