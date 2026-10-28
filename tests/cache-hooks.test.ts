import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { SPAWN, START, SWITCH, engine, step, stepEngine, stubAll, watchState } from './kit.ts'
import type { Cache, Meta } from '../types'

const MAIN = { input_tokens: 0, output_tokens: 500, cache_read_input_tokens: 169_200, cache_creation_input_tokens: 10_800, model: 'claude-opus-5-5' }
// A subscription within its plan's usage, the 5h window at `fiveHour`, with `tokens` of context
const reading = (tokens = 60_000, fiveHour = 40): SessionUsage => ({
  startedAt: 0, context: { window: 1_000_000, tokens, percent: tokens / 10_000 },
  rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-10-28T17:00:00Z' }],
})
const PLAN = reading()
const measure = ($: Engine, r: SessionUsage) => $.session.measure({ context: r.context, rateLimits: r.rateLimits, changed: ['rateLimits'] })
const mainStep = ($: Engine) => step($, { turnId: 't0', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
// Only the cache's toasts: a window crossing 75 or 90 toasts too
const cacheToasts = (toasts: string[]) => toasts.filter(t => t.startsWith('Cache '))
const messages = [{ role: 'user' as const, text: 'q', toolUses: [] }]

test("main-loop requests feed the cache and an agent's do not", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)

  await mainStep($)
  expect(state.get('cache')).toMatchObject({ lastAt: 0, last: { read: 169_200, write: 10_800, input: 0 } })

  await $.agent.spawn(SPAWN)
  await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })
  expect((state.get('cache') as Cache).session.read).toBe(169_200)
})

test('a model switch reports the tier under its billing and prices the rewrite', async ($, on) => {
  stubAll(on, { usage: PLAN })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.classic.PostModelSwitch(SWITCH)

  const c = state.get('cache') as Cache
  expect(c).toMatchObject({ tier: '1h', tierBilling: 'plan', rateModel: 'claude-opus-5-5', lastAt: null })
  expect(Math.abs((c.ratePerToken ?? 0) - 0.000008) < 1e-12).toBe(true)
})

test('a switch declined after PreModelSwitch keeps the cache warm', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await mainStep($)
  await $.classic.PreModelSwitch(SWITCH)
  expect(state.get('cache')).toMatchObject({ lastAt: 0, tier: '1h' })

  await clock.advance(3_300_000)
  expect(cacheToasts(toasts)).toHaveLength(1)
})

test('a PreModelSwitch a hook denies reports nothing', async ($, on) => {
  stubAll(on, { usage: PLAN, preSwitch: { permissionDecision: 'deny' } })
  const state = watchState(on)
  engine(on)

  await $.classic.PreModelSwitch({ ...SWITCH })

  expect(state.get('cache')).toBe(undefined)
})

