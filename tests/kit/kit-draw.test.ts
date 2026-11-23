import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { kitPassScore } from '../../hooks/kit/kit'
import { kitBannerSegs, kitLines } from '../../hooks/kit/kitlines'
import { scoreSeg } from '../../hooks/plan/planlines'
import type { BandInput } from '../../hooks/band/types'
import type { Line, Seg } from '../../hooks/core/types'
import type { Usage } from '../../hooks/session/types'
import type { KitState } from '../../hooks/kit/types'
import type { ScoresView } from '../../hooks/plan/types'
import { KIT_VALUES } from './settings'

const NOW = Date.parse('2026-11-19T14:00:00Z')
const kitOf = (values: Record<string, string | number> = KIT_VALUES): KitState => ({ values })
const NO_KIT: KitState = { values: null }

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
  const segs = kitBannerSegs(kitOf())
  expect(text(segs)).toBe('kit: auto-run · scoring 90 · auto-approve')
  expect(segs.find(seg => 'text' in seg && seg.text === 'auto-run')).toMatchObject({ tone: 'warn' })
})

test('with only scoring on, the kit banner is the scoring and its level', () => {
  expect(text(kitBannerSegs(kitOf({ scoring: 'on', pass_score: 90, auto_run: 'off' })))).toBe('kit: scoring 90')
  expect(text(kitBannerSegs(kitOf({ scoring: 'on' })))).toBe('kit: scoring')
})

test('with every mode off, or no kit data, the kit banner is empty', () => {
  expect(kitBannerSegs(kitOf({ scoring: 'off', auto_run: 'off', auto_approve: 'off', pass_score: 90, plan_model: 'opus' }))).toEqual([])
  expect(kitBannerSegs(kitOf({}))).toEqual([])
  expect(kitBannerSegs(NO_KIT)).toEqual([])
})

test('no kit data draws nothing', () => {
  expect(kitLines(NO_KIT, 120)).toEqual([])
  expect(kitLines(kitOf({}), 120)).toEqual([])
  expect(kitBannerSegs(NO_KIT)).toEqual([])
})

test("the band leads with REC, then Alfred Code's banner and the kit banner on line 2", () => {
  const lines = bandLines(input({ rec: REC, banner: ALFRED_BANNER, kitBanner: kitBannerSegs(kitOf()) }))
  expect(text(lines[0] ?? [])).toBe('● REC')
  expect(text(lines[1] ?? [])).toBe('auto-run · auto-compact 490k · scoring 80 │ kit: auto-run · scoring 90 · auto-approve')
})

test('at 60 columns the kit banner shortens to kit or goes, and no gauge, reset or cost drops for it', () => {
  const marks = { rec: REC, banner: ALFRED_BANNER }
  const kitBanner = kitBannerSegs(kitOf())
  for (const columns of [60, 50, 45]) {
    const base = { columns, usage: NARROW_USAGE, ...marks }
    const plain = bandLines(input(base))
    const withKit = bandLines(input({ ...base, kitBanner }))
    const modes = text(withKit[1] ?? [])
    expect(modes.startsWith('auto-run · auto-compact 490k · scoring 80')).toBe(true)
    expect(modes.includes('kit: ')).toBe(false)
    expect(modes.endsWith(' │ kit')).toBe(columns >= 50)
    expect(withKit.every(line => widthOf(line) <= columns)).toBe(true)
    expect(withKit.filter(line => text(line).includes('● REC'))).toHaveLength(1)
    // The rows the two lines leave are the plain band's, whole
    expect(texts(withKit.slice(2))).toEqual(texts(plain.slice(2)))
    expect(withKit).toHaveLength(plain.length)
  }
  const joined = bandLines(input({ columns: 60, maxRows: 2, usage: NARROW_USAGE, rec: REC, banner: ALFRED_BANNER, kitBanner }))
  const joinedPlain = bandLines(input({ columns: 60, maxRows: 2, usage: NARROW_USAGE, rec: REC, banner: ALFRED_BANNER }))
  expect(joined).toHaveLength(2)
  expect(text(joined[0] ?? [])).toBe('● REC │ auto-run · auto-compact 490k · scoring 80 │ kit')
  expect(text(joined[1] ?? [])).toBe(text(joinedPlain[1] ?? []))
  expect(text(joined[1] ?? [])).toContain('ctx')
})

