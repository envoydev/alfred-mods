import { expect, test } from 'claude-code/testing'

import { bandLines } from '../hooks/band.ts'
import type { BandInput, Line } from '../hooks/band.ts'
import { widthOf } from '../hooks/format.ts'
import { handoffLines } from '../hooks/handoff.ts'
import type { HandoffView } from '../hooks/handoff.ts'
import { STACK_TOASTS, bannerSegs, fillReady, fillToast, modelsAgree, parseStack, runwayOf } from '../hooks/stack.ts'
import { usageLines } from '../hooks/tabs.ts'
import type { Stack, Turn, Usage } from '../types'

const PROMPT = 'Read docs/work/plans/inspector.md, check that branch feat/x is checked out, and continue from its Resume: line (Task 3).\nThen run npm test.'
const FULL = {
  schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-10-29T14:03:00Z',
  model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, autoRun: true,
  scorer: { on: true, level: 80, rounds: 3 }, handoffPrompt: PROMPT,
}
const file = (over: Record<string, unknown> = {}) => JSON.stringify({ ...FULL, ...over })

test('a full valid file reads every field', () => {
  const r = parseStack(file(), 's1')
  expect(r).toEqual({
    state: 'used',
    fields: {
      fullContext: 'fresh-session', model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, noOffer: false,
      autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, updatedAt: Date.parse('2026-10-29T14:03:00Z'), ignored: [],
    },
    prompt: PROMPT,
  })
})

test('each bad form reads as unknown and is listed', () => {
  const bad: [string, unknown][] = [
    ['model', ''], ['model', 'm'.repeat(101)], ['model', 'a\u0007b'],
    ['window', 999], ['window', 10_000_001], ['window', 1.5], ['window', '150000'],
    ['resumeAt', 999], ['resumeAt', 1000000], ['resumeAt', 1000001], ['resumeAt', '150000'],
    ['autoRun', 'true'], ['autoRun', 1],
    ['scorer', { on: 'yes', level: 80, rounds: 3 }], ['scorer', { on: true, level: 0, rounds: 3 }],
    ['scorer', { on: true, level: 101, rounds: 3 }], ['scorer', { on: true, level: 80, rounds: 0 }],
    ['scorer', { on: true, level: 80, rounds: 11 }], ['scorer', []],
    ['handoffPrompt', ''], ['handoffPrompt', 'p'.repeat(1001)], ['handoffPrompt', 'a\u0000b'],
  ]
  for (const [field, value] of bad) {
    const r = parseStack(file({ [field]: value }), 's1')
    if (r.state !== 'used') throw new Error(`${field} ${JSON.stringify(value)}: the file was not used`)
    expect(r.fields.ignored).toEqual([field])
    const got = field === 'handoffPrompt' ? r.prompt : (r.fields as Record<string, unknown>)[field]
    expect(got).toBe(null)
    // The rest of the file still counts
    expect(r.fields.fullContext).toBe('fresh-session')
    if (field !== 'model') expect(r.fields.model).toBe('claude-opus-5-5')
    if (field !== 'handoffPrompt') expect(r.prompt).toBe(PROMPT)
  }
})

test('a missing field is unknown and not listed', () => {
  const r = parseStack(JSON.stringify({ schema: 1, session: 's1', fullContext: 'compact' }), 's1')
  expect(r).toEqual({
    state: 'used',
    fields: { fullContext: 'compact', model: null, window: null, resumeAt: null, noOffer: false, autoRun: null, scorer: null, updatedAt: null, ignored: [] },
    prompt: null,
  })
})

test('resumeAt null sets noOffer', () => {
  const r = parseStack(file({ resumeAt: null }), 's1')
  if (r.state !== 'used') throw new Error('not used')
  expect(r.fields.resumeAt).toBe(null)
  expect(r.fields.noOffer).toBe(true)
  expect(r.fields.ignored).toEqual([])
})

test('resumeAt under 10,000,000 counts when window is unknown', () => {
  const r = parseStack(file({ window: 'big', resumeAt: 150000 }), 's1')
  if (r.state !== 'used') throw new Error('not used')
  expect(r.fields.window).toBe(null)
  expect(r.fields.resumeAt).toBe(150000)
  expect(r.fields.ignored).toEqual(['window'])
  const missing = parseStack(JSON.stringify({ ...FULL, window: undefined, resumeAt: 9_999_999 }), 's1')
  if (missing.state !== 'used') throw new Error('not used')
  expect(missing.fields.resumeAt).toBe(9_999_999)
})

