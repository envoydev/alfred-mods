// The kit's draw: the Now tab's CLAUDE-KIT section. Pure: values in, lines out.
import { fitLine } from '../core/format'
import type { Line } from '../core/types'
import type { KitState } from './types'
import { KIT_FILE, KIT_MODEL_ROLES, KIT_NAMES, KIT_SECTION_HEAD, KIT_SETTING_ROWS } from './constants'
import { kitPassScore } from './kit'

// The Now tab's CLAUDE-KIT section: each switch the file sets with its value and the file, the pass score on the scoring
// row, and the models. Nothing with no kit data, or none of the names set.
export function kitLines(kit: KitState, columns: number): Line[] {
  const values = kit.values
  if (values === null) return []
  const row = (text: string): Line => [{ text: fitLine(text, columns) }]
  const out: Line[] = []
  for (const [label, name] of KIT_SETTING_ROWS) {
    const value = values[name]
    if (value === undefined) continue
    const pass = name === KIT_NAMES.scoring ? kitPassScore(values) : null
    out.push(row(`${label} ${value}${pass === null ? '' : ` · pass ${pass}`} · from ${KIT_FILE}`))
  }
  const models = KIT_MODEL_ROLES.flatMap(([role, name]) => {
    const value = values[name]
    return value === undefined ? [] : [`${role} ${value}`]
  })
  if (models.length > 0) out.push(row(`models: ${models.join(' · ')}`))
  return out.length === 0 ? [] : [[{ text: KIT_SECTION_HEAD, bold: true }], ...out]
}
