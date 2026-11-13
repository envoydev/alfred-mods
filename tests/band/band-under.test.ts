// The band under the input (spec 2026-11-11 band-under, U2, U4, U5): `/band under` draws the band in Claude Code's
// footer on the terminal, under Claude Code's own line, and the site above passes once the footer has drawn
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, RenderViewport } from 'claude-code'

import { underRows } from '../../hooks/band/band'
import { START, engine, engineSites, failState, rows, stubAll } from '../kit'

const ABOVE = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const MAIN: RenderViewport = { columns: 130, rows: 40, isFullscreen: false }
const UNDER = { 'settings:band-place': 'under' }

const footer = ($: Engine, surface: RenderSurface = 'terminal', viewport: RenderViewport = MAIN) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'PromptHint', props: HINT, viewport })
const above = ($: Engine, surface: RenderSurface = 'terminal', props = ABOVE) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props, viewport: MAIN })
const measure = ($: Engine, percent: number) =>
  $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })

// The first child of the drawn tree, as text: Claude Code's own line, which the engineSites stub draws as its props
const first = async (ui: { drawn: () => Promise<unknown> }): Promise<string> =>
  JSON.stringify(((await ui.drawn()) as { children?: unknown[] }).children?.[0] ?? null)
// The whole drawing is the stub's own line: Claude Code's footer as it was handed
const isEngineOnly = async (ui: { drawn: () => Promise<unknown> }): Promise<boolean> =>
  ((await ui.drawn()) as { type?: string }).type === 'Text' && JSON.stringify(await ui.drawn()).includes('? for shortcuts')
const isBand = (lines: string[]): boolean => lines.some(l => l.startsWith('tools:'))
// A session with something in three detail rows, which wait for their first item (the user, 2026-11-12): one tool
// call, one skill and one rule loaded by path
async function busy($: Engine): Promise<void> {
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'b1' })
  await $.tool.call({ tool: 'Skill', skill: 'solve-task', tool_use_id: 's1' })
  await $.classic.InstructionsLoaded({ file_path: '/w/.claude/rules/web.md', memory_type: 'Project', load_reason: 'path_glob_match', globs: ['src/**'], trigger_file_path: '/w/src/a.ts' } as never)
}

test("under, the footer draws Claude Code's line, then the band, and the site above passes", async ($, on) => {
  const kit = stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const { invalidates } = kit
  const low = await footer($)
  expect(await first(low)).toContain('? for shortcuts')
  expect(isBand(await rows(low))).toBe(true)
  expect(invalidates).toContain('ui.render')
  const high = await above($)
  expect(isBand(await rows(high))).toBe(false)
  await high.unmount()
  await low.unmount()
})

test('before the footer runs, the band stays above', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const high = await above($)
  expect(isBand(await rows(high))).toBe(true)
  const low = await footer($)
  expect(isBand(await rows(low))).toBe(true)
  // The footer's first run asks for a redraw (the kit records it rather than drawing again)
  await high.redraw()
  expect(isBand(await rows(high))).toBe(false)
  await high.unmount()
  await low.unmount()
})

test('the desktop keeps the band above, under or not', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($, 'desktop')
  expect(await isEngineOnly(low)).toBe(true)
  const high = await above($, 'desktop')
  expect(isBand(await rows(high))).toBe(true)
  await high.unmount()
  await low.unmount()
})

test("above, the footer is Claude Code's alone", async ($, on) => {
  stubAll(on, { band: 'full' })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($)
  expect(await isEngineOnly(low)).toBe(true)
  await low.unmount()
})

test('the width follows the site above, and redraws once per change', async ($, on) => {
  const { invalidates } = stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($, 'terminal', { columns: 130, rows: 40, isFullscreen: false })
  expect((await rows(low)).every(r => [...r].length <= 125)).toBe(true)
  const wide = await rows(low)
  // A new width asks for one redraw; the same width again asks for none
  const count = invalidates.length
  const high = await above($, 'terminal', { ...ABOVE, bodyColumns: 14 })
  expect(invalidates.length).toBe(count + 1)
  await high.redraw({ ...ABOVE, bodyColumns: 14 })
  expect(invalidates.length).toBe(count + 1)
  await low.redraw()
  const narrow = await rows(low)
  expect(narrow.every(r => [...r].length <= 14)).toBe(true)
  expect(narrow).not.toEqual(wide)
  await high.unmount()
  await low.unmount()
})

