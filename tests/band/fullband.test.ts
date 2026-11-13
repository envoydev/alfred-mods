// The full band (spec A): the turn's tool count on line 1, today's cost on line 2, and an info line under the gauges
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionUsage } from 'claude-code'

import { bandLines, cellsOf, infoLine } from '../../hooks/band/band'
import { clock, widthOf } from '../../hooks/core/format'
import { START, engine, rows, step, stepEngine, stubAll } from '../kit'
import type { BandInput } from '../../hooks/band/types'
import type { Cache } from '../../hooks/cache/types'
import type { Line } from '../../hooks/core/types'
import type { Turn } from '../../hooks/session/types'
import type { ToolStat } from '../../hooks/tools/types'


const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-28T14:00:00Z')
const P = NOW - 73 * 60_000
const R = NOW - 2 * 60_000
const HEAD = 'Sonnet 5.5 ◑ medium │ 59m │ ≈133 tok/s avg │ cache warm 54m'
const FULL = `${HEAD} │ you ${clock(P)} · Claude ${clock(R)}`

const stat = (calls: number): ToolStat => ({ calls, ok: calls, failed: 0, stopped: 0 })
const turn = (n: number, contextPercent: number | null = null): Turn => ({
  n, turnId: `t${n}`, promptAt: P, replyAt: R, durationMs: 3000, tokensIn: 0, tokensOut: 0, tools: 19, failures: 0, contextPercent, end: 'answer',
})
const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: NOW - 6 * 60_000, last: { read: 1000, write: 0, input: 10 },
  session: { read: 1000, write: 0, input: 10 }, toastedFor: null,
}
const COLD: Cache = { ...CACHE, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 } }
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' },
  { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' },
]

// The mockup's session, idle and healthy, at 200 columns
function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full',
    live: { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null },
    usage: { tokens: 60_000, window: 200_000, percent: 30, startedAt: NOW - 59 * 60_000, windows: WINDOWS, costUsd: 1.29, todayUsd: 10.46, at: NOW },
    meta: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: P, lastReplyAt: R, turnCount: 1,
      waiting: [], mainCalls: 19,
    },
    turns: [turn(1)], newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, planInvalid: false, score: null,
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 13_300, stepMs: 100_000 },
    stats: { AskUserQuestion: stat(13), Bash: stat(5), Grep: stat(1) },
    ...o,
  }
}

