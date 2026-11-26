// A /model that no classic.PostModelSwitch reports, as under a managed guard that skips it: read at the one-second
// tick, it forfeits the cache as a reported switch does, with no rewrite rate, as only the report gives one
import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { START, SWITCH, engine, step, stepEngine, stubAll, watchState } from '../kit'
import type { Cache } from '../../hooks/cache/types'

const HAIKU = 'claude-haiku-5-5'
const OPUS = 'claude-opus-5-5'
const MAIN = { input_tokens: 0, output_tokens: 500, cache_read_input_tokens: 169_200, cache_creation_input_tokens: 10_800, model: HAIKU }
const PLAN: SessionUsage = {
  startedAt: 0, context: { window: 1_000_000, tokens: 60_000, percent: 6 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-28T17:00:00Z' }],
}

test('a /model no PostModelSwitch reports leaves the cache cold at the next tick', async ($, on) => {
  const { clock, session } = stubAll(on, { usage: PLAN, model: HAIKU })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await $.session.start(START)
  await step($, { turnId: 't0', index: 0, model: HAIKU, messageCount: 1 })
  const warm = (state.get('cache') as Cache).lastRequestAt

  session.model = OPUS
  await clock.advance(1000)
  await clock.settle()

  expect([warm, state.get('cache')]).toMatchObject([0, { lastRequestAt: null, rateModel: OPUS, ratePerToken: null }])
})

test('a switch PostModelSwitch reported keeps its rewrite rate at the tick', async ($, on) => {
  const { clock, session } = stubAll(on, { usage: PLAN, model: HAIKU })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await $.session.start(START)
  await step($, { turnId: 't0', index: 0, model: HAIKU, messageCount: 1 })

  await $.classic.PostModelSwitch(SWITCH)
  session.model = OPUS
  await clock.advance(1000)
  await clock.settle()

  const cache = state.get('cache') as Cache
  expect([cache.tier, cache.rateModel, Math.abs((cache.ratePerToken ?? 0) - 0.000008) < 1e-12]).toEqual(['1h', OPUS, true])
})
