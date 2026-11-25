// The band's lines in the user's order (spec 2026-11-23, D4; rearranged by the user, 2026-11-24): line 1 (REC, the
// account, Claude Code's version, the MCP item and the new failures), the turn line, the info line (model, cache, speed,
// times, session time), then the gauges and the rows under them
import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { infoLine } from '../../hooks/band/info'
import { widthOf } from '../../hooks/core/format'
import { mcpItem } from '../../hooks/mcp/mcp'
import { NOW, REC, STRICT, input, text, texts } from './band-input'
import type { BandInput } from '../../hooks/band/types'
import type { McpServer } from '../../hooks/mcp/types'

const TEAM = { org: 'Acme', kind: 'Team' as const }
const VERSION = '2.1.331'
const servers = (count: number): McpServer[] => Array.from({ length: count }, (_, i) => ({ name: `s${i}`, state: 'connected' as const, since: 0 }))
const MCP = mcpItem(servers(3))
const withVersion = (o: Partial<BandInput> = {}): BandInput => {
  const base = input(o)
  return { ...base, session: { ...base.session, version: VERSION } }
}
const bare = (o: Partial<BandInput> = {}): BandInput => {
  const out = input(o)
  delete out.account
  return out
}
const live = { turnId: 't2', startedAt: NOW - 5000, toolCalls: 1, toolFailures: 0, runningCalls: [], promptAt: NOW - 5000 }

