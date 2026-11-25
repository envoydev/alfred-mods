// The modes line (the user, 2026-11-24: 'auto-run · auto-compact 400k · scoring 90 3'), from Alfred Code's status file
// and claude-kit's settings file, and where the band draws it
import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { modelsLine, modesLine } from '../../hooks/band/modes'
import { input, text, texts } from './band-input'
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

test("Alfred Code's modes read auto-run · auto-compact 400k · scoring 90 3, auto-run in warn", () => {
  const line = modesLine(STACK, null, WIDE)
  expect(text(line)).toBe('auto-run · auto-compact 400k · scoring 90 3')
  expect(line[0]).toEqual({ text: 'auto-run', tone: 'warn' })
})

test("claude-kit alone gives auto-run and scoring with its pass score and its loop's 3 rounds", () => {
  expect(text(modesLine(null, KIT, WIDE))).toBe('auto-run · scoring 90 3')
  expect(text(modesLine(NONE, KIT, WIDE))).toBe('auto-run · scoring 90 3')
})

test("with both, Alfred Code's scoring level and rounds win, and auto-run shows once", () => {
  const stack = { ...STACK, autoRun: false, scorer: { on: true, level: 80, rounds: 2 } }
  expect(text(modesLine(stack, KIT, WIDE))).toBe('auto-run · auto-compact 400k · scoring 80 2')
})

test("Alfred Code's scoring off leaves claude-kit's in force", () => {
  expect(text(modesLine({ ...STACK, scorer: { on: false, level: 90, rounds: 3 } }, KIT, WIDE))).toBe('auto-run · auto-compact 400k · scoring 90 3')
})

test('auto-compact with no known point reads alone; modes off draw nothing', () => {
  expect(text(modesLine({ ...STACK, autoRun: false, scorer: null, autoCompact: { on: true, at: null } }, null, WIDE))).toBe('auto-compact')
  expect(modesLine({ ...STACK, autoRun: false, scorer: null, autoCompact: { on: false, at: null } }, null, WIDE)).toEqual([])
  expect(modesLine(null, { values: { auto_run: 'off', scoring: 'off' } }, WIDE)).toEqual([])
  expect(modesLine(null, { values: null }, WIDE)).toEqual([])
  expect(modesLine(null, null, WIDE)).toEqual([])
})

test('an ignored status file gives nothing of its own', () => {
  expect(text(modesLine({ ...STACK, state: 'ignored', reason: 'another session' }, null, WIDE))).toBe('')
})

test('short of width the last mode goes first', () => {
  expect(text(modesLine(STACK, null, 30))).toBe('auto-run · auto-compact 400k')
  expect(text(modesLine(STACK, null, 10))).toBe('auto-run')
  expect(modesLine(STACK, null, 5)).toEqual([])
})

const withModes = (o: Partial<BandInput> = {}): BandInput => input({ account: { org: 'Acme', kind: 'Team' }, modes: modesLine(STACK, null, WIDE), ...o })

test('the modes take line 2, under the identity and above the info line', () => {
  const lines = texts(bandLines(withModes()))
  expect(lines[0]).toBe('Acme | Team')
  expect(lines[1]).toBe('auto-run · auto-compact 400k · scoring 90 3')
  expect(lines[2]?.startsWith('Sonnet 5.5')).toBe(true)
})

test('with no mode on there is no modes line', () => {
  const lines = texts(bandLines(withModes({ modes: [] })))
  expect(lines[1]?.startsWith('Sonnet 5.5')).toBe(true)
})

test('short of rows the modes join line 1 after the project row goes, and the identity stays', () => {
  const all = bandLines(withModes()).length
  const lines = texts(bandLines(withModes({ maxRows: all - 2 })))
  expect(lines[0]).toBe('Acme | Team │ auto-run · auto-compact 400k · scoring 90 3')
  expect(lines.some(line => line.startsWith('project:'))).toBe(false)
  expect(texts(bandLines(withModes({ maxRows: 1 })))[0]).toContain('Acme | Team')
})

test('joined, the modes give way where line 1 cannot hold them', () => {
  const lines = texts(bandLines(withModes({ maxRows: 1, columns: 30 })))
  expect(lines[0]).toBe('Acme | Team')
})

const MODELS = 'plan opus | audit opus | review opus | implement sonnet | search haiku'
const WITH_MODELS = { values: { ...KIT.values, plan_model: 'opus', audit_model: 'opus', review_model: 'opus', implement_model: 'sonnet', search_model: 'haiku' } }

test("claude-kit's five models read in its roles' order, dim; a role the file does not set is left out", () => {
  const line = modelsLine(WITH_MODELS, WIDE)
  expect(text(line)).toBe(MODELS)
  expect(line.every(seg => 'text' in seg && seg.tone === 'dim')).toBe(true)
  expect(text(modelsLine({ values: { plan_model: 'opus', search_model: 'haiku' } }, WIDE))).toBe('plan opus | search haiku')
  expect(modelsLine(KIT, WIDE)).toEqual([])
  expect(modelsLine({ values: null }, WIDE)).toEqual([])
  expect(modelsLine(null, WIDE)).toEqual([])
})

test('short of width the last role goes first', () => {
  expect(text(modelsLine(WITH_MODELS, 30))).toBe('plan opus | audit opus')
  expect(modelsLine(WITH_MODELS, 5)).toEqual([])
})

const withKit = (o: Partial<BandInput> = {}): BandInput =>
  input({ account: { org: 'Acme', kind: 'Team' }, modes: modesLine(null, WITH_MODELS, WIDE), models: modelsLine(WITH_MODELS, WIDE), ...o })

test('the models sit beside the modes on line 2 where the two fit, else on the line under them', () => {
  expect(texts(bandLines(withKit({ columns: WIDE })))[1]).toBe(`auto-run · scoring 90 3 · ${MODELS}`)
  const narrow = texts(bandLines(withKit({ columns: 80 })))
  expect(narrow[1]).toBe('auto-run · scoring 90 3')
  expect(narrow[2]).toBe(MODELS)
})

test('models with no mode on take line 2 alone', () => {
  expect(texts(bandLines(withKit({ modes: [] })))[1]).toBe(MODELS)
})

test('short of rows the models go when the modes join line 1', () => {
  const all = bandLines(withKit({ columns: 80 })).length
  const lines = texts(bandLines(withKit({ columns: 80, maxRows: all - 2 })))
  expect(lines[0]).toBe('Acme | Team │ auto-run · scoring 90 3')
  expect(lines.some(line => line.includes('plan opus'))).toBe(false)
})
