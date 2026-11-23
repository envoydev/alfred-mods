// The band's three lines (spec 2026-11-23, D4): identity (REC and the account), modes (the banners and the MCP item), then
// the gauges and the rows under them at the band's whole width
import { expect, test } from 'claude-code/testing'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { kitBannerSegs } from '../../hooks/kit/kitlines'
import { mcpItem } from '../../hooks/mcp/mcp'
import { KIT_VALUES } from '../kit/settings'
import { BANNER, IDLE, NOW, REC, STRICT, input, text, texts } from './band-input'
import type { BandInput } from '../../hooks/band/types'
import type { McpServer } from '../../hooks/mcp/types'

const TEAM = { org: 'Acme', kind: 'Team' as const }
const servers = (count: number): McpServer[] => Array.from({ length: count }, (_, i) => ({ name: `s${i}`, state: 'connected' as const, since: 0 }))
const MCP = mcpItem(servers(3))
const MODES = 'auto-run · auto-compact 490k · scoring 80'
const kitBanner = kitBannerSegs({ values: KIT_VALUES })
const bare = (o: Partial<BandInput> = {}): BandInput => {
  const out = input(o)
  delete out.account
  return out
}

test('the user sample draws three lines', () => {
  const lines = texts(bandLines(input({ account: TEAM, banner: BANNER, columns: 200 })))
  expect(lines[0]).toBe('Acme | Team')
  expect(lines[1]).toBe(MODES)
  expect(lines[2]?.startsWith('ctx ')).toBe(true)
})

test('a company name is plain and the bar and the kind are dim', () => {
  expect(bandLines(input({ account: TEAM }))[0]).toEqual([{ text: 'Acme' }, { text: ' | ', tone: 'dim' }, { text: 'Team', tone: 'dim' }])
  expect(text(bandLines(input({ account: { org: 'Acme', kind: 'Enterprise' } }))[0] ?? [])).toBe('Acme | Enterprise')
})

test('a personal account reads org | Personal', () => {
  const line = bandLines(input({ account: { org: 'Personal', kind: 'Personal' } }))[0] ?? []
  expect(text(line)).toBe('org | Personal')
  expect(line).toEqual([{ text: 'org', tone: 'dim' }, { text: ' | ', tone: 'dim' }, { text: 'Personal', tone: 'dim' }])
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
  expect(texts(bandLines(input({ rec: STRICT, account: { org: 'Personal', kind: 'Personal' } })))[0]).toBe('● REC │ org | Personal')
  expect(texts(bandLines(input({ rec: REC, account: TEAM })))[0]).toBe('● REC │ Acme | Team')
})

test('the MCP item follows the banners on line 2', () => {
  const lines = texts(bandLines(input({ account: TEAM, banner: BANNER, mcp: MCP })))
  expect(lines[1]).toBe(`${MODES} │ mcp ✓ 3`)
  expect(texts(bandLines(input({ account: TEAM, mcp: MCP })))[1]).toBe('mcp ✓ 3')
})

test("the kit banner follows Alfred Code's, before the MCP item", () => {
  const line = texts(bandLines(input({ account: TEAM, banner: BANNER, kitBanner, mcp: MCP })))[1] ?? ''
  expect(line.startsWith(`${MODES} │ kit: `)).toBe(true)
  expect(line.endsWith(' │ mcp ✓ 3')).toBe(true)
})

test('empty lines are dropped', () => {
  const lines = texts(bandLines(bare()))
  expect(lines[0]?.startsWith('ctx ')).toBe(true)
  expect(lines).toEqual(texts(bandLines(bare({ banner: [], kitBanner: [], mcp: [] }))))
  expect(texts(bandLines(input({ account: TEAM })))[1]?.startsWith('ctx ')).toBe(true)
  expect(texts(bandLines(bare({ banner: BANNER })))[0]).toBe(MODES)
  expect(texts(bandLines(bare({ rec: REC })))[0]).toBe('● REC')
})

test('the calm band and a working band lead with the same lines', () => {
  const live = { turnId: 't2', startedAt: NOW - 5000, toolCalls: 1, toolFailures: 0, runningCalls: [], promptAt: NOW - 5000 }
  for (const o of [{ mode: 'calm' as const }, { isWorking: true, live }]) {
    const lines = texts(bandLines(input({ ...o, account: TEAM, banner: BANNER, mcp: MCP })))
    expect(lines.slice(0, 2)).toEqual(['Acme | Team', `${MODES} │ mcp ✓ 3`])
    expect(lines.length).toBeGreaterThan(2)
  }
})