test('updatedAt that does not parse is unknown and not listed', () => {
  for (const updatedAt of ['yesterday', 12345, null]) {
    const r = parseStack(file({ updatedAt }), 's1')
    if (r.state !== 'used') throw new Error('not used')
    expect(r.fields.updatedAt).toBe(null)
    expect(r.fields.ignored).toEqual([])
  }
})

test('line feeds and tabs pass in handoffPrompt', () => {
  const text = 'Read a.md\n\tthen b'
  const r = parseStack(file({ handoffPrompt: text }), 's1')
  if (r.state !== 'used') throw new Error('not used')
  expect(r.prompt).toBe(text)
  expect(r.fields.ignored).toEqual([])
})

test('null scorer and null model are unknown and not listed', () => {
  const r = parseStack(file({ scorer: null, model: null, handoffPrompt: null, window: null }), 's1')
  if (r.state !== 'used') throw new Error('not used')
  expect(r.fields.scorer).toBe(null)
  expect(r.fields.model).toBe(null)
  expect(r.fields.window).toBe(null)
  expect(r.prompt).toBe(null)
  expect(r.fields.ignored).toEqual([])
})

test("a bad fullContext is unknown and listed, Phase 4's runs", () => {
  const r = parseStack(file({ fullContext: 'later' }), 's1')
  if (r.state !== 'used') throw new Error('not used')
  expect(r.fields.fullContext).toBe(null)
  expect(r.fields.ignored).toEqual(['fullContext'])
  expect(parseStack(file({ fullContext: 'off' }), 's1')).toMatchObject({ state: 'used', fields: { fullContext: 'off', ignored: [] } })
})

test("Phase 4's reasons come through", () => {
  expect(parseStack('{', 's1')).toEqual({ state: 'ignored', reason: 'not JSON' })
  expect(parseStack('[1]', 's1')).toEqual({ state: 'ignored', reason: 'not JSON' })
  expect(parseStack(JSON.stringify({ session: 's1' }), 's1')).toEqual({ state: 'ignored', reason: 'no schema' })
  expect(parseStack(file({ schema: 2 }), 's1')).toEqual({ state: 'ignored', reason: 'schema 2' })
  expect(parseStack(file(), 's2')).toEqual({ state: 'ignored', reason: 'another session' })
})

// Task 4: the runway and the banner
const STACK: Stack = {
  state: 'used', reason: null, fullContext: 'fresh-session', model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, noOffer: false,
  autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, hasPrompt: true, updatedAt: null, readAt: 0, ignored: [],
}
const USAGE: Usage = { tokens: 93_000, window: 1_000_000, percent: 9, startedAt: 0, windows: [], costUsd: null, todayUsd: null, at: 0 }
const BASE: BandInput = {
  now: 0, columns: 120, isWorking: false,
  live: { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null },
  usage: USAGE,
  meta: { model: null, effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0, waiting: [], mainCalls: 0 },
  turns: [], newFailures: 0, pace: {}, agents: [],
  cache: {
    tier: null, tierAt: null, tierBilling: null, config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
    ratePerToken: null, rateModel: null, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 }, toastedFor: null,
  },
  plan: null, planInvalid: false, score: null,
}
const turn = (n: number, contextPercent: number): Turn => ({
  n, turnId: `t${n}`, promptAt: null, replyAt: 0, durationMs: 1000, tokensIn: 0, tokensOut: 0, tools: 0, failures: 0, contextPercent, end: 'answer',
})
const text = (l: Line): string => l.map(s => ('text' in s ? s.text : '')).join('')
const RUNWAY = { percent: 62, resumeAt: 150000, at: 15 }

