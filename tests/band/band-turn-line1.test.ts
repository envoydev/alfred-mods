// Line 1 takes the turn where the width holds both (spec: docs/superpowers/specs/2026-11-25-band-turn-on-line-1-design.md)
import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { TURN_ROOM_MIN } from '../../hooks/band/constants'
import { cellsOf } from '../../hooks/band/wrap'
import type { BandInput } from '../../hooks/band/types'
import type { Line } from '../../hooks/core/types'
import { planView } from '../../hooks/plan/plan'
import { FIVE_OVERHEAD, FIVE_TIMES, NOW as PLAN_NOW, planOf } from '../plans'
import { CACHE, NOW, REC, STRICT, USAGE, input, text, texts } from './band-input'

const plan = planView(planOf({}), FIVE_TIMES, FIVE_OVERHEAD, {}, PLAN_NOW)
const live = {
  turnId: 't2', startedAt: NOW - 12_000, toolCalls: 3, toolFailures: 0, promptAt: NOW - 12_000,
  runningCalls: [{ id: 'c1', tool: 'Bash', label: 'npm test', startedAt: NOW - 5_000 }],
}
const acme = (o: Partial<BandInput> = {}): BandInput =>
  input({ account: { org: 'Acme', kind: 'Team' }, session: { ...input().session, version: '2.1.330' }, mcp: [{ text: 'mcp ✓ 10' }], ...o })
const closing = { ...CACHE, lastRequestAt: NOW - 56 * 60_000, lastRequest: { read: 200_000, write: 0, input: 10 }, sessionCounts: { read: 200_000, write: 0, input: 10 } }
const failed = { turns: [{ ...input().turns[0]!, toolFailures: 1 }], newFailures: 1 }
const running = { isWorking: true, live: { ...live, runningCalls: [] } } // turn 2, 12 s, 3 tools

