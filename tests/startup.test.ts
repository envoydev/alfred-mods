// From the first second (the user, 2026-11-11): the model, Claude Code's version, the project and branch are read at
// session start, and the 5h and 7d windows another session stored stand until this session's first reading
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionUsage } from 'claude-code'

import { PRESENTATION, START, SWITCH, engine, rows, stubAll, watchState } from './kit.ts'

import { nextWindows } from '../hooks/startup.ts'
import type { Meta, Usage } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-28T14:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' },
  { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' },
]
// What another session stored ten minutes ago; a 5h window that reset since is left out
const STORED = { at: NOW - 600_000, windows: WINDOWS }
const NO_LIMITS: SessionUsage = { startedAt: NOW, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } }
const LIMITS = [
  { kind: 'five_hour' as const, percentUsed: 18, resetsAt: '2026-10-28T17:00:00Z' },
  { kind: 'seven_day' as const, percentUsed: 41, resetsAt: '2026-10-31T09:00:00Z' },
]
const measure = ($: Engine, rateLimits: SessionUsage['rateLimits']) =>
  $.session.measure({ context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits, changed: ['context'] })

const usageOf = (state: { get(key: string): unknown }): Usage => state.get('usage') as Usage
const metaOf = (state: { get(key: string): unknown }): Meta => state.get('meta') as Meta

