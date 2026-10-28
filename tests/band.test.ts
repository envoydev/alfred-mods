import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface, SessionRateLimit, SessionUsage } from 'claude-code'

import { drawLines } from '../hooks/draw.tsx'
import { mask } from '../hooks/mask.ts'
import { START, engine, rows, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const

const band = (isWorking: boolean, bodyColumns = 120, hasSurvey = false) =>
  ({ hasSurvey, isWorking, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} })

const mount = ($: Engine, surface: RenderSurface, props: ReturnType<typeof band>) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props })

// A reading at these percents: context, the 5h window and the weekly one; a figure left out is not reported
function reading(ctx?: number, fiveHour?: number, week?: number, usd?: number): SessionUsage {
  const limits: SessionRateLimit[] = []
  if (fiveHour !== undefined) limits.push({ kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-10-28T17:00:00Z' })
  if (week !== undefined) limits.push({ kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-31T09:00:00Z' })
  return {
    startedAt: 0,
    context: ctx === undefined ? { window: 200_000 } : { window: 200_000, tokens: ctx * 2000, percent: ctx },
    rateLimits: limits,
    ...(usd === undefined ? {} : { cost: { usd } }),
  }
}

// Claude Code answers each `false <n>` command with an error and any other call with its result
function failingCalls(on: On): void {
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: 'ok', text: 'ok' })
}

async function oneTurn($: Engine, failing = 0): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  for (let i = 0; i < failing; i++) await $.tool.call({ tool: 'Bash', command: `false ${i}` })
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
}

for (const surface of SURFACES) {
  test(`the band shows dashes before the first reading (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading() })
    engine(on)
    await oneTurn($)

    const lines = await rows(await mount($, surface, band(false)))

    expect(lines.some(l => /ctx —/.test(l))).toBe(true)
    expect(lines.some(l => /NaN|undefined|5h|\$/.test(l))).toBe(false)
  })

  test(`healthy idle is one dim line (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading(30, 15, 40) })
    engine(on)
    await oneTurn($)

    const ui = await mount($, surface, band(false))
    const lines = await rows(ui)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/ctx ■■■ ■□□ □□□ □□□ □□□ 30% │ 5h ■■□ □□□ □□□ □□□ □□□ 15% │ wk 40%/)
    // The runs inside the line's one truncating Text carry the style; the Text around them carries none
    const texts = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === undefined)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every(t => t.props.dimColor === true)).toBe(true)
  })

  test(`needs-you shows the last turn and the Inspect button (${surface})`, async ($, on) => {
    const { opened } = stubAll(on, { usage: reading(82, 20, 30) })
    failingCalls(on)
    engine(on, ['tool.call'])
    await oneTurn($, 2)

    const ui = await mount($, surface, band(false))
    const lines = await rows(ui)

    expect(lines.some(l => /✓ Turn 1/.test(l))).toBe(true)
    expect(lines.some(l => /✗ 2 new/.test(l))).toBe(true)
    expect(await ui.find({ key: 'inspect' })).toBeDefined()
    await ui.press({ key: 'inspect' })
    expect(opened).toEqual(['inspect'])
    expect((await rows(ui)).some(l => /✗ 2 new/.test(l))).toBe(false)
  })

  test(`an Inspect the surface leaves undrawn keeps the failures new and says why (${surface})`, async ($, on) => {
    const { toasts } = stubAll(on, { usage: reading(82, 20, 30), unplaced: 'opened unasked under 144 columns (120 now)' })
    failingCalls(on)
    engine(on, ['tool.call'])
    await oneTurn($, 2)

    const ui = await mount($, surface, band(false))
    await ui.press({ key: 'inspect' })

    expect((await rows(ui)).some(l => /✗ 2 new/.test(l))).toBe(true)
    expect(toasts).toEqual(['Inspect pane not drawn: opened unasked under 144 columns (120 now)'])
  })

  // Claude Code counts a press as the person's only while its closure runs, so the open cannot wait on a write
  test(`the Inspect press opens the pane before its first state write (${surface})`, async ($, on) => {
    const { opened } = stubAll(on, { usage: reading(82, 20, 30) })
    failingCalls(on)
    engine(on, ['tool.call'])
    const openedAtWrite: number[] = []
    on('state.set', (_, e, next) => {
      openedAtWrite.push(opened.length)
      return next(e)
    })
    await oneTurn($, 1)
    const ui = await mount($, surface, band(false))
    openedAtWrite.length = 0

    await ui.press({ key: 'inspect' })

    expect(openedAtWrite[0]).toBe(1)
  })

  // A Text per segment wraps inside itself once the line passes the width, splitting '≈304 turns' (Task 8, live)
  test(`a line's texts are one Text that truncates at the end (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading(82, 20, 30) })
    failingCalls(on)
    engine(on, ['tool.call'])
    await oneTurn($, 1)

    const ui = await mount($, surface, band(false))
    const runs = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate-end')

    expect(runs.some(t => /^✓ Turn 1 · 3s · 1 tool · 1 ✗ │ you /.test(t.text ?? ''))).toBe(true)
    expect(runs.some(t => /^ctx .* │ 5h .* │ wk 30%$/.test(t.text ?? ''))).toBe(true)
  })

  // At 120 columns '≈N turns', 'on pace' and the cost pushed the times past the width (Task 8, live)
  test(`a calm line too long for the width keeps every figure on 5-cell bars (${surface})`, async ($, on) => {
    const { usage } = stubAll(on, { usage: reading(10, 15, 40, 3.12) })
    engine(on)
    for (const [i, ctx] of [10, 15, 20].entries()) {
      usage.current = reading(ctx, 15, 40, 3.12)
      await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
      await $.turn.start({ text: 'q', turnId: `t${i}` })
      await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: `t${i}`, reason: 'answer' })
    }

    const lines = await rows(await mount($, surface, band(false, 100)))

    expect(lines).toHaveLength(1)
    expect(lines[0]?.length ?? 0).toBeLessThanOrEqual(100)
    expect(lines[0]).toMatch(/^ctx ■□□□□ 20% ≈\d+ turns │ 5h □□□□□ 15% │ wk 40% │ \$3\.12 │ you \d\d:\d\d · Claude \d\d:\d\d$/)
  })

  test(`working shows the running Bash and its time (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: reading(30, 15, 40) })
    on('tool.call', async () => {
      await clock.sleep(60_000)
      return { result: 'ok', text: 'ok' }
    })
    engine(on, ['tool.call'])
    await $.session.start(START)
    await $.turn.start({ text: 'q', turnId: 't1' })
    const first = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' })
    await clock.advance(12_000)

    const ui = await mount($, surface, band(true))
    expect((await rows(ui)).some(l => /⟳ Turn 1 · 0:12 │ Bash ▸ Run tests 0:12/.test(l))).toBe(true)

    const second = $.tool.call({ tool: 'Bash', command: 'npm run lint', description: 'Lint' })
    await clock.settle()
    expect((await rows(ui)).some(l => / \+1$/.test(l))).toBe(true)

    await clock.advance(60_000)
    await Promise.all([first, second])
    await ui.unmount()
  })

  test(`the band narrows under 100 columns (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading(45, 25, 62) })
    engine(on)
    await oneTurn($)

    const lines = await rows(await mount($, surface, band(false, 90)))

    expect(lines.some(l => /ctx ■■□□□ 45% · 5h ■□□□□ 25% · wk ■■■□□ 62%/.test(l))).toBe(true)
  })

  test(`NO_COLOR drops every colour (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading(82, 20, 70, 3.12), env: { NO_COLOR: '1' } })
    failingCalls(on)
    engine(on, ['tool.call'])
    await oneTurn($, 1)

    const drawn = JSON.stringify(await (await mount($, surface, band(false))).drawn())

    expect(drawn).toMatch(/✗ 1 new/)
    expect(drawn).not.toMatch(/"(color|dimColor)"/)
  })

  test(`a survey holds the band (${surface})`, async ($, on) => {
    stubAll(on, { usage: reading(30, 15, 40) })
    engine(on)
    // This hook stands for the engine's own drawing
    on('ui.render', (h$, e) => {
      const { Text } = h$.ui.resolve(e)
      return h(Text, null, 'engine') as RenderElement
    })
    await oneTurn($)

    expect(await rows(await mount($, surface, band(false, 120, true)))).toEqual(['engine'])
  })
}

test('every drawn string passes through mask', async ($, on) => {
  // drawLines draws a site the mod leaves to the engine, with a hook's `$`
  on('ui.render', (h$, e) => drawLines(h$, e, [[{ text: 'abc' }]], { noColor: false, press: {} }))
  const ui = await $.ui.mount({
    plugin: 'session-inspector', surface: 'terminal', component: 'Pane', requestId: 'mask-check',
    props: { title: 'mask', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })

  expect((await ui.find({ type: 'Text' }))?.text).toBe(mask('abc'))
})
