// The kit's draw: the band's banner and the Now tab's CLAUDE-KIT section. Pure: values in, lines out.
import { fitLine } from '../core/format'
import type { Line, Seg } from '../core/types'
import type { KitState } from './types'
import { KIT_BANNER_LABEL, KIT_FILE, KIT_MODEL_ROLES, KIT_NAMES, KIT_SECTION_HEAD, KIT_SETTING_ROWS } from './constants'
import { isKitOn, kitPassScore } from './kit'

const DOT: Seg = { text: ' · ', tone: 'dim' }

// The modes that are on, after `kit:`: `auto-run` in warn as Alfred Code's banner has it, `scoring <pass score>`,
// `auto-approve`. Empty with no kit data or no mode on.
export function kitBannerSegs(kit: KitState): Seg[] {
  const values = kit.values
  if (values === null) return []
  const parts: Seg[] = []
  const add = (seg: Seg): void => {
    if (parts.length > 0) parts.push(DOT)
    parts.push(seg)
  }
  if (isKitOn(values, KIT_NAMES.autoRun)) add({ text: 'auto-run', tone: 'warn' })
  if (isKitOn(values, KIT_NAMES.scoring)) {
    const level = kitPassScore(values)
    add({ text: level === null ? 'scoring' : `scoring ${level}` })
  }
  if (isKitOn(values, KIT_NAMES.autoApprove)) add({ text: 'auto-approve' })
  return parts.length === 0 ? [] : [{ text: `${KIT_BANNER_LABEL}: `, tone: 'dim' }, ...parts]
}

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
