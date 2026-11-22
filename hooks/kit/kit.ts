// Reads claude-kit's settings file. Pure: text in, values out.
import { isRecord } from '../core/guards'
import type { KitValues } from './types'
import {
  KIT_FILE, KIT_FILE_MAX_CHARS, KIT_MODEL_NAMES, KIT_MODEL_ROLES, KIT_NAMES, KIT_OFF, KIT_ON, KIT_SWITCH_NAMES, PASS_SCORE_MAX, PASS_SCORE_MIN, WHOLE_NUMBER,
} from './constants'

// Where the file is: under the session's root. A trailing separator of the root goes; the rest of the path stays as the
// host spells it.
export const kitPathOf = (root: string): string => `${root.replace(/[\\/]+$/, '')}/${KIT_FILE}`

// The pass score as the kit takes it: a whole number from 1 to 100, written as a JSON number or a string of digits
function passScoreOf(value: unknown): number | null {
  const score = typeof value === 'number' ? value : typeof value === 'string' && WHOLE_NUMBER.test(value) ? Number(value) : 0
  return Number.isInteger(score) && score >= PASS_SCORE_MIN && score <= PASS_SCORE_MAX ? score : null
}

// Whether a name's value is one it takes
function isGood(name: string, value: unknown): boolean {
  if (KIT_SWITCH_NAMES.includes(name)) return value === KIT_ON || value === KIT_OFF
  if (name === KIT_NAMES.passScore) return passScoreOf(value) !== null
  return typeof value === 'string' && KIT_MODEL_NAMES.includes(value)
}

const KNOWN_NAMES: readonly string[] = [...KIT_SWITCH_NAMES, KIT_NAMES.passScore, ...KIT_MODEL_ROLES.map(([, name]) => name)]

// The values of the names the mod knows, each only when its own value is good; a name it does not know is ignored. Null
// where the text is no kit data: over the size cap, not JSON, or not one object. Only a known name is ever read, so a
// name such as `__proto__` is never looked at.
export function parseKitSettings(text: string): KitValues | null {
  if (text.length > KIT_FILE_MAX_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const values: KitValues = {}
  for (const name of KNOWN_NAMES) {
    const value = Object.hasOwn(parsed, name) ? parsed[name] : undefined
    if (!isGood(name, value)) continue
    values[name] = name === KIT_NAMES.passScore ? (passScoreOf(value) as number) : (value as string)
  }
  return values
}

export function isKitOn(values: KitValues, name: string): boolean {
  return values[name] === KIT_ON
}

// The pass score while scoring is on
export function kitPassScore(values: KitValues): number | null {
  if (!isKitOn(values, KIT_NAMES.scoring)) return null
  const score = values[KIT_NAMES.passScore]
  return typeof score === 'number' ? score : null
}
