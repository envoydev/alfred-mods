import { expect, test } from 'claude-code/testing'

import { runs, shownPlan } from '../hooks/plan.ts'
import { PRESENTATION, SPAWN, START, engine, spawns, stubAll, watchState } from './kit.ts'
import { PLAN_JSON, SCORES_JSON, planText } from './plans.ts'
import type { Credit, Plans, TaskItem } from '../types'

const PLAN_PATH = '.claude/session-inspector/plans/token-refresh.json'
const SCORES_PATH = '.claude/session-inspector/scores/token-refresh.json'

const ALL_DONE = { S4: 'done', S5: 'done' }

const plansOf = (state: { get(key: string): unknown }): Plans => state.get('plans') as Plans
const s4 = (state: { get(key: string): unknown }): string | undefined => plansOf(state).plans[0]?.value?.steps[3]?.status

test('the plan and scores files are read at the start', async ($, on) => {
  const { clock } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 }, [SCORES_PATH]: { text: SCORES_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  await clock.advance(300)

  const p = plansOf(state)
  expect(p.plans[0]).toMatchObject({ name: 'token-refresh', isInvalid: false })
  expect(p.plans[0]?.value?.steps).toHaveLength(5)
  expect(p.scores[0]?.value?.rounds).toHaveLength(2)
})

test('a Write is followed by a read within 300 ms', async ($, on) => {
  const { clock, files } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  files.current[PLAN_PATH] = { text: planText({ S4: 'done' }), mtimeMs: 2 }
  await $.tool.call({ tool: 'Write', file_path: PLAN_PATH, content: '' })
  await clock.advance(299)
  expect(s4(state)).toBe('in_progress')
  await clock.advance(1)
  expect(s4(state)).toBe('done')
})

test('a change from outside is read within 30 s', async ($, on) => {
  const { clock, files } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  files.current[PLAN_PATH] = { text: planText({ S4: 'done' }), mtimeMs: 2 }
  await clock.advance(29_699)
  expect(s4(state)).toBe('in_progress')
  await clock.advance(1)
  expect(s4(state)).toBe('done')
})

test('a cut read keeps the last good plan, and the next read recovers', async ($, on) => {
  const { clock, files } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  files.current[PLAN_PATH] = { text: '{"version":1,"title":"Tok', mtimeMs: 2 }
  await clock.advance(30_000)
  expect(plansOf(state).plans[0]).toMatchObject({ isInvalid: true })
  expect(s4(state)).toBe('in_progress')
  files.current[PLAN_PATH] = { text: planText({ S4: 'done' }), mtimeMs: 3 }
  await clock.advance(30_000)
  expect(plansOf(state).plans[0]).toMatchObject({ isInvalid: false })
  expect(s4(state)).toBe('done')
})

test('a file over 4 MiB is invalid without a read', async ($, on) => {
  const { clock, files } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1, size: 4_194_305 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  expect(plansOf(state).plans[0]).toMatchObject({ isInvalid: true, value: null })
  expect(files.reads).not.toContain(PLAN_PATH)
})

test('a removed plan file leaves the view', async ($, on) => {
  const { clock, files } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  expect(plansOf(state).plans).toHaveLength(1)

  delete files.current[PLAN_PATH]
  await clock.advance(30_000)
  expect(plansOf(state).plans).toEqual([])
})

