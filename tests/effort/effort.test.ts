// The effort a session will send, worked out before its first request. Each case below was run against Claude Code
// 2.1.332 with a local stub API on 2026-11-25, and its request carried the level expected here.
import { expect, test } from 'claude-code/testing'

import { effortText } from '../../hooks/core/format'
import { predictedEffort } from '../../hooks/effort/effort'
import type { EffortLayers } from '../../hooks/effort/types'

const SONNET = 'claude-sonnet-5-5'
const saved = (level: string, model = SONNET) => ({ modelSettings: { [model]: { effortLevel: level } } })
const predict = (layers: EffortLayers = {}, model = SONNET, envLevel?: string) => predictedEffort({ model, envLevel, layers })

const DEFAULT_CASES = [
  ['claude-opus-5-5', 'medium'], ['claude-sonnet-5-5', 'medium'], ['claude-haiku-5-5', 'medium'], ['claude-fable-5-2', 'medium'],
  ['claude-fable-5-1', 'high'], ['claude-opus-5', 'high'], ['claude-sonnet-5', 'high'], ['claude-opus-4-7', 'xhigh'],
  ['claude-sonnet-4-6', 'high'], ['claude-sonnet-4-6-20260101', 'high'], ['claude-sonnet-5-20260101', 'high'],
  ['claude-opus-5-5[1m]', 'medium'],
] as const

for (const [model, level] of DEFAULT_CASES) {
  test(`with nothing set, ${model} defaults to ${level}`, () => {
    expect(predict({}, model)).toBe(level)
  })
}

test('a model with no effort, or one the table does not know, gives none', () => {
  expect(predict({ user: { effortLevel: 'high' } }, 'claude-haiku-4-5')).toBeNull()
  expect(predict({}, 'claude-opus-9')).toBeNull()
  expect(predict({}, 'some-other-model')).toBeNull()
})

test("a model's saved level beats the same file's top-level one", () => {
  expect(predict({ user: { effortLevel: 'low', ...saved('high') } })).toBe('high')
})

test('a top-level user level counts for an older model alone', () => {
  expect(predict({ user: { effortLevel: 'low' } })).toBe('medium')
  expect(predict({ user: { effortLevel: 'low' } }, 'claude-opus-5')).toBe('low')
})

test('the highest file that sets a level for the model decides', () => {
  expect(predict({ user: saved('high'), project: { effortLevel: 'low' } })).toBe('low')
  expect(predict({ project: saved('low'), local: saved('xhigh') })).toBe('xhigh')
  expect(predict({ user: saved('high'), flag: { effortLevel: 'low' } })).toBe('low')
  expect(predict({ user: saved('high'), project: saved('low', 'claude-opus-5-5') })).toBe('high')
})

test('a saved key with a 1m or date suffix is the same model', () => {
  expect(predict({ user: saved('high', `${SONNET}[1m]`) })).toBe('high')
})

test('a level the settings do not take is passed over', () => {
  expect(predict({ user: saved('max') })).toBe('medium')
  expect(predict({ user: saved('high'), project: { effortLevel: 'max' } })).toBe('high')
})

test('the variable beats the files, in any case of letters; an unknown word is ignored', () => {
  expect(predict({ user: saved('high') }, SONNET, 'max')).toBe('max')
  expect(predict({ user: saved('low') }, SONNET, 'HIGH')).toBe('high')
  expect(predict({ user: saved('high') }, SONNET, 'banana')).toBe('high')
})

test('auto and unset send no level, unless a cap below max applies to the model', () => {
  expect(predict({ user: saved('high') }, SONNET, 'auto')).toBeNull()
  expect(predict({}, SONNET, 'unset')).toBeNull()
  expect(predict({ user: { ...saved('high'), maxEffortLevel: 'low' } }, SONNET, 'auto')).toBe('low')
})

test('a cap lowers the level, the lowest of the files', () => {
  expect(predict({ user: { ...saved('high'), maxEffortLevel: 'low' } })).toBe('low')
})

test("a model's own cap replaces its file's cap, and another file's cap still holds", () => {
  const user = { maxEffortLevel: 'low', modelSettings: { [SONNET]: { effortLevel: 'high', maxEffortLevel: 'max' } } }
  expect(predict({ user })).toBe('high')
  expect(predict({ user, project: { maxEffortLevel: 'medium' } })).toBe('medium')
})

test('a level the model does not have falls to the one below', () => {
  expect(predict({ user: { effortLevel: 'xhigh' } }, 'claude-sonnet-4-6')).toBe('high')
})

test('a guessed level is marked, a level a request carried is not', () => {
  expect(effortText({ effort: 'high', effortFrom: 'guess' })).toBe('≈high')
  expect(effortText({ effort: 'high', effortFrom: 'step' })).toBe('high')
  expect(effortText({ effort: 'high' })).toBe('high')
  expect(effortText({ effort: null, effortFrom: 'guess' })).toBeNull()
})