test('session start reads the model, the version, and the project and branch from .git/HEAD', async ($, on) => {
  stubAll(on, {
    now: NOW, usage: NO_LIMITS, model: 'claude-opus-5-5', version: '2.1.322', repo: { root: '/w' },
    files: { '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state)).toMatchObject({ model: 'claude-opus-5-5', version: '2.1.322', place: { project: 'w', branch: 'develop' } })
})

test('a detached HEAD reads as its short commit; a /clear reads the place again', async ($, on) => {
  const kit = stubAll(on, {
    now: NOW, usage: NO_LIMITS, repo: { root: '/w' },
    files: { '.git/HEAD': { text: '0123456789abcdef0123456789abcdef01234567\n', mtimeMs: 0 } },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: '0123456' })
  kit.files.current = { '.git/HEAD': { text: 'ref: refs/heads/main\n', mtimeMs: 0 } }
  await $.classic.SessionStart({ source: 'clear' })
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main' })
})

test('a checkout during the session shows on the 30-second poll', async ($, on) => {
  const kit = stubAll(on, { now: NOW, usage: NO_LIMITS, repo: { root: '/w' }, files: { '.git/HEAD': { text: 'ref: refs/heads/main\n', mtimeMs: 0 } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  kit.files.current = { '.git/HEAD': { text: 'ref: refs/heads/fix\n', mtimeMs: 0 } }
  await kit.clock.advance(30_000)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'fix' })
})

test('a worktree session reads its own branch through its .git file', async ($, on) => {
  stubAll(on, {
    now: NOW, usage: NO_LIMITS, repo: { root: '/w' }, cwd: '/wt',
    files: {
      'wt/.git': { text: 'gitdir: /w/.git/worktrees/wt\n', mtimeMs: 0 },
      '.git/worktrees/wt/HEAD': { text: 'ref: refs/heads/feature/tools\n', mtimeMs: 0 },
    },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state).place).toEqual({ project: 'wt', branch: 'feature/tools' })
})

// The review of 2026-11-11: a move into a worktree changes the session's folder, and the poll reads the place again
test("a move to another folder shows on the poll, with that folder's own branch", async ($, on) => {
  const opts = {
    now: NOW, usage: NO_LIMITS, repo: { root: '/w' }, cwd: '/w',
    files: {
      '.git/HEAD': { text: 'ref: refs/heads/main\n', mtimeMs: 0 },
      'wt/.git': { text: 'gitdir: /w/.git/worktrees/wt\n', mtimeMs: 0 },
      '.git/worktrees/wt/HEAD': { text: 'ref: refs/heads/feature/tools\n', mtimeMs: 0 },
    },
  }
  const kit = stubAll(on, opts)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main' })
  opts.cwd = '/wt'
  await kit.clock.advance(30_000)
  expect(metaOf(state).place).toEqual({ project: 'wt', branch: 'feature/tools' })
})

test('outside a repository the place is the folder alone', async ($, on) => {
  stubAll(on, { now: NOW, usage: NO_LIMITS, repo: null, cwd: '/home/notes' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state).place).toEqual({ project: 'notes', branch: null })
})

test('with every read refused, the session starts as before', async ($, on) => {
  stubAll(on, { now: NOW, usage: NO_LIMITS })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state)?.model ?? null).toBe(null)
  expect(metaOf(state)?.place).toBeUndefined()
})

test('the windows another session stored stand, marked, until the first reading with windows', async ($, on) => {
  const later = { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' }
  const past = { kind: 'five_hour', percentUsed: 90, resetsAt: '2026-10-28T13:00:00Z' }
  stubAll(on, { now: NOW, usage: NO_LIMITS, store: { 'usage:windows': { at: STORED.at, windows: [past, later] } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(usageOf(state)).toMatchObject({ windows: [later], windowsAt: STORED.at })
  // A reading with windows replaces them, unmarked
  await measure($, LIMITS)
  expect(usageOf(state).windows.map(w => w.percentUsed)).toEqual([18, 41])
  expect(usageOf(state).windowsAt ?? null).toBe(null)
})

// The review of 2026-11-11: a step's reading runs every 5 s while busy, and each store write rewrites the file every
// session shares, so only a turn's measure stores them, and only when the percents the band shows change
test("a turn's measure stores the windows for the next session, and only when the percents shown change", async ($, on) => {
  const kit = stubAll(on, { now: NOW, usage: { ...NO_LIMITS, rateLimits: LIMITS } })
  engine(on)
  await $.session.start(START)
  expect(kit.store.get('usage:windows')).toBeUndefined()
  await measure($, LIMITS)
  expect(kit.store.get('usage:windows')).toEqual({ at: NOW, windows: LIMITS.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })) })
  kit.store.set('usage:windows', 'another session wrote this')
  await measure($, LIMITS.map(l => ({ ...l, percentUsed: l.percentUsed + 0.04 })))
  expect(kit.store.get('usage:windows')).toBe('another session wrote this')
})

// The review of 2026-11-11: off a subscription a reading never has windows, so once a request is made the session's
// own readings decide, and its cache is not priced on another session's plan
test('a session off a subscription drops the stored windows at its first reading after a request', async ($, on) => {
  stubAll(on, { now: NOW, usage: NO_LIMITS, store: { 'usage:windows': STORED } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(usageOf(state).windows).toHaveLength(2)
  await measure($, [])
  expect(usageOf(state).windows).toEqual([])
  expect(usageOf(state).windowsAt ?? null).toBe(null)
})

test('a reading before the first request keeps the stored windows; one after it decides', () => {
  const u: Usage = { tokens: null, window: null, percent: null, startedAt: null, windows: WINDOWS, windowsAt: 1, costUsd: null, todayUsd: null, at: 0 }
  expect(nextWindows(u, [], false)).toEqual({ windows: WINDOWS, windowsAt: 1 })
  expect(nextWindows(u, [], true)).toEqual({ windows: [] })
  expect(nextWindows(u, LIMITS, false)).toEqual({ windows: LIMITS })
  expect(nextWindows({ ...u, windowsAt: undefined }, [], false)).toEqual({ windows: [] })
})

// The review of 2026-11-11: no reading runs while idle, so the tick drops a stored window whose reset has passed
test('a stored window goes once its reset passes, before any reading', async ($, on) => {
  const soon = { kind: 'five_hour', percentUsed: 85, resetsAt: new Date(NOW + 2000).toISOString() }
  const later = { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' }
  const kit = stubAll(on, { now: NOW, usage: NO_LIMITS, store: { 'usage:windows': { at: STORED.at, windows: [soon, later] } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(usageOf(state).windows).toHaveLength(2)
  await kit.clock.advance(3000)
  expect(usageOf(state)).toMatchObject({ windows: [later], windowsAt: STORED.at })
})

// The review of 2026-11-11: the band names the model before the first prompt, so a /model then shows at once
test('a /model switch before the first prompt shows at once', async ($, on) => {
  stubAll(on, { now: NOW, usage: NO_LIMITS, model: 'claude-haiku-5-5' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state).model).toBe('claude-haiku-5-5')
  await $.classic.PostModelSwitch(SWITCH)
  expect(metaOf(state).model).toBe('claude-opus-5-5')
})

for (const value of ['x', { at: 'soon', windows: [] }, { at: 1, windows: [{ kind: 'five_hour' }] }, null]) {
  test(`a stored ${JSON.stringify(value)} is no windows`, async ($, on) => {
    stubAll(on, { now: NOW, usage: NO_LIMITS, store: { 'usage:windows': value } })
    const state = watchState(on)
    engine(on)
    await $.session.start(START)
    expect(usageOf(state).windows).toEqual([])
  })
}

const band = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const mount = ($: Engine, surface: RenderSurface) => $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band })

for (const surface of SURFACES) {
  test(`the full band draws at once, before any prompt (${surface})`, async ($, on) => {
    stubAll(on, {
      band: 'full', now: NOW, usage: NO_LIMITS, model: 'claude-sonnet-5-5', version: '2.1.322', repo: { root: '/w' },
      store: { 'usage:windows': STORED }, files: { '.git/HEAD': { text: 'ref: refs/heads/main\n', mtimeMs: 0 } },
    })
    engine(on)
    await $.session.start(START)
    const lines = await rows(await mount($, surface))
    expect(lines).toHaveLength(2)
    expect(lines[0]?.startsWith('ctx — │ 5h ▱▱▱▱▱ ≈15% (')).toBe(true)
    expect(lines[1]).toBe('Sonnet 5.5 │ <1m │ w git:(main) │ CC 2.1.322')
  })
}

const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

test("the Usage tab marks the stored windows ≈ too, until the session's own reading", { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on, { now: NOW, usage: NO_LIMITS, store: { 'usage:windows': STORED } })
  engine(on)
  await $.session.start(START)
  const usageRows = async (): Promise<string[]> => {
    await $.command.run({ command: 'inspect', args: 'usage', origin: { kind: 'composer' }, presentation: PRESENTATION })
    const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'Pane', requestId: 'inspect', props: PANE })
    const out = await rows(ui)
    await ui.unmount()
    return out
  }
  expect((await usageRows()).find(l => l.startsWith('5h'))?.includes('≈15%')).toBe(true)
  await measure($, LIMITS)
  const live = (await usageRows()).find(l => l.startsWith('5h'))
  expect(live?.includes('18%') === true && !live.includes('≈18%')).toBe(true)
})
