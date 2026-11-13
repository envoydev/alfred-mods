// The "alfred-mods" key in Claude Code's settings files: each field read per file and settled in the order policy,
// flag, local, project, user, an earlier command's choice, the default (spec 2026-11-11 settings-values, S1-S4)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { HANDOFF_USAGE } from '../../hooks/handoff/handoff'
import { REC_HELP, recStatus } from '../../hooks/rec/rec'
import { PRESENTATION, START, engine, stubAll, watchState } from '../kit'
import type { FileStub } from '../kit'
import type { BandSetting } from '../../hooks/band/types'
import type { Handoff } from '../../hooks/handoff/types'
import type { RecState } from '../../hooks/rec/types'
import type { Stack } from '../../hooks/stack/types'
import type { Quiet } from '../../hooks/tools/types'

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

// The review's #4: a refused read of REC's words keeps the words REC had, and every other field still settles
test('a refused words read still settles every field', async ($, on) => {
  const { band, quiet, rec, handoff } = await start($, on, {
    refuseStore: ['rec:words'], sources: { user: mod({ band: 'calm', quiet: false, rec: 'on', handoff: 'auto', handoffAt: 70 }) },
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

// S3's REC hold: a file that set REC and goes quiet (a typo drops it whole, F5) does not unmask a running recording
const HOLD_LOCAL = 'REC stays on: .claude/settings.local.json no longer gives "rec" - fix the file, or set "rec": "off" in it'

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

// The review's #2: a bad "rec" in the file that set REC is that file going quiet, so the hold's toast alone tells it,
// never a skip toast saying REC is off beside it; a file above it saying off ends the hold, and the bad value under
// that file is never reached, so no skip is told
test('a bad rec in the holding file toasts the hold alone', async ($, on) => {
  const { rec, toasts, clock, sources } = await start($, on, { sources: { local: mod({ rec: 'on' }), user: mod({ rec: 'off' }) } })
  sources.local['alfred-mods'] = { rec: 'of' }
  await $.classic.ConfigChange({ source: 'local_settings' })
  await clock.advance(0)
  expect(rec().level).toBe('on')
  expect(toasts).toEqual([HOLD_LOCAL])
  sources.flag['alfred-mods'] = { rec: 'off' }
  await clock.advance(30_000)
  expect(rec().level).toBe('off')
  expect(toasts).toEqual([HOLD_LOCAL, 'REC off'])
})

test('a project strict that goes quiet holds, and its off ends it', async ($, on) => {
  const { rec, toasts, clock, sources } = await start($, on, { sources: { project: mod({ rec: 'strict' }), user: mod({ rec: 'on' }) } })
  expect(rec().level).toBe('strict')
  delete sources.project['alfred-mods']
  await clock.advance(30_000)
  expect(rec().level).toBe('strict')
  expect(toasts).toEqual(['REC stays strict: .claude/settings.json no longer gives "rec" - fix the file, or set "rec": "off" in it'])
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
const BAND_SKIP = '"band" in .claude/settings.local.json takes "full", "calm" or "off" - using "full" from the default'
const REC_SKIP = '"rec" in .claude/settings.local.json takes "off", "on" or "strict" - using "off" from the default'

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
const MOVED = 'Add "alfred-mods": { "bandRows": false, "rec": "strict" } to ~/.claude/settings.json - the choices your earlier commands made'

test('the old choices toast once per machine', async ($, on) => {
  const { toasts, toastMs, store } = await start($, on, { moved: 'unset', store: { 'settings:rec': 'strict', 'settings:band-tools': 'closed' } })
  expect(toasts).toEqual([MOVED])
  // The review's #1: 30 s to copy the line, which the box shows first (Claude Code 2.1.322 draws three 40-cell lines)
  expect(toastMs).toEqual([30_000])
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
  expect(toasts).toEqual(['Add "alfred-mods": { "rec": "strict" } to ~/.claude/settings.json - the choices your earlier commands made'])
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

// S5: the commands keep only their actions; a switch is a settings value
const run = async ($: Engine, command: string, args: string): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

test('/band and /quiet are not registered', async ($, on) => {
  const { registered } = await start($, on)
  expect(registered).toEqual(['inspect', 'rec', 'auto-handoff'])
  // No hook of the mod answers them, so nothing beneath the plugins does either
  expect(await run($, 'band', 'calm').catch(() => null)).toBe(null)
  expect(await run($, 'quiet', 'off').catch(() => null)).toBe(null)
})

test('/rec names an earlier /rec as the source of a stored level', async ($, on) => {
  await start($, on, { store: { 'settings:rec': 'on' } })
  expect(await run($, 'rec', '')).toBe(`${recStatus('on', 0)} - from an earlier /rec\n${REC_HELP}`)
})

test('/auto-handoff names an earlier /auto-handoff and the default', async ($, on) => {
  await start($, on, { store: { 'settings:handoff': { mode: 'off' } } })
  expect((await run($, 'auto-handoff', '')).split('\n')[0]).toMatch(/^Handoff: off · .* · mode from an earlier \/auto-handoff · first ask from the default$/)
})

test('/rec reads the files first', async ($, on) => {
  const { rec, handoff, sources } = await start($, on)
  sources.user['alfred-mods'] = { rec: 'on', handoff: 'off' }
  expect(await run($, 'rec', '')).toMatch(/^● REC on /)
  expect(rec().level).toBe('on')
  expect(await run($, 'auto-handoff', '')).toMatch(/^Handoff: off /)
  expect(handoff().mode).toBe('off')
})

// The user's ruling, 2026-11-12: /rec on|strict|off and /auto-handoff ask|auto|off|at <percent> write their field into
// the user file, the rest of it kept; Claude Code's ConfigChange then brings the change in as for an edit by hand
const HOME = { HOME: '/home/u' }
const USER = '/home/u/.claude/settings.json'
const USER_TEXT = '{\n  "theme": "dark",\n  "alfred-mods": {\n    "rec": "off"\n  }\n}\n'
const fileAt = (files: { current: Record<string, FileStub> }, path: string): string | undefined =>
  Object.entries(files.current).find(([key]) => key === path || key.endsWith(path))?.[1].text

test('/rec on, strict and off write "rec" in the user file', async ($, on) => {
  const { files, store } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  const writes = store.writes.length
  expect(await run($, 'rec', 'on')).toBe('Set "rec": "on" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toBe('{\n  "theme": "dark",\n  "alfred-mods": {\n    "rec": "on"\n  }\n}\n')
  expect(await run($, 'rec', 'STRICT')).toBe('Set "rec": "strict" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toContain('"rec": "strict"')
  expect(await run($, 'rec', 'off')).toBe('Set "rec": "off" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toBe(USER_TEXT)
  expect(store.writes.slice(writes)).toEqual([])
})

test('/rec on writes under CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  const { files } = await start($, on, { env: { ...HOME, CLAUDE_CONFIG_DIR: '/cfg' }, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  expect(await run($, 'rec', 'on')).toBe('Set "rec": "on" in ~/.claude/settings.json.')
  expect(fileAt(files, '/cfg/settings.json')).toBe('{\n  "alfred-mods": {\n    "rec": "on"\n  }\n}\n')
  expect(fileAt(files, USER)).toBe(USER_TEXT)
})

test('/rec on makes a missing user file', async ($, on) => {
  const { files } = await start($, on, { env: HOME })
  expect(await run($, 'rec', 'on')).toBe('Set "rec": "on" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toBe('{\n  "alfred-mods": {\n    "rec": "on"\n  }\n}\n')
})

test('/rec on leaves alone a user file it cannot keep', async ($, on) => {
  const broken = '{ "theme": '
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: broken, mtimeMs: 0 } } })
  expect(await run($, 'rec', 'on')).toBe('Nothing was written: ~/.claude/settings.json does not parse as JSON. Set "rec": "on" under "alfred-mods" in ~/.claude/settings.json by hand.')
  files.current[USER] = { text: '{ "alfred-mods": "on" }', mtimeMs: 0 }
  expect(await run($, 'rec', 'on')).toBe('Nothing was written: "alfred-mods" in ~/.claude/settings.json is not an object. Set "rec": "on" under "alfred-mods" in ~/.claude/settings.json by hand.')
  expect(files.writes).toEqual([])
})

test('/rec on says when no home is found', async ($, on) => {
  const { files } = await start($, on, { files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  expect(await run($, 'rec', 'on')).toBe('Nothing was written: no home folder was found. Set "rec": "on" under "alfred-mods" in ~/.claude/settings.json by hand.')
  expect(files.writes).toEqual([])
})

test('/rec on says when the user file cannot be read', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0, size: 5 * 1024 * 1024 } } })
  expect(await run($, 'rec', 'on')).toBe('Nothing was written: ~/.claude/settings.json could not be read. Set "rec": "on" under "alfred-mods" in ~/.claude/settings.json by hand.')
  expect(files.writes).toEqual([])
})

// A refused existence check is no proof the file is missing: making it then would overwrite the person's whole file
test('/rec on never makes the file when its existence check is refused', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } }, refuseExists: [USER] })
  expect(await run($, 'rec', 'on')).toBe('Nothing was written: ~/.claude/settings.json could not be read. Set "rec": "on" under "alfred-mods" in ~/.claude/settings.json by hand.')
  expect(files.writes).toEqual([])
  expect(fileAt(files, USER)).toBe(USER_TEXT)
})

