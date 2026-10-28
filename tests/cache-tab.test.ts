import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionUsage } from 'claude-code'

import { clock as clockText } from '../hooks/format.ts'
import { PRESENTATION, START, SWITCH, engine, rows, step, stepEngine, stubAll, watchState } from './kit.ts'
import type { Cache, Meta } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const MAIN = { input_tokens: 0, output_tokens: 500, cache_read_input_tokens: 169_200, cache_creation_input_tokens: 10_800, model: 'claude-opus-5-5' }
// The context at `ctx` percent of 200k, the 5h window at `fiveHour` (none when null) and the weekly one at 40
const reading = (ctx = 30, fiveHour: number | null = 15): SessionUsage => ({
  startedAt: 0, context: { window: 200_000, tokens: ctx * 2000, percent: ctx },
  rateLimits: fiveHour === null ? [] : [
    { kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-10-28T17:00:00Z' },
    { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' },
  ],
})
const PLAN = reading()
const messages = [{ role: 'user' as const, text: 'q', toolUses: [] }]

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const bandOf = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: BAND })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const measure = ($: Engine, r: SessionUsage) => $.session.measure({ context: r.context, rateLimits: r.rateLimits, changed: ['rateLimits'] })
const mainStep = ($: Engine) => step($, { turnId: 't0', index: 0, model: 'claude-opus-5-5', messageCount: 1 })

// One main turn with one request at its start
async function oneTurn($: Engine): Promise<void> {
  await $.turn.start({ text: 'q', turnId: 't1' })
  await mainStep($)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
}