test('a note integrated after the first read is toasted once', async ($, on) => {
  const { clock, files, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  expect(toasts).toEqual([])

  const note = { at: '2026-10-27T14:28:00Z', kind: 'integrated', step: 'S4', source: 'user', note: 'Retry once on a 401' }
  files.current[PLAN_PATH] = { text: planText({}, [note]), mtimeMs: 2 }
  await clock.advance(30_000)
  await clock.advance(30_000)
  expect(toasts).toEqual(["✎ Note folded into S4: 'Retry once on a 401'"])
})

test("a plan's first finish is toasted", async ($, on) => {
  const { clock, files, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  files.current[PLAN_PATH] = { text: planText(ALL_DONE), mtimeMs: 2 }
  await clock.advance(30_000)
  expect(toasts).toEqual(['Plan done: Token refresh in <1m'])
  expect(plansOf(state).finished['token-refresh']).toBe(30_000)
  files.current[PLAN_PATH] = { text: planText(ALL_DONE), mtimeMs: 3 }
  await clock.advance(30_000)
  expect(toasts).toHaveLength(1)
})

test('a plan already finished at the first read raises nothing', async ($, on) => {
  const { clock, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: planText(ALL_DONE), mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  expect(toasts).toEqual([])
  expect(plansOf(state).finished).toEqual({})
  expect(plansOf(state).toasted).toContain('done:token-refresh')
})

test('a missing folder reads as empty, and nothing is written there', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  expect(plansOf(state).plans).toEqual([])
  expect(plansOf(state).scores).toEqual([])
})

test('only a plan written this session runs, and a reload keeps when the session began', async ($, on) => {
  const { clock, files } = stubAll(on, { now: 10_000, files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 5_000 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  const shown = () => plansOf(state).plans[0]
  expect(plansOf(state).since).toBe(10_000)
  expect(runs(shown()!, plansOf(state).since)).toBe(false)

  files.current[PLAN_PATH] = { text: PLAN_JSON, mtimeMs: 12_000 }
  await $.tool.call({ tool: 'Write', file_path: PLAN_PATH, content: '' })
  await clock.advance(300)
  expect(runs(shown()!, plansOf(state).since)).toBe(true)
  await clock.set(20_000)
  await $.session.start(START)
  expect(plansOf(state).since).toBe(10_000)
})

test('after /clear a plan from before it stays out, and one written after runs', async ($, on) => {
  const { clock, files } = stubAll(on, { now: 10_000, files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 12_000 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  expect(runs(plansOf(state).plans[0]!, plansOf(state).since)).toBe(true)

  await clock.set(20_000)
  await $.classic.SessionStart({ source: 'clear' })
  expect(plansOf(state).since).toBe(20_000)
  expect(state.get('credit')).toEqual({ slices: {}, mine: {} })
  await clock.advance(300)
  expect(runs(plansOf(state).plans[0]!, plansOf(state).since)).toBe(false)
  files.current[PLAN_PATH] = { text: PLAN_JSON, mtimeMs: 25_000 }
  await clock.set(25_000)
  await $.tool.call({ tool: 'Write', file_path: PLAN_PATH, content: '' })
  await clock.advance(300)
  expect(runs(plansOf(state).plans[0]!, plansOf(state).since)).toBe(true)
})

// Task 6: crediting working time. The plan runs (written after the start at 0) with S4 in progress.
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })
const NAMED = (task: string) => `Build it.\nplan: token-refresh\ntask: ${task}`
const S4_KEY = 'step:token-refresh:S4:s1'
const S5_KEY = 'step:token-refresh:S5:s1'
const OVERHEAD_KEY = 'overhead:token-refresh:s1'
const msAt = (store: { get(key: string): unknown }, key: string): number | undefined => (store.get(key) as { ms: number } | undefined)?.ms
const timeKeys = (store: { keys(): string[] }): string[] => store.keys().filter(k => k.startsWith('step:') || k.startsWith('overhead:'))

test("a main turn's time goes to the running step", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)

  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(121_000)
  await $.turn.complete(complete('t1'))

  expect(store.get(S4_KEY)).toEqual({ ms: 120_000, isShared: false, at: 121_000 })
  expect(plansOf(state).times['token-refresh']?.S4?.ms).toBe(120_000)
})

test('an AskUserQuestion call is left out', async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['tool.call'])
  on('tool.call', async () => {
    await clock.advance(50_000)
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.set(121_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(70_000)
})

test("a call nobody was asked about keeps its whole time", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['tool.call'])
  on('tool.call', async () => {
    await clock.advance(40_000)
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.set(121_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(120_000)
})

test("a declined prompt's whole wait is left out", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['tool.call'])
  // No hook answers the request, so the person is asked; the kit's refusal stands for their No, 40 s later
  on('tool.check', async () => {
    await clock.advance(40_000)
    return { decision: 'ask' as const }
  })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'rm notes.txt' })
  await clock.set(121_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(80_000)
})

test("a named agent's turn credits its step, and the main loop's time is overhead meanwhile", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, prompt: NAMED('S5') })
  await $.turn.start({ text: '', turnId: 'x1', agentId: 'a1' })
  await clock.set(61_000)
  await $.turn.complete(complete('x1', { agentId: 'a1' }))
  await clock.set(91_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S5_KEY)).toBe(60_000)
  expect(msAt(store, OVERHEAD_KEY)).toBe(90_000)
  expect(store.get(S4_KEY)).toBe(undefined)

  // The next main turn has no agent live: its time goes to the running step
  await clock.set(101_000)
  await $.turn.start({ text: 'next', turnId: 't2' })
  await clock.set(131_000)
  await $.turn.complete(complete('t2'))
  expect(msAt(store, S4_KEY)).toBe(30_000)
  expect(msAt(store, OVERHEAD_KEY)).toBe(90_000)
})

