import { expect, test } from 'claude-code/testing'

import {
  addRequest, afterCompact, billingOf, cacheLine, cacheView, idleOf, minutes, needsTick, pinOf, reuseTone, selfCompacts,
  takeSwitch, tierOf, toastAt,
} from '../hooks/cache.ts'
import type { Line } from '../hooks/band.ts'
import type { Cache } from '../types'

// INITIAL.cache in register.ts, which does not export it
const C0: Cache = {
  tier: null, tierAt: null, tierBilling: null,
  config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 }, toastedFor: null,
}
// The deck's slide: a 1h cache from a switch, 180k cached, 94% of the last request read from it
const SLIDE: Cache = {
  ...C0, tier: '1h', tierBilling: 'plan', config: { ...C0.config, isTerminal: true }, lastAt: 0,
  last: { read: 169_200, write: 10_800, input: 0 }, session: { read: 169_200, write: 10_800, input: 0 }, ratePerToken: 0.000008,
}
const FIVE: Cache = { ...SLIDE, tier: '5m' }
const usage = (read: number, write: number, input: number) =>
  ({ cache_read_input_tokens: read, cache_creation_input_tokens: write, input_tokens: input, output_tokens: 5 })
// The kit has no toBeCloseTo: a float within a billionth of what it should be
const near = (x: number | null, y: number): boolean => x !== null && Math.abs(x - y) <= Math.abs(y) * 1e-9
const text = (line: Line): string => line.map(s => ('text' in s ? s.text : '')).join('')

test("the F4 line reads as the deck's slide", () => {
  expect(text(cacheLine(cacheView(SLIDE, 'plan', 480_000)))).toBe('warm 52m ▰▰▰▰▱ 94% reused · 180k cached · rewrite ≈ $1.44')
})

test('a tier from the default alone reads as an estimate', () => {
  const guess: Cache = { ...SLIDE, tier: null, ratePerToken: null }
  expect(text(cacheLine(cacheView(guess, 'plan', 480_000)))).toBe('warm ≈52m ▰▰▰▰▱ 94% reused · 180k cached')
  expect(text(cacheLine(cacheView(guess, 'other', 180_000))).startsWith('warm ≈2m ')).toBe(true)
  expect(text(cacheLine(cacheView(guess, 'other', 300_000))).startsWith('cold ')).toBe(true)
})

test('billing reads the 5h and 7d windows', () => {
  const w = (kind: string, percentUsed: number) => ({ kind, percentUsed, resetsAt: null })
  expect(billingOf([])).toBe('other')
  expect(billingOf([w('five_hour', 40)])).toBe('plan')
  expect(billingOf([w('five_hour', 100), w('seven_day', 30)])).toBe('credits')
  expect(billingOf([w('spend_limit', 50)])).toBe('other')
})

test("the tier follows Claude Code's order of pins", () => {
  expect(pinOf({ force5m: '1', ttl: '1h' })).toEqual({ tier: '5m', from: 'FORCE_PROMPT_CACHING_5M' })
  expect(pinOf({ ttl: '1h', setting: '5m' })).toEqual({ tier: '1h', from: 'CLAUDE_CODE_PROMPT_CACHE_TTL' })
  expect(pinOf({ setting: '5m', enable1h: '1' })).toEqual({ tier: '5m', from: 'promptCacheTtl' })
  expect(pinOf({ enable1h: '1' })).toEqual({ tier: '1h', from: 'ENABLE_PROMPT_CACHING_1H' })
  expect(pinOf({ ttl: '2h', setting: 30 })).toBe(null)
  expect(pinOf({})).toBe(null)
})

test("a switch's report holds while its billing does, and a pin beats it", () => {
  expect(tierOf(FIVE, 'plan')).toEqual({ tier: '5m', from: 'switch', isEstimate: false })
  expect(tierOf(FIVE, 'credits')).toEqual({ tier: '5m', from: 'default', isEstimate: true })
  expect(tierOf(SLIDE, 'credits')).toEqual({ tier: '5m', from: 'default', isEstimate: true })
  const pinned: Cache = { ...SLIDE, config: { ...SLIDE.config, pin: { tier: '5m', from: 'promptCacheTtl' } } }
  expect(tierOf(pinned, 'plan')).toEqual({ tier: '5m', from: 'pin', isEstimate: false })
})

test('reuse is read over read, write and uncached input, last and for the session', () => {
  const c = addRequest(addRequest({ ...C0, tier: '1h', tierBilling: 'plan' }, usage(6_800, 13_000, 200), 0), usage(169_200, 10_800, 0), 1)
  const v = cacheView(c, 'plan', 2)
  expect(Math.round(v.reuseLast ?? -1)).toBe(94)
  expect(Math.round(v.reuseSession ?? -1)).toBe(88)
  expect(cacheView(addRequest(C0, usage(90, 5, 5), 0), 'plan', 1).reuseLast).toBe(90)
})

test('warmth follows the tier', () => {
  expect(cacheView(FIVE, 'plan', 180_000)).toMatchObject({ state: 'warm', leftMs: 120_000 })
  expect(cacheView(FIVE, 'plan', 300_000).state).toBe('cold')
  const v = cacheView(SLIDE, 'plan', 180_000)
  expect(v.leftMs).toBe(3_420_000)
  expect(minutes(v.leftMs ?? 0)).toBe('57m')
})

test('a model switch makes the cache cold and prices the rewrite', () => {
  const c = takeSwitch({ ...SLIDE, ratePerToken: null }, { ttl: '1h', contextTokens: 100_000, usd: 0.8, model: 'claude-opus-5-5', billing: 'plan' }, 10, true)
  const v = cacheView(c, 'plan', 20)
  expect(v.state).toBe('cold')
  expect(c.tierBilling).toBe('plan')
  expect(near(c.ratePerToken, 0.000008)).toBe(true)
  expect(v.cached).toBe(180_000)
  expect(near(v.rewriteUsd, 1.44)).toBe(true)
})