// A button as the terminal draws a bracketed one
const text = (line: Line): string => line.map(s => ('text' in s ? s.text : 'button' in s ? `[ ${s.button.label} ]` : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

test("the info line holds every item in the user's order", () => {
  expect(text(infoLine(input({ columns: 86 })))).toBe(FULL)
  expect(cellsOf(infoLine(input({ columns: 86 })))).toBe(86)
})

test('the info line drops items by keep order, whole', () => {
  const at = (columns: number) => text(infoLine(input({ columns })))
  expect(at(85)).toBe(FULL.replace(` · Claude ${clock(R)}`, ''))
  expect(at(71)).toBe(`${HEAD} │ you ${clock(P)}`)
  expect(at(70)).toBe(HEAD)
  // tok/s goes before the cache
  expect(at(58)).toBe('Sonnet 5.5 ◑ medium │ 59m │ cache warm 54m')
  expect(at(41)).toBe('Sonnet 5.5 ◑ medium │ 59m')
  expect(at(24)).toBe('Sonnet 5.5 ◑ medium')
  expect(infoLine(input({ columns: 18 }))).toEqual([])
})

test("while a turn runs, the info line's 'you' is that turn's prompt", () => {
  const at = NOW - 14_000
  const running = input({ isWorking: true, live: { turnId: 't2', startedAt: at, tools: 0, failures: 0, running: [], promptAt: at } })
  expect(text(infoLine(running)).endsWith(`│ you ${clock(at)} · Claude ${clock(R)}`)).toBe(true)
})

test('an unknown model id draws as given', () => {
  const line = infoLine(input({ meta: { ...input().meta, model: 'my-model' } }))
  expect(line[0]).toEqual({ text: 'my-model' })
})

test("a fresh session's info line holds the model and the time alone", () => {
  const fresh = input({
    stats: {}, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 }, cache: COLD, turns: [],
    meta: { ...input().meta, lastPromptAt: null, lastReplyAt: null }, usage: { ...input().usage, startedAt: NOW - 30_000 },
  })
  const line = text(infoLine(fresh))
  expect(line).toBe('Sonnet 5.5 ◑ medium │ <1m')
  for (const absent of ['NaN', '×', 'cache', 'tok/s']) expect(line.includes(absent)).toBe(false)
})

test("full mode: line 1 counts the turn's tools, line 2 adds today while it fits", () => {
  const working = (tools: number) => texts(bandLines(input({
    isWorking: true, live: { turnId: 't2', startedAt: NOW - 14_000, tools, failures: 0, running: [], promptAt: NOW - 14_000 },
  })))[0] ?? ''
  expect(working(18).startsWith('⟳ Turn 2 · 0:14')).toBe(true)
  expect(working(18).includes(' · 18 tools')).toBe(true)
  expect(working(1).includes(' · 1 tool')).toBe(true)
  expect(working(1).includes(' · 1 tools')).toBe(false)

  // Idle with a new failure, the context forecast and the 5h pace on line 2, so it is over 100 columns wide
  const points = [{ at: NOW - 60 * 60_000, percent: 15 }, { at: NOW - 30 * 60_000, percent: 15 }, { at: NOW - 60_000, percent: 15 }]
  const needs = (columns: number) => bandLines(input({
    columns, newFailures: 1, turns: [turn(1, 20), turn(2, 25), turn(3, 30)],
    pace: { five_hour: { resetsAt: '2026-10-28T17:00:00Z', points, toasted: [] } },
  }))
  const wide = needs(200)
  expect(text(wide[1] ?? []).endsWith('$1.29 · today $10.46')).toBe(true)
  expect(text(wide[2] ?? [])).toBe(text(infoLine(input({ columns: 200 }))))
  const cut = widthOf(wide[1] ?? []) - 1
  expect(cut).toBeGreaterThanOrEqual(100)
  expect(text(needs(cut)[1] ?? []).endsWith('$1.29')).toBe(true)
  expect(text(needs(99)[1] ?? []).includes('$')).toBe(false)
})

test('full mode, idle and healthy: two lines in their colours and usage:, no times on the gauge line', () => {
  const lines = bandLines(input())
  expect(texts(lines)).toHaveLength(3)
  expect(text(lines[2] ?? [])).toBe('usage:   [ 19 tools ]')
  expect(lines[0]?.[0]).toEqual({ text: 'ctx ', tone: 'usage' })
  expect(text(lines[0] ?? []).includes('you ')).toBe(false)
  expect(text(lines[0] ?? []).endsWith('$1.29 · today $10.46')).toBe(true)
})

test('calm mode draws what no mode draws', () => {
  const idle = input()
  const working = input({ isWorking: true, live: { turnId: 't2', startedAt: NOW - 14_000, tools: 18, failures: 0, running: [], promptAt: null } })
  const needs = input({ newFailures: 2 })
  for (const x of [idle, working, needs]) {
    const calm = bandLines({ ...x, mode: 'calm' })
    expect(calm).toEqual(bandLines({ ...x, mode: undefined }))
    expect(texts(calm).some(l => l.includes('tok/s') || l.includes('today'))).toBe(false)
  }
  expect((texts(bandLines({ ...working, mode: 'calm' }))[0] ?? '').includes(' tools')).toBe(false)
})

test("REC's mark and the banner narrow line 1 only: the lines under it keep the band's width", () => {
  const marks = { rec: { level: 'on' as const, words: 0 }, banner: [{ text: 'auto-run · scorer high', tone: 'dim' as const }] }
  for (const o of [{ newFailures: 1 }, {}]) {
    const plain = bandLines(input({ columns: 128, ...o }))
    const marked = bandLines(input({ columns: 128, ...o, ...marks }))
    expect(text(marked[0] ?? []).startsWith('● REC │ auto-run · scorer high │ ')).toBe(true)
    expect(texts(marked.slice(1))).toEqual(texts(plain.slice(1)))
    expect(texts(marked).includes(FULL)).toBe(true)
  }
})

// A bare digit arms only the buttons wholly inside the band's window (types, `maxRows`): short of rows, the info line
// goes, so the line under it, with [Inspect], [Compact] or [Handoff], stays in view
test('short of rows, the full band drops its info line and keeps the buttons in view', () => {
  const inspect = (lines: Line[]): boolean => (lines[lines.length - 1] ?? []).some(s => 'button' in s && s.button.key === 'inspect')
  const short = bandLines(input({ newFailures: 1, maxRows: 3 }))
  expect(short).toHaveLength(3)
  expect(inspect(short)).toBe(true)
  expect(texts(short).includes(FULL)).toBe(false)
  const tall = bandLines(input({ newFailures: 1, maxRows: 4 }))
  expect(tall).toHaveLength(4)
  expect(inspect(tall)).toBe(true)
  expect(texts(tall).includes(FULL)).toBe(true)
  // With REC's mark on a row of its own, the row count is the band's whole
  const marked = bandLines(input({ columns: 128, newFailures: 1, maxRows: 4, rec: { level: 'on', words: 0 }, banner: [{ text: 'x'.repeat(120) }] }))
  expect(marked).toHaveLength(4)
  expect(inspect(marked)).toBe(true)
})

// Every tool by name and the skills in context (the user, 2026-11-11): usage: counts them as text (settings-values S6),
// and open, rows under it list them all
const tools = (lines: Line[]) => lines.flat().find(s => 'button' in s && s.button.key === 'tools')

test("usage: counts the session's tool calls and the main chat's skills, never a Skill call as a tool", () => {
  const skills = { 'superpowers:brainstorming': 1, 'solve-task': 2 }
  const at = (o: Partial<BandInput>) => texts(bandLines(input({ columns: 200, ...o }))).find(l => l.startsWith('usage:'))
  const meta = input().meta
  expect(at({ meta: { ...meta, skills: { 'solve-task': 2 } } })).toBe('usage:   [ 19 tools · 1 skill ]')
  expect(at({ meta: { ...meta, skills }, stats: { ...input().stats, 'Skill: solve-task': stat(2) } })).toBe('usage:   [ 19 tools · 2 skills ]')
  expect(at({ meta: { ...meta, skills }, stats: {} })).toBe('usage:   [ 2 skills ]')
  expect(at({ stats: { Bash: stat(1) } })).toBe('usage:   [ 1 tool ]')
  expect(at({ isToolsOpen: true })).toBe('usage:   [ 19 tools ]')
  // Its width runs out: the skills' count goes first
  expect(at({ columns: 32, meta: { ...meta, skills } })).toBe('usage:   [ 19 tools · 2 skills ]')
  expect(at({ columns: 31, meta: { ...meta, skills } })).toBe('usage:   [ 19 tools ]')
  // No button: `bandRows` opens and closes the rows
  expect(tools(bandLines(input()))).toBeUndefined()
  expect(text(infoLine(input()))).not.toContain('tools')
})

test('closed, the band draws no rows of tools; open, every tool and the skills under usage:, in their colours while quiet', () => {
  expect(texts(bandLines(input())).some(l => /^(tools|skills|agents|rules):/.test(l))).toBe(false)
  const open = bandLines(input({ isToolsOpen: true }))
  expect(texts(open).slice(1)).toEqual([
    text(infoLine(input({ isToolsOpen: true }))),
    'usage:   [ 19 tools ]',
    'tools:   AskUserQuestion ×13 │ Bash ×5 │ Grep ×1',
  ])
  const tools = open.find(l => text(l).startsWith('tools:')) ?? []
  expect(tools.find(s => 'text' in s && s.text === 'Bash ×5')).toEqual({ text: 'Bash ×5' })
})

test('the skills row names each skill loaded in the main chat and how many the listing carries', () => {
  const meta = { ...input().meta, skills: { 'superpowers:brainstorming': 1, 'solve-task': 2 } }
  const row = (o: Partial<BandInput>) => texts(bandLines(input({ isToolsOpen: true, ...o }))).find(l => l.startsWith('skills:'))
  expect(row({ meta })).toBe('skills:  superpowers:brainstorming ×1 │ solve-task ×2')
  expect(row({ meta, listing: { listed: 57, total: 60, tokens: 3200 } })).toBe('skills:  superpowers:brainstorming ×1 │ solve-task ×2 │ 57 of 60 listed')
  // The listing alone is no skill: the row waits for the first
  expect(row({ listing: { listed: 60, total: 60, tokens: 3200 } })).toBeUndefined()
  // Busy, the skills keep their colour
  const busy = bandLines(input({ isToolsOpen: true, meta, newFailures: 1 })).find(l => text(l).startsWith('skills:'))
  expect(busy?.find(s => 'text' in s && s.text === 'solve-task ×2')).toEqual({ text: 'solve-task ×2', tone: 'skill' })
})

// A side agent's note (2026-11-11): a resumed or branched conversation holds skills loaded before the mod watched it,
// which no API lists, so the row says what it counts from in place of 'none loaded'
test('after a resume the skills row counts from it', () => {
  const resumed = { ...input().meta, isResumed: true }
  const row = (o: Partial<BandInput>) => texts(bandLines(input({ isToolsOpen: true, ...o }))).find(l => l.startsWith('skills:'))
  expect(row({ meta: resumed, listing: { listed: 60, total: 60, tokens: 3200 } })).toBeUndefined()
  expect(row({ meta: { ...resumed, skills: { 'solve-task': 1 } } })).toBe('skills:  solve-task ×1 │ since resume')
})

test('the rows wrap whole names under their label, each row in the width', () => {
  const stats = { AskUserQuestion: stat(13), Bash: stat(5), 'Context7:query-docs': stat(3), Grep: stat(1) }
  const lines = bandLines(input({ isToolsOpen: true, columns: 41, stats }))
  const i = texts(lines).findIndex(l => l.startsWith('tools:'))
  expect(texts(lines).slice(i, i + 2)).toEqual(['tools:   AskUserQuestion ×13 │ Bash ×5', '         Context7:query-docs ×3 │ Grep ×1'])
  for (const l of lines.slice(i)) expect(cellsOf(l)).toBeLessThanOrEqual(41)
})

const FOUR: Partial<BandInput> = {
  rules: { always: ['a.md'], byPath: [], isTracked: true }, meta: { ...input().meta, skills: { 'solve-task': 1 }, agentTypes: { Explore: 1 } },
}

test('short of rows, the open rows give way first, then usage:, then the info line, and the buttons stay in view', () => {
  const inspect = (lines: Line[]): boolean => (lines[lines.length - 1] ?? []).some(s => 'button' in s && s.button.key === 'inspect')
  // Something in each of the four rows, which wait for their first item (the user, 2026-11-12)
  const at = (maxRows: number) => bandLines(input({ ...FOUR, isToolsOpen: true, newFailures: 1, maxRows }))
  expect(texts(at(7)).filter(l => /^(tools|skills|agents|rules):/.test(l))).toHaveLength(2)
  expect(texts(at(6)).filter(l => /^(tools|skills|agents|rules):/.test(l))).toEqual(['tools:   AskUserQuestion ×13 │ Bash ×5 │ Grep ×1'])
  expect(texts(at(5)).some(l => /^(tools|skills|agents|rules):/.test(l))).toBe(false)
  expect(texts(at(5))).toContain('usage:   [ 19 tools · 1 skill · 1 agent · 1 rule ]')
  expect(texts(at(4)).some(l => l.startsWith('usage:'))).toBe(false)
  expect(texts(at(4)).includes(FULL)).toBe(true)
  expect(texts(at(3)).some(l => l.startsWith(HEAD))).toBe(false)
  for (const n of [7, 6, 5, 4, 3]) {
    expect(at(n)).toHaveLength(n)
    expect(inspect(at(n))).toBe(true)
  }
})

// The rows hang under the info line: `bandRows` opens and closes them, so they no longer wait for a toggle in view
test('open, the rows draw under any info line; with no room for one, none draws', () => {
  const open = (columns: number) => input({ isToolsOpen: true, columns })
  expect(texts(bandLines(open(24))).some(l => l.startsWith('tools:'))).toBe(true)
  // At 18 the model does not fit, and no info line is drawn
  const narrow = bandLines(open(18))
  expect(texts(narrow).some(l => /^(usage|tools|skills|agents|rules):/.test(l))).toBe(false)
})

test('calm mode has no toggle and no rows, open or not', () => {
  const calm = bandLines(input({ isToolsOpen: true, mode: 'calm', newFailures: 1 }))
  expect(calm).toEqual(bandLines(input({ mode: 'calm', newFailures: 1 })))
  expect(tools(calm)).toBeUndefined()
})

// From the first second (the user, 2026-11-11): before any reading, the full band draws the model, the windows another
// session stored marked ≈, the cost and the place; calm draws nothing yet, as it always has
const AT_START: Partial<BandInput> = {
  turns: [], stats: {}, cache: COLD, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 },
  usage: { tokens: null, window: null, percent: null, startedAt: NOW - 30_000, windows: WINDOWS, windowsAt: NOW - 600_000, costUsd: 0, todayUsd: 10.46, at: NOW },
  meta: {
    model: 'claude-sonnet-5-5', effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0,
    waiting: [], mainCalls: 0, place: { project: 'alfred-mods', branch: 'develop' }, version: '2.1.322',
  },
}