test("an agent's turn that starts before its spawn resolves is still credited", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: '', turnId: 'x1', agentId: 'a1' })
  await clock.set(1005)
  await $.agent.spawn({ ...SPAWN, prompt: NAMED('S5') })
  await clock.set(61_000)
  await $.turn.complete(complete('x1', { agentId: 'a1' }))
  expect(msAt(store, S5_KEY)).toBe(60_000)

  // A loop whose spawn never resolves credits nothing
  await $.turn.start({ text: '', turnId: 'z1', agentId: 'zz' })
  await clock.set(91_000)
  await $.turn.complete(complete('z1', { agentId: 'zz' }))
  expect(timeKeys(store)).toEqual([S5_KEY])
})

test('an Agent call the main loop waits inside is not counted twice', async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['tool.call'])
  on('tool.call', async () => {
    await clock.advance(30_000)
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'look', subagent_type: 'Explore' })
  await clock.set(91_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(60_000)
})

test('time before a status change goes to the step that was running', async ($, on) => {
  const { clock, files, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(60_700)
  files.current[PLAN_PATH] = { text: planText({ S4: 'done', S5: 'in_progress' }), mtimeMs: 60_700 }
  await $.tool.call({ tool: 'Write', file_path: PLAN_PATH, content: '' })
  await clock.set(61_000)
  await clock.set(101_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(60_000)
  expect(msAt(store, S5_KEY)).toBe(40_000)
})

test("a status change and a turn's end at once count the turn once", async ($, on) => {
  const { clock, files, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(100_700)
  files.current[PLAN_PATH] = { text: planText({ S4: 'done', S5: 'in_progress' }), mtimeMs: 100_700 }
  await $.tool.call({ tool: 'Write', file_path: PLAN_PATH, content: '' })
  // The reload's timer fires at 101_000 and its read is still running when the turn ends at the same time
  await clock.set(101_000)
  await $.turn.complete(complete('t1'))
  await clock.advance(1)

  expect(((msAt(store, S4_KEY)) ?? 0) + ((msAt(store, S5_KEY)) ?? 0)).toBe(100_000)
  expect((state.get('credit') as Credit).slices.main).toBe(undefined)
})

test('two agents naming one step both add up', async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['agent.spawn'])
  spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' } })
  await $.session.start(START)
  await clock.set(1000)
  await $.agent.spawn({ ...SPAWN, description: 'one', prompt: NAMED('S5') })
  await $.agent.spawn({ ...SPAWN, description: 'two', prompt: NAMED('S5') })
  await $.turn.start({ text: '', turnId: 'x1', agentId: 'a1' })
  await clock.set(31_000)
  await $.turn.start({ text: '', turnId: 'x2', agentId: 'a2' })
  await clock.set(61_000)
  await Promise.all([$.turn.complete(complete('x1', { agentId: 'a1' })), $.turn.complete(complete('x2', { agentId: 'a2' }))])

  expect(msAt(store, S5_KEY)).toBe(90_000)
})

test('a plan not written this session takes no time', async ($, on) => {
  const { clock, store } = stubAll(on, { now: 10_000, files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 5_000 } } })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.advance(60_000)
  await $.turn.complete(complete('t1'))

  expect(timeKeys(store)).toEqual([])
})