test('modelsAgree', () => {
  expect(modelsAgree('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(true)
  expect(modelsAgree('Claude-Opus-5-5', 'claude-opus-5-5')).toBe(true)
  expect(modelsAgree(null, 'claude-opus-5-5')).toBe(true)
  expect(modelsAgree('claude-opus-5-5', null)).toBe(true)
  expect(modelsAgree('claude-opus-5-5', 'claude-sonnet-5-5')).toBe(false)
})

test('runwayOf', () => {
  expect(runwayOf(STACK, USAGE, 'claude-opus-5-5')).toEqual({ percent: 62, resumeAt: 150000, at: 15 })
  expect(runwayOf(STACK, { ...USAGE, tokens: 157_500 }, null)?.percent).toBe(105)
  expect(runwayOf(STACK, { ...USAGE, window: null }, null)).toEqual({ percent: 62, resumeAt: 150000, at: null })
  expect(runwayOf({ ...STACK, fullContext: 'compact' }, USAGE, null)).toBe(null)
  expect(runwayOf({ ...STACK, fullContext: 'off' }, USAGE, null)).toBe(null)
  expect(runwayOf({ ...STACK, resumeAt: null, noOffer: true }, USAGE, null)).toBe(null)
  expect(runwayOf({ ...STACK, state: 'ignored', reason: 'schema 2' }, USAGE, null)).toBe(null)
  expect(runwayOf(STACK, USAGE, 'claude-sonnet-5-5')).toBe(null)
  expect(runwayOf(STACK, { ...USAGE, tokens: null }, null)).toBe(null)
})

test('the band measures ctx against the runway at 120 and 90 columns', () => {
  for (const columns of [120, 90]) {
    const lines = bandLines({ ...BASE, columns, runway: RUNWAY })
    expect(lines).toHaveLength(1)
    expect(text(lines[0]!)).toBe('ctx ▰▰▰▱▱ 62% of 150k')
  }
  expect(text(bandLines({ ...BASE, runway: { ...RUNWAY, percent: 105 } })[0]!).startsWith('ctx ▰▰▰▰▰ 105% of 150k')).toBe(true)
  // Without a runway, the core item
  expect(text(bandLines(BASE)[0]!)).toBe('ctx ▱▱▱▱▱ 9%')
})

test('the forecast counts turns to the runway', () => {
  const lines = bandLines({ ...BASE, turns: [turn(1, 5), turn(2, 7), turn(3, 9)], runway: RUNWAY, forecast: { at: 15, label: '150k' } })
  expect(lines.map(text).join('\n')).toContain('62% of 150k ≈3 turns')
})

test('the band goes hot at 60% of the runway', () => {
  const calm = bandLines({ ...BASE, runway: { ...RUNWAY, percent: 59 } })[0]!
  expect(calm.every(s => !('text' in s) || s.tone === 'dim')).toBe(true)
  const hot = bandLines({ ...BASE, runway: { ...RUNWAY, percent: 60 } })
  expect(hot.flat().some(s => 'text' in s && s.text === ' 60%' && s.tone === 'warn')).toBe(true)
})

test('the Usage tab counts turns to the runway, else to 80%', () => {
  const input = {
    ...BASE, turns: [turn(1, 5), turn(2, 7), turn(3, 9)], failures: [], stats: {},
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 }, view: { tab: 'usage' as const, shown: [], planSlug: null },
  }
  expect(usageLines({ ...input, forecast: { at: 15, label: '150k' } }).map(text).join('\n')).toContain('≈3 turns to 150k')
  expect(usageLines({ ...input, forecast: { at: 15, label: '80%' } }).map(text).join('\n')).toContain('≈3 turns to 80%')
  expect(usageLines({ ...input, turns: [turn(1, 50), turn(2, 60), turn(3, 70)] }).map(text).join('\n')).toContain('≈1 turns to 80%')
})

const VIEW: HandoffView = {
  mode: 'ask', threshold: 80, isAskUp: false, percent: 31, point: 300_000, window: 1_000_000, handled: null, lastSave: null,
  alfred: { state: 'stood-down', reason: null }, isWorking: false, runway: null,
}

test('the stood-down HANDOFF row reads the runway', () => {
  expect(text(handoffLines({ ...VIEW, runway: RUNWAY }, 100)[1]!)).toBe('ctx 62% of 150k · handoff by Alfred Code')
  expect(text(handoffLines(VIEW, 100)[1]!)).toBe('ctx 31% of 300k · handoff by Alfred Code')
})

test('bannerSegs', () => {
  expect(text(bannerSegs(STACK))).toBe('auto-run · scorer 80')
  expect(bannerSegs(STACK)[0]).toEqual({ text: 'auto-run', tone: 'warn' })
  expect(text(bannerSegs({ ...STACK, scorer: { on: false, level: 80, rounds: 3 } }))).toBe('auto-run')
  expect(text(bannerSegs({ ...STACK, autoRun: false }))).toBe('scorer 80')
  expect(text(bannerSegs({ ...STACK, autoRun: null }))).toBe('scorer 80')
  expect(bannerSegs({ ...STACK, autoRun: false, scorer: null })).toEqual([])
  expect(bannerSegs({ ...STACK, autoRun: null, scorer: { on: false, level: 80, rounds: 3 } })).toEqual([])
  expect(bannerSegs({ ...STACK, state: 'ignored', reason: 'another session' })).toEqual([])
})

test('the banner leads line 1, after REC when it is on, calm and working, at 90 and 120 columns', () => {
  const banner = bannerSegs(STACK)
  for (const columns of [90, 120]) {
    for (const isWorking of [false, true]) {
      const live = isWorking ? { ...BASE.live, turnId: 't1', startedAt: 0 } : BASE.live
      const plain = bandLines({ ...BASE, columns, isWorking, live, banner })
      expect(text(plain[0]!).startsWith('auto-run · scorer 80 │ ')).toBe(true)
      const withRec = bandLines({ ...BASE, columns, isWorking, live, banner, rec: { level: 'on', words: 0 } })
      expect(text(withRec[0]!).startsWith('● REC │ auto-run · scorer 80 │ ')).toBe(true)
    }
  }
})

test('with no reading yet, the banner alone', () => {
  const none = { ...BASE, usage: { ...USAGE, tokens: null, percent: null }, banner: bannerSegs(STACK) }
  expect(bandLines(none).map(text)).toEqual(['auto-run · scorer 80'])
  expect(bandLines({ ...none, rec: { level: 'on', words: 0 } }).map(text)).toEqual(['● REC │ auto-run · scorer 80'])
  expect(bandLines({ ...none, banner: [] })).toEqual([])
})

test('REC and the banner at 60 columns keep both marks', () => {
  const lines = bandLines({ ...BASE, columns: 60, banner: bannerSegs(STACK), rec: { level: 'on', words: 0 }, runway: RUNWAY, newFailures: 2 })
  expect(text(lines[0]!).startsWith('● REC │ auto-run · scorer 80 │ ')).toBe(true)
})

test('the marks take line 1 alone when the calm line does not fit beside them, and every gauge, reset and the cost stay', () => {
  const windows = [{ kind: 'five_hour', percentUsed: 45, resetsAt: '2026-10-28T17:00:00Z' }, { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-31T09:00:00Z' }]
  const usage = { ...USAGE, windows, costUsd: 1.23 }
  for (const columns of [90, 100]) {
    const lines = bandLines({ ...BASE, columns, usage, banner: bannerSegs(STACK), rec: { level: 'on', words: 0 }, runway: RUNWAY })
    expect(text(lines[0]!)).toBe('● REC │ auto-run · scorer 80')
    expect(text(lines[1]!)).toMatch(/^ctx ▰▰▰▱▱ 62% of 150k.* 5h .*\(\d\d\.\d\d \d\d:\d\d\).* 7d .*\(\d\d\.\d\d \d\d:\d\d\)/)
    if (columns >= 100) expect(text(lines[1]!)).toContain('$1.23')
    for (const l of lines) expect(widthOf(l)).toBeLessThanOrEqual(columns)
  }
})

// Task 6: the press-time check and the toast by outcome
test('fillReady: a used file owning the full context, with a prompt', () => {
  expect(fillReady(STACK, 'Read a.md')).toBe(true)
  expect(fillReady({ ...STACK, fullContext: 'compact' }, 'Read a.md')).toBe(true)
  expect(fillReady(STACK, null)).toBe(false)
  expect(fillReady({ ...STACK, fullContext: 'off' }, 'Read a.md')).toBe(false)
  expect(fillReady({ ...STACK, fullContext: null }, 'Read a.md')).toBe(false)
  expect(fillReady({ ...STACK, state: 'ignored', reason: 'unreadable' }, 'Read a.md')).toBe(false)
  expect(fillReady({ ...STACK, state: 'none', reason: 'no status file for this session' }, 'Read a.md')).toBe(false)
})

test('fillToast by outcome', () => {
  expect(fillToast({ isFilled: true })).toBe("Alfred Code's resume prompt filled - Enter in the prompt box sends it")
  expect(fillToast({ isFilled: false, refusal: 'dialog' })).toBe('A dialog holds the keys: close it, then press f again')
  expect(fillToast({ isFilled: false, refusal: 'no_composer' })).toBe('No prompt box here to fill')
  expect(fillToast({ isFilled: false })).toBe("Alfred Code's resume prompt was not filled")
  expect(STACK_TOASTS.notEmpty).toBe("Prompt not empty: clear it, then press f to fill Alfred Code's resume prompt")
  expect(STACK_TOASTS.gone).toBe('Alfred Code has no resume prompt now')
})
