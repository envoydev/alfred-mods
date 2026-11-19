// The Prompt tab: what the last main turn carried for the model, as lines of styled segments
import type { Line } from '../core/types'
import type { PromptPart, PromptRecord } from './types'
import { clockText, fitLine } from '../core/format'
import { BEFORE_FIRST_TURN, LEFT_OUT_TEXT, NO_TURN_TEXT, NO_TYPED_TEXT, PROMPT_GROUPS } from './constants'

const count = (value: number): string => value.toLocaleString('en-US')
const charsText = (value: number): string => `${count(value)} chars`
const partsText = (value: number): string => `${value} ${value === 1 ? 'part' : 'parts'}`

function headerLine(record: PromptRecord): Line {
  const total = record.parts.reduce((sum, part) => sum + part.chars, 0)
  const items = [
    record.startedAt === null ? BEFORE_FIRST_TURN : clockText(record.startedAt),
    ...(record.typedChars === null ? [] : [record.typedChars === 0 ? NO_TYPED_TEXT : `you ${charsText(record.typedChars)}`]),
    partsText(record.parts.length),
    charsText(total),
    ...(record.dropped > 0 ? [`${record.dropped} dropped`] : []),
  ]
  return [{ text: 'Last turn', bold: true }, { text: ` · ${items.join(' · ')}` }]
}

// A part kept shorter than it came ends with its whole length
const cutNote = (part: PromptPart): string => (part.chars > part.text.length ? `… (${charsText(part.chars)})` : '')

// The part's row, then its text as a block the surface wraps; a part left out has no text
function blockRows(heading: string, part: PromptPart): Line[] {
  if (part.isLeftOut) return [[{ text: `${heading} · ${LEFT_OUT_TEXT}`, bold: true }]]
  return [[{ text: `${heading} · ${charsText(part.chars)}`, bold: true }], [{ code: `${part.text}${cutNote(part)}` }]]
}

function partRows(part: PromptPart, columns: number): Line[] {
  if (part.origin === 'hook') return blockRows(`${part.event ?? 'hook'} · ${part.type}`, part)
  if (part.origin === 'plugin') return blockRows(part.event ?? part.type, part)
  const lead = part.isLeftOut ? `${part.type} · ${LEFT_OUT_TEXT}` : `${part.type} · ${charsText(part.chars)} · `
  if (part.isLeftOut) return [[{ text: lead }]]
  const note = cutNote(part)
  const room = Math.max(1, columns - [...lead].length - [...note].length)
  const fitted = fitLine(part.text, room)
  // A text stored cut and cut again to the width would end with two ellipses: the note's own stands
  const first = note !== '' && fitted.endsWith('…') ? fitted.slice(0, -1) : fitted
  return [[{ text: `${lead}${first}${note}` }]]
}

export function promptLines(record: PromptRecord, columns: number): Line[] {
  const isEmpty = record.startedAt === null && record.typedChars === null && record.parts.length === 0 && record.dropped === 0
  if (isEmpty) return [[{ text: NO_TURN_TEXT, tone: 'dim' }]]
  const out: Line[] = [headerLine(record)]
  for (const group of PROMPT_GROUPS) {
    const parts = record.parts.filter(part => part.origin === group.origin)
    if (parts.length === 0) continue
    out.push([{ text: group.title, bold: true }], ...parts.flatMap(part => partRows(part, columns)))
  }
  return out
}
