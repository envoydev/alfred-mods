// When the effort reaches the session: guessed at the start, after a /clear, a settings edit and a model switch, and
// told by the main loop's request as it is sent
import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { START, engine, step, stepEngine, stubAll, watchState } from '../kit'
import type { Session } from '../../hooks/session/types'

const SONNET = 'claude-sonnet-5-5'
const READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }
const saved = (level: string, model = SONNET) => ({ modelSettings: { [model]: { effortLevel: level } } })
const effortOf = (state: { get(key: string): unknown }) => {
  const session = state.get('session') as Session
  return [session.model, session.effort, session.effortFrom]
}

test('a session starts with the effort its settings give', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('high') } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect(effortOf(state)).toEqual([SONNET, 'high', 'guess'])
})

test('CLAUDE_CODE_EFFORT_LEVEL comes before the settings at the start', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('high') }, env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect(effortOf(state)).toEqual([SONNET, 'low', 'guess'])
})

test('a settings file whose read is refused sets nothing', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('high') }, refuseSource: ['project'] })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect(effortOf(state)).toEqual([SONNET, 'high', 'guess'])
})

test('the request names its effort while it runs, and the settings no longer move it', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, sources } = stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  const whileRunning: unknown[] = []
  on('turn.step', async function* (_, e) {
    whileRunning.push(effortOf(state))
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await $.session.start(START)

  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'xhigh', messageCount: 1 })
  sources.user.modelSettings = saved('low').modelSettings
  await clock.advance(30_000)
  await clock.settle()

  expect(whileRunning).toEqual([[SONNET, 'xhigh', 'step']])
  expect(effortOf(state)).toEqual([SONNET, 'xhigh', 'step'])
})

test('a request that carries no effort leaves none shown', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)

  await step($, { turnId: 't1', index: 0, model: 'claude-haiku-4-5', messageCount: 1 })

  expect(effortOf(state)).toEqual(['claude-haiku-4-5', null, 'step'])
})

test('a level saved before the first request moves the guess at the next settings read', async ($, on) => {
  const { clock, sources } = stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  sources.user.modelSettings = saved('low').modelSettings
  await clock.advance(30_000)
  await clock.settle()

  expect(effortOf(state)).toEqual([SONNET, 'low', 'guess'])
})

test('a model switch before the first request guesses for the new model', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('xhigh', 'claude-opus-5-5') } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  await $.classic.PostModelSwitch({ from_model: SONNET, to_model: 'claude-opus-5-5' } as never)

  expect(effortOf(state)).toEqual(['claude-opus-5-5', 'xhigh', 'guess'])
})

test('a conversation that starts over guesses the effort again', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('high') } })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'max', messageCount: 1 })

  await $.classic.SessionStart({ source: 'clear' } as never)

  expect(effortOf(state)).toEqual([SONNET, 'high', 'guess'])
})

test('a model switch after a request drops its level for a guess on the new model', async ($, on) => {
  stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await step($, { turnId: 't1', index: 0, model: 'claude-opus-4-7', effort: 'xhigh', messageCount: 1 })

  await $.classic.PostModelSwitch({ from_model: 'claude-opus-4-7', to_model: 'claude-haiku-4-5' } as never)

  // Haiku 4.5 takes no effort, so nothing is guessed for it
  expect(effortOf(state)).toEqual(['claude-haiku-4-5', null, undefined])
})

test('a guess still reading when the model moves is dropped', async ($, on) => {
  let isSwitched = false
  let watched: ReturnType<typeof watchState> | null = null
  // The guess for Sonnet waits on a settings file while the person switches the model
  const beforeWholeSource = async (): Promise<void> => {
    if (isSwitched || (watched?.get('session') as Session | undefined)?.model !== SONNET) return
    isSwitched = true
    await $.classic.PostModelSwitch({ from_model: SONNET, to_model: 'claude-opus-5-5' } as never)
  }
  stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('xhigh', 'claude-opus-5-5') }, beforeWholeSource })
  const state = watchState(on)
  watched = state
  engine(on)

  await $.session.start(START)

  expect([isSwitched, effortOf(state)]).toEqual([true, ['claude-opus-5-5', 'xhigh', 'guess']])
})