test('from the first second the full band draws the model, the stored windows marked ≈, the cost and the place', () => {
  const lines = texts(bandLines(input(AT_START)))
  expect(lines).toHaveLength(3)
  expect(lines[0]?.startsWith('ctx — │ 5h ▱▱▱▱▱ ≈15% (')).toBe(true)
  expect(lines[0]?.includes(' │ 7d ≈40% (')).toBe(true)
  expect(lines[0]?.endsWith(' │ $0.00 · today $10.46')).toBe(true)
  expect(lines[1]).toBe('Sonnet 5.5 │ <1m │ CC 2.1.322')
  expect(lines[2]).toBe('project: alfred-mods │ git:(develop)')
  expect(bandLines(input(AT_START))[1]?.[0]).toMatchObject({ tone: 'sonnet' })
  // Narrow, the same marks
  expect(texts(bandLines(input({ ...AT_START, columns: 80 })))[0]?.includes('5h ▱▱▱▱▱ ≈15%')).toBe(true)
  // A live reading's windows carry no mark
  const live = texts(bandLines(input({ ...AT_START, usage: { ...input(AT_START).usage, windowsAt: undefined } })))
  expect(live[0]?.includes('≈')).toBe(false)
  // The info line is dim but for the model in every state (the review of 2026-11-11); the project is the text's own
  // colour (settings-values S6)
  const working = bandLines(input({ ...AT_START, isWorking: true })).flat()
  expect(working.find(s => 'text' in s && s.text === 'alfred-mods')).toEqual({ text: 'alfred-mods' })
  expect(working.find(s => 'text' in s && s.text === 'CC 2.1.322')).toEqual({ text: 'CC 2.1.322', tone: 'dim' })
})