test('the section carries each switch with its file, the pass score on the scoring row and the models, and no age or note', () => {
  const lines = kitLines(kitOf(), 120)
  expect(lines[0]).toEqual([{ text: 'CLAUDE-KIT', bold: true }])
  expect(texts(lines.slice(1))).toEqual([
    'auto-run on · from .claude/kit/settings.json',
    'scoring on · pass 90 · from .claude/kit/settings.json',
    'auto-approve on · from .claude/kit/settings.json',
    'models: plan opus · audit opus · review opus · implement sonnet · search haiku',
  ])
})

test('a name the file does not set has no row, a model may be absent, and the pass score shows only while scoring is on', () => {
  expect(texts(kitLines(kitOf({ scoring: 'off', pass_score: 90, plan_model: 'opus', search_model: 'haiku' }), 120).slice(1))).toEqual([
    'scoring off · from .claude/kit/settings.json', 'models: plan opus · search haiku',
  ])
  expect(texts(kitLines(kitOf({ auto_run: 'off' }), 120).slice(1))).toEqual(['auto-run off · from .claude/kit/settings.json'])
})

// The kit banner moves no gauge and adds at most its own line: the rows after the leading lines are the plain band's
test('a kit banner that does not fit the width is shortened or left out, and the rows stay the plain band\'s', () => {
  const kitBanner = kitBannerSegs(kitOf())
  const cases: { columns: number; mode: 'full' | 'calm'; marks: Partial<BandInput>; maxRows?: number }[] = [
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER } },
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER }, maxRows: 2 },
    { columns: 140, mode: 'full', marks: { rec: REC, banner: ALFRED_BANNER }, maxRows: 3 },
    { columns: 140, mode: 'calm', marks: { rec: REC, banner: ALFRED_BANNER } },
    { columns: 130, mode: 'calm', marks: { banner: ALFRED_BANNER } },
    { columns: 100, mode: 'calm', marks: {} },
    { columns: 100, mode: 'full', marks: {}, maxRows: 2 },
    { columns: 80, mode: 'full', marks: {} },
    { columns: 120, mode: 'full', marks: {} },
    { columns: 140, mode: 'full', marks: { rec: REC } },
    { columns: 170, mode: 'full', marks: { banner: ALFRED_BANNER } },
  ]
  const isLead = (line: Line): boolean => /^(● REC|auto-run · auto-compact|kit)/.test(text(line))
  for (const { columns, mode, marks, maxRows } of cases) {
    const base = { columns, mode, ...marks, ...(maxRows === undefined ? {} : { maxRows }) }
    const plain = bandLines(input(base))
    const withKit = bandLines(input({ ...base, kitBanner }))
    const note = JSON.stringify({ columns, mode, maxRows, marks: Object.keys(marks) })
    expect(withKit.length - plain.length, note).toBeLessThanOrEqual(1)
    expect(withKit.every(line => widthOf(line) <= columns), note).toBe(true)
    expect(texts(withKit.filter(line => !isLead(line))), note).toEqual(texts(plain.filter(line => !isLead(line))))
  }
})

const view = (total: number): ScoresView => ({
  scale: 100, totals: [{ round: 1, total }], delta: null, shown: { round: 1, total }, isGrading: false, criteria: [], severities: [],
  fixed: [], improved: [], open: [], hasStatus: false,
})

test("the score takes the kit's pass level: ok at or over it, warn under it", () => {
  const level = kitPassScore(KIT_VALUES)
  expect(level).toBe(90)
  expect(scoreSeg(view(91), level)[0]).toMatchObject({ text: 'score 91', tone: 'ok' })
  expect(scoreSeg(view(85), level)[0]).toMatchObject({ text: 'score 85', tone: 'warn' })
})

test('the score takes whichever level it is given: ok at 80 and warn at 90 for a total of 85', () => {
  expect(scoreSeg(view(85), 80)[0]).toMatchObject({ tone: 'ok' })
  expect(scoreSeg(view(85), 90)[0]).toMatchObject({ tone: 'warn' })
})