test('the rows under: half the fullscreen less the footer and prompt, the main screen whole', () => {
  const none = { hasStatusLine: false, isPinned: false }
  expect(underRows({ rows: 40, isFullscreen: true }, none)).toBe(14)
  expect(underRows({ rows: 40, isFullscreen: true }, { hasStatusLine: true, isPinned: false })).toBe(12)
  expect(underRows({ rows: 40, isFullscreen: true }, { hasStatusLine: true, isPinned: true })).toBe(11)
  expect(underRows({ rows: 10, isFullscreen: true }, { hasStatusLine: true, isPinned: true })).toBe(2)
  expect(underRows({ rows: 40, isFullscreen: false }, { hasStatusLine: true, isPinned: true })).toBe(40)
  expect(underRows({ rows: 40 }, none)).toBe(40)
})

test('fullscreen at 20 rows draws at most 4 band rows, dropping the open rows from the last', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($, 'terminal', { columns: 130, rows: 20, isFullscreen: true })
  const drawn = await rows(low)
  expect(drawn).toHaveLength(4)
  expect(drawn.some(r => r.startsWith('tools:'))).toBe(true)
  expect(drawn.some(r => r.startsWith('rules:'))).toBe(false)
  await low.unmount()
})

// The status line is read at session start (spec Rows: '12 with a statusLine set' at 40, here 4 of 6 at 24)
test('fullscreen at 24 rows draws 6 band rows, 4 with a status line set', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($, 'terminal', { columns: 130, rows: 24, isFullscreen: true })
  expect(await rows(low)).toHaveLength(6)
  await low.unmount()
})

test('a status line set leaves the band two rows fewer in fullscreen', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER, settings: { statusLine: { type: 'command', command: 'printf hud' } } })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($, 'terminal', { columns: 130, rows: 24, isFullscreen: true })
  expect(await rows(low)).toHaveLength(4)
  await low.unmount()
})

test('under, the pinned line leaves REC out while the footer draws the band', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses, clock } = stubAll(on, { band: 'full', store: { ...UNDER, 'settings:rec': 'on' } })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($)
  await clock.advance(1000)
  expect(statuses[statuses.length - 1]).toBeUndefined()
  const high = await above($)
  await clock.advance(1000)
  expect(statuses[statuses.length - 1]).toBeUndefined()
  await high.unmount()
  await low.unmount()
})

test("a refused read under keeps Claude Code's line and shows the failure note", { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses, clock } = stubAll(on, { band: 'full', store: { ...UNDER, 'settings:rec': 'on' } })
  engineSites(on)
  const fail = failState(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($)
  fail.key = 'band'
  await low.redraw()
  expect(await first(low)).toContain('? for shortcuts')
  expect(JSON.stringify(await low.drawn())).toContain('the band failed to draw')
  const high = await above($)
  expect(JSON.stringify(await high.drawn())).not.toContain('the band failed to draw')
  await clock.advance(1000)
  expect(statuses[statuses.length - 1]).toBe('● REC')
  await high.unmount()
  await low.unmount()
})

test('a refused read above leaves the footer as Claude Code drew it', async ($, on) => {
  stubAll(on, { band: 'full' })
  engineSites(on)
  const fail = failState(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  fail.key = 'band'
  const low = await footer($)
  expect(await isEngineOnly(low)).toBe(true)
  await low.unmount()
})

test('a survey above is never hidden', async ($, on) => {
  stubAll(on, { band: 'full' })
  engineSites(on)
  const fail = failState(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  fail.key = 'band'
  const high = await above($, 'terminal', { ...ABOVE, hasSurvey: true })
  expect(JSON.stringify(await high.drawn())).not.toContain('the band failed to draw')
  await high.unmount()
})

test("calm under draws the calm band's lines under Claude Code's line", async ($, on) => {
  stubAll(on, { band: 'unset', store: { ...UNDER, 'settings:band': 'calm' } })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($)
  expect(await first(low)).toContain('? for shortcuts')
  // The same lines the calm band draws above, where the desktop keeps it
  const high = await above($, 'desktop')
  expect(await rows(low)).toEqual(await rows(high))
  expect((await rows(low)).length).toBeGreaterThan(0)
  expect(isBand(await rows(low))).toBe(false)
  await high.unmount()
  await low.unmount()
})

test('a new session starts with no footer seen', async ($, on) => {
  stubAll(on, { band: 'full', store: UNDER })
  engineSites(on)
  engine(on)
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const low = await footer($)
  await low.unmount()
  await $.session.start(START)
  await measure($, 40)
  await busy($)
  const high = await above($)
  expect(isBand(await rows(high))).toBe(true)
  await high.unmount()
})
