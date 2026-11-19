import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { kitPassScore, parseKitStatus } from '../../hooks/kit/kit'
import { kitBannerSegs, kitLines } from '../../hooks/kit/kitlines'
import { scoreSeg } from '../../hooks/plan/planlines'
import type { BandInput } from '../../hooks/band/types'
import type { Line, Seg } from '../../hooks/core/types'
import type { Usage } from '../../hooks/session/types'
import type { KitState } from '../../hooks/kit/types'
import type { ScoresView } from '../../hooks/plan/types'
import { LINE, LINE_NOT_SAVED, LINE_SAVED } from './lines'

const NOW = Date.parse('2026-11-19T14:00:00Z')
const kitOf = (line: string, seenAt: number | null = NOW - 3 * 60_000): KitState => ({ status: parseKitStatus(line), seenAt })
const NO_KIT: KitState = { status: null, seenAt: null }

const text = (line: readonly Seg[]): string => line.map(seg => ('text' in seg ? seg.text : 'button' in seg ? `[ ${seg.button.label} ]` : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

// One rate window, so the narrow band's rows fit 50 columns
const NARROW_USAGE: Usage = {
  contextTokens: 60_000, contextWindow: 200_000, contextPercent: 30, startedAt: NOW - 59 * 60_000, costUsd: 1.29, todayUsd: 10.46, readingAt: NOW,
  rateWindows: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-11-19T17:00:00Z' }],
}

const ALFRED_BANNER: Seg[] = [{ text: 'auto-run · auto-compact 490k · scoring 80' }]
const REC = { level: 'on' as const, words: 0 }

// The full band's idle session, as tests/band/band-rows.test.ts draws it
function input(o: Partial<BandInput> = {}): BandInput {
  const promptAt = NOW - 73 * 60_000
  const replyAt = NOW - 2 * 60_000
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full',
    live: { turnId: null, startedAt: null, toolCalls: 0, toolFailures: 0, runningCalls: [], promptAt: null },
    usage: {
      contextTokens: 60_000, contextWindow: 200_000, contextPercent: 30, startedAt: NOW - 59 * 60_000, costUsd: 1.29, todayUsd: 10.46, readingAt: NOW,
      rateWindows: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-11-19T17:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-11-22T09:00:00Z' }],
    },
    session: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: promptAt, lastReplyAt: replyAt, turnCount: 1,
      waitingPrompts: [], mainToolCalls: 19,
    },
    turns: [{
      turnNumber: 1, turnId: 't1', promptAt, replyAt, durationMs: 3000, tokensIn: 0, tokensOut: 0, toolCalls: 19, toolFailures: 0, contextPercent: null, endReason: 'answer',
    }],
    newFailures: 0, pace: {}, agents: [],
    cache: {
      tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, isIdleCompactOff: false, idleMinTokens: 200_000, isIdleSurface: false },
      ratePerToken: null, rateModel: null, lastRequestAt: NOW - 6 * 60_000, lastRequest: { read: 1000, write: 0, input: 10 },
      sessionCounts: { read: 1000, write: 0, input: 10 }, toastedForRequestAt: null,
    },
    plan: null, isPlanInvalid: false, score: null,
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 13_300, stepMs: 100_000 },
    stats: { Bash: { calls: 5, ok: 5, failed: 0, stopped: 0 } },
    ...o,
  }
}

test("the kit banner reads each mode that is on, with auto-run in 'warn' as Alfred Code's banner has it", () => {
  const segs = kitBannerSegs(kitOf(LINE))
  expect(text(segs)).toBe('kit: auto-run · scoring 90 · auto-approve')
  expect(segs.find(seg => 'text' in seg && seg.text === 'auto-run')).toMatchObject({ tone: 'warn' })
})

test('with only scoring on, the kit banner is the scoring and its level', () => {
  const only = parseKitStatus(LINE_NOT_SAVED)
  expect(text(kitBannerSegs({ status: only, seenAt: NOW }))).toBe('kit: scoring 90')
})

test('with every mode off, or no kit line, the kit banner is empty', () => {
  const off = parseKitStatus(LINE_NOT_SAVED.replace('scoring=on', 'scoring=off'))
  expect(kitBannerSegs({ status: off, seenAt: NOW })).toEqual([])
  expect(kitBannerSegs(NO_KIT)).toEqual([])
})

test('no kit line draws nothing', () => {
  expect(kitLines(NO_KIT, NOW, 120)).toEqual([])
  expect(kitBannerSegs(NO_KIT)).toEqual([])
})

test('the band leads line 1 with REC, Alfred Code\'s banner, then the kit banner', () => {
  const lines = bandLines(input({ rec: REC, banner: ALFRED_BANNER, kitBanner: kitBannerSegs(kitOf(LINE)) }))
  expect(text(lines[0] ?? []).startsWith('● REC │ auto-run · auto-compact 490k · scoring 80 │ kit: auto-run · scoring 90 · auto-approve │ ')).toBe(true)
})

