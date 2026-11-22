// The signed-in account on the band's first line (spec: the account read from the global config): 'org Personal' or
// 'org <company name>' after REC and before Alfred Code's banner, a mark that leads line 1 in every state and mode but
// "off" and is never dropped for width; '‹org›' under REC strict for a company name
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { kitBannerSegs } from '../../hooks/kit/kitlines'
import { START, engine, rows, stubAll } from '../kit'
import { KIT_VALUES } from '../kit/settings'
import type { BandInput } from '../../hooks/band/types'
import type { Cache } from '../../hooks/cache/types'
import type { Line, Seg } from '../../hooks/core/types'
import type { Usage } from '../../hooks/session/types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, isIdleCompactOff: false, idleMinTokens: 200_000, isIdleSurface: false },
  ratePerToken: null, rateModel: null, lastRequestAt: null, lastRequest: null, sessionCounts: { read: 0, write: 0, input: 0 }, toastedForRequestAt: null,
}
const USAGE: Usage = {
  contextTokens: 60_000, contextWindow: 200_000, contextPercent: 30, startedAt: NOW - 59 * 60_000, costUsd: 1.29, todayUsd: 10.46, readingAt: NOW,
  rateWindows: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' }],
}
const PLACE = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop', sync: { ahead: 1, behind: 2 }, changes: { added: 12, removed: 3 } }
const BANNER: Seg[] = [{ text: 'auto-run · auto-compact 490k · scoring 80' }]
const REC = { level: 'on' as const, words: 0 }
const STRICT = { level: 'strict' as const, words: 0 }
const IDLE = { turnId: null, startedAt: null, toolCalls: 0, toolFailures: 0, runningCalls: [], promptAt: null }

// The full band's idle session with one reading, and an account unless a test says none
function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full', live: IDLE, usage: USAGE,
    session: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: NOW - 73 * 60_000, lastReplyAt: NOW - 120_000, turnCount: 1,
      waitingPrompts: [], mainToolCalls: 19, place: PLACE,
    },
    turns: [{
      turnNumber: 1, turnId: 't1', promptAt: NOW - 73 * 60_000, replyAt: NOW - 120_000, durationMs: 3000, tokensIn: 0, tokensOut: 0, toolCalls: 19, toolFailures: 0,
      contextPercent: null, endReason: 'answer',
    }],
    newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, isPlanInvalid: false, score: null, account: { org: 'Personal' },
    ...o,
  }
}
// Before any reading: no turn, no context percent and no model, so the band has no body
const NO_READING: Partial<BandInput> = { turns: [], usage: { ...USAGE, contextPercent: null, rateWindows: [] }, session: { ...input().session, model: null } }

