import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { isKitOn, kitPassScore, parseKitStatus } from '../../hooks/kit/kit'
import { noteKitLine, readKit, readKitScoreLevel, restoreKit } from '../../hooks/kit/effects'
import { LINE, LINE_NOT_SAVED, LINE_SAVED } from './lines'

// The host refuses a test hook's `$.state` calls: its scan of the test module lists none, and the mod calls no kit effect
// from a hook yet (Task 2 wires them). So these tests give the effects a `$` of their own that keeps state in a map:
// `reset` is the engine's own reset on a /clear, a resume or a branch, and `writes` every value written, in order. The
// effects keep the last value in module memory, shared by every test of the file, so each test notes at a later time.
function fakeState() {
  const kept = new Map<string, { value: unknown; version: number }>()
  const writes: unknown[] = []
  const state = {
    get: async (ref: { key: string }) => ({ value: kept.get(ref.key)?.value, version: kept.get(ref.key)?.version ?? 0 }),
    set: async (ref: { key: string }, value: unknown) => {
      const version = (kept.get(ref.key)?.version ?? 0) + 1
      kept.set(ref.key, { value, version })
      writes.push(value)
      return { isSet: true, version }
    },
  }
  return { $: { state } as unknown as EngineInterface, writes, reset: () => kept.clear() }
}

test('the measured line reads every value with its source, in order', () => {
  const status = parseKitStatus(LINE)
  expect(Object.keys(status!.values)).toEqual(['auto_run', 'scoring', 'pass_score', 'auto_approve', 'plan_model', 'audit_model', 'review_model', 'implement_model', 'search_model'])
  expect(status!.values.auto_run).toEqual({ value: 'on', source: '.claude/kit/settings.json' })
  expect(status!.saved).toBe(null)
})
test('a source with parentheses inside it reads whole', () => {
  const status = parseKitStatus("kit status (x): plan_model=opus (the audit-planner agent's own); audit_model=opus (plan_model);")
  expect(status!.values.plan_model!.source).toBe("the audit-planner agent's own")
  expect(status!.values.audit_model).toEqual({ value: 'opus', source: 'plan_model' })
  expect(parseKitStatus('kit status (x): x=1 (a (b) c); y=2 (d);')!.values).toEqual({ x: { value: '1', source: 'a (b) c' }, y: { value: '2', source: 'd' } })
})
test('a saved note and a not-saved note are kept', () => {
  expect(parseKitStatus(LINE_SAVED)!.saved).toMatch(/^saved: scoring=off in \.claude\/kit\/settings\.json$/)
  expect(parseKitStatus(LINE_NOT_SAVED)!.saved).toMatch(/^not saved - /)
})
test('a cut value ending ... reads as written', () => {
  expect(parseKitStatus('kit status (x): plan_model=abc... (default);')!.values.plan_model!.value).toBe('abc...')
})
test('an unknown name is kept; a broken item ends the read and keeps what came before', () => {
  const status = parseKitStatus('kit status (x): auto_run=on (default); new_flag=1 (default); broken item; scoring=on (default);')
  expect(Object.keys(status!.values)).toEqual(['auto_run', 'new_flag'])
})
test('no marker reads null', () => {
  expect(parseKitStatus('some other hook context')).toBe(null)
})
test('a name such as __proto__ stays a plain value, never the prototype', () => {
  const status = parseKitStatus('kit status (x): __proto__=1 (default);')
  expect(Object.keys(status!.values)).toEqual(['__proto__'])
  expect(Object.getPrototypeOf(status!.values)).toBe(Object.prototype)
})
test('the on value reads as on, any other as off', () => {
  const status = parseKitStatus(LINE)!
  expect(isKitOn(status, 'auto_run')).toBe(true)
  expect(isKitOn(status, 'plan_model')).toBe(false)
  expect(isKitOn(status, 'missing')).toBe(false)
})
test('the pass score counts only while scoring is on and as a whole number 1-100', () => {
  expect(kitPassScore(parseKitStatus('kit status (x): scoring=on (d); pass_score=90 (d);')!)).toBe(90)
  expect(kitPassScore(parseKitStatus('kit status (x): scoring=off (d); pass_score=90 (d);')!)).toBe(null)
  expect(kitPassScore(parseKitStatus('kit status (x): scoring=on (d); pass_score=101 (d);')!)).toBe(null)
  expect(kitPassScore(parseKitStatus('kit status (x): scoring=on (d); pass_score=8.5 (d);')!)).toBe(null)
})

test('a kit line sets the kit atom; a text with no marker leaves it as it is', async () => {
  const { $ } = fakeState()
  await noteKitLine($, LINE, 5000)
  expect(await readKit($)).toEqual({ status: parseKitStatus(LINE), seenAt: 5000 })
  await noteKitLine($, 'no marker', 6000)
  expect(await readKit($)).toEqual({ status: parseKitStatus(LINE), seenAt: 5000 })
})
test('after the engine resets the state, restoreKit writes the kept value back', async () => {
  const { $, reset } = fakeState()
  await noteKitLine($, LINE, 10_000)
  reset()
  expect(await readKit($)).toEqual({ status: null, seenAt: null })
  await restoreKit($)
  expect(await readKit($)).toEqual({ status: parseKitStatus(LINE), seenAt: 10_000 })
})
test('the same line noted five times at one time writes once, and again after a second', async () => {
  const { $, writes } = fakeState()
  const now = 40_000
  for (let i = 0; i < 5; i++) await noteKitLine($, LINE, now)
  expect(writes).toHaveLength(1)
  await noteKitLine($, LINE, now + 1000)
  expect(writes).toHaveLength(2)
  expect((await readKit($)).seenAt).toBe(now + 1000)
})
test('a changed line writes at once', async () => {
  const { $, writes } = fakeState()
  await noteKitLine($, LINE, 60_000)
  await noteKitLine($, LINE_SAVED, 60_000)
  expect(writes).toHaveLength(2)
})
test('the score level is the pass score while scoring is on, else null', async () => {
  const { $ } = fakeState()
  await noteKitLine($, LINE, 80_000)
  expect(await readKitScoreLevel($)).toBe(90)
  await noteKitLine($, LINE_SAVED, 81_000)
  expect(await readKitScoreLevel($)).toBe(null)
})
