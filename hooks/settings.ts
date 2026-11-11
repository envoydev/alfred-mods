// The mod's switches as values under one "alfred-mods" key in Claude Code's settings files (spec 2026-11-11
// settings-values, S1-S3): each field read per file, the first valid value in the order policy, flag, local, project,
// user, then an earlier command's choice, then the default. Pure: register.ts reads the files and the store. REC is no
// field: /rec sets it, per machine (the user's ruling, 2026-11-12), so a file's "rec" is an unknown field, ignored.
import type { HandoffMode } from '../types'
import { MODES, isThreshold } from './handoff.ts'

export type Field = 'band' | 'bandPlace' | 'bandRows' | 'quiet' | 'handoff' | 'handoffAt'
export type Source = 'policy' | 'flag' | 'local' | 'project' | 'user'
export type From = Source | 'legacy' | 'default'
export type Values = {
  band: 'full' | 'calm'; bandPlace: 'above' | 'under'; bandRows: boolean; quiet: boolean
  handoff: HandoffMode; handoffAt: number
}
export type Skip = { field: Field; source: Source }
// `userFields`: the fields the user's own file gives a valid value, the ones whose old store key retires (S7)
export type Resolved = { values: Values; from: Record<Field, From>; skipped: Skip[]; userFields: Field[] }

export const FIELDS: readonly Field[] = ['band', 'bandPlace', 'bandRows', 'quiet', 'handoff', 'handoffAt']
export const SOURCES: readonly Source[] = ['policy', 'flag', 'local', 'project', 'user']
export const DEFAULTS: Values = { band: 'full', bandPlace: 'above', bandRows: true, quiet: true, handoff: 'ask', handoffAt: 80 }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

// Each field's test and the words its toast uses for the values it takes
const RULES: Record<Field, { isValid: (v: unknown) => boolean; takes: string }> = {
  band: { isValid: v => v === 'full' || v === 'calm', takes: '"full" or "calm"' },
  bandPlace: { isValid: v => v === 'above' || v === 'under', takes: '"above" or "under"' },
  bandRows: { isValid: isBool, takes: 'true or false' },
  quiet: { isValid: isBool, takes: 'true or false' },
  handoff: { isValid: v => MODES.some(m => m === v), takes: '"ask", "auto" or "off"' },
  handoffAt: { isValid: isThreshold, takes: 'a whole number from 10 to 95' }
}

const NAMES: Record<From, string> = {
  user: '~/.claude/settings.json', project: '.claude/settings.json', local: '.claude/settings.local.json',
  flag: '--settings', policy: 'managed settings', legacy: 'an earlier command', default: 'the default'
}

export function nameOf(from: From): string {
  return NAMES[from]
}

// Each field walks the order down to its first valid value; a bad value on the way is skipped and listed, one under
// the value in use is not. A key that is not an object, or a file that did not parse (absent), gives no fields.
export function resolve(layers: Partial<Record<Source, unknown>>, legacy: Partial<Values>): Resolved {
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
      const v = layer[field]
      if (!rule.isValid(v)) {
        if (!isSet) skipped.push({ field, source })
        continue
      }
      if (source === 'user') userFields.push(field)
      if (isSet) continue
      values[field] = v
      from[field] = source
      isSet = true
    }
    if (!isSet && legacy[field] !== undefined && rule.isValid(legacy[field])) {
      values[field] = legacy[field]
      from[field] = 'legacy'
    }
  }
  return { values: values as Values, from, skipped, userFields }
}

// S3's toast for a skipped value: it names the file, the values the field takes and the value in use, never the bad one
export function skippedToast(skip: Skip, r: Resolved): string {
  const using = JSON.stringify(r.values[skip.field])
  return `"${skip.field}" in ${nameOf(skip.source)} takes ${RULES[skip.field].takes} - using ${using} from ${nameOf(r.from[skip.field])}`
}

// The old commands' store keys as an earlier command's choices (S7): only the values those commands wrote, so a fresh
// store, or anything another version or a hand wrote, gives no field
export function legacyOf(raw: { band: unknown; place: unknown; tools: unknown; quiet: unknown; handoff: unknown }): Partial<Values> {
  const out: Partial<Values> = {}
  if (raw.band === 'calm' || raw.band === 'full') out.band = raw.band
  if (raw.place === 'under') out.bandPlace = 'under'
  if (raw.tools === 'open' || raw.tools === 'closed') out.bandRows = raw.tools === 'open'
  if (isBool(raw.quiet)) out.quiet = raw.quiet
  if (isRecord(raw.handoff)) {
    const mode = MODES.find(m => m === (raw.handoff as Record<string, unknown>).mode)
    if (mode !== undefined) out.handoff = mode
    if (isThreshold(raw.handoff.threshold)) out.handoffAt = raw.handoff.threshold
  }
  return out
}

// S7's toast, once per machine: the earlier commands' choices still in force, as the line to paste, in S2's order. The
// line comes first, so the box's three lines show it before the why (the review's #1)
export function movedToast(kept: Partial<Values>): string {
  const fields = FIELDS.filter(f => kept[f] !== undefined).map(f => `"${f}": ${JSON.stringify(kept[f])}`).join(', ')
  return `Add "alfred-mods": { ${fields} } to ~/.claude/settings.json - the choices your earlier commands made`
}