test('a session resumed under its own id keeps its stored step time', async ($, on) => {
  const { clock, store } = stubAll(on, {
    files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } }, store: { [S4_KEY]: { ms: 300_000, isShared: false, at: 0 } },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(61_000)
  await $.turn.complete(complete('t1'))

  expect(msAt(store, S4_KEY)).toBe(360_000)
  expect(plansOf(state).times['token-refresh']?.S4?.ms).toBe(360_000)
})

test('idle time between turns never counts', async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(11_000)
  await $.turn.complete(complete('t1'))
  await clock.set(611_000)
  await $.turn.start({ text: 'r', turnId: 't2' })
  await clock.set(621_000)
  await $.turn.complete(complete('t2'))

  expect(msAt(store, S4_KEY)).toBe(20_000)
})

test('stale time keys are pruned at the start', async ($, on) => {
  const DAY = 86_400_000
  const { store } = stubAll(on, {
    now: 100 * DAY,
    store: { 'step:old:S1:s0': { ms: 1, isShared: false, at: 69 * DAY }, 'step:old:S1:s9': { ms: 1, isShared: false, at: 71 * DAY } },
  })
  engine(on)
  await $.session.start(START)

  expect(store.keys()).toEqual(['step:old:S1:s9'])
})

// Task 7: the task-list fallback
const taskTools = (on: Parameters<typeof engine>[0]) =>
  on('tool.call', (_, e) => (e.tool === 'TaskCreate'
    ? { result: { task: { id: '1', subject: 'Write tests' } }, text: 'Task #1 created' }
    : { result: 'ok', text: 'ok' }))
const tasksOf = (state: { get(key: string): unknown }): TaskItem[] => (state.get('tasks') as TaskItem[] | undefined) ?? []

test('TaskCreate and TaskUpdate keep the task list', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  taskTools(on)
  await $.session.start(START)

  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  expect(tasksOf(state)).toEqual([{ id: '1', subject: 'Write tests', status: 'in_progress', ms: 0 }])
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'deleted' })
  expect(tasksOf(state)).toEqual([])
})

test("TodoWrite replaces the list and keeps a subject's time", async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content })

  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'in_progress'), todo('B', 'pending')] })
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.set(61_000)
  await $.turn.complete(complete('t1'))
  expect(tasksOf(state)[0]?.ms).toBe(60_000)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'in_progress')] })
  expect(tasksOf(state)).toEqual([{ id: '0', subject: 'A', status: 'completed', ms: 60_000 }, { id: '1', subject: 'B', status: 'in_progress', ms: 0 }])
})

test('a task status change inside a turn credits the time before it to the item that was in progress', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content })

  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'in_progress'), todo('B', 'pending')] })
  await clock.set(60_000)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'in_progress')] })
  await clock.set(100_000)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'completed')] })
  await clock.set(110_000)
  await $.turn.complete(complete('t1'))
  expect(tasksOf(state).map(t => t.ms)).toEqual([60_000, 40_000])
})

