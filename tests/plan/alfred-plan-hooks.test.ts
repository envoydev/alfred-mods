import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isPlanRunning, shownPlan } from '../../hooks/plan/plan'
import { START, engine, stubAll, watchState } from '../kit'
import type { FileStub } from '../kit'
import { PLAN_JSON, SCORING_JSON, STATUS_JSON } from '../plans'
import type { Plans } from '../../hooks/plan/types'

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

async function start($: Engine, on: On, files: Record<string, FileStub>, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { files, now: 1000, ...o })
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
  const plan = p().planFiles.find(w => w.name === 'waste-bin')
  expect(plan).toMatchObject({ isInvalid: false, value: { title: 'Waste bin (plannings)' } })
  expect(plan?.value?.steps.map(s => s.status)).toEqual(['blocked', 'done', 'in_progress', 'pending'])
  expect(p().scoreFiles.find(w => w.name === 'waste-bin')?.value).toMatchObject({ subject: { kind: 'plan', ref: 'waste-bin' }, released: 2 })
  expect(p().alfredFolder).toEqual({ name: 'waste-bin', folder: FOLDER })
})

test('without the status file\'s plan the folder is never touched, and the project\'s own plans read as before', async ($, on) => {
  const { p, files } = await start($, on, {
    [STATUS]: session(null), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 }, [JSON_PLAN]: { text: PLAN_JSON, mtimeMs: 2 },
  })
  expect(p().planFiles.map(w => w.name)).toEqual(['token-refresh'])
  expect(p().alfredFolder).toBeNull()
  expect([...files.lists, ...files.reads].some(path => path.includes('.alfred/') && !path.includes('.alfred/alfred-mods/'))).toBe(false)
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
  const third = () => p().planFiles.find(w => w.name === 'waste-bin')?.value?.steps[2]?.status
  files.current[PLAN_STATUS] = statusWith({ tasks: JSON.parse(STATUS_JSON).tasks.map((t: { id: string }) => (t.id === '3' ? { ...t, status: 'done', doneAt: '2026-11-13T12:00Z' } : t)) }, 3)
  await clock.advance(30_000)
  expect(third()).toBe('done')
  files.current[PLAN_STATUS] = { text: '{"schema":1,"tit', mtimeMs: 4 }
  await clock.advance(30_000)
  expect(p().planFiles.find(w => w.name === 'waste-bin')).toMatchObject({ isInvalid: true })
  expect(third()).toBe('done')
  files.current[PLAN_STATUS] = statusWith({ schema: 2 }, 5)
  await clock.advance(30_000)
  expect(p().planFiles.find(w => w.name === 'waste-bin')).toMatchObject({ isInvalid: true })
})

// Ten minutes of the mock clock: the Windows runner took 5.0 s on 0.14.1's main run, so it carries its own timeout
test('a plan completed as the status file lets it go stays for 10 minutes, then leaves; one let go unfinished leaves at once', { timeoutMs: 30_000 }, async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[PLAN_STATUS] = statusWith({ completedAt: '2026-11-13T12:00Z' }, 3)
  files.current[STATUS] = session(null)
  await clock.advance(30_000)
  expect(p().alfredFolder).toEqual({ name: 'waste-bin', folder: FOLDER })
  expect(p().finishedAt['waste-bin']).toBeDefined()
  await clock.advance(10 * MIN)
  expect(p().alfredFolder).toBeNull()
  expect(p().planFiles.some(w => w.name === 'waste-bin')).toBe(false)
})

test('a plan the status file lets go unfinished leaves at the next read', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = session(null)
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfredFolder).toBeNull()
  expect(p().planFiles.some(w => w.name === 'waste-bin')).toBe(false)
})

test('a status file that will not read keeps the named plan; only a readable file letting it go drops it', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = { text: '{"schema":1,"sess', mtimeMs: 3 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfredFolder).toEqual({ name: 'waste-bin', folder: FOLDER })
  files.current[STATUS] = { text: JSON.stringify({ ...JSON.parse(session(FOLDER).text), plan: '../x' }), mtimeMs: 4 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().alfredFolder).toEqual({ name: 'waste-bin', folder: FOLDER })
})

test('a switch to another plan folder never shows the old plan under the new name', async ($, on) => {
  const OTHER = '.alfred/docs/work/plans/other'
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } })
  files.current[STATUS] = session(OTHER)
  files.current[`${OTHER}/status.json`] = { text: '{"schema":1,"tit', mtimeMs: 5 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  const other = p().planFiles.find(w => w.name === 'other')
  expect(other === undefined || other.value === null).toBe(true)
})

// A plan of the project's own folder that shares the plan folder's name (the review's deferred minor, 2026-11-13)
const OWN_SAME = '.claude/session-inspector/plans/waste-bin.json'
const ownSame = (status: string): FileStub => ({
  text: JSON.stringify({ version: 1, title: 'Own plan', updatedAt: '2026-11-13T10:00:00Z', steps: [{ id: 'S1', title: 'One', status }] }), mtimeMs: 2,
})

test('a plan of the project\'s own folder with the same name stays while the named folder has no status.json', async ($, on) => {
  const { p } = await start($, on, { [STATUS]: session(FOLDER), [OWN_SAME]: ownSame('in_progress') })
  expect(p().planFiles.find(w => w.name === 'waste-bin')?.value?.title).toBe('Own plan')
  expect(p().alfredFolder).toBeNull()
})

