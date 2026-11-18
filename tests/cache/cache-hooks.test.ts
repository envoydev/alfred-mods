import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionUsage } from 'claude-code'

import { SPAWN, START, SWITCH, engine, seedState, step, stepEngine, stubAll, watchState } from '../kit'
import type { Cache } from '../../hooks/cache/types'
import type { Session } from '../../hooks/session/types'

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
  expect(state.get('cache')).toMatchObject({ lastRequestAt: 0, lastRequest: { read: 169_200, write: 10_800, input: 0 } })

  await $.agent.spawn(SPAWN)
  await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })
  expect((state.get('cache') as Cache).sessionCounts.read).toBe(169_200)
})

test('a model switch reports the tier under its billing and prices the rewrite', async ($, on) => {
  stubAll(on, { usage: PLAN })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await $.classic.PostModelSwitch(SWITCH)

  const c = state.get('cache') as Cache
  expect(c).toMatchObject({ tier: '1h', tierBilling: 'plan', rateModel: 'claude-opus-5-5', lastRequestAt: null })
  expect(Math.abs((c.ratePerToken ?? 0) - 0.000008) < 1e-12).toBe(true)
})

test('a switch declined after PreModelSwitch keeps the cache warm', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await mainStep($)
  await $.classic.PreModelSwitch(SWITCH)
  expect(state.get('cache')).toMatchObject({ lastRequestAt: 0, tier: '1h' })

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

  expect((state.get('cache') as Cache).config).toMatchObject({ pin: { tier: '1h', from: 'promptCacheTtl' }, isIdleCompactOff: true })
})

test("idle compaction's threshold is read at the start", async ($, on) => {
  stubAll(on, { env: { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '120000' } })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)

  expect((state.get('cache') as Cache).config.idleMinTokens).toBe(120_000)
})

test('the 5 min toast fires once per warm stretch', { timeoutMs: 15_000 }, async ($, on) => {
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

// The reload comes 50 minutes after the last request, so the walk to the toast is 5 minutes: a 55-minute walk held the
// toast's timer open past a hook's 10 s budget on CI's Windows runner
test('after a reload, a warm 1h cache still gets its toast', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN, now: 3_000_000 })
  engine(on)
  // A reload keeps $.state and runs register and session.start again: the cache stands warm from a switch at 0
  const warm: Cache = {
    tier: '1h', tierAt: 0, tierBilling: 'plan', config: { pin: null, isIdleCompactOff: false, idleMinTokens: 200_000, isIdleSurface: true },
    ratePerToken: 0.000008, rateModel: 'claude-opus-5-5', lastRequestAt: 0, lastRequest: { read: 169_200, write: 10_800, input: 0 },
    sessionCounts: { read: 169_200, write: 10_800, input: 0 }, toastedForRequestAt: null,
  }
  seedState(on, { cache: { shape: 'cache-3', value: warm } })

  await $.session.start(START)
  await clock.advance(299_000)
  expect(cacheToasts(toasts)).toEqual([])

  await clock.advance(1_000)
  expect(cacheToasts(toasts)).toEqual(['Cache cold in 5m (rewrite ≈ $1.44): press 3 to compact, or /inspect cache'])
})

test('with no switch, a subscription within its plan gets the toast as an estimate', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => MAIN)
  await measure($, PLAN)

  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual(['Cache cold in ≈5m: press 3 to compact, or /inspect cache'])
})

test('crossing into usage credits withholds the 1h toast', { timeoutMs: 15_000 }, async ($, on) => {
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
test('a 1h cache under 100k gets no toast', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: PLAN })
  engine(on)
  stepEngine(on, () => ({ ...MAIN, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 3_000 }))
  await measure($, PLAN)

  await mainStep($)
  await clock.advance(3_400_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('no toast while a turn runs', { timeoutMs: 15_000 }, async ($, on) => {
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

test('where Claude Code should compact the conversation itself, the toast waits for it and comes if it does not', { timeoutMs: 15_000 }, async ($, on) => {
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

test("Claude Code's own idle compaction leaves no warning", { timeoutMs: 15_000 }, async ($, on) => {
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

test('the toast stays when idle compaction is off', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000), settings: { idleCompaction: false } })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toHaveLength(1)
})

// Claude Code compacts an idle conversation in the terminal, VS Code's chat panel and the desktop app's Code tab
// (settings-reference, `idleCompaction`, read 2026-11-19), and the SDK hosts start with no surface: what counts is where
// the session draws
for (const surface of ['vscode', 'desktop'] as const) {
  test(`in ${surface}, Claude Code's own idle compaction delays the warning as in the terminal`, { timeoutMs: 15_000 }, async ($, on) => {
    const { clock, toasts } = stubAll(on, { usage: reading(210_000), surfaces: [surface] })
    engine(on)
    stepEngine(on, () => MAIN)

    await $.session.start({ ...START, surface: null, isInteractive: false })
    await mainStep($)
    await clock.advance(3_300_000)

    expect(cacheToasts(toasts)).toEqual([])
  })
}

// An SDK host draws nothing at session.start: its surface attaches later, which the turn's end reads again
test('a surface that attaches after the start delays the warning from the next turn', { timeoutMs: 15_000 }, async ($, on) => {
  const surfaces: RenderSurface[] = []
  const { clock, toasts } = stubAll(on, { usage: reading(210_000), surfaces })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: null, isInteractive: false })
  surfaces.push('vscode')
  await mainStep($)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't0', reason: 'answer' })
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toEqual([])
})

test('a plain -p run, which draws nowhere, keeps the early warning', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000), surfaces: [] })
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: null, isInteractive: false })
  await mainStep($)
  await clock.advance(3_300_000)

  expect(cacheToasts(toasts)).toHaveLength(1)
})

test('after /clear in the terminal, the toast still waits for self-compaction', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, toasts } = stubAll(on, { usage: reading(210_000) })
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => MAIN)

  await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'clear' })
  await mainStep($)
  expect((state.get('cache') as Cache).config.isIdleSurface).toBe(true)

  await clock.advance(3_300_000)
  expect(cacheToasts(toasts)).toEqual([])
})

test('after /clear the armed toast stays quiet', { timeoutMs: 15_000 }, async ($, on) => {
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
  expect(state.get('cache')).toMatchObject({ lastRequestAt: null, lastRequest: null })
  expect((state.get('session') as Session).compactions).toBe(1)

  await mainStep($)
  await $.session.compact({ trigger: 'precompute', messages })
  expect((state.get('cache') as Cache).lastRequestAt).toBe(0)
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
