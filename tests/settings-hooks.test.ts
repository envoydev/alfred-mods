// The "alfred-mods" key in Claude Code's settings files: each field read per file and settled in the order policy,
// flag, local, project, user, an earlier command's choice, the default (spec 2026-11-11 settings-values, S1-S4)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { BandSetting, Handoff, Quiet, RecState, Stack } from '../types'
import { START, engine, stubAll, watchState } from './kit.ts'
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

test('rec on masks', async ($, on) => {
  const { rec } = await start($, on, { sources: { user: mod({ rec: 'on' }) } })
  expect(rec().level).toBe('on')
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

// S3's REC hold: a file that set REC and goes quiet (a typo drops it whole, F5) does not unmask a running recording
const HOLD_LOCAL = 'alfred-mods: REC stays on - .claude/settings.local.json no longer gives "rec" (a file that does not parse gives nothing); fix it, or set "rec": "off" there'

async function holding($: Engine, on: On) {
  const kit = await start($, on, { sources: { local: mod({ rec: 'on' }), user: mod({ rec: 'off' }) } })
  expect(kit.rec().level).toBe('on')
  delete kit.sources.local['alfred-mods']
  await $.classic.ConfigChange({ source: 'local_settings' })
  await kit.clock.advance(0)
  return kit
}

test('a local on over a user off holds when the local file goes quiet', async ($, on) => {
  const { rec, toasts, clock } = await holding($, on)
  expect(rec().level).toBe('on')
  expect(toasts).toEqual([HOLD_LOCAL])
  await $.classic.ConfigChange({ source: 'user_settings' })
  await clock.advance(30_000)
  expect(rec().level).toBe('on')
  expect(toasts).toEqual([HOLD_LOCAL])
})

test('the file answering ends the hold', async ($, on) => {
  const { rec, toasts, clock, sources } = await holding($, on)
  sources.local['alfred-mods'] = { rec: 'off' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  await clock.advance(0)
  expect(rec().level).toBe('off')
  expect(toasts).toEqual([HOLD_LOCAL, 'REC off'])
})

test('a higher file lowers at once', async ($, on) => {
  const { rec, toasts, clock, sources } = await start($, on, { sources: { user: mod({ rec: 'on' }) } })
  sources.local['alfred-mods'] = { rec: 'off' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  await clock.advance(0)
  expect(rec().level).toBe('off')
  expect(toasts).toEqual(['REC off'])
})

test('a project strict that goes quiet holds, and its off ends it', async ($, on) => {
  const { rec, toasts, clock, sources } = await start($, on, { sources: { project: mod({ rec: 'strict' }), user: mod({ rec: 'on' }) } })
  expect(rec().level).toBe('strict')
  delete sources.project['alfred-mods']
  await clock.advance(30_000)
  expect(rec().level).toBe('strict')
  expect(toasts).toEqual(['alfred-mods: REC stays strict - .claude/settings.json no longer gives "rec" (a file that does not parse gives nothing); fix it, or set "rec": "off" there'])
  sources.project['alfred-mods'] = { rec: 'off' }
  await clock.advance(30_000)
  expect(rec().level).toBe('off')
})

test('a /clear keeps the hold', async ($, on) => {
  const { rec } = await holding($, on)
  await $.classic.SessionStart({ source: 'clear' })
  expect(rec().level).toBe('on')
})

test('a new run ends the hold', async ($, on) => {
  const { rec, toasts } = await holding($, on)
  await $.session.start(START)
  expect(rec().level).toBe('off')
  expect(toasts).toEqual([HOLD_LOCAL])
})

test('a change found after the first read toasts REC\'s status', async ($, on) => {
  const { toasts, clock, sources } = await start($, on)
  expect(toasts).toEqual([])
  sources.user['alfred-mods'] = { rec: 'on' }
  await clock.advance(30_000)
  expect(toasts).toEqual(['● REC on · hiding keys · emails · phones'])
})

test('the session\'s first read toasts nothing, REC on included', async ($, on) => {
  const { rec, toasts } = await start($, on, { sources: { user: mod({ rec: 'on' }) } })
  expect(rec().level).toBe('on')
  expect(toasts).toEqual([])
})

// S3: a skipped value is told once, when the set of skipped fields changes, and never quoted
const BAND_SKIP = 'alfred-mods: "band" in .claude/settings.local.json takes "full" or "calm" - using "full" from the default'
const REC_SKIP = 'alfred-mods: "rec" in .claude/settings.local.json takes "off", "on" or "strict" - using "off" from the default'

test('a bad value toasts once', async ($, on) => {
  const { toasts, clock, sources } = await start($, on, { sources: { local: mod({ band: 'compact' }) } })
  expect(toasts).toEqual([BAND_SKIP])
  await clock.advance(30_000)
  expect(toasts).toEqual([BAND_SKIP])
  sources.local['alfred-mods'] = { band: 'compact', rec: 'yes' }
  await clock.advance(30_000)
  expect(toasts).toEqual([BAND_SKIP, REC_SKIP])
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
const MOVED = 'alfred-mods reads its switches from settings files now. Kept from your earlier commands: add "alfred-mods": { "bandRows": false, "rec": "strict" } to ~/.claude/settings.json'

test('the old choices toast once per machine', async ($, on) => {
  const { toasts, store } = await start($, on, { moved: 'unset', store: { 'settings:rec': 'strict', 'settings:band-tools': 'closed' } })
  expect(toasts).toEqual([MOVED])
  expect(store.get('settings:moved')).toBe(true)
  await $.session.start(START)
  expect(toasts).toEqual([MOVED])
})

test('no toast when nothing differs from the default', async ($, on) => {
  const { toasts, store } = await start($, on, { moved: 'unset', store: { 'settings:quiet': true } })
  expect(toasts).toEqual([])
  expect(store.get('settings:moved')).toBe(undefined)
})

test('a field a file sets is not in the toast', async ($, on) => {
  const { toasts } = await start($, on, {
    moved: 'unset', store: { 'settings:rec': 'strict', 'settings:band-tools': 'closed' }, sources: { local: mod({ bandRows: true }) },
  })
  expect(toasts).toEqual(['alfred-mods reads its switches from settings files now. Kept from your earlier commands: add "alfred-mods": { "rec": "strict" } to ~/.claude/settings.json'])
})

test('the user file retires a field', async ($, on) => {
  const { store, rec, handoff } = await start($, on, {
    store: { 'settings:rec': 'on', 'settings:handoff': { mode: 'auto', threshold: 70 } }, sources: { user: mod({ rec: 'strict', handoff: 'off' }) },
  })
  expect(store.get('settings:rec')).toBe(undefined)
  expect(store.get('settings:handoff')).toEqual({ threshold: 70 })
  expect(rec().level).toBe('strict')
  expect(handoff()).toMatchObject({ mode: 'off', threshold: 70 })
})

test('settings:handoff goes once both its fields are retired', async ($, on) => {
  const { store } = await start($, on, {
    store: { 'settings:handoff': { mode: 'auto', threshold: 70 } }, sources: { user: mod({ handoff: 'ask', handoffAt: 85 }) },
  })
  expect(store.keys()).not.toContain('settings:handoff')
})

test('a local file overrides without retiring', async ($, on) => {
  const { store, rec } = await start($, on, { store: { 'settings:rec': 'on' }, sources: { local: mod({ rec: 'off' }) } })
  expect(rec().level).toBe('off')
  expect(store.get('settings:rec')).toBe('on')
})

test('a refused delete is tried again', async ($, on) => {
  const { store, toasts, clock } = await start($, on, {
    refuseDelete: ['settings:rec'], store: { 'settings:rec': 'on' }, sources: { user: mod({ rec: 'on' }) },
  })
  expect(store.get('settings:rec')).toBe('on')
  expect(toasts).toEqual([])
  await clock.advance(30_000)
  expect(store.get('settings:rec')).toBe(undefined)
  expect(toasts).toEqual([])
})