test('the finished turn joins line 1 after the MCP item and before the new failures, with no 1 ✗ of its own', () => {
  const lines = texts(bandLines(acme({ columns: 150, ...failed })))
  expect(lines[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10 │ ✓ Turn 1 · 3s · 19 tools │ ✗ 1 new ')
  expect(lines.some(line => line.startsWith('✓ Turn'))).toBe(false)
})
test('with no new failures the merged turn keeps its own failure count', () => {
  const lines = texts(bandLines(acme({ columns: 150, turns: failed.turns, usage: { ...USAGE, contextPercent: 70 } })))
  expect(lines[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10 │ ✓ Turn 1 · 3s · 19 tools · 1 ✗')
  const own = bandLines(acme({ columns: 150, turns: failed.turns, usage: { ...USAGE, contextPercent: 70 } }))[0]?.find(seg => 'text' in seg && seg.text === ' · 1 ✗')
  expect(own).toMatchObject({ tone: 'fail' })
})
test('the running turn joins line 1 too', () => {
  expect(texts(bandLines(acme({ columns: 150, ...running })))[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10 │ ⟳ Turn 2 · 0:12 · 3 tools')
})
test('at 80 columns the version gives way so the turn can join; at 60 the turn keeps its own row', () => {
  expect(texts(bandLines(acme({ columns: 80, ...failed })))[0]).toBe('Acme | Team │ mcp ✓ 10 │ ✓ Turn 1 · 3s │ ✗ 1 new ')
  const narrow = texts(bandLines(acme({ columns: 60, ...failed })))
  expect(narrow[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10 │ ✗ 1 new ') // two lines: the identity keeps its version
  expect(narrow[1]).toBe('✓ Turn 1 · 3s')
})
test('at every width the running and the finished turn sit on the same row, and line 1 and the turn row fit', () => {
  for (const rec of [undefined, REC, STRICT]) for (const under of [undefined, { buttons: 'text' as const }, { buttons: 'click' as const }])
    for (let columns = 60; columns <= 200; columns++) {
      const done = bandLines(acme({ columns, rec, under, ...failed }))
      const busy = bandLines(acme({ columns, rec, under, ...failed, ...running }))
      const isMerged = (lines: Line[]): boolean => lines.some(line => text(line).includes('Turn') && text(line).includes('mcp ✓ 10'))
      expect(isMerged(done)).toBe(isMerged(busy))
      // only line 1 and the turn row are this change's: the gauges row passes the width at narrow widths today
      const owned = (lines: Line[]): Line[] => lines.filter(line => text(line).includes('mcp ✓ 10') || /^[✓✗⟳] Turn/.test(text(line)))
      for (const line of [...owned(done), ...owned(busy)]) expect(cellsOf(line)).toBeLessThanOrEqual(columns)
    }
})
test('a turn no form of which fits the room keeps its own row', () => {
  // 71 columns leave the no-version identity exactly TURN_ROOM_MIN of room (22 + 3 + 22 reserve + 24); the turn's room
  // is then 25 (71 - 22 - 3 - 21 for ' │ ✗ 1 new 1: Inspect'), and its narrow form is 26
  expect(TURN_ROOM_MIN).toBe(24)
  const turns = [{ ...input().turns[0]!, turnNumber: 123_456_789, durationMs: 3_599_000 }]
  const lines = texts(bandLines(acme({ columns: 71, turns, newFailures: 1 })))
  expect(lines[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10 │ ✗ 1 new ')
  expect(lines[1]).toBe('✓ Turn 123456789 · 59m 59s')
})
test('the idle healthy band and a cache warning with no turn yet lose no row', () => {
  expect(texts(bandLines(acme()))).toEqual([
    'Acme | Team | CC 2.1.330 │ mcp ✓ 10',
    'Sonnet 5.5 ◑ medium │ Claude 15:58 · you 14:47 │ 59m',
    'ctx ▰▱▱▱▱ 30% │ 5h ▱▱▱▱▱ 15% (28.10 19:00) │ $1.29 · today $10.46',
    'project: Example │ git:(develop) ↑1 ↓2 +12 −3 │ folder: Frontend/src/app',
  ])
  const warned = texts(bandLines(acme({ turns: [], cache: closing })))
  expect(warned.some(line => line.startsWith('⚠ cache cold in 4m'))).toBe(true)
  expect(warned[0]).toBe('Acme | Team | CC 2.1.330 │ mcp ✓ 10')
})
test('a full band whose plan row maxRows dropped keeps PLAN on the merged line', () => {
  // walk maxRows down on the new code until the plan row is gone; the merged line then carries PLAN
  let max = bandLines(acme({ columns: 150, ...failed, plan })).length
  let lines = texts(bandLines(acme({ columns: 150, ...failed, plan, maxRows: max })))
  while (lines.some(line => line.startsWith('plan:'))) lines = texts(bandLines(acme({ columns: 150, ...failed, plan, maxRows: --max })))
  expect(lines[0]).toContain('│ PLAN 3/5')
})
test('with no identity the turn stays its own row; under the input the action row comes first; one row fewer than before', () => {
  const bare = texts(bandLines(input({ account: undefined, ...failed })))
  expect(bare[0]).toBe('✗ 1 new ') // today's line 1 with no identity: the failures item alone
  expect(bare[1]).toMatch(/^✓ Turn 1/)
  const merged = bandLines(acme({ columns: 150, ...failed })).length
  expect(bare.length).toBe(merged + 1)
  const under = texts(bandLines(acme({ columns: 150, ...failed, cache: closing, under: { buttons: 'text' } })))
  expect(under[0]).toMatch(/^⚠ cache cold/)
  expect(under[1]).toContain('✓ Turn 1')
})
test('a calm band whose plan runs keeps the whole step-less plan line on line 1, the title never cut', () => {
  const long = 'Update the interceptor and every caller of the refresh endpoint'
  const longPlan = planView(planOf({ S4: { title: long } }), FIVE_TIMES, FIVE_OVERHEAD, {}, PLAN_NOW)
  for (const columns of [100, 160]) {
    const line = texts(bandLines(acme({ columns, mode: 'calm', isWorking: true, live: { ...live, runningCalls: [] }, plan: longPlan })))[0] ?? ''
    expect(line).toContain('Token refresh')
    expect(line).toContain('3/5 · 60%')
    expect(line).not.toContain('…')
    expect(line).not.toContain('⟳ S4 12m')
  }
})
