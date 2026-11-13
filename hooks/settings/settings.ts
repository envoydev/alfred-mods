// The mod's switches as values under one "alfred-mods" key in Claude Code's settings files (spec 2026-11-11
// settings-values, S1-S3): each field read per file, the first valid value in the order policy, flag, local, project,
// user, then an earlier command's choice, then the default. Pure: register.ts reads the files and the store.
import { MODES, isThreshold } from '../handoff/handoff'
import { LEVELS } from '../rec/rec'
import type { BandMode } from '../band/types'
import type { HandoffMode } from '../handoff/types'
import type { RecLevel } from '../rec/types'
import type { Field, From, ResolvedSettings, Skip, Source, SettingsValues } from './types'

export const FIELDS: readonly Field[] = ['band', 'bandPlace', 'bandRows', 'quiet', 'rec', 'handoff', 'handoffAt']
export const SOURCES: readonly Source[] = ['policy', 'flag', 'local', 'project', 'user']
export const DEFAULTS: SettingsValues = { band: 'full', bandPlace: 'above', bandRows: true, quiet: true, rec: 'off', handoff: 'ask', handoffAt: 80 }

// "off" draws no band, above or under (the user, 2026-11-12: '/inspect band off' hides it where nothing takes a key)
export const BAND_MODES: readonly BandMode[] = ['full', 'calm', 'off']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isBool = (value: unknown): value is boolean => typeof value === 'boolean'

// Each field's test and the words its toast uses for the values it takes
const RULES: Record<Field, { isValid: (value: unknown) => boolean; takes: string }> = {
  band: { isValid: value => BAND_MODES.some(mode => mode === value), takes: '"full", "calm" or "off"' },
  bandPlace: { isValid: value => value === 'above' || value === 'under', takes: '"above" or "under"' },
  bandRows: { isValid: isBool, takes: 'true or false' },
  quiet: { isValid: isBool, takes: 'true or false' },
  rec: { isValid: value => LEVELS.some(level => level === value), takes: '"off", "on" or "strict"' },
  handoff: { isValid: value => MODES.some(mode => mode === value), takes: '"ask", "auto" or "off"' },
  handoffAt: { isValid: isThreshold, takes: 'a whole number from 10 to 95' }
}

const NAMES: Record<From, string> = {
  user: '~/.claude/settings.json', project: '.claude/settings.json', local: '.claude/settings.local.json',
  flag: '--settings', policy: 'managed settings', legacy: 'an earlier command', default: 'the default'
}

export function sourceFileName(from: From): string {
  return NAMES[from]
}

// Each field walks the order down to its first valid value; a bad value on the way is skipped and listed, one under
// the value in use is not. A key that is not an object, or a file that did not parse (absent), gives no fields.
export function resolveSettings(layers: Partial<Record<Source, unknown>>, legacy: Partial<SettingsValues>): ResolvedSettings {
  const values = { ...DEFAULTS } as Record<Field, unknown>
  const from = {} as Record<Field, From>
  const skipped: Skip[] = []
  const userFields: Field[] = []
  for (const field of FIELDS) {
    const rule = RULES[field]
    from[field] = 'default'
    let isSet = false
    for (const source of SOURCES) {
      const layer = layers[source]
      if (!isRecord(layer) || !Object.prototype.hasOwnProperty.call(layer, field)) continue
      const value = layer[field]
      if (!rule.isValid(value)) {
        if (!isSet) skipped.push({ field, source })
        continue
      }
      if (source === 'user') userFields.push(field)
      if (isSet) continue
      values[field] = value
      from[field] = source
      isSet = true
    }
    if (!isSet && legacy[field] !== undefined && rule.isValid(legacy[field])) {
      values[field] = legacy[field]
      from[field] = 'legacy'
    }
  }
  return { values: values as SettingsValues, from, skipped, userFields }
}

// S3's toast for a skipped value: it names the file, the values the field takes and the value in use, never the bad one
export function skippedToast(skip: Skip, resolved: ResolvedSettings): string {
  const using = JSON.stringify(resolved.values[skip.field])
  return `"${skip.field}" in ${sourceFileName(skip.source)} takes ${RULES[skip.field].takes} - using ${using} from ${sourceFileName(resolved.from[skip.field])}`
}