test('calm draws nothing before the first reading, as it always has; full with nothing known draws nothing', () => {
  expect(bandLines(input({ ...AT_START, mode: 'calm' }))).toEqual([])
  const none = input(AT_START)
  expect(bandLines({ ...none, usage: { ...none.usage, windows: [] }, meta: { ...none.meta, model: null } })).toEqual([])
})

test('the version goes first when the width runs out; a branchless project row is its name alone', () => {
  const at = (columns: number) => text(infoLine(input({ ...AT_START, columns })))
  expect(at(29)).toBe('Sonnet 5.5 │ <1m │ CC 2.1.322')
  expect(at(28)).toBe('Sonnet 5.5 │ <1m')
  const meta = input(AT_START).meta
  const notes = texts(bandLines(input({ ...AT_START, meta: { ...meta, place: { project: 'notes', branch: null } } })))
  expect(notes).toContain('project: notes')
})

// A side agent's note (2026-11-11): the user asked for every item, so the info line wraps onto a second row before an
// item drops; past two rows, or short of the band's rows, items drop as before
const PLACED = { place: { project: 'alfred-mods', branch: 'develop' }, version: '2.1.322' }

test('the info line wraps onto a second row, between items, before one drops', () => {
  const meta = { ...input().meta, ...PLACED }
  const rest = ['project: alfred-mods │ git:(develop)', 'usage:   [ 19 tools ]']
  expect(texts(bandLines(input({ columns: 103, meta }))).slice(1)).toEqual([`${FULL} │ CC 2.1.322`, ...rest])
  const at80 = bandLines(input({ columns: 80, meta })).slice(1)
  expect(texts(at80)).toEqual([HEAD, `you ${clock(P)} · Claude ${clock(R)} │ CC 2.1.322`, ...rest])
  for (const l of at80) expect(cellsOf(l)).toBeLessThanOrEqual(80)
  // Past two rows, items drop by keep order: at 40 the version goes first
  const at40 = texts(bandLines(input({ columns: 40, meta })).slice(1, 3))
  expect(at40.some(l => l.includes('CC 2.1.322'))).toBe(false)
  expect(at40[0]?.startsWith('Sonnet 5.5 ◑ medium')).toBe(true)
})