test('/auto-handoff auto says when the user file cannot be written', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } }, refuseWrite: [USER] })
  expect(await run($, 'auto-handoff', 'auto')).toBe('Nothing was written: ~/.claude/settings.json refused the write. Set "handoff": "auto" under "alfred-mods" in ~/.claude/settings.json by hand.')
  expect(fileAt(files, USER)).toBe(USER_TEXT)
})

test('/rec on names a higher file that comes first', async ($, on) => {
  await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } }, sources: { local: mod({ rec: 'off' }) } })
  expect(await run($, 'rec', 'on')).toBe('Set "rec": "on" in ~/.claude/settings.json. .claude/settings.local.json gives "off", which comes first.')
})

test('/auto-handoff ask, auto, off and at <percent> write their field in the user file', async ($, on) => {
  const { files, store } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  const writes = store.writes.length
  expect(await run($, 'auto-handoff', 'auto')).toBe('Set "handoff": "auto" in ~/.claude/settings.json.')
  expect(await run($, 'auto-handoff', 'at 70')).toBe('Set "handoffAt": 70 in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toBe('{\n  "theme": "dark",\n  "alfred-mods": {\n    "rec": "off",\n    "handoff": "auto",\n    "handoffAt": 70\n  }\n}\n')
  expect(await run($, 'auto-handoff', '95')).toBe('Set "handoffAt": 95 in ~/.claude/settings.json.')
  expect(await run($, 'auto-handoff', 'Off')).toBe('Set "handoff": "off" in ~/.claude/settings.json.')
  expect(await run($, 'auto-handoff', 'ask')).toBe('Set "handoff": "ask" in ~/.claude/settings.json.')
  expect(store.writes.slice(writes)).toEqual([])
})

test('/auto-handoff at a percent outside 10 to 95 writes nothing', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  for (const args of ['at 100', 'at 9', 'at 80.5', '5', 'at']) {
    expect((await run($, 'auto-handoff', args)).split('\n')).toEqual(['The first ask takes a whole number from 10 to 95.', HANDOFF_USAGE])
  }
  expect(files.writes).toEqual([])
})

test('a word /rec and /auto-handoff do not take prints the state and the help', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } }, sources: { user: mod({ rec: 'on' }) } })
  expect(await run($, 'rec', 'loud')).toBe(`${recStatus('on', 0)} - from ~/.claude/settings.json\n${REC_HELP}`)
  expect((await run($, 'auto-handoff', 'never')).split('\n').slice(1).join('\n')).toBe(HANDOFF_USAGE)
  expect(files.writes).toEqual([])
})