// The old commands' store keys as an earlier command's choices (S7): only the values those commands wrote, so a fresh
// store, or anything another version or a hand wrote, gives no field
export function legacyOf(raw: { band: unknown; place: unknown; tools: unknown; quiet: unknown; rec: unknown; handoff: unknown }): Partial<SettingsValues> {
  const out: Partial<SettingsValues> = {}
  if (raw.band === 'calm' || raw.band === 'full') out.band = raw.band
  if (raw.place === 'under') out.bandPlace = 'under'
  if (raw.tools === 'open' || raw.tools === 'closed') out.bandRows = raw.tools === 'open'
  if (isBool(raw.quiet)) out.quiet = raw.quiet
  const level = LEVELS.find(known => known === raw.rec)
  if (level !== undefined) out.rec = level
  if (isRecord(raw.handoff)) {
    const mode = MODES.find(known => known === (raw.handoff as Record<string, unknown>).mode)
    if (mode !== undefined) out.handoff = mode
    if (isThreshold(raw.handoff.threshold)) out.handoffAt = raw.handoff.threshold
  }
  return out
}

// The order a hold compares sources in, highest first
const ORDER: readonly From[] = ['policy', 'flag', 'local', 'project', 'user', 'legacy', 'default']

// S3's one departure, REC's hold: after the session's first read, a lower level lowers REC only when it comes from the
// source that set the level in force, or one above it. From a lower source - the file that set it gives no valid "rec"
// any more, which a typo that drops the whole file also does - the level in force holds.
export function holdRec(inForce: { level: RecLevel; from: From } | null, next: { level: RecLevel; from: From }): { level: RecLevel; from: From; isHeld: boolean } {
  if (inForce === null || LEVELS.indexOf(next.level) >= LEVELS.indexOf(inForce.level) || ORDER.indexOf(next.from) <= ORDER.indexOf(inForce.from)) {
    return { ...next, isHeld: false }
  }
  return { ...inForce, isHeld: true }
}

// S3's toast for a hold, once per hold. The toast box carries the mod's name and shows three 40-cell lines, so no
// prefix and under 120 characters (the review's #1, Claude Code 2.1.322)
export function holdToast(level: RecLevel, from: From): string {
  return `REC stays ${level}: ${sourceFileName(from)} no longer gives "rec" - fix the file, or set "rec": "off" in it`
}

// S7's toast, once per machine: the earlier commands' choices still in force, as the line to paste, in S2's order. The
// line comes first, so the box's three lines show it before the why (the review's #1)
export function movedToast(kept: Partial<SettingsValues>): string {
  const fields = FIELDS.filter(name => kept[name] !== undefined).map(field => `"${field}": ${JSON.stringify(kept[field])}`).join(', ')
  return `Add "alfred-mods": { ${fields} } to ~/.claude/settings.json - the choices your earlier commands made`
}

// One field of "alfred-mods" set in a settings file's text, for /rec on|strict|off, /auto-handoff ask|auto|off|at and
// /inspect band (the user's rulings, 2026-11-12): every other key kept in its order, in the file's own indent, line ends and last
// newline; null or blank text makes the file. A file that is not one JSON object, or whose "alfred-mods" is not an
// object, is never rewritten: 'parse' or 'key' says which.
export function writeField<F extends Field>(text: string | null, field: F, value: SettingsValues[F]): { text: string } | { why: 'parse' | 'key' } {
  const isBlank = text === null || text.trim() === ''
  let parsed: unknown = {}
  if (!isBlank) {
    try {
      parsed = JSON.parse(text)
    } catch {
      return { why: 'parse' }
    }
  }
  if (!isRecord(parsed)) return { why: 'parse' }
  const block = parsed['alfred-mods']
  if (block !== undefined && !isRecord(block)) return { why: 'key' }
  const indent = isBlank ? '  ' : (/\n([ \t]+)\S/.exec(text)?.[1] ?? '  ')
  const out = JSON.stringify({ ...parsed, 'alfred-mods': { ...block, [field]: value } }, null, indent)
  const isCrlf = !isBlank && text.includes('\r\n')
  const last = isBlank || /\n$/.test(text) ? '\n' : ''
  return { text: (out + last).replace(/\n/g, isCrlf ? '\r\n' : '\n') }
}

// The old commands' store keys, by the field each held (S7); `settings:handoff` holds two, retired field by field
export const LEGACY_KEYS: Partial<Record<Field, string>> = {
  band: 'settings:band', bandPlace: 'settings:band-place', bandRows: 'settings:band-tools', quiet: 'settings:quiet', rec: 'settings:rec',
}

// A source's name in the commands' answers: an earlier command's choice is named for its command (S7)
export const sourceLabel = (from: From, command: '/rec' | '/auto-handoff' | '/band'): string => (from === 'legacy' ? `an earlier ${command}` : sourceFileName(from))