test('before any reading the identity and modes lines draw alone, "off" draws nothing', () => {
  const none = { turns: [], usage: { ...input().usage, contextPercent: null, rateWindows: [] }, session: { ...input().session, model: null } }
  expect(texts(bandLines(input({ ...none, account: TEAM, banner: BANNER })))).toEqual(['Acme | Team', MODES])
  expect(bandLines(input({ mode: 'off', account: TEAM, banner: BANNER }))).toEqual([])
})

test('narrow line 2 drops the kit banner first', () => {
  const base: Partial<BandInput> = { account: TEAM, banner: BANNER, mcp: MCP }
  const withKit = (columns: number): string[] => texts(bandLines(input({ ...base, kitBanner, columns })))
  expect(withKit(60)[1]).toBe(`${MODES} │ kit │ mcp ✓ 3`)
  expect(withKit(54)[1]).toBe(`${MODES} │ mcp ✓ 3`)
  expect(withKit(60).slice(2)).toEqual(texts(bandLines(input({ ...base, columns: 60 }))).slice(2))
  for (const columns of [60, 54, 50]) expect(bandLines(input({ ...base, kitBanner, columns })).every(line => widthOf(line) <= columns)).toBe(true)
})

test('a banner that alone overflows is cut, and the MCP item stays', () => {
  const lines = bandLines(input({ account: TEAM, banner: BANNER, kitBanner, mcp: MCP, columns: 30 }))
  expect(widthOf(lines[1] ?? [])).toBeLessThanOrEqual(30)
  expect(text(lines[1] ?? [])).toMatch(/^auto-run.*… │ mcp ✓ 3$/)
})

test('the identity line is never cut by the modes', () => {
  expect(texts(bandLines(input({ account: TEAM, banner: BANNER, columns: 36, rec: REC })))[0]).toBe('● REC │ Acme | Team')
})

const FULL: Partial<BandInput> = { account: TEAM, banner: BANNER, mcp: MCP }
const countRows = (o: Partial<BandInput>): number => bandLines(input(o)).length

test('short of rows line 2 gives way after the project row', () => {
  const all = countRows(FULL)
  const noPlace = texts(bandLines(input({ ...FULL, maxRows: all - 1 })))
  expect(noPlace.some(line => line.startsWith('project:'))).toBe(false)
  expect(noPlace.slice(0, 2)).toEqual(['Acme | Team', `${MODES} │ mcp ✓ 3`])
  expect(noPlace.some(line => line.startsWith('ctx '))).toBe(true)
})

test('then line 1 joins line 2 where it fits, before the info line gives its second row', () => {
  const all = countRows(FULL)
  const joined = texts(bandLines(input({ ...FULL, maxRows: all - 2 })))
  expect(joined[0]).toBe(`Acme | Team │ ${MODES} │ mcp ✓ 3`)
  expect(joined).toHaveLength(all - 2)
  const info = texts(bandLines(input({ ...FULL, maxRows: all - 3 })))
  expect(info).toHaveLength(all - 3)
  expect(info[0]).toBe(`Acme | Team │ ${MODES} │ mcp ✓ 3`)
})

test('where the two do not fit one line, line 2 goes and the identity stays', () => {
  const o: Partial<BandInput> = { ...FULL, columns: 50 }
  const all = countRows(o)
  const lines = texts(bandLines(input({ ...o, maxRows: all - 2 })))
  expect(lines[0]).toBe('Acme | Team')
  expect(lines.join('\n')).not.toContain('auto-run ·')
})

test('the identity line stays however few rows are left', () => {
  expect(texts(bandLines(input({ ...FULL, maxRows: 1 })))[0]).toContain('Acme | Team')
})

test('under the input the action row stays first', () => {
  const lines = texts(bandLines(input({ ...FULL, under: { buttons: 'text' }, newFailures: 1 })))
  expect(lines[0]).toContain('✗ 1 new')
  expect(lines[1]).toBe('Acme | Team')
  expect(lines[2]).toBe(`${MODES} │ mcp ✓ 3`)
  expect(lines.slice(3).some(line => line.startsWith('ctx '))).toBe(true)
  expect(lines.filter(line => line.includes('✗ 1 new'))).toHaveLength(1)
})

test('above the input the action row stays last, after the rows under the gauges', () => {
  const lines = texts(bandLines(input({ ...FULL, newFailures: 1 })))
  expect(lines[0]).toBe('Acme | Team')
  expect(lines[lines.length - 1]).toContain('✗ 1 new')
})

test('the idle band with a turn running holds the lines too', () => {
  expect(bandLines(input({ ...FULL, live: IDLE })).length).toBeGreaterThan(3)
})
