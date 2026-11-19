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
import type { PlansFolder } from '../plan/types'
import { UNSET_PLANS_FOLDER } from '../plan/constants'

// The mod's switches, from the "alfred-mods" key of each settings file and the old commands' store keys (spec
// 2026-11-11 settings-values, S1-S4 and S7): read at the start, on the poll, after a /clear and after each change, one
// run at a time as the status file's reads are. `rec`, the level in force and the source that set it; `skippedKey`,
// the skipped values last told; `isHoldTold`, whether REC's hold was told. A new claude run starts them over.
const settingsMemory = {
  resolved: null as ResolvedSettings | null, rec: null as { level: RecLevel; from: From } | null, skippedKey: '', isHoldTold: false,
  reading: Promise.resolve() as Promise<void>,
}

export const settingsInForce = (): SettingsValues => settingsMemory.resolved?.values ?? DEFAULTS

// The folder the plan and score files live in, and the source that chose it: 'default' means the field is unset
export function plansFolderInForce(): { folder: PlansFolder; from: From } {
  const resolved = settingsMemory.resolved
  return resolved === null ? { folder: UNSET_PLANS_FOLDER, from: 'default' } : { folder: resolved.values.plansFolder, from: resolved.from.plansFolder }
}

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
async function readSettingsNow($: EngineInterface, isStart: boolean): Promise<void> {
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
  const resolved = resolveSettings(layers, legacy)
  settingsMemory.resolved = resolved
  await retireLegacyKeys($, resolved, legacy, rawHandoff)
  if (isStart) await toastMovedOnce($, resolved)
  const before = settingsMemory.rec
  const pending = holdRec(before, { level: resolved.values.rec, from: resolved.from.rec })
  // A skipped value is told once (S3): each skip the last told set did not hold, when the set changes. While REC holds,
  // its skip is the hold's to tell: a skip toast would name a level REC is not at
  const skips = resolved.skipped.filter(k => !(pending.isHeld && k.field === 'rec'))
  const skippedKey = skips.map(k => `${k.field}@${k.source}`).sort().join(',')
  if (skippedKey !== settingsMemory.skippedKey) {
    const told = new Set(settingsMemory.skippedKey.split(','))
    for (const skip of skips) if (!told.has(`${skip.field}@${skip.source}`)) toast($, skippedToast(skip, resolved))
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
async function retireLegacyKeys($: EngineInterface, resolved: ResolvedSettings, legacy: Partial<SettingsValues>, rawHandoff: unknown): Promise<void> {
  for (const field of resolved.userFields) {
    const key = LEGACY_KEYS[field]
    if (key !== undefined && legacy[field] !== undefined) await $.store.delete(key).catch(() => undefined)
  }
  const isMode = resolved.userFields.includes('handoff') && legacy.handoff !== undefined
  const isAt = resolved.userFields.includes('handoffAt') && legacy.handoffAt !== undefined
  if ((!isMode && !isAt) || typeof rawHandoff !== 'object' || rawHandoff === null || Array.isArray(rawHandoff)) return
  const left: Record<string, unknown> = { ...rawHandoff }
  if (isMode) delete left.mode
  if (isAt) delete left.threshold
  if ('mode' in left || 'threshold' in left) await $.store.set('settings:handoff', left).catch(() => undefined)
  else await $.store.delete('settings:handoff').catch(() => undefined)
}

// S7's toast, at a run's first read, once per machine: the earlier commands' choices still in force. A refused read of
// the mark counts as told, so a failing store never repeats it.
async function toastMovedOnce($: EngineInterface, resolved: ResolvedSettings): Promise<void> {
  const kept: Partial<Record<Field, unknown>> = {}
  for (const field of FIELDS) if (resolved.from[field] === 'legacy' && resolved.values[field] !== DEFAULTS[field]) kept[field] = resolved.values[field]
  if (Object.keys(kept).length === 0 || (await $.store.get('settings:moved').catch(() => true)) === true) return
  // 30 s to copy the line (the review's #1)
  toast($, movedToast(kept as Partial<SettingsValues>), 30_000)
  await $.store.set('settings:moved', true).catch(() => undefined)
}

// The user settings file Claude Code reads: settings.json in CLAUDE_CONFIG_DIR when set, else in ~/.claude; null with no
// home to find it from
async function userSettingsPath($: EngineInterface): Promise<string | null> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? ''
  if (dir !== '') return `${dir.replace(/[\\/]+$/, '')}/settings.json`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return home === '' ? null : `${home.replace(/[\\/]+$/, '')}/.claude/settings.json`
}

// The one write of /rec on|strict|off and /auto-handoff ask|auto|off|at <percent> (the user's ruling, 2026-11-12): the
// field into the user file, every other key kept. The files are read first, so the answer names a higher file that
// still comes first; Claude Code's ConfigChange then brings the change in, as it does an edit by hand.
export async function writeUserFieldResult<F extends Field>($: EngineInterface, field: F, value: SettingsValues[F]): Promise<{ ok: boolean; text: string }> {
  const user = sourceFileName('user')
  const shown = `"${field}": ${JSON.stringify(value)}`
  const byHand = (why: string): { ok: false; text: string } => ({ ok: false, text: `Nothing was written: ${why}. Set ${shown} under "alfred-mods" in ${user} by hand.` })
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
  const resolved = settingsMemory.resolved
  const from = resolved?.from[field]
  const isFirst = resolved !== null && resolved !== undefined && (from === 'policy' || from === 'flag' || from === 'local' || from === 'project')
  return { ok: true, text: `Set ${shown} in ${user}.${isFirst ? ` ${sourceFileName(from)} gives ${JSON.stringify(resolved.values[field])}, which comes first.` : ''}` }
}

export async function writeUserField<F extends Field>($: EngineInterface, field: F, value: SettingsValues[F]): Promise<string> {
  return (await writeUserFieldResult($, field, value)).text
}

const SHADOWING_SOURCES: readonly From[] = ['policy', 'flag', 'local']

// One field into the project's .claude/settings.json (made when missing), every other key kept. The layers are read
// first, so `shadow` names a higher source that gives the field a valid value and keeps coming first; nothing is read
// again after the write - Claude Code's ConfigChange brings the new value in, as for writeUserField.
export async function writeProjectField<F extends Field>($: EngineInterface, field: F, value: SettingsValues[F]): Promise<{ ok: true; shadow: From | null } | { ok: false; why: string }> {
  // The file's name is also its path, relative to the working folder
  const name = sourceFileName('project')
  await loadSettings($)
  const from = settingsMemory.resolved?.from[field] ?? 'default'
  const shadow = SHADOWING_SOURCES.includes(from) ? from : null
  // A refused check is no proof the file is missing: only a check that answers false makes the file
  const isThere = await $.fs.exists(name).catch(() => undefined)
  const text = isThere === false ? null : isThere === true ? await $.fs.read(name).catch(() => undefined) : undefined
  if (text === undefined) return { ok: false, why: `${name} could not be read - ${field} not written` }
  const next = writeField(text, field, value)
  if ('why' in next) return { ok: false, why: next.why === 'parse' ? `${name} does not parse - ${field} not written` : `"alfred-mods" in ${name} is not an object - ${field} not written` }
  const isWritten = await $.fs.write(name, next.text).then(() => true, () => false)
  return isWritten ? { ok: true, shadow } : { ok: false, why: `${name} refused the write - ${field} not written` }
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
