// The full band (spec A): the turn's tool count on line 1, today's cost on line 2, and an info line under the gauges
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionUsage } from 'claude-code'

import { bandLines, infoLine } from '../hooks/band.ts'
import type { BandInput, Line } from '../hooks/band.ts'
import { clock, widthOf } from '../hooks/format.ts'
import { START, engine, rows, step, stepEngine, stubAll } from './kit.ts'

import type { Cache, ToolStat, Turn } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-28T14:00:00Z')
const P = NOW - 73 * 60_000
const R = NOW - 2 * 60_000
const FULL = `Sonnet 5.5 ◑ medium │ 59m │ ≈133 tok/s avg │ cache warm 54m │ AskUserQuestion ×13 · Bash ×5 · Grep ×1 │ you ${clock(P)} · Claude ${clock(R)}`

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

const text = (line: Line): string => line.map(s => ('text' in s ? s.text : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

test('the info line holds every item in the mockup order', () => {
  expect(text(infoLine(input({ columns: 128 })))).toBe(FULL)
  expect(widthOf(infoLine(input({ columns: 128 })))).toBe(128)
})

test('the info line drops items by keep order, whole', () => {
  const at = (columns: number) => text(infoLine(input({ columns })))
  const head = 'Sonnet 5.5 ◑ medium │ 59m │ ≈133 tok/s avg │ cache warm 54m'
  expect(at(127)).toBe(FULL.replace(` · Claude ${clock(R)}`, ''))
  expect(at(112)).toBe(`${head} │ AskUserQuestion ×13 · Bash ×5 · Grep ×1`)
  expect(at(100)).toBe(`${head} │ AskUserQuestion ×13 · Bash ×5 +1`)
  expect(at(93)).toBe(`${head} │ AskUserQuestion ×13 +2`)
  expect(at(83)).toBe(head)
  // tok/s goes before the cache
  expect(at(58)).toBe('Sonnet 5.5 ◑ medium │ 59m │ cache warm 54m')
  expect(at(41)).toBe('Sonnet 5.5 ◑ medium │ 59m')
  expect(at(24)).toBe('Sonnet 5.5 ◑ medium')
  expect(infoLine(input({ columns: 18 }))).toEqual([])
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

test('full mode, idle and healthy: two dim lines, no times on the gauge line', () => {
  const lines = bandLines(input())
  expect(lines).toHaveLength(2)
  for (const s of lines.flat()) if ('text' in s) expect(s.tone).toBe('dim')
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

// The mounted band: a session started 5 minutes ago, one main step on Sonnet at medium effort
const band = (isWorking: boolean) =>
  ({ hasSurvey: false, isWorking, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} })
const mount = ($: Engine, surface: RenderSurface, isWorking: boolean) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band(isWorking) })
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
    stubAll(on, { band: 'full', usage: READING, now: NOW })
    stepEngine(on, () => null)
    engine(on)
    await runningTurn($)
    const lines = await rows(await mount($, surface, true))
    expect(lines).toHaveLength(3)
    expect(lines[2]?.startsWith('Sonnet 5.5 ◑ medium │ 5m')).toBe(true)
  })

  test(`with nothing stored, the band is full (${surface})`, async ($, on) => {
    stubAll(on, { band: 'unset', usage: READING, now: NOW })
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
