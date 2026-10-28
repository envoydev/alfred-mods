import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { localDate } from '../hooks/forecast.ts'
import { when } from '../hooks/format.ts'
import { PRESENTATION, SPAWN, START, engine, stubAll, watchState } from './kit.ts'
import type { Meta, Totals, Turn, Usage } from '../types'

const USAGE = {
  input_tokens: 2, output_tokens: 254, cache_read_input_tokens: 33603, cache_creation_input_tokens: 34287, model: 'claude-sonnet-5-5',
}
const READING: SessionUsage = { startedAt: 0, context: { window: 200_000, tokens: 90_000, percent: 45 }, rateLimits: [], cost: { usd: 0.2 } }
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })

test('a turn records prompt and reply times, tokens and its tool calls', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await clock.set(1000)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.set(4000)
  await $.turn.complete({ ...complete('t1'), usage: USAGE })

  expect((state.get('turns') as Turn[])[0]).toMatchObject({ n: 1, promptAt: 0, replyAt: 4000, tokensIn: 67892, tokensOut: 254, tools: 1, failures: 0, contextPercent: 45, end: 'answer' })
})

test('a task notification is not your prompt', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' } })
  await clock.set(1000)
  await $.turn.start({ text: 'done', turnId: 't1' })
  await $.turn.complete(complete('t1'))

  expect((state.get('turns') as Turn[])[0]?.promptAt).toBeNull()
})

test("an agent's turn adds to totals and not to the timeline", async ($, on) => {
  stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.agent.spawn(SPAWN)
  await $.turn.complete({ ...complete('a-turn'), agentId: 'a1', usage: USAGE })

  expect(state.get('totals')).toMatchObject({ input: 67892, output: 254, cacheRead: 33603, cacheWrite: 34287 })
  expect(state.get('turns')).toBeUndefined()
})

test('the 5h window toasts once at 75 and once at 90', async ($, on) => {
  const { toasts } = stubAll(on, { usage: READING })
  engine(on)

  for (const percentUsed of [70, 76, 80, 91]) {
    await $.session.measure({
      context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: '2026-10-28T17:00:00Z' }], changed: ['rateLimits'],
    })
  }

  expect(toasts).toHaveLength(2)
  const reset = when(Date.parse('2026-10-28T17:00:00Z'))
  expect(toasts).toEqual([`5h limit at 75%, resets ${reset}`, `5h limit at 90%, resets ${reset}`])
})

// The window's band name and the band's date form (the user, 2026-10-28)
test('the 7d window toasts as 7d with its reset date', async ($, on) => {
  const { toasts } = stubAll(on, { usage: READING })
  engine(on)

  for (const percentUsed of [70, 76]) {
    await $.session.measure({
      context: { window: 200_000 }, rateLimits: [{ kind: 'seven_day', percentUsed, resetsAt: '2026-10-31T09:00:00Z' }], changed: ['rateLimits'],
    })
  }

  expect(toasts).toEqual([`7d limit at 75%, resets ${when(Date.parse('2026-10-31T09:00:00Z'))}`])
})

test('a precompute or skipped compaction is not counted', async ($, on) => {
  stubAll(on, { usage: READING })
  const state = watchState(on)
  // Registered before the engine's general answer, so it answers the auto compaction first
  on('session.compact', { trigger: 'auto' }, () => ({ skip: 'nothing to compact' }))
  engine(on)
  const messages = [{ role: 'user' as const, text: 'q', toolUses: [] }]

  await $.session.compact({ trigger: 'precompute', messages })
  await $.session.compact({ trigger: 'auto', messages })
  expect(state.get('meta')).toBeUndefined()

  await $.session.compact({ trigger: 'manual', messages })
  expect((state.get('meta') as Meta).compactions).toBe(1)
})