const text = (line: readonly object[]): string => line.map(seg => ('text' in seg && typeof seg.text === 'string' ? seg.text : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)
const first = (o: Partial<BandInput>): string => text(bandLines(input(o))[0] ?? [])

test('the full band leads line 1 with the org', () => {
  const line = bandLines(input())[0] ?? []
  expect(text(line).startsWith('org Personal │ ctx ')).toBe(true)
  expect(line.slice(0, 2)).toEqual([{ text: 'org ', tone: 'dim' }, { text: 'Personal' }])
})

test('the calm band leads line 1 with it too', () => {
  expect(first({ mode: 'calm' }).startsWith('org Personal │ ctx ')).toBe(true)
})

test('a working band leads line 1 with it', () => {
  const live = { turnId: 't2', startedAt: NOW - 5000, toolCalls: 1, toolFailures: 0, runningCalls: [], promptAt: NOW - 5000 }
  expect(first({ isWorking: true, live }).startsWith('org Personal │ ')).toBe(true)
})

test('under the input the marks lead the first band row, as REC does', () => {
  const lines = bandLines(input({ under: { buttons: 'click' }, newFailures: 1 }))
  expect(texts(lines).filter(line => line.includes('org Personal'))).toHaveLength(1)
  expect(text(lines[0] ?? []).startsWith('org Personal │ ✗ 1 new')).toBe(true)
})

test('before any reading the marks draw alone, so the account shows from the start', () => {
  expect(texts(bandLines(input(NO_READING)))).toEqual(['org Personal'])
  expect(texts(bandLines(input({ ...NO_READING, mode: 'calm' })))).toEqual(['org Personal'])
})

test('"off" draws nothing', () => {
  expect(bandLines(input({ mode: 'off' }))).toEqual([])
  expect(bandLines(input({ ...NO_READING, mode: 'off' }))).toEqual([])
})

test('with no account in the input the band is as it was', () => {
  const bare = input()
  delete bare.account
  expect(texts(bandLines(bare)).join('\n')).not.toContain('org ')
  expect(text(bandLines(bare)[0] ?? []).startsWith('ctx ')).toBe(true)
})

test('a company name and unknown draw as they are', () => {
  expect(first({ account: { org: 'Acme Inc' } }).startsWith('org Acme Inc │ ')).toBe(true)
  expect(first({ account: { org: null } }).startsWith('org unknown │ ')).toBe(true)
})

test('a company name past 40 cells is cut with an ellipsis', () => {
  const line = first({ account: { org: 'x'.repeat(60) } })
  expect(line.startsWith(`org ${'x'.repeat(39)}… │ `)).toBe(true)
})

test('the org is dim-labelled and plain-valued for a company, Personal and unknown alike', () => {
  for (const org of ['Acme Inc', 'Personal', null]) {
    expect((bandLines(input({ account: { org } }))[0] ?? []).slice(0, 2)).toEqual([{ text: 'org ', tone: 'dim' }, { text: org ?? 'unknown' }])
  }
})

test('with REC on the org follows the REC mark and shows as it is', () => {
  expect(first({ rec: REC, account: { org: 'Acme Inc' } }).startsWith('● REC │ org Acme Inc │ ')).toBe(true)
})

test('REC strict draws a company name as ‹org›, and leaves Personal and unknown', () => {
  const company = first({ rec: STRICT, account: { org: 'Acme Inc' } })
  expect(company.startsWith('● REC │ org ‹org› │ ')).toBe(true)
  expect(company).not.toContain('Acme')
  expect(first({ rec: STRICT, account: { org: 'Personal' } }).startsWith('● REC │ org Personal │ ')).toBe(true)
  expect(first({ rec: STRICT, account: { org: null } }).startsWith('● REC │ org unknown │ ')).toBe(true)
})

test("the order is REC, the org, then Alfred Code's banner", () => {
  expect(first({ rec: REC, banner: BANNER }).startsWith('● REC │ org Personal │ auto-run · auto-compact 490k · scoring 80 │ ')).toBe(true)
})

test('the kit banner follows the others while the marks and the body fit', () => {
  const kitBanner = kitBannerSegs({ values: KIT_VALUES })
  expect(first({ rec: REC, banner: BANNER, kitBanner })).toContain('scoring 80 │ kit: ')
})

test('the kit banner still yields first: it shortens to kit or goes, and the org stays', () => {
  const kitBanner = kitBannerSegs({ values: KIT_VALUES })
  for (const columns of [60, 54, 50]) {
    const base: Partial<BandInput> = { columns, rec: REC }
    const plain = bandLines(input(base))
    const withKit = bandLines(input({ ...base, kitBanner }))
    expect(text(withKit[0] ?? []).startsWith('● REC │ org Personal │ ')).toBe(true)
    expect(text(withKit[0] ?? [])).not.toContain('kit: ')
    expect(withKit.every(line => widthOf(line) <= columns)).toBe(true)
    expect(texts(withKit.slice(1))).toEqual(texts(plain.slice(1)))
  }
})

test('narrow, the marks take line 1 alone and the band keeps its rows whole under them', () => {
  const marks: Partial<BandInput> = { columns: 36, rec: REC, banner: BANNER }
  const lines = bandLines(input(marks))
  expect(text(lines[0] ?? [])).toBe('● REC │ org Personal │ auto-run · auto-compact 490k · scoring 80')
  const bare = input({ columns: 36 })
  delete bare.account
  expect(texts(lines.slice(1))).toEqual(texts(bandLines(bare)))
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
    expect(lines[0]?.startsWith('org Acme Inc │ ')).toBe(true)
    expect(lines.find(line => line.startsWith('project:'))).toBe('project: w │ git:(develop)')
  })
}

test('the session draws the org unknown when no config is found', async ($, on) => {
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  expect((await rows(await mount($, 'terminal'), { keepOrg: true }))[0]?.startsWith('org unknown │ ')).toBe(true)
})

test('a Pro or Max account is drawn as Personal, never its organization name', async ($, on) => {
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { ...accountFile({ organizationType: 'claude_max', organizationName: "jane@example.com's Organization" }), ...HEAD } })
  const tree = JSON.stringify(await (await mount($, 'terminal')).drawn())
  expect(tree).toContain('Personal')
  expect(tree).not.toContain('jane@example.com')
})
