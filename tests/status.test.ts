import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { START, engine, stubAll } from './kit.ts'
import { statusText } from '../hooks/band.ts'

// Spec D2: one status line under the prompt, which Claude Code draws while the band is collapsed, only while something
// needs the person. Claude Code puts '⚠ alfred-mods:' before it (the D2 probe), so the line has no ⚠ of its own.
const measure = ($: Engine, percent: number) =>
  $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })

// Every Bash call fails; hooked before the test's first call on $
function failing($: Engine, on: On): void {
  on('tool.call', async (_, e) => {
    await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: e.tool_use_id, error: 'Exit code 1' })
    return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }
  })
}
// Two calls with different commands, so they keep two rows
async function failTwice($: Engine): Promise<void> {
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'exit 2' })
}

test('statusText joins what needs the person, in the band order', () => {
  expect(statusText({ percent: 82, newFailures: 2, recLevel: 'off' })).toBe('ctx 82% · ✗ 2 new')
  expect(statusText({ percent: 82, newFailures: 2, recLevel: 'on' })).toBe('● REC · ctx 82% · ✗ 2 new')
  // The band turns hot at 60
  expect(statusText({ percent: 59.6, newFailures: 0, recLevel: 'off' })).toBe('ctx 60%')
  expect(statusText({ percent: 59.4, newFailures: 0, recLevel: 'off' })).toBeNull()
  expect(statusText({ percent: null, newFailures: 0, recLevel: 'off' })).toBeNull()
  expect(statusText({ percent: null, newFailures: 0, recLevel: 'strict' })).toBe('● REC')
})

test('the status line shows what needs the person', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses } = stubAll(on)
  engine(on, ['tool.call'])
  failing($, on)
  await $.session.start(START)
  await measure($, 82)
  await failTwice($)
  expect(statuses[statuses.length - 1]).toBe('ctx 82% · ✗ 2 new')
})

test('● REC while REC is on', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses } = stubAll(on, { store: { 'settings:rec': 'on' } })
  engine(on)
  await $.session.start(START)
  expect(statuses).toEqual(['● REC'])
})

test('cleared when nothing needs the person', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses } = stubAll(on)
  engine(on)
  await $.session.start(START)
  // The module's first call is always sent, so a line pinned before a reload is cleared
  expect(statuses).toEqual([undefined])
  await measure($, 40)
  expect(statuses).toEqual([undefined])
  await measure($, 82)
  await measure($, 40)
  expect(statuses).toEqual([undefined, 'ctx 82%', undefined])
})

test('set only when its text changes', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses, clock } = stubAll(on)
  engine(on)
  await $.session.start(START)
  await measure($, 82)
  await measure($, 82.2)
  // The tick reads it each second and finds it the same
  await clock.advance(3000)
  expect(statuses).toEqual([undefined, 'ctx 82%'])
  await measure($, 90)
  expect(statuses).toEqual([undefined, 'ctx 82%', 'ctx 90%'])
})

// The text is the mod's own, but every string the mod puts on screen passes mask(): a private word 'new' shows so
test('through mask()', { timeoutMs: 15_000 }, async ($, on) => {
  const { statuses } = stubAll(on, { store: { 'settings:rec': 'on', 'rec:words': ['new'] } })
  engine(on, ['tool.call'])
  failing($, on)
  await $.session.start(START)
  await failTwice($)
  const last = statuses[statuses.length - 1] ?? ''
  expect(last.startsWith('● REC · ✗ 2 ')).toBe(true)
  expect(last.includes('new')).toBe(false)
})
