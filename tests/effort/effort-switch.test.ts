// A /model and a /effort reach the band where no classic.PostModelSwitch or classic.ConfigChange tells the mod, as
// under a managed guard that skips those hooks: the model is read at the one-second tick, and a /effort is observed
// as the command it is
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { PRESENTATION, START, engine, step, stepEngine, stubAll, watchState } from '../kit'
import type { Session } from '../../hooks/session/types'

const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }
const saved = (level: string, model = SONNET) => ({ modelSettings: { [model]: { effortLevel: level } } })
const effortOf = (state: { get(key: string): unknown }) => {
  const session = state.get('session') as Session
  return [session.model, session.effort, session.effortFrom]
}

// Claude Code's own /effort, beneath the mod: a level it saves lands in the user file, as the picker's Enter does
function coreEffort(on: On, user: Record<string, unknown>, model: string, saves = true): void {
  on('command.run', { command: 'effort' }, (_, e) => {
    const level = e.args.trim()
    if (saves && level !== '' && level !== 'max') user.modelSettings = { [model]: { effortLevel: level } }
    return { text: `Set effort level to ${level}` }
  })
}

const runEffort = async ($: Engine, args: string): Promise<string | undefined> =>
  (await $.command.run({ command: 'effort', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text

test('a /model that no PostModelSwitch reports shows at the next tick, with the new model\'s effort', async ($, on) => {
  const { clock, session } = stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('xhigh', OPUS) } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  session.model = OPUS
  await clock.advance(1000)
  await clock.settle()

  expect(effortOf(state)).toEqual([OPUS, 'xhigh', 'guess'])
})

test('a /model after a request drops the request\'s level at the next tick', async ($, on) => {
  const { clock, session } = stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'high', messageCount: 1 })

  session.model = OPUS
  await clock.advance(1000)
  await clock.settle()

  expect(effortOf(state)).toEqual([OPUS, 'medium', 'guess'])
})

test('a request answered on another model keeps its model while the session\'s model stands', async ($, on) => {
  const { clock } = stubAll(on, { usage: READING, model: SONNET })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await clock.advance(1000)
  await clock.settle()

  await step($, { turnId: 't1', index: 0, model: OPUS, effort: 'high', messageCount: 1 })
  await clock.advance(3000)
  await clock.settle()

  expect(effortOf(state)).toEqual([OPUS, 'high', 'step'])
})

test('/effort <level> after a request shows that level at once', async ($, on) => {
  const { sources } = stubAll(on, { usage: READING, model: SONNET })
  coreEffort(on, sources.user, SONNET)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'xhigh', messageCount: 1 })

  const text = await runEffort($, 'low')

  expect([text, effortOf(state)]).toEqual(['Set effort level to low', [SONNET, 'low', 'guess']])
})

test('/effort max, for the session alone, holds across a model switch', async ($, on) => {
  const { clock, sources, session } = stubAll(on, { usage: READING, model: SONNET })
  coreEffort(on, sources.user, SONNET)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  await runEffort($, 'max')
  await clock.advance(31_000)
  await clock.settle()
  const shown = effortOf(state)
  session.model = OPUS
  await clock.advance(1000)
  await clock.settle()

  expect([shown, effortOf(state)]).toEqual([[SONNET, 'max', 'guess'], [OPUS, 'max', 'guess']])
})

test('/effort <level> after /effort max replaces the session pick', async ($, on) => {
  const { sources } = stubAll(on, { usage: READING, model: SONNET })
  coreEffort(on, sources.user, SONNET)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  await runEffort($, 'max')
  await runEffort($, 'low')

  expect(effortOf(state)).toEqual([SONNET, 'low', 'guess'])
})

test('/effort opened and closed with no pick keeps the level the request told', async ($, on) => {
  const { clock, sources } = stubAll(on, { usage: READING, model: SONNET })
  coreEffort(on, sources.user, SONNET, false)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  // As `claude --effort high` sends it, which no settings file says
  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'high', messageCount: 1 })

  await runEffort($, '')
  await clock.advance(31_000)
  await clock.settle()

  expect(effortOf(state)).toEqual([SONNET, 'high', 'step'])
})

test('/effort with no level shows the level the picker saves within seconds', async ($, on) => {
  const { clock, sources } = stubAll(on, { usage: READING, model: SONNET })
  coreEffort(on, sources.user, SONNET, false)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => null)
  await $.session.start(START)
  await step($, { turnId: 't1', index: 0, model: SONNET, effort: 'medium', messageCount: 1 })

  await runEffort($, '')
  // The person picks in the picker after the command answered
  await clock.advance(3000)
  sources.user.modelSettings = saved('high').modelSettings
  await clock.advance(2000)
  await clock.settle()

  expect(effortOf(state)).toEqual([SONNET, 'high', 'guess'])
})

test('/effort auto drops a session pick for the saved level', async ($, on) => {
  const { sources } = stubAll(on, { usage: READING, model: SONNET, sources: { user: saved('xhigh') } })
  coreEffort(on, sources.user, SONNET, false)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  await runEffort($, 'max')
  const picked = effortOf(state)
  await runEffort($, 'auto')

  expect([picked, effortOf(state)]).toEqual([[SONNET, 'max', 'guess'], [SONNET, 'xhigh', 'guess']])
})

test('CLAUDE_CODE_EFFORT_LEVEL comes before a /effort pick', async ($, on) => {
  const { sources } = stubAll(on, { usage: READING, model: SONNET, env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } })
  coreEffort(on, sources.user, SONNET)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)

  await runEffort($, 'high')

  expect(effortOf(state)).toEqual([SONNET, 'low', 'guess'])
})
