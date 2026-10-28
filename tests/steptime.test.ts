import { expect, test } from 'claude-code/testing'

import { closeSlices, liveSpans, mineOf, overheadKey, sliceMs, staleKeys, stepKey, sumTimes, targetsOf, waitOf } from '../hooks/steptime.ts'
import { FIVE, planOf } from './plans.ts'
import type { Credit } from '../types'

const NAME = 'token-refresh'
const DAY = 86_400_000

test("a named agent's time goes to its step", () => {
  expect(targetsOf(NAME, FIVE, { plan: NAME, task: 'S5' }, true)).toEqual({ steps: ['S5'], isShared: false })
})

test("the main loop's time is overhead while agents build named steps", () => {
  expect(targetsOf(NAME, FIVE, null, true)).toBe('overhead')
})

test("with no agent naming a step, the main loop's time goes to the running step", () => {
  expect(targetsOf(NAME, FIVE, null, false)).toEqual({ steps: ['S4'], isShared: false })
  expect(targetsOf(NAME, planOf({ S5: 'in_progress' }), null, false)).toEqual({ steps: ['S4', 'S5'], isShared: true })
})

test("between steps a begun plan's time is overhead, and an unbegun or finished plan takes none", () => {
  expect(targetsOf(NAME, planOf({ S2: 'pending', S3: 'pending', S4: 'pending' }), null, false)).toBe('overhead')
  expect(targetsOf(NAME, planOf({ S1: 'pending', S2: 'pending', S3: 'pending', S4: 'pending' }), null, false)).toBe(null)
  expect(targetsOf(NAME, planOf({ S4: 'done', S5: 'done' }), null, false)).toBe(null)
})

test("an agent naming a step the plan lacks follows the main loop's rule", () => {
  expect(targetsOf(NAME, FIVE, { plan: NAME, task: 'S9' }, false)).toEqual({ steps: ['S4'], isShared: false })
  expect(targetsOf(NAME, FIVE, { plan: 'other', task: 'S1' }, false)).toEqual({ steps: ['S4'], isShared: false })
})

test('a slice is its time less its waits, never below 0', () => {
  expect(sliceMs({ at: 1000, waitMs: 4000, named: [] }, 10_000)).toBe(5000)
  expect(sliceMs({ at: 1000, waitMs: 20_000, named: [] }, 10_000)).toBe(0)
})

test('a slice closed twice is counted once', () => {
  const c: Credit = { slices: { main: { at: 0, waitMs: 0, named: [] } }, mine: {} }
  const once = closeSlices(c, [{ loop: 'main', keys: ['step:p:S4:s1'], isShared: false }], 60_000, false)
  expect(once.credit.mine['step:p:S4:s1']?.ms).toBe(60_000)
  expect(once.credit.slices.main).toBe(undefined)
  const twice = closeSlices(once.credit, [{ loop: 'main', keys: ['step:p:S4:s1'], isShared: false }], 70_000, false)
  expect(twice.credit.mine['step:p:S4:s1']?.ms).toBe(60_000)
  expect(twice.spans).toEqual({})
})

test('a reopen restarts only a slice still open', () => {
  const c: Credit = { slices: { main: { at: 0, waitMs: 5000, named: ['p:S5'] } }, mine: {} }
  const close = [{ loop: 'main', keys: ['overhead:p:s1'], isShared: false }]
  expect(closeSlices(c, close, 60_000, true).credit.slices.main).toEqual({ at: 60_000, waitMs: 0, named: ['p:S5'] })
  expect(closeSlices({ slices: {}, mine: {} }, close, 60_000, true).credit.slices).toEqual({})
})

