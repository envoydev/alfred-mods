// The settings folder's effects: what it reads and writes through $
import type { Field, From, ResolvedSettings, Source, SettingsValues } from './types'
import { DEFAULTS, FIELDS, LEGACY_KEYS, SOURCES, holdRec, holdToast, legacyOf, movedToast, sourceFileName, resolveSettings, skippedToast, writeField } from './settings'
import type { RecLevel } from '../rec/types'
import { toast } from '../core/effects'
import { applyQuiet } from '../tools/effects'
import { recStatus } from '../rec/rec'
import { applyRec, recWordCount } from '../rec/effects'
import { applyBandSetting } from '../band/effects'
import type { EngineInterface } from 'claude-code'
import { applyHandoffSetting } from '../handoff/effects'
import type { HookInput, HookNext } from '../core/types'

// The mod's switches, from the "alfred-mods" key of each settings file and the old commands' store keys (spec
// 2026-11-11 settings-values, S1-S4 and S7): read at the start, on the poll, after a /clear and after each change, one
// run at a time as the status file's reads are. `rec`, the level in force and the source that set it; `skippedKey`,
// the skipped values last told; `isHoldTold`, whether REC's hold was told. A new claude run starts them over.
const settingsMemory = {
  resolved: null as ResolvedSettings | null, rec: null as { level: RecLevel; from: From } | null, skippedKey: '', isHoldTold: false,
  reading: Promise.resolve() as Promise<void>,
}

export const settingsInForce = (): SettingsValues => settingsMemory.resolved?.values ?? DEFAULTS

// REC's level in force and the source that set it, or null before the settings are read
export function recInForce(): { level: RecLevel; from: From } | null {
  return settingsMemory.rec
}

export function loadSettings($: EngineInterface, isStart = false): Promise<void> {
  const next = settingsMemory.reading.then(() => readSettingsNow($, isStart))
  settingsMemory.reading = next.catch(() => undefined)
  return next
}

// Each source read on its own, so a file that does not parse falls to the files below rather than taking the rest
// with it (S1); a refused read, or a store key that throws, counts as absent
export async function readSettingsNow($: EngineInterface, isStart: boolean): Promise<void> {
  if (isStart) {
    settingsMemory.rec = null
    settingsMemory.skippedKey = ''
    settingsMemory.isHoldTold = false
  }
  const layers: Partial<Record<Source, unknown>> = {}
  for (const source of SOURCES) layers[source] = await $.settings.read({ key: 'alfred-mods', source }).catch(() => undefined)
  const rawHandoff = await $.store.get('settings:handoff').catch(() => null)
  const legacy = legacyOf({
    band: await $.store.get('settings:band').catch(() => null),
    place: await $.store.get('settings:band-place').catch(() => null),
    tools: await $.store.get('settings:band-tools').catch(() => null),
    quiet: await $.store.get('settings:quiet').catch(() => null),
    rec: await $.store.get('settings:rec').catch(() => null),
    handoff: rawHandoff,
  })
  const r = resolveSettings(layers, legacy)
  settingsMemory.resolved = r
  await retireLegacyKeys($, r, legacy, rawHandoff)
  if (isStart) await toastMovedOnce($, r)
  const before = settingsMemory.rec
  const pending = holdRec(before, { level: r.values.rec, from: r.from.rec })
  // A skipped value is told once (S3): each skip the last told set did not hold, when the set changes. While REC holds,
  // its skip is the hold's to tell: a skip toast would name a level REC is not at
  const skips = r.skipped.filter(k => !(pending.isHeld && k.field === 'rec'))
  const skippedKey = skips.map(k => `${k.field}@${k.source}`).sort().join(',')
  if (skippedKey !== settingsMemory.skippedKey) {
    const told = new Set(settingsMemory.skippedKey.split(','))
    for (const skip of skips) if (!told.has(`${skip.field}@${skip.source}`)) toast($, skippedToast(skip, r))
    settingsMemory.skippedKey = skippedKey
  }
  // REC's hold (S3), told once per hold; a level that changes after the session's first read is told as /rec told it
  settingsMemory.rec = { level: pending.level, from: pending.from }
  if (!pending.isHeld) settingsMemory.isHoldTold = false
  else if (!settingsMemory.isHoldTold) {
    settingsMemory.isHoldTold = true
    toast($, holdToast(pending.level, pending.from))
  }
  await applyRec($)
  if (before !== null && before.level !== pending.level) toast($, recStatus(pending.level, recWordCount()))
  await applyQuiet($)
  await applyBandSetting($)
  await applyHandoffSetting($)
}