test('the first read of a named folder never takes the same-named own plan as its last state', async ($, on) => {
  const { p, files, clock, toasts } = await start($, on, { [STATUS]: session(null), [OWN_SAME]: ownSame('in_progress') })
  files.current[STATUS] = session(FOLDER)
  files.current[PLAN_STATUS] = statusWith({ completedAt: '2026-11-13T12:00Z' }, 3)
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(p().planFiles.find(w => w.name === 'waste-bin')?.value?.title).toBe('Waste bin (plannings)')
  expect(toasts.some(t => t.startsWith('Plan done'))).toBe(false)
})

// plansFolder `.alfred` (the user's ruling, 2026-11-25): every plan folder of Alfred Code's is read, named or not
const ALFRED_CHOSEN = { sources: { project: { 'alfred-mods': { plansFolder: '.alfred' } } } }
const planAt = (name: string, mtimeMs: number): Record<string, FileStub> =>
  ({ [`.alfred/docs/work/plans/${name}/status.json`]: statusWith({ title: name }, mtimeMs) })

test('with plansFolder .alfred every plan folder under .alfred/docs/work/plans is read, with its scores', async ($, on) => {
  const { p } = await start($, on, {
    ...planAt('first', 2), ...planAt('second', 3), [`.alfred/docs/work/plans/second/scoring.json`]: { text: SCORING_JSON, mtimeMs: 3 },
    '.alfred/docs/work/plans/empty/empty.md': { text: '# x', mtimeMs: 1 },
  }, ALFRED_CHOSEN)
  expect(p().planFiles.map(w => w.name).sort()).toEqual(['first', 'second'])
  expect(p().planFiles.find(w => w.name === 'second')?.value?.title).toBe('second')
  expect(p().scoreFiles.map(w => w.name)).toEqual(['second'])
  expect(p().alfredFolder).toBeNull()
})

test("Alfred Code's plan stands in for a same-named file of the mod's own folder, and the others stay", async ($, on) => {
  const own = { text: PLAN_JSON, mtimeMs: 9 }
  const { p } = await start($, on, { ...planAt('shared', 2), '.alfred/alfred-mods/plans/shared.json': own, '.alfred/alfred-mods/plans/kit.json': own }, ALFRED_CHOSEN)
  expect(p().planFiles.map(w => w.name).sort()).toEqual(['kit', 'shared'])
  expect(p().planFiles.find(w => w.name === 'shared')?.value?.title).toBe('shared')
})

test('the plan the status file names is listed once, named, beside the others', async ($, on) => {
  const { p } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 }, ...planAt('first', 3) }, ALFRED_CHOSEN)
  expect(p().planFiles.map(w => w.name).sort()).toEqual(['first', 'waste-bin'])
  expect(p().planFiles.find(w => w.name === 'waste-bin')?.isNamed).toBe(true)
})

test('only the 20 plans written last are read', async ($, on) => {
  const many = Object.assign({}, ...Array.from({ length: 23 }, (_, i) => planAt(`p${String(i).padStart(2, '0')}`, i + 1))) as Record<string, FileStub>
  const { p, files } = await start($, on, many, ALFRED_CHOSEN)
  expect(p().planFiles).toHaveLength(20)
  expect(p().planFiles.some(w => w.name === 'p00' || w.name === 'p02')).toBe(false)
  expect(files.reads.some(path => path.includes('/p00/'))).toBe(false)
})

test('with another plansFolder no plan folder of Alfred Code is listed', async ($, on) => {
  const { p, files } = await start($, on, planAt('first', 2))
  expect(p().planFiles).toEqual([])
  expect(files.lists.some(path => path.endsWith('.alfred/docs/work/plans'))).toBe(false)
})

test('with .alfred, a plan the status file lets go unfinished is no longer named, so it stops counting as running', async ($, on) => {
  const { p, files, clock } = await start($, on, { [STATUS]: session(FOLDER), [PLAN_STATUS]: { text: STATUS_JSON, mtimeMs: 2 } }, ALFRED_CHOSEN)
  expect(p().planFiles.find(w => w.name === 'waste-bin')?.isNamed).toBe(true)
  files.current[STATUS] = session(null)
  await clock.advance(30_000)
  await clock.advance(30_000)
  const letGo = p().planFiles.find(w => w.name === 'waste-bin')
  expect(p().alfredFolder).toBeNull()
  expect(letGo?.isNamed).not.toBe(true)
  expect(isPlanRunning(letGo as NonNullable<typeof letGo>, p().watchedSince)).toBe(false)
})

test("an Alfred Code plan that replaces a same-named file of the mod's folder says nothing of the old one: no toast", async ($, on) => {
  const open = { text: PLAN_JSON, mtimeMs: 2 }
  const { p, files, clock, toasts } = await start($, on, { '.alfred/alfred-mods/plans/login.json': open }, ALFRED_CHOSEN)
  files.current['.alfred/docs/work/plans/login/status.json'] = statusWith({ title: 'login', completedAt: '2026-11-13T12:00Z' }, 3)
  await clock.advance(30_000)
  expect(p().planFiles.find(w => w.name === 'login')?.value?.title).toBe('login')
  expect(toasts).toEqual([])
  expect(p().finishedAt.login).toBeUndefined()
})