test('short of rows, the project row goes first, then the second info row, before the open rows of tools', () => {
  const meta = { ...FOUR.meta!, ...PLACED }
  const at = (maxRows: number) => texts(bandLines(input({ ...FOUR, columns: 80, meta, isToolsOpen: true, newFailures: 1, maxRows })))
  const second = `you ${clock(P)} · Claude ${clock(R)} │ CC 2.1.322`
  const open = 4
  // Line 1, the gauges, two info rows, the project row, usage:, four rows, the action row
  expect(at(7 + open)).toContain('project: alfred-mods │ git:(develop)')
  expect(at(6 + open).some(l => l.startsWith('project:'))).toBe(false)
  expect(at(6 + open)).toContain(second)
  expect(at(5 + open)).not.toContain(second)
  expect(at(5 + open)).toContain(`${HEAD} │ you ${clock(P)}`)
  for (const n of [7 + open, 6 + open, 5 + open]) {
    expect(at(n)).toHaveLength(n)
    expect(at(n).filter(l => /^(tools|skills|agents|rules):/.test(l))).toHaveLength(open)
  }
})

// The mounted band: a session started 5 minutes ago, one main step on Sonnet at medium effort
const band = (isWorking: boolean, maxRows = 6) =>
  ({ hasSurvey: false, isCollapsed: false, isWorking, maxRows, bodyColumns: 160, scroll: { offset: 0, bodyRows: maxRows }, view: {} })
