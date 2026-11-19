// Reads claude-kit's status line. Pure: text in, values out.
import type { KitStatus, KitValue } from './types'
import {
  KIT_HEAD_END, KIT_ITEM, KIT_ITEM_END, KIT_MARKER, KIT_NAMES, KIT_ON, NOT_SAVED_PREFIX, PASS_SCORE_MAX, PASS_SCORE_MIN, SAVED_PREFIX, WHOLE_NUMBER,
} from './constants'

// The line's items in order and its note, or null where `text` holds no kit line. The read stops at the first thing that
// is neither an item nor the note, and keeps what came before it: a newer hook's new item never hides the older ones.
export function parseKitStatus(text: string): KitStatus | null {
  const marker = text.indexOf(KIT_MARKER)
  if (marker === -1) return null
  const headEnd = text.indexOf(KIT_HEAD_END, marker + KIT_MARKER.length)
  if (headEnd === -1) return null
  const entries: [string, KitValue][] = []
  let saved: string | null = null
  let rest = text.slice(headEnd + KIT_HEAD_END.length).trimStart()
  while (rest !== '') {
    if (rest.startsWith(SAVED_PREFIX) || rest.startsWith(NOT_SAVED_PREFIX)) {
      const end = rest.lastIndexOf(KIT_ITEM_END)
      saved = (end === -1 ? rest : rest.slice(0, end)).trim()
      break
    }
    const item = KIT_ITEM.exec(rest)
    if (item === null) break
    entries.push([item[1]!, { value: item[2]!, source: item[3]! }])
    rest = rest.slice(item[0].length).trimStart()
  }
  // `fromEntries` makes own properties, so a name such as `__proto__` stays a name
  return { values: Object.fromEntries(entries), saved }
}

export function isKitOn(status: KitStatus, name: string): boolean {
  return status.values[name]?.value === KIT_ON
}

// The pass score while scoring is on, and only as a whole number from 1 to 100
export function kitPassScore(status: KitStatus): number | null {
  if (!isKitOn(status, KIT_NAMES.scoring)) return null
  const written = status.values[KIT_NAMES.passScore]?.value
  if (written === undefined || !WHOLE_NUMBER.test(written)) return null
  const score = Number(written)
  return score >= PASS_SCORE_MIN && score <= PASS_SCORE_MAX ? score : null
}