test('two loops naming one step both add, and a shared span splits', () => {
  const c: Credit = { slices: { a1: { at: 0, waitMs: 0, named: [] }, a2: { at: 30_000, waitMs: 0, named: [] } }, mine: {} }
  const both = closeSlices(c, [{ loop: 'a1', keys: ['step:p:S5:s1'], isShared: false }, { loop: 'a2', keys: ['step:p:S5:s1'], isShared: false }], 60_000, false)
  expect(both.credit.mine['step:p:S5:s1']?.ms).toBe(90_000)
  const split = closeSlices({ slices: { main: { at: 0, waitMs: 0, named: [] } }, mine: {} },
    [{ loop: 'main', keys: ['step:p:S4:s1', 'step:p:S5:s1'], isShared: true }], 60_000, false)
  expect(split.credit.mine).toEqual({ 'step:p:S4:s1': { ms: 30_000, isShared: true }, 'step:p:S5:s1': { ms: 30_000, isShared: true } })
})

test("every session's keys add up, and one plan's never count for another", () => {
  expect(stepKey('p', 'S1', 's1')).toBe('step:p:S1:s1')
  expect(overheadKey('p', 's1')).toBe('overhead:p:s1')
  const entries = {
    'step:p:S1:s1': { ms: 60_000, isShared: false, at: 0 }, 'step:p:S1:s2': { ms: 30_000, isShared: true, at: 0 },
    'step:q:S1:s1': { ms: 5, isShared: false, at: 0 }, 'overhead:p:s1': { ms: 7000, at: 0 },
    'step:p:S2:s1': { ms: 'lots' }, 'cost:2026-10-27:s1': 5,
  }
  expect(sumTimes(entries, 'p')).toEqual({ times: { S1: { ms: 90_000, isShared: true } }, overhead: 7000 })
})

test('keys untouched for 30 days are stale', () => {
  const now = 100 * DAY
  const entries = {
    'step:p:S1:s1': { ms: 1, isShared: false, at: now - 31 * DAY }, 'step:p:S1:s2': { ms: 1, isShared: false, at: now - 29 * DAY },
    'overhead:p:s1': { ms: 1, at: now - 31 * DAY }, 'cost:2026-01-01:s1': { at: 0 },
  }
  expect(staleKeys(entries, now)).toEqual(['step:p:S1:s1', 'overhead:p:s1'])
})

// No test plays a person's yes (the kit's EngineToolCall), so the approved-after-asking wait is pinned here
test("a permission prompt's wait is left out, the tool's own time kept", () => {
  const bash = { tool: 'Bash', ms: 40_000, isMain: true, isAsked: true, outcome: 'ok' as const, durationMs: 5_000 }
  expect(waitOf(bash)).toBe(35_000)
  expect(waitOf({ ...bash, durationMs: null })).toBe(null)
  expect(waitOf({ ...bash, isAsked: false, durationMs: null })).toBe(0)
  expect(waitOf({ ...bash, outcome: 'denied', durationMs: null })).toBe(40_000)
  expect(waitOf({ ...bash, tool: 'AskUserQuestion', isAsked: false })).toBe(40_000)
  expect(waitOf({ ...bash, tool: 'Agent', isAsked: false })).toBe(40_000)
  expect(waitOf({ ...bash, tool: 'Agent', isAsked: false, isMain: false })).toBe(0)
})

test("a session's own keys seed its totals", () => {
  const entries = { 'step:p:S4:s1': { ms: 300_000, isShared: true, at: 0 }, 'overhead:p:s1': { ms: 5, at: 0 }, 'step:p:S4:s2': { ms: 9, isShared: false, at: 0 } }
  expect(mineOf(entries, 's1')).toEqual({ 'step:p:S4:s1': { ms: 300_000, isShared: true }, 'overhead:p:s1': { ms: 5, isShared: false } })
})

test('an open slice shows its span so far, split among its keys, and stays open', () => {
  const c: Credit = { slices: { main: { at: 0, waitMs: 10_000, named: [] } }, mine: {} }
  const closes = [{ loop: 'main', keys: ['step:p:S3:s1', 'step:p:S4:s1'], isShared: true }, { loop: 'gone', keys: ['overhead:p:s1'], isShared: false }]

  expect(liveSpans(c, closes, 70_000)).toEqual({ 'step:p:S3:s1': 30_000, 'step:p:S4:s1': 30_000 })
  expect(c.slices.main).toEqual({ at: 0, waitMs: 10_000, named: [] })
})