test('after /clear the timeline and tools start over and the command still answers', async ($, on) => {
  stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(complete('t1'))
  expect(state.get('turns')).toHaveLength(1)

  await $.classic.SessionStart({ source: 'clear' })

  expect(state.get('turns')).toEqual([])
  expect(state.get('stats')).toEqual({})
  expect((state.get('meta') as Meta).turnCount).toBe(0)
  const ran = await $.command.run({ command: 'inspect', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(ran.text).toBeDefined()
})

// The person opens Usage at the start, before any turn has ended: the other sessions' spend is already today's
test("today's cost is shown from the start and after /clear", async ($, on) => {
  stubAll(on, { usage: READING, store: { [`cost:${localDate(0)}:other`]: 4_200_000 } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  expect((state.get('usage') as Usage).todayUsd).toBe(4.2)

  await $.classic.SessionStart({ source: 'clear' })
  expect((state.get('usage') as Usage).todayUsd).toBe(4.2)
})

// The store keeps every session of 7 days; a turn's end read all their values, twice (Task 9 review)
test("a session reads no other day's cost", async ($, on) => {
  const older = `cost:${localDate(-2 * 86_400_000)}:old`
  let reads = 0
  // Registered first, so it sits above the store's stub
  on('store.get', { key: older }, (_, e, next) => {
    reads += 1
    return next(e)
  })
  stubAll(on, { usage: READING, store: { [older]: 1_000_000, 'cost-last:old': { micros: 1_000_000, at: -2 * 86_400_000 } } })
  engine(on)

  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete(complete('t1'))

  expect(reads).toBe(0)
})

// The engine queues a prompt typed while a turn runs; its time belongs to the turn that answers it (Task 9 review)
test('a prompt typed during a turn keeps its time for its own turn', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.prompt.submit({ text: 'first', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'first', turnId: 't1' })
  await clock.set(2000)
  await $.prompt.submit({ text: 'second', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  await clock.set(3000)
  await $.turn.complete(complete('t1'))
  await $.turn.start({ text: 'second', turnId: 't2' })
  await clock.set(5000)
  await $.turn.complete(complete('t2'))

  expect((state.get('turns') as Turn[]).map(t => t.promptAt)).toEqual([0, 2000])
})

// Live, Claude Code raised turn.start before the prompt's hooks had finished, and the turn lost its prompt time
test('a turn started before the prompt settles still gets its time', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on, ['prompt.submit'])
  on('prompt.submit', async (_, e) => {
    await $.turn.start({ text: e.text, turnId: 't1' })
    return { text: e.text }
  })

  await clock.set(1000)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await clock.set(4000)
  await $.turn.complete(complete('t1'))

  expect((state.get('turns') as Turn[])[0]?.promptAt).toBe(1000)
})

test('a slash command is not your prompt', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await clock.set(10_000)
  await $.prompt.submit({ text: '/context', wait: false, origin: { kind: 'composer' }, command: { name: 'context', args: '' } })
  await clock.set(11_000)
  await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: 'done', turnId: 't1' })
  await $.turn.complete(complete('t1'))

  expect((state.get('turns') as Turn[])[0]?.promptAt).toBeNull()
})

test('an interrupted turn with no usage still records the turn', async ($, on) => {
  stubAll(on, { usage: READING })
  const state = watchState(on)
  engine(on)

  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete({ ...complete('t1'), reason: 'aborted', isAborted: true })

  expect((state.get('turns') as Turn[])[0]).toMatchObject({ tokensIn: 0, end: 'aborted' })
  expect(state.get('totals')).toBeUndefined()
})

test("the step's model and effort are the main loop's", async ($, on) => {
  const { clock } = stubAll(on, { usage: READING })
  const state = watchState(on)
  on('turn.step', async function* (_, e) {
    await clock.sleep(2000)
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, output_tokens: 100 } }
  })

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 1 })
  const drained = (async () => {
    for await (const _ of stream) { /* drain the stream */ }
    return stream.result
  })()
  await clock.advance(2000)
  await drained

  expect(state.get('meta')).toMatchObject({ model: 'claude-haiku-5-5', effort: 'medium' })
  expect(state.get('totals')).toMatchObject({ stepOutput: 100, stepMs: 2000 })
})

test("today's cost adds this session's spend since it started to the other sessions' today", async ($, on) => {
  const { usage } = stubAll(on, { usage: READING, sessionId: 's2' })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  usage.current = { ...READING, cost: { usd: 0.5 } }
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete(complete('t1'))

  expect((state.get('usage') as Usage).todayUsd).toBe(0.3)
  expect((state.get('usage') as Usage).costUsd).toBe(0.5)
})

test('a window with no reading leaves the usage figures null', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect(state.get('usage')).toMatchObject({ tokens: null, percent: null, window: 200_000, windows: [], costUsd: null })
  expect(state.get('totals') as Totals | undefined).toBeUndefined()
})
