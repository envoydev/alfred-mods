// The signed-in organization in the band's project row (spec: the org read from the global config): 'org Personal' or
// 'org <company name>' after the branch's sync and changes, before the folder, in every width form; '‹org›' under REC
// strict for a company name
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { bandLines } from '../../hooks/band/band'
import { widthOf } from '../../hooks/core/format'
import { START, engine, rows, stubAll } from '../kit'
import type { BandInput } from '../../hooks/band/types'
import type { Cache } from '../../hooks/cache/types'
import type { Line } from '../../hooks/core/types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, isIdleCompactOff: false, idleMinTokens: 200_000, isIdleSurface: false },
  ratePerToken: null, rateModel: null, lastRequestAt: null, lastRequest: null, sessionCounts: { read: 0, write: 0, input: 0 }, toastedForRequestAt: null,
}
const PLACE = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop', sync: { ahead: 1, behind: 2 }, changes: { added: 12, removed: 3 } }

function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full',
    live: { turnId: null, startedAt: null, toolCalls: 0, toolFailures: 0, runningCalls: [], promptAt: null },
    usage: { contextTokens: null, contextWindow: 200_000, contextPercent: null, startedAt: NOW, rateWindows: [], costUsd: null, todayUsd: null, readingAt: NOW },
    session: { model: 'claude-sonnet-5-5', effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0, waitingPrompts: [], mainToolCalls: 0, place: PLACE },
    turns: [], newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, isPlanInvalid: false, score: null,
    ...o,
  }
}

const text = (line: Line): string => line.map(s => ('text' in s ? s.text : '')).join('')
const projectRow = (o: Partial<BandInput>): Line => bandLines(input(o)).find(line => text(line).startsWith('project:')) ?? []
const drawn = (account: BandInput['account'], o: Partial<BandInput> = {}): string => text(projectRow({ account, ...o }))
const known = (org: string | null): BandInput['account'] => ({ org })

test('the project row shows the org after the sync and the changes, before the folder', () => {
  expect(drawn(known('Acme Inc'))).toBe('project: Example │ git:(develop) ↑1 ↓2 +12 −3 │ org Acme Inc │ folder: Frontend/src/app')
})

test('the org follows a branch with no changes, and a project with no branch', () => {
  expect(drawn(known('Acme'), { session: { ...input().session, place: { project: 'w', branch: 'main' } } })).toBe('project: w │ git:(main) │ org Acme')
  expect(drawn(known('Acme'), { session: { ...input().session, place: { project: 'w', branch: null } } })).toBe('project: w │ org Acme')
})

test('an org that is not known shows as unknown', () => {
  expect(drawn(known(null))).toContain('│ org unknown │')
})

test('no account in the input draws the row as before', () => {
  expect(drawn(undefined)).toBe('project: Example │ git:(develop) ↑1 ↓2 +12 −3 │ folder: Frontend/src/app')
})

test('an org past 40 cells is cut with an ellipsis', () => {
  const row = drawn(known('x'.repeat(60)))
  expect(row).toContain(`org ${'x'.repeat(39)}… │`)
  expect(row).not.toContain('x'.repeat(40))
})

test('narrow, the folder, the changes and the sync go in their order and the org stays', () => {
  expect(drawn(known('Acme'), { columns: 70 })).toBe('project: Example │ git:(develop) ↑1 ↓2 +12 −3 │ org Acme')
  expect(drawn(known('Acme'), { columns: 55 })).toBe('project: Example │ git:(develop) ↑1 ↓2 │ org Acme')
  expect(drawn(known('Acme'), { columns: 45 })).toBe('project: Example │ git:(develop) │ org Acme')
  expect(widthOf(projectRow({ account: known('Acme'), columns: 45 }))).toBeLessThanOrEqual(45)
})

