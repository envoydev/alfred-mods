// The modes lines (the user, 2026-11-25): 'alfred-code: auto-run · auto-compact 400k · scoring 90 3' from Alfred Code's
// status file and 'claude-kit: auto-run · scoring 90 3 · plan opus | ...' from claude-kit's settings file, each on its own
// line under the context gauges, and where the band draws them short of rows
import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { alfredModesLine, kitModesLine, modelsLine } from '../../hooks/band/modes'
import { NO_READING, input, text, texts } from './band-input'
import type { BandInput } from '../../hooks/band/types'
import type { Stack } from '../../hooks/stack/types'

const STACK: Stack = {
  state: 'used', reason: null, fullContext: 'compact', model: 'claude-opus-5-5', window: 1_000_000, resumeAt: null, hasNoOffer: false,
  autoRun: true, scorer: { on: true, level: 90, rounds: 3 }, autoCompact: { on: true, at: 400_000 }, plan: null, hasPrompt: false,
  updatedAt: null, readAt: null, ignoredFields: [],
}
const NONE: Stack = { ...STACK, state: 'none', autoRun: null, scorer: null, autoCompact: null }
const KIT = { values: { auto_run: 'on', scoring: 'on', pass_score: 90, auto_approve: 'on' } }
const WIDE = 150
const ALFRED = 'alfred-code: auto-run · auto-compact 400k · scoring 90 3'
const MODELS = 'plan opus | audit opus | review opus | implement sonnet | search haiku'
const WITH_MODELS = { values: { ...KIT.values, plan_model: 'opus', audit_model: 'opus', review_model: 'opus', implement_model: 'sonnet', search_model: 'haiku' } }

test("Alfred Code's modes read auto-run · auto-compact 400k · scoring 90 3, auto-run in warn", () => {
  const line = alfredModesLine(STACK, WIDE)
  expect(text(line)).toBe('auto-run · auto-compact 400k · scoring 90 3')
  expect(line[0]).toEqual({ text: 'auto-run', tone: 'warn' })
})

test("Alfred Code's scoring shows the rounds its status file gives, as alfred-code:mode:scoring sets them", () => {
  expect(text(alfredModesLine({ ...STACK, scorer: { on: true, level: 85, rounds: 5 } }, WIDE))).toBe('auto-run · auto-compact 400k · scoring 85 5')
  expect(text(alfredModesLine({ ...STACK, scorer: { on: false, level: 90, rounds: 3 } }, WIDE))).toBe('auto-run · auto-compact 400k')
})

test("claude-kit's scoring gives its pass score and the rounds its loop runs: 6 under its auto-run, else 3", () => {
  expect(text(kitModesLine(KIT, WIDE))).toBe('auto-run · scoring 90 6')
  expect(text(kitModesLine({ values: { ...KIT.values, auto_run: 'off' } }, WIDE))).toBe('scoring 90 3')
  expect(kitModesLine({ values: { auto_run: 'off', scoring: 'off' } }, WIDE)).toEqual([])
  expect(kitModesLine({ values: null }, WIDE)).toEqual([])
  expect(kitModesLine(null, WIDE)).toEqual([])
})

test('each source keeps its own modes: neither borrows the other', () => {
  expect(text(alfredModesLine({ ...STACK, autoRun: false }, WIDE))).toBe('auto-compact 400k · scoring 90 3')
  expect(alfredModesLine(NONE, WIDE)).toEqual([])
  expect(alfredModesLine(null, WIDE)).toEqual([])
  expect(alfredModesLine({ ...STACK, state: 'ignored', reason: 'another session' }, WIDE)).toEqual([])
})

test('auto-compact with no known point reads alone', () => {
  expect(text(alfredModesLine({ ...STACK, autoRun: false, scorer: null, autoCompact: { on: true, at: null } }, WIDE))).toBe('auto-compact')
})

test('short of width the last mode goes first', () => {
  expect(text(alfredModesLine(STACK, 30))).toBe('auto-run · auto-compact 400k')
  expect(text(alfredModesLine(STACK, 10))).toBe('auto-run')
  expect(alfredModesLine(STACK, 5)).toEqual([])
})

test("claude-kit's five models read in its roles' order, dim; a role the file does not set is left out", () => {
  const line = modelsLine(WITH_MODELS, WIDE)
  expect(text(line)).toBe(MODELS)
  expect(line.every(seg => 'text' in seg && seg.tone === 'dim')).toBe(true)
  expect(text(modelsLine({ values: { plan_model: 'opus', search_model: 'haiku' } }, WIDE))).toBe('plan opus | search haiku')
  expect(modelsLine(KIT, WIDE)).toEqual([])
  expect(modelsLine(null, WIDE)).toEqual([])
})