// S7: a field the user's own file sets, machine-wide as the store is, drops its old value; a project or local value
// overrides the old one without retiring it. A refused delete is tried at the next read.
export async function retireLegacyKeys($: EngineInterface, r: ResolvedSettings, legacy: Partial<SettingsValues>, rawHandoff: unknown): Promise<void> {
  for (const field of r.userFields) {
    const key = LEGACY_KEYS[field]
    if (key !== undefined && legacy[field] !== undefined) await $.store.delete(key).catch(() => undefined)
  }
  const isMode = r.userFields.includes('handoff') && legacy.handoff !== undefined
  const isAt = r.userFields.includes('handoffAt') && legacy.handoffAt !== undefined
  if ((!isMode && !isAt) || typeof rawHandoff !== 'object' || rawHandoff === null || Array.isArray(rawHandoff)) return
  const left: Record<string, unknown> = { ...rawHandoff }
  if (isMode) delete left.mode
  if (isAt) delete left.threshold
  if ('mode' in left || 'threshold' in left) await $.store.set('settings:handoff', left).catch(() => undefined)
  else await $.store.delete('settings:handoff').catch(() => undefined)
}

// S7's toast, at a run's first read, once per machine: the earlier commands' choices still in force. A refused read of
// the mark counts as told, so a failing store never repeats it.
export async function toastMovedOnce($: EngineInterface, r: ResolvedSettings): Promise<void> {
  const kept: Partial<Record<Field, unknown>> = {}
  for (const field of FIELDS) if (r.from[field] === 'legacy' && r.values[field] !== DEFAULTS[field]) kept[field] = r.values[field]
  if (Object.keys(kept).length === 0 || (await $.store.get('settings:moved').catch(() => true)) === true) return
  // 30 s to copy the line (the review's #1)
  toast($, movedToast(kept as Partial<SettingsValues>), 30_000)
  await $.store.set('settings:moved', true).catch(() => undefined)
}

// The user settings file Claude Code reads: settings.json in CLAUDE_CONFIG_DIR when set, else in ~/.claude; null with no
// home to find it from
export async function userSettingsPath($: EngineInterface): Promise<string | null> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? ''
  if (dir !== '') return `${dir.replace(/[\\/]+$/, '')}/settings.json`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return home === '' ? null : `${home.replace(/[\\/]+$/, '')}/.claude/settings.json`
}

// The one write of /rec on|strict|off and /auto-handoff ask|auto|off|at <percent> (the user's ruling, 2026-11-12): the
// field into the user file, every other key kept. The files are read first, so the answer names a higher file that
// still comes first; Claude Code's ConfigChange then brings the change in, as it does an edit by hand.
export async function writeUserField<F extends Field>($: EngineInterface, field: F, value: SettingsValues[F]): Promise<string> {
  const user = sourceFileName('user')
  const shown = `"${field}": ${JSON.stringify(value)}`
  const byHand = (why: string): string => `Nothing was written: ${why}. Set ${shown} under "alfred-mods" in ${user} by hand.`
  await loadSettings($)
  const path = await userSettingsPath($)
  if (path === null) return byHand('no home folder was found')
  // A refused check is no proof the file is missing: only a check that answers false makes the file
  const isThere = await $.fs.exists(path).catch(() => undefined)
  const text = isThere === false ? null : isThere === true ? await $.fs.read(path).catch(() => undefined) : undefined
  if (text === undefined) return byHand(`${user} could not be read`)
  const next = writeField(text, field, value)
  if ('why' in next) return byHand(next.why === 'parse' ? `${user} does not parse as JSON` : `"alfred-mods" in ${user} is not an object`)
  const isWritten = await $.fs.write(path, next.text).then(() => true, () => false)
  if (!isWritten) return byHand(`${user} refused the write`)
  const r = settingsMemory.resolved
  const from = r?.from[field]
  const isFirst = r !== null && r !== undefined && (from === 'policy' || from === 'flag' || from === 'local' || from === 'project')
  return `Set ${shown} in ${user}.${isFirst ? ` ${sourceFileName(from)} gives ${JSON.stringify(r.values[field])}, which comes first.` : ''}`
}

export function reloadSettingsSoon($: EngineInterface, e: HookInput<'classic.ConfigChange'>, next: HookNext<'classic.ConfigChange'>) {
  $.clock.after(0, () => {
    loadSettings($).catch(() => undefined)
  })
  return next(e)
}

// The settings as last resolved, with each value's source; null before the first read
export function resolvedSettings(): ResolvedSettings | null {
  return settingsMemory.resolved
}
