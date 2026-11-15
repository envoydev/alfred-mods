// The band's ctx and cost follow each request of a running turn: session.measure fires only after a main-thread turn,
// so the main loop's turn.step reads the usage again (spec B)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage, TurnStepInput, TurnStepResult, TurnUsage } from 'claude-code'

import { localDate } from '../../hooks/core/forecast'
import { SPAWN, START, engine, rows, step, stepEngine, stubAll, watchState } from '../kit'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const MAIN_STEP = { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 }
const STEP_USAGE: TurnUsage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
const DAY_KEY = `cost:${localDate(NOW)}:s1`

const band = (isWorking: boolean) =>
  ({ hasSurvey: false, isCollapsed: false, isWorking, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} })

// A reading at this context percent and session cost, the 5h window at 20%
function reading(ctx: number, usd: number): SessionUsage {
  return {
    startedAt: 0,
    context: { window: 200_000, tokens: ctx * 2000, percent: ctx },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }],
    cost: { usd },
  }
}

// A session started at a $0.50 reading and a turn running in it
async function running($: Engine, on: On) {
  const kit = stubAll(on, { usage: reading(10, 0.5), now: NOW })
  const state = watchState(on)
  stepEngine(on, () => STEP_USAGE)
  engine(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  return { ...kit, state }
}

test("a main step brings the band's ctx and cost up to date before the turn ends", async ($, on) => {
  const { usage, state } = await running($, on)
  usage.current = reading(15, 1.29)
  await step($, MAIN_STEP)

  expect(state.get('usage')).toMatchObject({ contextPercent: 15, costUsd: 1.29 })
  const lines = await rows(await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: band(true) }))
  expect(lines.some(l => l.includes('15%') && l.includes('$1.29'))).toBe(true)
})

test("today's cost moves with each main step, and the store is written at the turn's end only", async ($, on) => {
  const { usage, state, store } = await running($, on)
  usage.current = reading(15, 1.29)
  await step($, MAIN_STEP)

  expect(state.get('usage')).toMatchObject({ todayUsd: 0.79 })
  expect(store.get(DAY_KEY)).toBe(undefined)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(store.get(DAY_KEY)).toBe(790_000)
  expect(state.get('usage')).toMatchObject({ todayUsd: 0.79 })
})

test("an agent's step reads no usage: its figures wait for the tick", async ($, on) => {
  const { usage, state } = await running($, on)
  await $.agent.spawn(SPAWN)
  usage.current = reading(15, 1.29)
  await step($, { ...MAIN_STEP, turnId: 'x', model: 'claude-haiku-5-5', agentId: 'a1' })

  expect(state.get('usage')).toMatchObject({ contextPercent: 10, costUsd: 0.5 })
})

// A foreground agent holds the main loop, so no main step fires until it ends: the once-a-second tick reads the usage
// instead, at most every 5 seconds, while a turn runs or an agent is live
test("while an agent works, the tick brings ctx, cost and today up to date every 5 seconds", async ($, on) => {
  const { usage, state, clock } = await running($, on)
  await $.agent.spawn(SPAWN)
  usage.current = reading(15, 1.29)
  await clock.advance(1000)
  expect(state.get('usage')).toMatchObject({ contextPercent: 15, costUsd: 1.29, todayUsd: 0.79 })

  usage.current = reading(18, 1.5)
  await clock.advance(1000)
  expect(state.get('usage')).toMatchObject({ contextPercent: 15, costUsd: 1.29 })
  await clock.advance(4000)
  expect(state.get('usage')).toMatchObject({ contextPercent: 18, costUsd: 1.5, todayUsd: 1 })
})

test("a background agent's spend reaches the band while the main loop is idle", async ($, on) => {
  const { usage, state, clock } = await running($, on)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.agent.spawn({ ...SPAWN, background: true })
  usage.current = reading(15, 1.29)
  await clock.advance(5000)
  expect(state.get('usage')).toMatchObject({ contextPercent: 15, costUsd: 1.29 })
})

test('idle with no agent, the tick reads no usage', async ($, on) => {
  const { usage, state, clock } = await running($, on)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  usage.current = reading(15, 1.29)
  await clock.advance(10_000)
  expect(state.get('usage')).toMatchObject({ contextPercent: 10, costUsd: 0.5 })
})

// The step's own result, as the generator returns it: the kit's stream carries no `result`
async function stepResult($: Engine, e: TurnStepInput): Promise<TurnStepResult> {
  const stream = $.turn.step(e)
  let r = await stream.next()
  while (r.done !== true) r = await stream.next()
  return r.value
}

test('a usage read that fails leaves the step and the figures as they were', async ($, on) => {
  const { usage, state } = await running($, on)
  usage.fail = true
  const result = await stepResult($, MAIN_STEP)

  expect(result.turnId).toBe('t1')
  expect(state.get('usage')).toMatchObject({ contextPercent: 10, costUsd: 0.5 })
})

// Ten seconds before local midnight: another session spent $10 today and $0.25 already past midnight
const EVE = new Date(2026, 9, 28, 23, 59, 50).getTime()
const NIGHT = { [`cost:${localDate(EVE)}:s0`]: 10_000_000, [`cost:${localDate(EVE + 60_000)}:s0`]: 250_000 }

test("today's cost turns over at local midnight while the session is idle", async ($, on) => {
  const { clock } = stubAll(on, { usage: reading(10, 0.5), now: EVE, store: NIGHT })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('usage')).toMatchObject({ todayUsd: 10 })
  await clock.advance(15_000)
  expect(state.get('usage')).toMatchObject({ todayUsd: 0.25 })
})

test("a turn running over midnight adds its steps to the new day's cost", async ($, on) => {
  const { clock, usage } = stubAll(on, { usage: reading(10, 0.5), now: EVE, store: NIGHT })
  const state = watchState(on)
  stepEngine(on, () => STEP_USAGE)
  engine(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await clock.advance(15_000)
  usage.current = reading(15, 1.29)
  await step($, MAIN_STEP)
  expect(Math.round((state.get('usage') as { todayUsd: number }).todayUsd * 100)).toBe(104)
})