test('a report before the switch is confirmed leaves the cache warm', () => {
  const c = takeSwitch({ ...SLIDE, tier: null, ratePerToken: null }, { ttl: '1h', contextTokens: 100_000, usd: 0.8, model: 'claude-opus-5-5', billing: 'plan' }, 10, false)
  expect(cacheView(c, 'plan', 20).state).toBe('warm')
  expect(c.tier).toBe('1h')
  expect(near(c.ratePerToken, 0.000008)).toBe(true)
})

test('a switch before the first response gives the tier and no price', () => {
  const c = takeSwitch(C0, { ttl: '1h', contextTokens: 0, usd: 0, model: 'claude-opus-5-5', billing: 'plan' }, 10, true)
  expect(c.tier).toBe('1h')
  expect(c.ratePerToken).toBe(null)
  expect(text(cacheLine(cacheView(c, 'plan', 20)))).not.toMatch(/NaN|Infinity/)
})

// Caching off (DISABLE_PROMPT_CACHING, a gateway without it): nothing read or written leaves the cache as it was
test('a request that reads and writes nothing from the cache does not warm it', () => {
  const off = addRequest(C0, usage(0, 0, 40_000), 0)
  expect(cacheView(off, 'other', 250_000)).toMatchObject({ state: 'cold', isClosing: false })
  expect(toastAt(off, 'plan', null)).toBe(null)
  expect(off.session.input).toBe(40_000)
  expect(addRequest(SLIDE, usage(0, 0, 500), 100_000).lastAt).toBe(0)
})

test('a request with no tokens changes nothing', () => {
  const c = { ...C0 }
  expect(addRequest(c, usage(0, 0, 0), 9)).toBe(c)
})

test('after a compaction the cache is cold with nothing to rewrite', () => {
  const v = cacheView(afterCompact(SLIDE), 'plan', 1000)
  expect(v).toMatchObject({ state: 'cold', cached: 0, rewriteUsd: null })
  expect(Math.round(v.reuseSession ?? -1)).toBe(94)
})

test("the warning's window is per tier", () => {
  expect(toastAt(SLIDE, 'plan', null)).toBe(3_300_000)
  expect(toastAt(FIVE, 'plan', null)).toBe(null)
  const late = cacheView(SLIDE, 'plan', 3_360_000)
  expect(late.isClosing).toBe(true)
  expect(minutes(late.leftMs ?? 0)).toBe('4m')
  expect(cacheView(FIVE, 'plan', 200_000).isClosing).toBe(false)
  const last = cacheView(FIVE, 'plan', 250_000)
  expect(last.isClosing).toBe(true)
  expect(minutes(last.leftMs ?? 0)).toBe('1m')
})

// Seen live: Claude Code did not compact at minute 54 (a feature flag gates it), and a withheld warning left none
test('where Claude Code should compact it itself, the warning waits until 3 minutes are left', () => {
  expect(toastAt(SLIDE, 'plan', 210_000)).toBe(3_420_000)
  expect(toastAt(SLIDE, 'plan', 190_000)).toBe(3_300_000)
  expect(cacheView(SLIDE, 'plan', 3_400_000, 210_000).isClosing).toBe(false)
  expect(cacheView(SLIDE, 'plan', 3_420_000, 210_000).isClosing).toBe(true)
  expect(cacheView(SLIDE, 'plan', 3_400_000).isClosing).toBe(true)
})

test('the clock ticks once a minute while warm and each second near cold', () => {
  expect([60_000, 60_500, 61_000, 3_400_000, 3_600_500, 3_602_000].map(t => needsTick(SLIDE, 'plan', t)))
    .toEqual([true, true, false, true, true, false])
  expect([230_500, 250_000, 300_500, 301_500].map(t => needsTick(FIVE, 'plan', t))).toEqual([false, true, true, false])
})

test('idle compaction is read from its settings', () => {
  expect(idleOf({})).toEqual({ idleOff: false, idleMinTokens: 200_000 })
  expect(idleOf({ idleCompaction: false }).idleOff).toBe(true)
  expect(idleOf({ autoCompactEnabled: false }).idleOff).toBe(true)
  expect(idleOf({ disableAutoCompact: '1' }).idleOff).toBe(true)
  expect(idleOf({ minTokens: '50000' }).idleMinTokens).toBe(100_000)
  expect(idleOf({ minTokens: '150000' }).idleMinTokens).toBe(150_000)
  expect(idleOf({ minTokens: 'x' }).idleMinTokens).toBe(200_000)
  expect(idleOf({ minTokens: '-5' }).idleMinTokens).toBe(200_000)
})

test('Claude Code compacts a large idle 1h conversation itself', () => {
  expect(selfCompacts(SLIDE, 'plan', 210_000)).toBe(true)
  expect(selfCompacts(SLIDE, 'plan', 190_000)).toBe(false)
  expect(selfCompacts(FIVE, 'plan', 210_000)).toBe(false)
  expect(selfCompacts({ ...SLIDE, config: { ...SLIDE.config, idleOff: true } }, 'plan', 210_000)).toBe(false)
  expect(selfCompacts({ ...SLIDE, config: { ...SLIDE.config, isTerminal: false } }, 'plan', 210_000)).toBe(false)
  expect(selfCompacts(SLIDE, 'plan', null)).toBe(false)
})

test("the reuse bar takes the miss rate's colour", () => {
  expect([94, 30, 10].map(reuseTone)).toEqual(['ok', 'warn', 'fail'])
})