test('the user sample: line 1 with the version and the MCP item, the info line, then the gauges', () => {
  const lines = texts(bandLines(withVersion({ account: TEAM, mcp: MCP })))
  expect(lines[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3`)
  expect(lines[1]?.startsWith('Sonnet 5.5 ◑ medium │ ')).toBe(true)
  expect(lines[1]).not.toContain('mcp')
  expect(lines[2]?.startsWith('ctx ')).toBe(true)
  expect(lines[3]?.startsWith('project:')).toBe(true)
})

test("the version follows the account mark as its kind does, dim, and reads alone without an account", () => {
  expect(bandLines(withVersion({ account: TEAM }))[0]).toEqual([
    { text: 'Acme' }, { text: ' | ', tone: 'dim' }, { text: 'Team', tone: 'dim' }, { text: ' | ', tone: 'dim' }, { text: `CC ${VERSION}`, tone: 'dim' },
  ])
  const none = bare()
  expect(texts(bandLines({ ...none, session: { ...none.session, version: VERSION } }))[0]).toBe(`CC ${VERSION}`)
  expect(texts(bandLines(withVersion({ rec: REC, account: TEAM })))[0]).toBe(`● REC │ Acme | Team | CC ${VERSION}`)
})

test('where the identity with the version passes the width, the version goes and the account stays whole', () => {
  const lines = bandLines(withVersion({ rec: REC, account: TEAM, columns: 30 }))
  expect(text(lines[0] ?? [])).toBe('● REC │ Acme | Team')
  expect(text(bandLines(withVersion({ account: TEAM, columns: 40 }))[0] ?? [])).toBe(`Acme | Team | CC ${VERSION}`)
})

test('the info line reads model, cache, speed, Claude and you, then the session time; no version and no MCP item on it', () => {
  const cache = { ...input().cache, lastRequestAt: NOW - 60_000, sessionCounts: { read: 1000, write: 0, input: 10 } }
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 9200, stepMs: 100_000 }
  const o = withVersion({ account: TEAM, mcp: MCP, cache, totals })
  const line = text(infoLine(o))
  const order = ['Sonnet 5.5', 'cache ', '≈92 tok/s avg', 'Claude ', 'you ', '│ 59m']
  const at = order.map(part => line.lastIndexOf(part))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(line).toMatch(/Claude \d\d:\d\d · you \d\d:\d\d │ 59m$/)
  expect(line).not.toContain('CC ')
  expect(line).not.toContain('mcp')
})

test('short of width the info line keeps the prompt time before it drops the times', () => {
  const o = withVersion({ account: TEAM, mcp: MCP })
  const full = text(infoLine(o))
  const narrower = text(infoLine({ ...o, columns: widthOf(infoLine(o)) - 1 }))
  expect(full).toContain('Claude ')
  expect(narrower).not.toContain('Claude ')
  expect(narrower).toMatch(/ │ you \d\d:\d\d │ 59m$/)
})

test('a company name is plain and the bar and the kind are dim', () => {
  expect(bandLines(input({ account: TEAM }))[0]).toEqual([{ text: 'Acme' }, { text: ' | ', tone: 'dim' }, { text: 'Team', tone: 'dim' }])
  expect(text(bandLines(input({ account: { org: 'Acme', kind: 'Enterprise' } }))[0] ?? [])).toBe('Acme | Enterprise')
})

test('a personal account reads Personal, with no org label (the user, 2026-11-25)', () => {
  const line = bandLines(input({ account: { org: 'Personal', kind: 'Personal' } }))[0] ?? []
  expect(text(line)).toBe('Personal')
  expect(line).toEqual([{ text: 'Personal', tone: 'dim' }])
})

test('a company named Personal on a Team plan draws its name and its kind', () => {
  expect(texts(bandLines(input({ account: { org: 'Personal', kind: 'Team' } })))[0]).toBe('Personal | Team')
  expect(texts(bandLines(input({ account: { org: 'Personal', kind: null } })))[0]).toBe('Personal')
  expect(texts(bandLines(input({ account: { org: 'Acme', kind: 'Personal' } })))[0]).toBe('Personal')
})

test('an unknown account reads org | unknown', () => {
  expect(texts(bandLines(input({ account: { org: null } })))[0]).toBe('org | unknown')
  expect(texts(bandLines(input({ account: { org: null, kind: 'Team' } })))[0]).toBe('org | unknown')
})

test('a company with no known kind reads its name alone, cut to 40 cells', () => {
  expect(texts(bandLines(input({ account: { org: 'Acme', kind: null } })))[0]).toBe('Acme')
  expect(texts(bandLines(input({ account: { org: 'x'.repeat(60), kind: 'Team' } })))[0]).toBe(`${'x'.repeat(39)}… | Team`)
})

test('REC strict hides a company name', () => {
  expect(texts(bandLines(input({ rec: STRICT, account: TEAM })))[0]).toBe('● REC │ ‹org› | Team')
  expect(texts(bandLines(input({ rec: STRICT, account: { org: 'Personal', kind: 'Personal' } })))[0]).toBe('● REC │ Personal')
  expect(texts(bandLines(input({ rec: REC, account: TEAM })))[0]).toBe('● REC │ Acme | Team')
})

test('the band draws no modes line', () => {
  const lines = texts(bandLines(withVersion({ account: TEAM, mcp: MCP })))
  expect(lines.some(line => line.includes('auto-run') || line.includes('scoring') || line.startsWith('kit'))).toBe(false)
  expect(lines.filter(line => line.includes('mcp ✓ 3'))).toHaveLength(1)
})

test('an empty identity is dropped', () => {
  expect(texts(bandLines(bare()))[0]?.startsWith('Sonnet 5.5')).toBe(true)
  expect(texts(bandLines(bare({ rec: REC })))[0]).toBe('● REC')
})

test('the calm band and a working band lead with the identity line', () => {
  for (const o of [{ mode: 'calm' as const }, { isWorking: true, live }]) {
    const lines = texts(bandLines(withVersion({ ...o, account: TEAM, mcp: MCP })))
    expect(lines[0]?.startsWith(`Acme | Team | CC ${VERSION} │ mcp ✓ 3`)).toBe(true)
    expect(lines.length).toBeGreaterThan(1)
  }
})

test('before any reading the identity draws alone, "off" draws nothing', () => {
  const none = { turns: [], usage: { ...input().usage, contextPercent: null, rateWindows: [] } }
  const base = withVersion({ ...none, account: TEAM })
  expect(texts(bandLines({ ...base, session: { ...base.session, model: null } }))).toEqual([`Acme | Team | CC ${VERSION}`])
  expect(bandLines(withVersion({ mode: 'off', account: TEAM }))).toEqual([])
})

const FULL: Partial<BandInput> = { account: TEAM, mcp: MCP }
const countRows = (o: Partial<BandInput>): number => bandLines(withVersion(o)).length

test('short of rows the project row gives way first, then the info line keeps one row', () => {
  const all = countRows(FULL)
  const noPlace = texts(bandLines(withVersion({ ...FULL, maxRows: all - 1 })))
  expect(noPlace.some(line => line.startsWith('project:'))).toBe(false)
  expect(noPlace[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3`)
  expect(noPlace.some(line => line.startsWith('ctx '))).toBe(true)
  expect(noPlace.some(line => line.includes('mcp ✓ 3'))).toBe(true)
})

test('the identity line stays however few rows are left', () => {
  expect(texts(bandLines(withVersion({ ...FULL, maxRows: 1 })))[0]).toContain('Acme | Team')
})

test('under the input the new failures and their command end line 1, and no action row repeats them', () => {
  const lines = texts(bandLines(withVersion({ ...FULL, under: { buttons: 'text' }, newFailures: 1 })))
  expect(lines[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3 │ ✓ Turn 1 · 3s · 19 tools │ ✗ 1 new /inspect`)
  expect(lines.slice(1).some(line => line.startsWith('ctx '))).toBe(true)
  expect(lines.filter(line => line.includes('✗ 1 new'))).toHaveLength(1)
})

test('above the input the new failures end line 1 with their button, and the band ends with no action row for them', () => {
  const band = bandLines(withVersion({ ...FULL, newFailures: 1 }))
  const lines = texts(band)
  expect(lines[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3 │ ✓ Turn 1 · 3s · 19 tools │ ✗ 1 new `)
  expect(band[0]?.some(seg => 'button' in seg && seg.button.key === 'inspect')).toBe(true)
  expect(lines.filter(line => line.includes('✗ 1 new'))).toHaveLength(1)
})

test('short of width line 1 gives up the version, then the MCP item, and keeps the failures', () => {
  const o = withVersion({ ...FULL, under: { buttons: 'text' }, newFailures: 1 })
  expect(texts(bandLines({ ...o, columns: 40 }))[0]).toBe('Acme | Team │ mcp ✓ 3 │ ✗ 1 new /inspect')
  expect(texts(bandLines({ ...o, columns: 30 }))[0]).toBe('Acme | Team │ ✗ 1 new /inspect')
})

test('while a turn runs the failures wait for it to end, as every ask does', () => {
  const lines = texts(bandLines(withVersion({ ...FULL, isWorking: true, live, newFailures: 1 })))
  expect(lines[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3 │ ⟳ Turn 2 · 0:05 · 1 tool`)
  expect(lines.some(line => line.includes('new'))).toBe(false)
})

test('a band with a turn running: line 1 with the turn, the info line, then the gauges', () => {
  const lines = texts(bandLines(withVersion({ ...FULL, isWorking: true, live })))
  expect(lines[0]).toBe(`Acme | Team | CC ${VERSION} │ mcp ✓ 3 │ ⟳ Turn 2 · 0:05 · 1 tool`)
  expect(lines[1]?.startsWith('Sonnet 5.5')).toBe(true)
  expect(lines[2]?.startsWith('ctx ')).toBe(true)
  const idle = texts(bandLines(withVersion({ ...FULL, live })))
  expect(idle.some(line => line.startsWith('⟳'))).toBe(false)
})
