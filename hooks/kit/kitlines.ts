// The kit's draw: the band's banner and the Now tab's CLAUDE-KIT section. Pure: values in, lines out.
import { fitLine, minutesText } from '../core/format'
import type { Line, Seg, Tone } from '../core/types'
import type { KitState } from './types'
import { KIT_BANNER_LABEL, KIT_MODEL_ROLES, KIT_NAMES, KIT_SECTION_HEAD, KIT_SETTING_ROWS, NOT_SAVED_PREFIX } from './constants'
import { isKitOn, kitPassScore } from './kit'

const DOT: Seg = { text: ' · ', tone: 'dim' }

// The modes that are on, after `kit:`: `auto-run` in warn as Alfred Code's banner has it, `scoring <pass score>`,
// `auto-approve`. Empty with no line seen or no mode on.
export function kitBannerSegs(kit: KitState): Seg[] {
  const status = kit.status
  if (status === null) return []
  const parts: Seg[] = []
  const add = (seg: Seg): void => {
    if (parts.length > 0) parts.push(DOT)
    parts.push(seg)
  }
  if (isKitOn(status, KIT_NAMES.autoRun)) add({ text: 'auto-run', tone: 'warn' })
  if (isKitOn(status, KIT_NAMES.scoring)) {
    const level = kitPassScore(status)
    add({ text: level === null ? 'scoring' : `scoring ${level}` })
  }
  if (isKitOn(status, KIT_NAMES.autoApprove)) add({ text: 'auto-approve' })
  return parts.length === 0 ? [] : [{ text: `${KIT_BANNER_LABEL}: `, tone: 'dim' }, ...parts]
}

// The Now tab's CLAUDE-KIT section: each setting with its value and source, the models, the hook's note, and the age of
// the line the values came from. Nothing with no line seen.
export function kitLines(kit: KitState, now: number, columns: number): Line[] {
  const status = kit.status
  if (status === null) return []
  const out: Line[] = [[{ text: KIT_SECTION_HEAD, bold: true }]]
  const row = (text: string, tone?: Tone): Line => [{ text: fitLine(text, columns), ...(tone === undefined ? {} : { tone }) }]
  for (const [label, name] of KIT_SETTING_ROWS) {
    const item = status.values[name]
    if (item === undefined) continue
    const pass = name === KIT_NAMES.scoring ? kitPassScore(status) : null
    out.push(row(`${label} ${item.value}${pass === null ? '' : ` · pass ${pass}`} · from ${item.source}`))
  }
  const models = KIT_MODEL_ROLES.flatMap(([role, name]) => {
    const item = status.values[name]
    return item === undefined ? [] : [`${role} ${item.value}`]
  })
  if (models.length > 0) out.push(row(`models: ${models.join(' · ')}`))
  if (status.saved !== null) out.push(row(status.saved, status.saved.startsWith(NOT_SAVED_PREFIX) ? 'warn' : 'dim'))
  if (kit.seenAt !== null) out.push(row(`seen ${minutesText(Math.max(0, now - kit.seenAt))} ago`, 'dim'))
  return out
}
