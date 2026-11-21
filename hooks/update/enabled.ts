// The old install's key set false in a settings file's text by one targeted edit: the one textual `"<key>": true` becomes
// `"<key>": false` and every other byte stays, so a committed file does not reflow. Text that is not one JSON object,
// whose enabledPlugins does not hold the key set true, or where that text is not found exactly once, is never
// rewritten: 'parse' or 'key' says which.
import { isRecord } from '../core/guards'
import { ENABLED_PLUGINS_KEY, REGEX_SPECIALS } from './constants'

export function switchOffPlugin(text: string | null, key: string): { text: string } | { why: 'parse' | 'key' } {
  if (text === null || text.trim() === '') return { why: 'parse' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { why: 'parse' }
  }
  if (!isRecord(parsed)) return { why: 'parse' }
  const enabled = parsed[ENABLED_PLUGINS_KEY]
  if (!isRecord(enabled) || enabled[key] !== true) return { why: 'key' }
  const quoted = JSON.stringify(key).replace(REGEX_SPECIALS, '\\$&')
  const found = [...text.matchAll(new RegExp(`(${quoted}\\s*:\\s*)true(?![\\w$])`, 'g'))]
  const only = found.length === 1 ? found[0] : undefined
  if (only?.index === undefined) return { why: 'key' }
  return { text: `${text.slice(0, only.index)}${only[1] ?? ''}false${text.slice(only.index + only[0].length)}` }
}
