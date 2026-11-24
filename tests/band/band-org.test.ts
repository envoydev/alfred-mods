// The signed-in account on the band's first line (spec 2026-11-23, D4): '<company name> | Team', 'org | Personal' or
// 'org | unknown' after REC, on a line of its own that leads in every state and mode but "off" and is never dropped for
// width; '‹org›' under REC strict for a company name
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { START, engine, rows, stubAll } from '../kit'
import { NOW, NO_READING, REC, STRICT, input, text, texts } from './band-input'
import type { BandInput } from '../../hooks/band/types'

const first = (o: Partial<BandInput>): string => text(bandLines(input(o))[0] ?? [])
const TEAM = { org: 'Acme Inc', kind: 'Team' as const }

test('the full band leads with the account on its own line', () => {
  const lines = bandLines(input())
  expect(text(lines[0] ?? [])).toBe('org | Personal')
  expect(text(lines[1] ?? []).startsWith('Sonnet 5.5')).toBe(true)
  expect(text(lines[2] ?? []).startsWith('ctx ')).toBe(true)
})

test('the calm band leads with it too', () => {
  const lines = texts(bandLines(input({ mode: 'calm' })))
  expect(lines[0]).toBe('org | Personal')
  expect(lines[1]?.startsWith('ctx ')).toBe(true)
})

test('a working band leads with it', () => {
  const live = { turnId: 't2', startedAt: NOW - 5000, toolCalls: 1, toolFailures: 0, runningCalls: [], promptAt: NOW - 5000 }
  expect(first({ isWorking: true, live })).toBe('org | Personal')
})

test('under the input the action row leads and the account line follows it', () => {
  const lines = bandLines(input({ under: { buttons: 'click' }, newFailures: 1 }))
  expect(texts(lines).filter(line => line.includes('org | Personal'))).toHaveLength(1)
  expect(text(lines[0] ?? []).startsWith('✗ 1 new')).toBe(true)
  expect(text(lines[1] ?? [])).toBe('org | Personal')
})

test('before any reading the account draws alone, so it shows from the start', () => {
  expect(texts(bandLines(input(NO_READING)))).toEqual(['org | Personal'])
  expect(texts(bandLines(input({ ...NO_READING, mode: 'calm' })))).toEqual(['org | Personal'])
})

test('"off" draws nothing', () => {
  expect(bandLines(input({ mode: 'off' }))).toEqual([])
  expect(bandLines(input({ ...NO_READING, mode: 'off' }))).toEqual([])
})

test('with no account in the input the band is the body alone', () => {
  const bare = input()
  delete bare.account
  expect(texts(bandLines(bare)).join('\n')).not.toContain('org')
  expect(text(bandLines(bare)[0] ?? []).startsWith('Sonnet 5.5')).toBe(true)
})

test('a company name, Personal and unknown draw by their kind', () => {
  expect(first({ account: TEAM })).toBe('Acme Inc | Team')
  expect(first({ account: { org: 'Personal', kind: 'Personal' } })).toBe('org | Personal')
  expect(first({ account: { org: null } })).toBe('org | unknown')
})

test('a company name past 40 cells is cut with an ellipsis', () => {
  expect(first({ account: { org: 'x'.repeat(60), kind: 'Team' } })).toBe(`${'x'.repeat(39)}… | Team`)
})

test('the name is plain and the bar and the kind are dim', () => {
  expect((bandLines(input({ account: TEAM }))[0] ?? [])).toEqual([{ text: 'Acme Inc' }, { text: ' | ', tone: 'dim' }, { text: 'Team', tone: 'dim' }])
})

test('with REC on the account follows the REC mark and shows as it is', () => {
  expect(first({ rec: REC, account: TEAM })).toBe('● REC │ Acme Inc | Team')
})

test('REC strict draws a company name as ‹org›, and leaves Personal and unknown', () => {
  const company = first({ rec: STRICT, account: TEAM })
  expect(company).toBe('● REC │ ‹org› | Team')
  expect(company).not.toContain('Acme')
  expect(first({ rec: STRICT, account: { org: 'Personal', kind: 'Personal' } })).toBe('● REC │ org | Personal')
  expect(first({ rec: STRICT, account: { org: null } })).toBe('● REC │ org | unknown')
})

test('the order is REC, then the account, on line 1', () => {
  expect(texts(bandLines(input({ rec: REC })))[0]).toBe('● REC │ org | Personal')
})

test('narrow, the identity line keeps its row and the body keeps the whole width', () => {
  const lines = bandLines(input({ columns: 36, rec: REC }))
  expect(text(lines[0] ?? [])).toBe('● REC │ org | Personal')
  const plain = input({ columns: 36 })
  delete plain.account
  expect(texts(lines.slice(1))).toEqual(texts(bandLines(plain)))
})

test('the project row no longer carries the org', () => {
  const project = texts(bandLines(input())).find(line => line.startsWith('project:')) ?? ''
  expect(project).toBe('project: Example │ git:(develop) ↑1 ↓2 +12 −3 │ folder: Frontend/src/app')
})

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const band = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8, bodyColumns: 160, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const mount = ($: Engine, surface: RenderSurface) => $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band })
const HEAD = { '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } }
const started = async ($: Engine, on: Parameters<typeof stubAll>[0], o: Parameters<typeof stubAll>[1]) => {
  stubAll(on, { band: 'full', model: 'claude-sonnet-5-5', version: '2.1.322', repo: { root: '/w' }, files: HEAD, ...o })
  engine(on)
  await $.session.start(START)
}
const accountFile = (account: Record<string, unknown>) => ({ '/cfg/.claude.json': { text: JSON.stringify({ oauthAccount: account }), mtimeMs: 0 } })

for (const surface of SURFACES) {
  test(`on the ${surface}, a session reads the account from the config and the band's first line draws it`, async ($, on) => {
    await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { ...accountFile({ organizationType: 'claude_team', organizationName: 'Acme Inc' }), ...HEAD } })
    const lines = await rows(await mount($, surface), { keepOrg: true })
    expect(lines[0]).toBe('Acme Inc | Team | CC 2.1.322')
    expect(lines.find(line => line.startsWith('project:'))).toBe('project: w │ git:(develop)')
  })
}

test('the session draws the org unknown when no config is found', async ($, on) => {
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  expect((await rows(await mount($, 'terminal'), { keepOrg: true }))[0]).toBe('org | unknown | CC 2.1.322')
})

test('a Pro or Max account is drawn as Personal, never its organization name', async ($, on) => {
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { ...accountFile({ organizationType: 'claude_max', organizationName: "jane@example.com's Organization" }), ...HEAD } })
  const tree = JSON.stringify(await (await mount($, 'terminal')).drawn())
  expect(tree).toContain('Personal')
  expect(tree).not.toContain('jane@example.com')
})
