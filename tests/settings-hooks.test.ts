// The "alfred-mods" key in Claude Code's settings files: each field read per file and settled in the order policy,
// flag, local, project, user, an earlier command's choice, the default (spec 2026-11-11 settings-values, S1-S4)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { BandSetting, Handoff, Quiet, RecState, Stack } from '../types'
import { HANDOFF_USAGE } from '../hooks/handoff.ts'
import { PRESENTATION, START, engine, stubAll, watchState } from './kit.ts'
import type { FileStub } from './kit.ts'

const STATUS = '.claude/session-inspector/status/s1.json'
const STATUS_FILE: FileStub = {
  text: JSON.stringify({
    schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-10-29T14:03:00Z', model: 'claude-opus-5-5',
    window: 1000000, resumeAt: 150000, autoRun: false, scorer: { on: false, level: 80, rounds: 3 }, handoffPrompt: null,
  }),
  mtimeMs: 1,
}

// No earlier command's choice unless a test stores one: the kit's 'calm' band and quiet off would read as such
async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  return {
    ...kit, state,
    band: (): BandSetting => state.get('band') as BandSetting,
    quiet: (): Quiet => state.get('quiet') as Quiet,
    rec: (): RecState => state.get('rec') as RecState,
    handoff: (): Handoff => state.get('handoff') as Handoff,
  }
}

const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })

test('bandRows false in local closes the rows over the user file', async ($, on) => {
  const { band } = await start($, on, { sources: { local: mod({ bandRows: false }), user: mod({ bandRows: true }) } })
  expect(band().isToolsOpen).not.toBe(true)
  expect(band().mode).toBe('full')
})

test('bandPlace under in the user file alone draws under', async ($, on) => {
  const { band } = await start($, on, { sources: { user: mod({ bandPlace: 'under' }) } })
  expect(band().isUnder).toBe(true)
})

test('quiet false draws full tool rows', async ($, on) => {
  const { quiet } = await start($, on, { sources: { user: mod({ quiet: false }) } })
  expect(quiet()).toEqual({ isOn: false })
})

test('no file and no earlier choice: every field at its default', async ($, on) => {
  const { band, quiet, rec, handoff } = await start($, on)
  expect(band()).toEqual({ mode: 'full', isToolsOpen: true })
  expect(quiet()).toEqual({ isOn: true })
  expect(rec().level).toBe('off')
  expect(handoff()).toMatchObject({ mode: 'ask', threshold: 80 })
})

test('handoff and handoffAt reach the handoff state', async ($, on) => {
  const { handoff } = await start($, on, { sources: { project: mod({ handoff: 'auto', handoffAt: 70 }) } })
  expect(handoff()).toMatchObject({ mode: 'auto', threshold: 70 })
})

// REC is the /rec command's, not a settings value (the user's ruling, 2026-11-12): a "rec" in any file is ignored, untold
test('a "rec" in a settings file is ignored', async ($, on) => {
  const { rec, toasts } = await start($, on, { sources: { user: mod({ rec: 'on' }), local: mod({ rec: 'strict' }), project: mod({ rec: 'yes' }) } })
  expect(rec().level).toBe('off')
  expect(toasts).toEqual([])
})

test('a /rec level is never retired by a file', async ($, on) => {
  const { rec, store } = await start($, on, { store: { 'settings:rec': 'on' }, sources: { user: mod({ rec: 'off' }) } })
  expect(rec().level).toBe('on')
  expect(store.get('settings:rec')).toBe('on')
})

test('a refused source counts as none', async ($, on) => {
  const { band } = await start($, on, { refuseSource: ['policy', 'flag'], sources: { local: mod({ band: 'calm' }) } })
  expect(band().mode).toBe('calm')
})

test('a file over an earlier command, the earlier command over the default', async ($, on) => {
  const { band, rec } = await start($, on, {
    store: { 'settings:band': 'calm', 'settings:rec': 'strict' }, sources: { user: mod({ band: 'full' }) },
  })
  expect(band().mode).toBe('full')
  expect(rec().level).toBe('strict')
})

test('the poll reads again', async ($, on) => {
  const { band, sources, clock } = await start($, on)
  expect(band().mode).toBe('full')
  sources.local['alfred-mods'] = { band: 'calm', bandRows: false }
  await clock.advance(29_000)
  expect(band().mode).toBe('full')
  await clock.advance(1_000)
  expect(band()).toEqual({ mode: 'calm' })
})

test('the poll still reads the status file', async ($, on) => {
  const { state, files, clock } = await start($, on)
  expect((state.get('stack') as Stack).state).toBe('none')
  files.current[STATUS] = STATUS_FILE
  await clock.advance(30_000)
  expect((state.get('stack') as Stack).state).not.toBe('none')
})

