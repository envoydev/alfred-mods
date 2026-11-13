// The full band's info line: model, effort, speed, cache and times
import { billingOf, cacheView, minutesLeftText } from '../cache/cache'
import { minutesText, modelParts, modelText, tokensText } from '../core/format'
import type { BandInput } from './types'
import type { Line, Seg } from '../core/types'
import { timeParts } from './gauges'
import { packRows } from './wrap'

// One item of the info line: its forms, fullest first, and its keep rank, 1 going first when the width runs out
type Item = { keep: number; forms: Line[] }

const dimText = (text: string): Line => [{ text, tone: 'dim' }]

// The info line's items in the user's order (2026-11-11), each only when known: the model and effort, the session's
// time, the average output speed, the cache, the last prompt and reply, Claude Code's version
function infoItems(input: BandInput): Item[] {
  const items: Item[] = []
  const model = input.session.model
  if (model !== null) {
    const family = modelParts(model)?.family
    const name: Seg = family === undefined ? { text: modelText(model, true) } : { text: modelText(model, true), tone: family }
    items.push({ keep: 6, forms: [input.session.effort === null ? [name] : [name, { text: ` ◑ ${input.session.effort}`, tone: 'dim' }]] })
  }
  if (input.usage.startedAt !== null) items.push({ keep: 5, forms: [dimText(minutesText(input.now - input.usage.startedAt))] })
  const totals = input.totals
  if (totals !== undefined && totals.stepMs > 0) items.push({ keep: 3, forms: [dimText(`≈${Math.round(totals.stepOutput / (totals.stepMs / 1000))} tok/s avg`)] })
  if (input.cache.sessionCounts.read + input.cache.sessionCounts.write > 0) {
    const cacheState = cacheView(input.cache, billingOf(input.usage.rateWindows), input.now, input.usage.contextTokens)
    items.push({ keep: 4, forms: [dimText(cacheState.leftMs === null ? 'cache cold' : `cache warm ${cacheState.tier.isEstimate ? '≈' : ''}${minutesLeftText(cacheState.leftMs)}`)] })
  }
  // The running turn's prompt while one runs; the last turn's, as line 1 of the calm band shows it, otherwise
  const parts = timeParts(input, 2, true)
  if (parts.length > 0) items.push({ keep: 1, forms: parts.map((_, i) => dimText(parts.slice(0, parts.length - i).join(' · '))) })
  // Claude Code's version, from the first second; the first to go when the width runs out
  if (input.session.version !== undefined) items.push({ keep: 0.5, forms: [dimText(`CC ${input.session.version}`)] })
  return items
}

// The info line fitted to one row of the width
export function infoLine(input: BandInput): Line {
  return infoRows(input, 1)[0] ?? []
}

// The info line in up to `upTo` rows of the width, a row breaking between two items (the user, 2026-11-11: every item,
// as claude-hud shows them): while they need more rows, the present item with the lowest keep takes its next form or
// goes; nothing fitting, or nothing known, draws no row
export function infoRows(input: BandInput, upTo: number): Line[] {
  const items = infoItems(input)
  const form = items.map(() => 0)
  const shown = items.map(() => true)
  for (;;) {
    const kept = items.flatMap((item, i) => (shown[i] ? [item.forms[form[i] ?? 0] ?? []] : []))
    const rows = packRows(kept, input.columns)
    if (rows !== null && rows.length <= upTo) return rows
    let lowest = -1
    items.forEach((item, i) => {
      if (shown[i] && (lowest === -1 || item.keep < (items[lowest]?.keep ?? Infinity))) lowest = i
    })
    const item = items[lowest]
    if (item === undefined) return []
    if ((form[lowest] ?? 0) < item.forms.length - 1) form[lowest] = (form[lowest] ?? 0) + 1
    else shown[lowest] = false
  }
}