const mount = ($: Engine, surface: RenderSurface, isWorking: boolean, maxRows = 6) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band(isWorking, maxRows) })
const READING: SessionUsage = {
  startedAt: NOW - 5 * 60_000, context: { window: 200_000, tokens: 20_000, percent: 10 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }], cost: { usd: 0.4 },
}
const MAIN_STEP = { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium' as const, messageCount: 1 }

async function runningTurn($: Engine): Promise<void> {
  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await step($, MAIN_STEP)
}

for (const surface of SURFACES) {
  test(`a running turn draws three lines, the third the info line (${surface})`, async ($, on) => {
    stubAll(on, { band: 'full', usage: READING, now: NOW, store: { 'settings:band-tools': 'closed' } })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    const lines = await rows(await mount($, surface, true))
    expect(lines).toHaveLength(3)
    expect(lines[2]?.startsWith('Sonnet 5.5 ◑ medium │ 5m')).toBe(true)
  })

  test(`a running turn with two rows to draw in leaves out the info line (${surface})`, async ($, on) => {
    stubAll(on, { band: 'full', usage: READING, now: NOW })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    const lines = await rows(await mount($, surface, true, 2))
    expect(lines).toHaveLength(2)
    expect(lines.some(l => l.startsWith('Sonnet 5.5'))).toBe(false)
  })

  test(`with nothing stored, the band is full (${surface})`, async ($, on) => {
    stubAll(on, { band: 'unset', usage: READING, now: NOW, store: { 'settings:band-tools': 'closed' } })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    const lines = await rows(await mount($, surface, true))
    expect(lines).toHaveLength(3)
    expect(lines[2]?.startsWith('Sonnet 5.5 ◑ medium')).toBe(true)
  })

  test(`REC strict hides today's cost and the session's (${surface})`, async ($, on) => {
    stubAll(on, { band: 'full', usage: READING, now: NOW, store: { 'settings:rec': 'strict' } })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    const lines = await rows(await mount($, surface, true))
    expect(lines.some(l => /\$\d/.test(l))).toBe(false)
  })

  // Ten seconds before a clock minute, 5m 20s into the session: the minute turns before the 30-second poll would
  // redraw anything, and the session's time reads 6m from 5m 30s
  test(`the info line's session time moves each minute while idle (${surface})`, async ($, on) => {
    const start = NOW + 50_000
    const { clock: time } = stubAll(on, { band: 'full', usage: { ...READING, startedAt: start - 320_000 }, now: start })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    const ui = await mount($, surface, false)
    expect((await rows(ui)).some(l => l.startsWith('Sonnet 5.5 ◑ medium │ 5m'))).toBe(true)
    await time.advance(10_000)
    expect((await rows(ui)).some(l => l.startsWith('Sonnet 5.5 ◑ medium │ 6m'))).toBe(true)
    await ui.unmount()
  })
}