test('the variable that chooses the tier is read at the start', async ($, on) => {
  stubAll(on, { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect((state.get('cache') as Cache).config.pin).toEqual({ tier: '5m', from: 'CLAUDE_CODE_PROMPT_CACHE_TTL' })
})

test('the settings that choose the tier and idle compaction are read at the start', async ($, on) => {
  stubAll(on, { settings: { promptCacheTtl: '1h', idleCompaction: false } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect((state.get('cache') as Cache).config).toMatchObject({ pin: { tier: '1h', from: 'promptCacheTtl' }, idleOff: true })
})

test("idle compaction's threshold is read at the start", async ($, on) => {
  stubAll(on, { env: { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '120000' } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect((state.get('cache') as Cache).config.idleMinTokens).toBe(120_000)
})

test('the 5 min toast fires once per warm stretch', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.classic.PostModelSwitch(SWITCH)
  await mainStep($)
  await clock.advance(3_299_000)
  expect(cacheToasts(toasts)).toEqual([])

  await clock.advance(1_000)
  expect(cacheToasts(toasts)).toEqual(['Cache cold in 5m (rewrite ≈ $1.44): press 3 to compact, or /inspect cache'])

  await clock.advance(240_000)
  expect(cacheToasts(toasts)).toHaveLength(1)

  await mainStep($)
  await clock.advance(3_300_000)
  expect(cacheToasts(toasts)).toHaveLength(2)
})

test('after a reload, a warm 1h cache still gets its toast', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  // A reload keeps $.state and runs register and session.start again: the cache stands warm from a switch at 0
  const warm: Cache = {
    tier: '1h', tierAt: 0, tierBilling: 'plan', config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: true },
    ratePerToken: 0.000008, rateModel: 'claude-opus-5-5', lastAt: 0, last: { read: 169_200, write: 10_800, input: 0 },
    session: { read: 169_200, write: 10_800, input: 0 }, toastedFor: null,
  }
  let isWritten = false
  on('state.set', async ($, e, next) => {
    if (e.key === 'cache') isWritten = true
    return next(e)
  })
  on('state.get', async ($, e, next) => {
    const r = await next(e)
    if (e.key !== 'cache' || isWritten || r.value === undefined) return r
    return { value: { ...r.value, value: { shape: 'cache-1', value: warm } } }
  })

  await $.session.start(START)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual(['Cache cold in 5m (rewrite ≈ $1.44): press 3 to compact, or /inspect cache'])
})

test('with no switch, a subscription within its plan gets the toast as an estimate', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual(['Cache cold in ≈5m: press 3 to compact, or /inspect cache'])
})

test('crossing into usage credits withholds the 1h toast', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await mainStep($)
  await measure($, reading(60_000, 100))
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual([])
})

// The user's ruling (2026-10-28): no warning under 100k cached
test('a 1h cache under 100k gets no toast', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => ({ ...MAIN, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 3_000 }))
  await measure($, PLAN)

  await mainStep($)
  await clock.advance(3_400_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('no toast while a turn runs', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.turn.start({ text: 'q', turnId: 't1' })
  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('no toast on the 5m tier', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.classic.PostModelSwitch({ ...SWITCH, cache_ttl: '5m' })
  await mainStep($)
  await clock.advance(600_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('where Claude Code should compact the conversation itself, the toast waits for it and comes if it does not', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000) })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await mainStep($)
  await clock.advance(3_300_000)
  expect(cacheToasts(toasts)).toEqual([])

  await clock.advance(120_000)
  expect(cacheToasts(toasts)).toEqual(['Cache cold in ≈3m: press 3 to compact, or /inspect cache'])
})

test("Claude Code's own idle compaction leaves no warning", async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000) })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await mainStep($)
  await clock.advance(3_240_000)
  await $.session.compact({ trigger: 'auto', messages })
  await clock.advance(360_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('the toast stays when idle compaction is off', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000), settings: { idleCompaction: false } })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toHaveLength(1)
})

test('the toast stays off the terminal, where idle compaction waits for the next message', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000) })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'desktop', isInteractive: true })
  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toHaveLength(1)
})

test('after /clear in the terminal, the toast still waits for self-compaction', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000) })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'clear' })
  await mainStep($)
  expect((state.get('cache') as Cache).config.isTerminal).toBe(true)

  await clock.advance(3_300_000)
  expect(cacheToasts(toasts)).toEqual([])
})

test('after /clear the armed toast stays quiet', async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.classic.PostModelSwitch(SWITCH)
  await mainStep($)
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test("every counted compaction makes the cache cold, Claude Code's own included", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)

  await mainStep($)
  await $.session.compact({ trigger: 'auto', messages })
  expect(state.get('cache')).toMatchObject({ lastAt: null, last: null })
  expect((state.get('meta') as Meta).compactions).toBe(1)

  await mainStep($)
  await $.session.compact({ trigger: 'precompute', messages })
  expect((state.get('cache') as Cache).lastAt).toBe(0)
})

test('a resumed session prices the rewrite from its start', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.classic.SessionStart({ source: 'resume', estimated_cache_write_usd: 0.36, context_tokens: 45_000, model: 'claude-opus-5-5' })

  const c = state.get('cache') as Cache
  expect(c.tier).toBe(null)
  expect(Math.abs((c.ratePerToken ?? 0) - 0.000008) < 1e-12).toBe(true)
})