test("an agent's task call is not the session's task list", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  taskTools(on)
  await $.session.start(START)
  await $.agent.spawn(SPAWN)

  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'd', agentId: 'a1' })
  expect(tasksOf(state)).toEqual([])
})

test("with a plan file shown, the main loop's time goes to the plan, not the tasks", async ($, on) => {
  const { clock, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  const state = watchState(on)
  engine(on, ['tool.call'])
  taskTools(on)
  await $.session.start(START)
  await clock.advance(300)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })

  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.advance(60_000)
  await $.turn.complete(complete('t1'))
  expect(msAt(store, S4_KEY)).toBe(60_000)
  expect(tasksOf(state)[0]?.ms).toBe(0)
})

test('a task list this session shows over a plan left by an earlier session', async ($, on) => {
  const { clock, store } = stubAll(on, { now: 10_000, files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 5_000 } } })
  const state = watchState(on)
  engine(on, ['tool.call'])
  taskTools(on)
  await $.session.start(START)
  await clock.advance(300)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  expect(shownPlan(plansOf(state), null, true)).toBe('tasks')

  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.advance(60_000)
  await $.turn.complete(complete('t1'))
  expect(tasksOf(state)[0]?.ms).toBe(60_000)
  expect(msAt(store, S4_KEY)).toBe(undefined)
})

// The final review's probes: a status change inside an open wait, more than 100 notes, a pin that does not run, and
// control characters in a toast built from a file
test('a status change read while the main loop waits in an Agent call leaves the wait out of both steps', async ($, on) => {
  const { clock, files, store } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on, ['tool.call'])
  on('tool.call', async () => {
    files.current[PLAN_PATH] = { text: planText({ S4: 'done', S5: 'in_progress' }), mtimeMs: 1000 }
    await clock.advance(59_000)
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(START)
  await clock.advance(300)
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'look', subagent_type: 'Explore' } as never)
  await clock.set(61_000)
  await $.turn.complete(complete('t1'))
  expect(msAt(store, S4_KEY) ?? 0).toBe(0)
  expect(msAt(store, 'step:token-refresh:S5:s1')).toBe(1000)
})

test('past 100 notes, no old note is toasted again', async ($, on) => {
  const notes = Array.from({ length: 101 }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 27, 10, i)).toISOString(), kind: 'integrated', step: 'S2', source: 'user', note: `note ${i}` }))
  const { clock, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: planText({}, notes), mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  await clock.advance(60_000)
  expect(toasts).toEqual([])
})

test('two notes on one step with no time each get their toast', async ($, on) => {
  const n = (note: string) => ({ kind: 'integrated', step: 'S4', source: 'user', note })
  const { clock, files, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: planText({}, [n('first')]), mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  files.current[PLAN_PATH] = { text: planText({}, [n('first'), n('second')]), mtimeMs: 2 }
  await clock.advance(30_000)
  expect(toasts).toEqual(["✎ Note folded into S4: 'second'"])
})

test('pinning a plan that does not run keeps this session\'s time on the plan that runs', async ($, on) => {
  const { clock, store } = stubAll(on, {
    now: 10_000,
    files: { '.claude/session-inspector/plans/old.json': { text: PLAN_JSON, mtimeMs: 5_000 }, [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 10_000 } },
  })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  await $.command.run({ command: 'inspect', args: 'plan old', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.advance(60_000)
  await $.turn.complete(complete('t1'))
  expect(msAt(store, S4_KEY)).toBe(60_000)
  expect(msAt(store, 'step:old:S4:s1')).toBe(undefined)
})

test('a toast built from a plan file carries no control character', async ($, on) => {
  const { clock, files, toasts } = stubAll(on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } } })
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  files.current[PLAN_PATH] = { text: planText(ALL_DONE, [], p => { p.title = 'Token \u001b[31mrefresh\u0007' }), mtimeMs: 2 }
  await clock.advance(30_000)
  expect(toasts).toEqual(['Plan done: Token refresh in <1m'])
})
