import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import { PRESENTATION, engine, rows, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const SUBSCRIPTION: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 60_000, percent: 30 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' }],
  cost: { usd: 3.12 },
}

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const bandOf = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: BAND })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

// Claude Code answers each `false` command with an error and any other call with its result
function failingCalls(on: On): void {
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1\nboom', text: 'Exit code 1\nboom' } : { result: 'ok', text: 'ok' })
}

async function turn($: Engine, turnId: string, failing: string[] = []): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId })
  for (const id of failing) await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: id })
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' })
}

for (const surface of SURFACES) {
  test(`/inspect tools opens the Tools tab (${surface})`, async ($, on) => {
    const { opened } = stubAll(on, { usage: SUBSCRIPTION })
    failingCalls(on)
    engine(on, ['tool.call'])
    await turn($, 't1', ['c1'])

    expect((await inspect($, 'tools')).text).toBe('Opened the inspect pane.')
    expect(opened).toEqual(['inspect'])
    const lines = await rows(await pane($, surface))
    expect(lines.some(l => /Bash\s+1\s+0\s+1\s+0/.test(l))).toBe(true)
    expect(lines.some(l => /Exit code 1/.test(l))).toBe(true)
  })

  test(`/inspect bogus lists the tabs and opens nothing (${surface})`, async ($, on) => {
    const { opened } = stubAll(on, { usage: SUBSCRIPTION })
    engine(on)

    expect((await inspect($, 'bogus')).text).toBe('Tabs: now, usage, tools, timeline.')
    expect(opened).toEqual([])
  })

  test(`/inspect says so when the surface leaves the pane undrawn (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION, unplaced: 'no surface attached' })
    engine(on)

    expect((await inspect($, 'now')).text).toBe('The inspect pane is open but not drawn: no surface attached.')
  })

  test(`opening Now marks failures seen (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    failingCalls(on)
    engine(on, ['tool.call'])
    await turn($, 't1', ['c1'])
    const band = await bandOf($, surface)
    expect((await rows(band)).some(l => /✗ 1 new/.test(l))).toBe(true)

    await inspect($, '')

    expect((await rows(band)).some(l => /✗ 1 new/.test(l))).toBe(false)
  })

  // The engine says whether the pane is up: the mod's own flag missed a pane placed later, and a /clear reset it
  test(`a pane placed after it waited undrawn sees new failures (${surface})`, async ($, on) => {
    const { panes } = stubAll(on, { usage: SUBSCRIPTION, unplaced: 'unasked below 144 columns (120 now)' })
    failingCalls(on)
    engine(on, ['tool.call'])
    await inspect($, 'now')
    const waiting = panes[0]
    if (waiting !== undefined) panes[0] = { ...waiting, isPlaced: true, isShown: true }

    await turn($, 't1', ['c1'])

    expect((await rows(await bandOf($, surface))).some(l => /✗ 1 new/.test(l))).toBe(false)
  })

  test(`after /clear a failure under the shown pane is not new (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    failingCalls(on)
    engine(on, ['tool.call'])
    await inspect($, 'now')
    await $.classic.SessionStart({ source: 'clear' })

    await turn($, 't1', ['c1'])

    expect((await rows(await bandOf($, surface))).some(l => /✗ 1 new/.test(l))).toBe(false)
  })

  test(`Show expands the error and Copy copies it (${surface})`, async ($, on) => {
    const { copied } = stubAll(on, { usage: SUBSCRIPTION })
    failingCalls(on)
    engine(on, ['tool.call'])
    await turn($, 't1', ['c1'])
    await inspect($, 'now')
    const ui = await pane($, surface)

    await ui.press({ key: 'show-c1' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('Exit code 1\nboom')
    await ui.press({ key: 'copy-c1' })
    expect(copied).toEqual(['Exit code 1\nboom'])
  })

  // Tool output can carry colour codes and carriage returns, and a tree holding one is refused whole (Task 9, live)
  test(`an error's control characters are not drawn (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    on('tool.call', () => ({ isError: true as const, result: 'x', text: '\x1b[31mFAIL\x1b[0m one\r\ntwo\x07' }))
    engine(on, ['tool.call'])
    await turn($, 't1', ['c1'])
    await inspect($, 'now')
    const ui = await pane($, surface)

    expect((await rows(ui)).some(l => /✗ \S+ Bash .*FAIL one/.test(l))).toBe(true)
    await ui.press({ key: 'show-c1' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('FAIL one\ntwo')
  })

  test(`the Usage tab has no Account row and labels a subscription's cost est. (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    engine(on)
    await turn($, 't1')
    await inspect($, 'usage')

    const lines = await rows(await pane($, surface))

    expect(lines.some(l => /Account/.test(l))).toBe(false)
    expect(lines.some(l => /\$3\.12 session · \$3\.12 today, est\./.test(l))).toBe(true)
  })

  // One bar everywhere, the band's (the user, 2026-10-28)
  test(`the Usage tab draws the band's bar (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    engine(on)
    await turn($, 't1')
    await inspect($, 'usage')

    const lines = await rows(await pane($, surface))

    expect(lines.some(l => /^Context\s+▰▱▱▱▱ 30%/.test(l))).toBe(true)
    expect(lines.some(l => /^5h\s+▰▱▱▱▱ 20%   resets \d\d\.\d\d \d\d:\d\d/.test(l))).toBe(true)
    expect(lines.some(l => /^7d\s+▰▰▱▱▱ 40%   resets \d\d\.\d\d \d\d:\d\d/.test(l))).toBe(true)
  })

  test(`a Usage tab percent takes its threshold colour (${surface})`, async ($, on) => {
    stubAll(on, { usage: { ...SUBSCRIPTION, context: { window: 200_000, tokens: 180_000, percent: 90 } } })
    engine(on)
    await turn($, 't1')
    await inspect($, 'usage')

    const texts = await (await pane($, surface)).findAll({ type: 'Text' })

    expect(texts.find(t => t.text === ' 90%')?.props.color).toBe('#ef4444')
    expect(texts.find(t => t.text === ' 40%')?.props.color).toBe('#22c55e')
  })

  test(`the Usage tab says when a window runs out before its reset (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: SUBSCRIPTION, now: Date.parse('2026-10-28T14:00:00Z') })
    engine(on)
    await turn($, 't1')
    for (const percentUsed of [40, 50, 60]) {
      await $.session.measure({ context: SUBSCRIPTION.context, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: '2026-10-28T17:00:00Z' }] })
      await clock.advance(600_000)
    }
    await inspect($, 'usage')

    const lines = await rows(await pane($, surface))

    expect(lines.some(l => /^5h\s+.* 60%   resets .*   full ≈\d\d:\d\d/.test(l))).toBe(true)
  })

  test(`the Timeline lists turns newest first (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: SUBSCRIPTION })
    engine(on)
    await turn($, 't1')
    await clock.advance(60_000)
    await turn($, 't2')
    await inspect($, 'timeline')

    const lines = await rows(await pane($, surface))
    const first = lines.findIndex(l => /^#\s+you/.test(l))

    expect(lines[first + 1]).toMatch(/^2\s/)
    expect(lines[first + 2]).toMatch(/^1\s/)
  })

  test(`a tab button switches the tab (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION })
    engine(on)
    await turn($, 't1')
    await inspect($, 'now')
    const ui = await pane($, surface)

    await ui.press({ key: 'tab-timeline' })

    expect((await rows(ui)).some(l => /^#\s+you/.test(l))).toBe(true)
  })
}