// The review's #4: a refused read of REC's words keeps the words REC had, and every other field still settles
test('a refused words read still settles every field', async ($, on) => {
  const { band, quiet, rec, handoff } = await start($, on, {
    refuseStore: ['rec:words'], store: { 'settings:rec': 'on' }, sources: { user: mod({ band: 'calm', quiet: false, handoff: 'auto', handoffAt: 70 }) },
  })
  expect(band().mode).toBe('calm')
  expect(quiet()).toEqual({ isOn: false })
  expect(rec().level).toBe('on')
  expect(handoff()).toMatchObject({ mode: 'auto', threshold: 70 })
})

test('the poll reads the status file when the words read is refused', async ($, on) => {
  const { state, files, clock } = await start($, on, { refuseStore: ['rec:words'] })
  files.current[STATUS] = STATUS_FILE
  await clock.advance(30_000)
  expect((state.get('stack') as Stack).state).not.toBe('none')
})

// S4: Claude Code raises ConfigChange on an edit to a settings file; a read inside the hook still answers the old
// value (F4), so the mod reads again at the clock's next tick
test('a ConfigChange reads again after the clock\'s next tick', async ($, on) => {
  const { band, sources, clock } = await start($, on)
  sources.local['alfred-mods'] = { band: 'calm' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  expect(band().mode).toBe('full')
  await clock.advance(0)
  expect(band().mode).toBe('calm')
})

test('two ConfigChanges in one tick read in turn', async ($, on) => {
  const { band, sources, clock } = await start($, on)
  sources.local['alfred-mods'] = { band: 'calm' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  sources.user['alfred-mods'] = { bandRows: false }
  await $.classic.ConfigChange({ source: 'user_settings' })
  await clock.advance(0)
  expect(band()).toEqual({ mode: 'calm' })
})

test('with leave_out_skipped_hooks no ConfigChange hook is registered', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { band, sources, clock } = await start($, on)
  sources.local['alfred-mods'] = { band: 'calm' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  await clock.advance(0)
  expect(band().mode).toBe('full')
  await clock.advance(30_000)
  expect(band().mode).toBe('calm')
})

// Another session's /rec reaches this one with the poll, as in 0.7
test('a level another session stored arrives with the poll', async ($, on) => {
  const { rec, store, clock } = await start($, on)
  store.set('settings:rec', 'strict')
  await clock.advance(30_000)
  expect(rec().level).toBe('strict')
})

// S3: a skipped value is told once, when the set of skipped fields changes, and never quoted
const BAND_SKIP = '"band" in .claude/settings.local.json takes "full" or "calm" - using "full" from the default'
const QUIET_SKIP = '"quiet" in .claude/settings.local.json takes true or false - using true from the default'

test('a bad value toasts once', async ($, on) => {
  const { toasts, clock, sources } = await start($, on, { sources: { local: mod({ band: 'compact' }) } })
  expect(toasts).toEqual([BAND_SKIP])
  await clock.advance(30_000)
  expect(toasts).toEqual([BAND_SKIP])
  sources.local['alfred-mods'] = { band: 'compact', quiet: 'yes' }
  await clock.advance(30_000)
  expect(toasts).toEqual([BAND_SKIP, QUIET_SKIP])
  expect(toasts.some(t => t.includes('compact') || t.includes('yes'))).toBe(false)
})

test('two ConfigChanges in one tick toast once', async ($, on) => {
  const { toasts, clock, sources } = await start($, on)
  sources.local['alfred-mods'] = { band: 'calm' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  sources.local['alfred-mods'] = { band: 'compact' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  await clock.advance(0)
  expect(toasts).toEqual([BAND_SKIP])
})

test('a run starts with no skip told', async ($, on) => {
  const { toasts, clock } = await start($, on, { sources: { local: mod({ band: 'compact' }) } })
  expect(toasts).toEqual([BAND_SKIP])
  await $.session.start(START)
  expect(toasts).toEqual([BAND_SKIP, BAND_SKIP])
  await clock.advance(30_000)
  expect(toasts).toEqual([BAND_SKIP, BAND_SKIP])
})

// S7: the old commands' choices, told once per machine and retired field by field when the user's file sets them
const MOVED = 'Add "alfred-mods": { "bandRows": false, "quiet": false } to ~/.claude/settings.json - the choices your earlier commands made'

test('the old choices toast once per machine', async ($, on) => {
  const { toasts, toastMs, store } = await start($, on, { moved: 'unset', store: { 'settings:quiet': false, 'settings:band-tools': 'closed' } })
  expect(toasts).toEqual([MOVED])
  // The review's #1: 30 s to copy the line, which the box shows first (Claude Code 2.1.322 draws three 40-cell lines)
  expect(toastMs).toEqual([30_000])
  expect(store.get('settings:moved')).toBe(true)
  await $.session.start(START)
  expect(toasts).toEqual([MOVED])
})

test('a /rec level is not in the toast', async ($, on) => {
  const { toasts } = await start($, on, { moved: 'unset', store: { 'settings:rec': 'strict' } })
  expect(toasts).toEqual([])
})

test('no toast when nothing differs from the default', async ($, on) => {
  const { toasts, store } = await start($, on, { moved: 'unset', store: { 'settings:quiet': true } })
  expect(toasts).toEqual([])
  expect(store.get('settings:moved')).toBe(undefined)
})

test('a field a file sets is not in the toast', async ($, on) => {
  const { toasts } = await start($, on, {
    moved: 'unset', store: { 'settings:quiet': false, 'settings:band-tools': 'closed' }, sources: { local: mod({ bandRows: true }) },
  })
  expect(toasts).toEqual(['Add "alfred-mods": { "quiet": false } to ~/.claude/settings.json - the choices your earlier commands made'])
})

test('the user file retires a field', async ($, on) => {
  const { store, quiet, handoff } = await start($, on, {
    store: { 'settings:quiet': false, 'settings:handoff': { mode: 'auto', threshold: 70 } }, sources: { user: mod({ quiet: true, handoff: 'off' }) },
  })
  expect(store.get('settings:quiet')).toBe(undefined)
  expect(store.get('settings:handoff')).toEqual({ threshold: 70 })
  expect(quiet()).toEqual({ isOn: true })
  expect(handoff()).toMatchObject({ mode: 'off', threshold: 70 })
})

test('settings:handoff goes once both its fields are retired', async ($, on) => {
  const { store } = await start($, on, {
    store: { 'settings:handoff': { mode: 'auto', threshold: 70 } }, sources: { user: mod({ handoff: 'ask', handoffAt: 85 }) },
  })
  expect(store.keys()).not.toContain('settings:handoff')
})

test('a local file overrides without retiring', async ($, on) => {
  const { store, quiet } = await start($, on, { store: { 'settings:quiet': false }, sources: { local: mod({ quiet: true }) } })
  expect(quiet()).toEqual({ isOn: true })
  expect(store.get('settings:quiet')).toBe(false)
})

test('a refused delete is tried again', async ($, on) => {
  const { store, toasts, clock } = await start($, on, {
    refuseDelete: ['settings:quiet'], store: { 'settings:quiet': false }, sources: { user: mod({ quiet: false }) },
  })
  expect(store.get('settings:quiet')).toBe(false)
  expect(toasts).toEqual([])
  await clock.advance(30_000)
  expect(store.get('settings:quiet')).toBe(undefined)
  expect(toasts).toEqual([])
})

// S5: /auto-handoff keeps only its actions, its switches settings values; /rec sets REC (rec-hooks.test.ts)
const run = async ($: Engine, command: string, args: string): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

test('/band and /quiet are not registered', async ($, on) => {
  const { registered } = await start($, on)
  expect(registered).toEqual(['inspect', 'rec', 'auto-handoff'])
  // No hook of the mod answers them, so nothing beneath the plugins does either
  expect(await run($, 'band', 'calm').catch(() => null)).toBe(null)
  expect(await run($, 'quiet', 'off').catch(() => null)).toBe(null)
})

test('/auto-handoff off writes nothing', async ($, on) => {
  const { store } = await start($, on, { sources: { project: mod({ handoff: 'auto' }), user: mod({ handoffAt: 70 }) } })
  const writes = store.writes.length
  const text = (await run($, 'auto-handoff', 'off')).split('\n')
  expect(text[0]).toMatch(/^Handoff: auto at 70% · .* · mode from \.claude\/settings\.json · first ask from ~\/\.claude\/settings\.json$/)
  expect(text.slice(1).join('\n')).toBe(HANDOFF_USAGE)
  expect(await run($, 'auto-handoff', '')).toBe(text.join('\n'))
  expect(store.writes.slice(writes)).toEqual([])
})

test('/auto-handoff names an earlier /auto-handoff and the default', async ($, on) => {
  await start($, on, { store: { 'settings:handoff': { mode: 'off' } } })
  expect((await run($, 'auto-handoff', '')).split('\n')[0]).toMatch(/^Handoff: off · .* · mode from an earlier \/auto-handoff · first ask from the default$/)
})

test('/auto-handoff reads the files first', async ($, on) => {
  const { handoff, sources } = await start($, on)
  sources.user['alfred-mods'] = { handoff: 'off' }
  expect(await run($, 'auto-handoff', '')).toMatch(/^Handoff: off /)
  expect(handoff().mode).toBe('off')
})