test('narrower still, a long branch is cut so the org stays whole', () => {
  const branch = `feature/${'b'.repeat(22)}`
  const place = { project: 'alfred-mods', branch }
  const row = projectRow({ account: known('Acme'), columns: 60, session: { ...input().session, place } })
  expect(widthOf(row)).toBeLessThanOrEqual(60)
  expect(text(row)).toMatch(/git:\(feature\/b+…\) │ org Acme$/)
  expect(row).toContainEqual({ text: 'org ', tone: 'dim' })
  expect(row).toContainEqual({ text: 'Acme' })
})

test('narrower still, a long project is cut after the branch, and the org stays whole', () => {
  const place = { project: 'p'.repeat(40), branch: 'b'.repeat(30) }
  const row = projectRow({ account: known('Acme'), columns: 40, session: { ...input().session, place } })
  expect(widthOf(row)).toBeLessThanOrEqual(40)
  expect(text(row)).toMatch(/^project: p+… │ git:\(b+…\) │ org Acme$/)
})

test('the label is dim and the value plain, for a company name, Personal and unknown alike', () => {
  for (const org of ['Acme Inc', 'Personal', null]) {
    const row = projectRow({ account: known(org) })
    expect(row).toContainEqual({ text: 'org ', tone: 'dim' })
    expect(row).toContainEqual({ text: org ?? 'unknown' })
  }
})

test('REC strict draws a company name as ‹org›, the label kept', () => {
  const plain = drawn(known('Acme Inc'), { rec: { level: 'strict', words: 0 } })
  expect(plain).toContain('│ org ‹org› │')
  expect(plain).not.toContain('Acme')
  expect(projectRow({ account: known('Acme Inc'), rec: { level: 'strict', words: 0 } })).toContainEqual({ text: '‹org›' })
})

test('REC strict leaves Personal and unknown as they are', () => {
  expect(drawn(known('Personal'), { rec: { level: 'strict', words: 0 } })).toContain('│ org Personal │')
  expect(drawn(known(null), { rec: { level: 'strict', words: 0 } })).toContain('│ org unknown │')
})

test('REC on leaves the org name as it is', () => {
  expect(drawn(known('Acme Inc'), { rec: { level: 'on', words: 0 } })).toContain('│ org Acme Inc │')
})

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const band = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8, bodyColumns: 160, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const mount = ($: Engine, surface: RenderSurface) => $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band })
const started = async ($: Engine, on: Parameters<typeof stubAll>[0], o: Parameters<typeof stubAll>[1]) => {
  stubAll(on, { band: 'full', model: 'claude-sonnet-5-5', version: '2.1.322', repo: { root: '/w' }, files: { '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } }, ...o })
  engine(on)
  await $.session.start(START)
}
const orgFile = (name: string) => ({ '/cfg/.claude.json': { text: JSON.stringify({ oauthAccount: { organizationName: name } }), mtimeMs: 0 } })

for (const surface of SURFACES) {
  test(`on the ${surface}, a session reads the org from the config and the band draws it`, async ($, on) => {
    await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { ...orgFile('Acme Inc'), '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } } })
    expect((await rows(await mount($, surface))).join('\n')).toContain('project: w │ git:(develop) │ org Acme Inc')
  })
}

test('the session draws the org unknown when no config is found', async ($, on) => {
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  expect((await rows(await mount($, 'terminal'))).join('\n')).toContain('│ org unknown')
})

test('a Pro or Max account is drawn as Personal, with no warn tone', async ($, on) => {
  const file = { '/cfg/.claude.json': { text: JSON.stringify({ oauthAccount: { organizationType: 'claude_max', organizationName: 'jane@example.com\'s Organization' } }), mtimeMs: 0 } }
  await started($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { ...file, '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } } })
  const tree = JSON.stringify(await (await mount($, 'terminal')).drawn())
  expect(tree).toContain('Personal')
  expect(tree).not.toContain('jane@example.com')
  expect(tree).not.toContain('"warning"')
})