const both = (o: Partial<BandInput> = {}): BandInput => input({
  account: { org: 'Acme', kind: 'Team' }, alfredModes: alfredModesLine(STACK, WIDE), kitModes: kitModesLine(WITH_MODELS, WIDE),
  models: modelsLine(WITH_MODELS, WIDE), ...o,
})

test('the two lines sit under the context gauges and above the project row, as the user laid the band out', () => {
  const lines = texts(bandLines(both({ columns: WIDE })))
  const at = lines.indexOf(ALFRED)
  expect(at).toBeGreaterThan(1)
  expect(lines[at - 1]?.startsWith('ctx')).toBe(true)
  expect(lines[at + 1]).toBe(`claude-kit: auto-run · scoring 90 6 · ${MODELS}`)
  expect(lines[at + 2]?.startsWith('project:')).toBe(true)
  expect(lines[1]?.startsWith('Sonnet 5.5')).toBe(true)
})

test('a source with nothing on draws no line', () => {
  const lines = texts(bandLines(both({ alfredModes: [] })))
  expect(lines.some(line => line.startsWith('alfred-code:'))).toBe(false)
  expect(lines.some(line => line.startsWith('claude-kit:'))).toBe(true)
})

test("claude-kit's models alone still take its line", () => {
  expect(texts(bandLines(both({ kitModes: [] })))).toContain(`claude-kit: ${MODELS}`)
})

test("short of width claude-kit's models go on the line under its modes", () => {
  const lines = texts(bandLines(both({ columns: 90 })))
  const at = lines.indexOf('claude-kit: auto-run · scoring 90 6')
  expect(at).toBeGreaterThan(-1)
  expect(lines[at + 1]?.trim()).toBe(MODELS)
})

test('short of rows the project row goes first, then the two lines become one with no models, and the identity stays', () => {
  const all = bandLines(both({ columns: WIDE })).length
  const lines = texts(bandLines(both({ columns: WIDE, maxRows: all - 2 })))
  expect(lines).toContain('alfred-code: auto-run · auto-compact 400k · scoring 90 3 │ claude-kit: auto-run · scoring 90 6')
  expect(lines.some(line => line.startsWith('project:') || line.includes('plan opus'))).toBe(false)
  expect(texts(bandLines(both({ maxRows: 1 })))[0]).toContain('Acme | Team')
})

test('before the first reading the lines still show under the identity', () => {
  const lines = texts(bandLines(both({ columns: WIDE, ...NO_READING, mode: 'calm' })))
  expect(lines).toEqual(['Acme | Team', ALFRED, `claude-kit: auto-run · scoring 90 6 · ${MODELS}`])
})

test('short of rows, the joined line after the models line under them also goes', () => {
  const all = bandLines(both({ columns: 100 })).length
  const lines = texts(bandLines(both({ columns: 100, maxRows: all - 3 })))
  expect(lines.some(line => line.includes('plan opus'))).toBe(false)
  expect(lines.filter(line => line.includes('claude-kit:'))).toHaveLength(1)
})

test('joined, a line too wide for both keeps alfred-code alone', () => {
  const all = bandLines(both({ columns: 70 })).length
  const lines = texts(bandLines(both({ columns: 70, maxRows: all - 3 })))
  expect(lines).toContain('alfred-code: auto-run · auto-compact 400k · scoring 90 3')
  expect(lines.some(line => line.startsWith('claude-kit:'))).toBe(false)
})

test('short of rows past the usage and plan rows the modes lines go before the info line', () => {
  expect(texts(bandLines(both({ columns: WIDE, maxRows: 4 })))[3]).toContain('│ claude-kit:')
  const lines = texts(bandLines(both({ columns: WIDE, maxRows: 3 })))
  expect(lines).toHaveLength(3)
  expect(lines[0]).toContain('Acme | Team')
  expect(lines.some(line => line.startsWith('alfred-code:') || line.startsWith('claude-kit:'))).toBe(false)
  expect(lines.some(line => line.startsWith('Sonnet 5.5'))).toBe(true)
})

test('the calm band draws the modes lines dim', () => {
  const lines = bandLines(both({ columns: WIDE, mode: 'calm' }))
  const alfred = lines.find(line => text(line).startsWith('alfred-code:'))
  expect(alfred?.every(seg => !('tone' in seg) || seg.tone === 'dim')).toBe(true)
})