for (const surface of SURFACES) {
  test(`cache expiry matches a 5m tier once a model switch reports it (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch({ ...SWITCH, cache_ttl: '5m' })
    await mainStep($)
    await inspect($, 'cache')

    await clock.advance(180_000)
    const first = await pane($, surface)
    expect((await rows(first)).some(l => /^Cache\s+warm 2m ▰/.test(l))).toBe(true)
    await first.unmount()
    await clock.advance(120_001)
    expect((await rows(await pane($, surface))).some(l => /^Cache\s+cold ▰/.test(l))).toBe(true)
  })

  test(`cache expiry matches a 1h tier once a model switch reports it (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch(SWITCH)
    await mainStep($)
    await inspect($, 'cache')

    await clock.advance(180_000)
    expect((await rows(await pane($, surface))).some(l => /^Cache\s+warm 57m /.test(l))).toBe(true)
  })

  test(`the Cache tab reads as the deck's slide (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch(SWITCH)
    await mainStep($)
    await inspect($, 'cache')
    await clock.advance(480_000)

    const lines = await rows(await pane($, surface))
    expect(lines.some(l => /^Cache\s+warm 52m ▰▰▰▰▱ 94% reused · 180k cached · rewrite ≈ \$1\.44\s+Compact$/.test(l))).toBe(true)
    expect(lines).toContain('Reused    last request 94% · session 94%')
    expect(lines).toContain(`Tier      1h, from the model switch at ${clockText(0)} · rewrite priced on Opus 5.5`)
  })

  for (const [name, r, tier] of [
    ['within plan usage', PLAN, '≈1h'], ['off a subscription', reading(30, null), '≈5m'], ['on usage credits', reading(30, 100), '≈5m'],
  ] as const) {
    test(`before a model switch the Cache tab shows Claude Code's default ${name} as an estimate (${surface})`, async ($, on) => {
      stubAll(on, { usage: r })
      engine(on)
      stepEngine(on, () => MAIN)
      await measure($, r)
      await mainStep($)
      await inspect($, 'cache')

      const lines = await rows(await pane($, surface))
      expect(lines).toContain(`Tier      ${tier}, Claude Code's default ${name}`)
      if (name === 'within plan usage') {
        expect(lines.some(l => /^Cache\s+warm ≈60m ▰▰▰▰▱ 94% reused · 180k cached\s+Compact$/.test(l))).toBe(true)
      }
    })
  }

  test(`a variable that pins the tier is named (${surface})`, async ($, on) => {
    stubAll(on, { usage: PLAN, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })
    engine(on)
    await $.session.start(START)
    await inspect($, 'cache')

    expect(await rows(await pane($, surface))).toContain('Tier      5m, set by CLAUDE_CODE_PROMPT_CACHE_TTL')
  })

  test(`the band offers Compact in a 1h cache's last 5 minutes (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch(SWITCH)
    await oneTurn($)

    await clock.advance(3_000_000)
    expect(await rows(await bandOf($, surface))).toHaveLength(1)
    await clock.advance(360_000)
    const ui = await bandOf($, surface)
    expect((await rows(ui)).some(l => /⚠ cache cold in 4m Compact/.test(l))).toBe(true)
    expect((await ui.find({ key: 'compact' }))?.props.hotkey).toBe('3')
    // A 5m cache gets no toast to say 'press 3': the terminal draws '3: Compact'
    expect((await ui.find({ key: 'compact' }))?.props.plain).toBe(true)
  })

  test(`the band offers Compact in a 5m cache's last minute, with no toast (${surface})`, async ($, on) => {
    const { clock, toasts } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch({ ...SWITCH, cache_ttl: '5m' })
    await oneTurn($)

    await clock.advance(200_000)
    expect(await rows(await bandOf($, surface))).toHaveLength(1)
    await clock.advance(50_000)
    expect((await rows(await bandOf($, surface))).some(l => /⚠ cache cold in 1m Compact/.test(l))).toBe(true)
    expect(toasts).toEqual([])
  })

  test(`the Now tab carries the cache warning, so a collapsed band hides nothing (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await measure($, PLAN)
    await $.classic.PostModelSwitch({ ...SWITCH, cache_ttl: '5m' })
    await mainStep($)
    await inspect($, 'now')

    await clock.advance(200_000)
    const first = await pane($, surface)
    expect(await rows(first)).toContain('Nothing needs a look.')
    await first.unmount()
    await clock.advance(50_000)
    const lines = await rows(await pane($, surface))
    const look = lines.findIndex(l => l.startsWith('NEEDS A LOOK'))
    expect(lines.findIndex(l => /⚠ cache cold in 1m Compact/.test(l))).toBeGreaterThan(look)
    expect(lines).not.toContain('Nothing needs a look.')
  })

  // It walks an hour of the clock, 2 to 4 s of real time: a full run on a loaded machine needs more than the kit's 5 s
  test(`the Cache tab says when Claude Code should compact it itself, and the band waits for it (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { clock } = stubAll(on, { usage: { ...PLAN, context: { window: 1_000_000, tokens: 210_000, percent: 21 } } })
    engine(on)
    stepEngine(on, () => MAIN)
    await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
    await mainStep($)
    await inspect($, 'cache')

    expect(await rows(await pane($, surface)))
      .toContain(`Idle      Claude Code should compact it itself at ≈${clockText(3_240_000)}, else a warning at ≈${clockText(3_420_000)}`)
    await clock.advance(3_360_000)
    expect((await rows(await bandOf($, surface))).some(l => /⚠/.test(l))).toBe(false)
    await clock.advance(60_000)
    expect((await rows(await bandOf($, surface))).some(l => /⚠ cache cold in ≈3m Compact/.test(l))).toBe(true)
  })

  test(`under the floor, the Idle row names Claude Code's own compaction and no warning (${surface})`, async ($, on) => {
    stubAll(on, { usage: { ...PLAN, context: { window: 1_000_000, tokens: 210_000, percent: 21 } } })
    engine(on)
    stepEngine(on, () => ({ ...MAIN, input_tokens: 150_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 9_000 }))
    await $.session.start({ ...START, surface: 'terminal', isInteractive: true })
    await mainStep($)
    await inspect($, 'cache')

    expect(await rows(await pane($, surface))).toContain(`Idle      Claude Code should compact it itself at ≈${clockText(3_240_000)}`)
  })

  test(`a Compact press compacts once and counts it (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    const state = watchState(on)
    engine(on, ['session.compact'])
    stepEngine(on, () => MAIN)
    const triggers: string[] = []
    on('session.compact', (_, e) => {
      triggers.push(e.trigger)
      return { messages }
    })
    await measure($, PLAN)
    await mainStep($)
    await inspect($, 'cache')

    await (await pane($, surface)).press({ key: 'compact' })
    await clock.settle()

    // The engine stamps a plugin's compaction 'plugin'; the kit leaves the trigger unset
    expect(triggers).toHaveLength(1)
    expect((state.get('meta') as Meta).compactions).toBe(1)
    expect((state.get('cache') as Cache).lastAt).toBe(null)
  })

  test(`a skipped compaction says why (${surface})`, async ($, on) => {
    const { toasts } = stubAll(on, { usage: PLAN })
    const state = watchState(on)
    engine(on, ['session.compact'])
    stepEngine(on, () => MAIN)
    on('session.compact', () => ({ skip: 'nothing to compact' }))
    await measure($, PLAN)
    await mainStep($)
    await inspect($, 'cache')

    await (await pane($, surface)).press({ key: 'compact' })

    expect(toasts).toEqual(['Compact skipped: nothing to compact'])
    expect((state.get('meta') as Meta | undefined)?.compactions).not.toBe(1)
  })

  test(`a second Compact press while one runs starts none (${surface})`, async ($, on) => {
    const { clock, toasts } = stubAll(on, { usage: PLAN })
    engine(on, ['session.compact'])
    stepEngine(on, () => MAIN)
    const triggers: string[] = []
    on('session.compact', async (_, e) => {
      triggers.push(e.trigger)
      await clock.sleep(1000)
      return { messages }
    })
    await measure($, PLAN)
    await mainStep($)
    await inspect($, 'cache')
    const ui = await pane($, surface)

    await ui.press({ key: 'compact' })
    await ui.press({ key: 'compact' })
    await clock.advance(1000)

    expect(triggers).toHaveLength(1)
    expect(toasts).toEqual(['Compact is already running.'])
  })

  test(`the Cache tab counts down while idle (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await $.session.start(START)
    await $.classic.PostModelSwitch(SWITCH)
    await mainStep($)
    await inspect($, 'cache')
    const ui = await pane($, surface)

    expect((await rows(ui)).some(l => /warm 60m/.test(l))).toBe(true)
    await clock.advance(60_000)
    expect((await rows(ui)).some(l => /warm 59m/.test(l))).toBe(true)
  })

  test(`a 5m cache counts down to cold while idle (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: PLAN })
    engine(on)
    stepEngine(on, () => MAIN)
    await $.session.start(START)
    await $.classic.PostModelSwitch({ ...SWITCH, cache_ttl: '5m' })
    await mainStep($)
    await inspect($, 'cache')
    const ui = await pane($, surface)

    expect((await rows(ui)).some(l => /warm 5m/.test(l))).toBe(true)
    await clock.advance(240_000)
    expect((await rows(ui)).some(l => /warm 1m/.test(l))).toBe(true)
    await clock.advance(61_000)
    expect((await rows(ui)).some(l => /^Cache\s+cold /.test(l))).toBe(true)
  })

  test(`the tab bar colours Cache cyan (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    await inspect($, 'now')

    const texts = await (await pane($, surface)).findAll({ type: 'Text' })
    expect(texts.find(t => t.text === 'Cache')?.props).toMatchObject({ color: '#22d3ee', bold: true })
  })

  test(`/inspect cache opens the Cache tab (${surface})`, async ($, on) => {
    const { opened } = stubAll(on)
    engine(on)

    expect((await inspect($, 'cache')).text).toBe('Opened the inspect pane.')
    expect(opened).toEqual(['inspect'])
    expect(await rows(await pane($, surface))).toContain('Cache     no main-loop request yet')
  })
}