test('at 60 columns the kit banner shortens to kit or goes, and no gauge, reset or cost drops for it', () => {
  const marks = { rec: REC, banner: ALFRED_BANNER }
  const kitBanner = kitBannerSegs(kitOf(LINE))
  for (const columns of [60, 54, 50]) {
    for (const maxRows of [undefined, 2]) {
      const base = { columns, usage: NARROW_USAGE, ...(maxRows === undefined ? {} : { maxRows }), ...marks }
      const plain = bandLines(input(base))
      const withKit = bandLines(input({ ...base, kitBanner }))
      const first = text(withKit[0] ?? [])
      expect(first.startsWith('● REC │ auto-run · auto-compact 490k · scoring 80')).toBe(true)
      expect(first.includes('kit: ')).toBe(false)
      expect(withKit.every(line => widthOf(line) <= columns)).toBe(true)
      expect(withKit.filter(line => text(line).includes('● REC'))).toHaveLength(1)
      // The rows the marks leave are the plain band's, whole
      expect(texts(withKit.slice(1))).toEqual(texts(plain.slice(1)))
      expect(withKit).toHaveLength(plain.length)
    }
  }
  const sixty = bandLines(input({ columns: 60, usage: NARROW_USAGE, rec: REC, banner: ALFRED_BANNER, kitBanner }))
  expect(text(sixty[0] ?? []).includes(' │ kit')).toBe(true)
  const twoRows = bandLines(input({ columns: 60, maxRows: 2, usage: NARROW_USAGE, rec: REC, banner: ALFRED_BANNER, kitBanner }))
  const twoRowsPlain = bandLines(input({ columns: 60, maxRows: 2, usage: NARROW_USAGE, rec: REC, banner: ALFRED_BANNER }))
  expect(twoRows).toHaveLength(2)
  expect(text(twoRows[1] ?? [])).toBe(text(twoRowsPlain[1] ?? []))
  expect(text(twoRows[1] ?? [])).toContain('ctx')
})

test('the section carries each setting with its source, the models and the age of the line', () => {
  const lines = kitLines(kitOf(LINE), NOW, 120)
  expect(lines[0]).toEqual([{ text: 'CLAUDE-KIT', bold: true }])
  expect(texts(lines.slice(1))).toEqual([
    'auto-run on · from .claude/kit/settings.json',
    'scoring on · pass 90 · from default',
    'auto-approve on · from .claude/kit/settings.json',
    'models: plan opus · audit opus · review opus · implement sonnet · search haiku',
    'seen 3m ago',
  ])
})

test('a saved note and a not-saved note each take a row', () => {
  const saved = texts(kitLines(kitOf(LINE_SAVED), NOW, 120))
  expect(saved).toContain('saved: scoring=off in .claude/kit/settings.json')
  expect(saved).toContain('scoring off · from .claude/kit/settings.json')
  const refused = texts(kitLines(kitOf(LINE_NOT_SAVED), NOW, 120))
  expect(refused.some(row => row.startsWith('not saved - saving changes the file of the repo'))).toBe(true)
})

// The kit banner never adds a row or moves a gauge: the rows under line 1 and the row count are the plain band's.
// Where the plain band's marks share line 1 with the body, so do the kit's (the body's first line stays on line 1)
test('a kit banner that fits the width but would push the body off line 1 is shortened or left out', () => {
  const kitBanner = kitBannerSegs(kitOf(LINE))
  const cases: { columns: number; mode: 'full' | 'calm'; marks: Partial<BandInput>; maxRows?: number }[] = [
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER } },
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER }, maxRows: 2 },
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER }, maxRows: 3 },
    { columns: 140, mode: 'calm', marks: { rec: REC, banner: ALFRED_BANNER } },
    { columns: 130, mode: 'calm', marks: { banner: ALFRED_BANNER } },
    { columns: 100, mode: 'calm', marks: {} },
    { columns: 100, mode: 'full', marks: {}, maxRows: 2 },
    { columns: 80, mode: 'full', marks: {} },
  ]
  for (const { columns, mode, marks, maxRows } of cases) {
    const base = { columns, mode, ...marks, ...(maxRows === undefined ? {} : { maxRows }) }
    const plain = bandLines(input(base))
    const withKit = bandLines(input({ ...base, kitBanner }))
    const note = JSON.stringify({ columns, mode, maxRows, marks: Object.keys(marks) })
    expect(withKit, note).toHaveLength(plain.length)
    expect(withKit.every(line => widthOf(line) <= columns), note).toBe(true)
    expect(texts(withKit.slice(1)), note).toEqual(texts(plain.slice(1)))
  }
})

const view = (total: number): ScoresView => ({
  scale: 100, totals: [{ round: 1, total }], delta: null, shown: { round: 1, total }, isGrading: false, criteria: [], severities: [],
  fixed: [], improved: [], open: [], hasStatus: false,
})

test("the score takes the kit's pass level: ok at or over it, warn under it", () => {
  const status = parseKitStatus(LINE)
  const level = status === null ? null : kitPassScore(status)
  expect(level).toBe(90)
  expect(scoreSeg(view(91), level)[0]).toMatchObject({ text: 'score 91', tone: 'ok' })
  expect(scoreSeg(view(85), level)[0]).toMatchObject({ text: 'score 85', tone: 'warn' })
})

test('the score takes whichever level it is given: ok at 80 and warn at 90 for a total of 85', () => {
  expect(scoreSeg(view(85), 80)[0]).toMatchObject({ tone: 'ok' })
  expect(scoreSeg(view(85), 90)[0]).toMatchObject({ tone: 'warn' })
})
