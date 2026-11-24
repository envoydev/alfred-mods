// The full band's info line: model, effort, cache, MCP, speed, times and the session's time
import { billingOf, cacheView, minutesLeftText } from '../cache/cache'
import { minutesText, modelParts, modelText } from '../core/format'
import type { BandInput } from './types'
import type { Line, Seg } from '../core/types'
import { TIMES_JOIN } from './constants'
import { timesOf } from './gauges'
import { packRows } from './wrap'

// One item of the info line: its forms, fullest first, and its keep rank, 1 going first when the width runs out
type Item = { keep: number; forms: Line[] }

const dimText = (text: string): Line => [{ text, tone: 'dim' }]

// The info line's items in the user's order (2026-11-24), each only when known: the model and effort, the cache, the MCP
// item, the average output speed, Claude's last reply and the last prompt, the session's time
function infoItems(input: BandInput): Item[] {
  const items: Item[] = []
  const model = input.session.model
  if (model !== null) {
    const family = modelParts(model)?.family
    const name: Seg = family === undefined ? { text: modelText(model, true) } : { text: modelText(model, true), tone: family }
    items.push({ keep: 6, forms: [input.session.effort === null ? [name] : [name, { text: ` ◑ ${input.session.effort}`, tone: 'dim' }]] })
  }
  if (input.cache.sessionCounts.read + input.cache.sessionCounts.write > 0) {
    const cacheState = cacheView(input.cache, billingOf(input.usage.rateWindows), input.now, input.usage.contextTokens)
    items.push({ keep: 4, forms: [dimText(cacheState.leftMs === null ? 'cache cold' : `cache warm ${cacheState.tier.isEstimate ? '≈' : ''}${minutesLeftText(cacheState.leftMs)}`)] })
  }
  if (input.mcp !== undefined && input.mcp.length > 0) items.push({ keep: 4.5, forms: [input.mcp] })
  const totals = input.totals
  if (totals !== undefined && totals.stepMs > 0) items.push({ keep: 3, forms: [dimText(`≈${Math.round(totals.stepOutput / (totals.stepMs / 1000))} tok/s avg`)] })
  // Claude's last reply, then the running turn's prompt while one runs, else the last turn's, as line 1 of the calm band
  // shows it; short of width, the prompt alone
  const { you, claude } = timesOf(input, true)
  if (you !== null && claude !== null) items.push({ keep: 1, forms: [dimText(`${claude}${TIMES_JOIN}${you}`), dimText(you)] })
  else if (you !== null || claude !== null) items.push({ keep: 1, forms: [dimText(you ?? claude ?? '')] })
  if (input.usage.startedAt !== null) items.push({ keep: 5, forms: [dimText(minutesText(input.now - input.usage.startedAt))] })
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
