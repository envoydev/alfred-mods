// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { isLive } from '../agents/agents'
import { widthOf } from '../core/format'
import { paceForecast } from '../core/forecast'
import type { BandInput } from './types'
import type { RecLevel } from '../rec/types'
import type { Line, Seg } from '../core/types'
import { fiveHourPace, gauges, narrowGauges, percentText } from './gauges'
import { cellsOf } from './wrap'
import { toolRows } from './detail'
import { placeRow, planRow, usageRow } from './project'
import { infoRows } from './info'
import { cacheWarning, handoffAsk, lastTurn, underButton, withPlanTail, withTimes, withToday, workingLine } from './working'

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

// The status line under the prompt (spec D2), which stays while the band is collapsed: what needs the person, short
// and in the band's order - REC, the context once the band turns hot at 60, the new failures - or null for none. While
// the band is in view it shows REC and the context itself, so the line leaves them out (spec 2026-11-11, D6).
export function statusText(o: { percent: number | null; newFailures: number; recLevel: RecLevel; isBandShown: boolean }): string | null {
  const parts = [
    o.recLevel === 'off' || o.isBandShown ? null : '● REC',
    !o.isBandShown && o.percent !== null && Math.round(o.percent) >= 60 ? `ctx ${percentText(o.percent)}` : null,
    o.newFailures > 0 ? `✗ ${o.newFailures} new` : null,
  ].filter((p): p is string => p !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// The rows the band takes under the input (spec 2026-11-11 band-under, U2, F7): the main screen's whole height, as the
// site above reports there; in fullscreen, half the screen less the prompt and the engine's footer line, less a status
// line's two rows (claude-hud's default; the setting says nothing of the height) and the mod's pinned line
export function underRows(viewport: { rows: number; isFullscreen?: boolean }, o: { hasStatusLine: boolean; isPinned: boolean }): number {
  if (viewport.isFullscreen !== true) return viewport.rows
  return Math.max(2, Math.floor(viewport.rows / 2) - 6 - (o.hasStatusLine ? 2 : 0) - (o.isPinned ? 1 : 0))
}

// What the full band keeps under its info line: the rows the info line may take (none for 0), the project row, the open
// detail rows (how many lines of them), the usage row and the plan row
type Keep = { infoUpTo: number; isPlaceKept: boolean; toolRowsKept: number; isUsageKept: boolean; isPlanKept: boolean }

const KEEP_ALL: Keep = { infoUpTo: 2, isPlaceKept: true, toolRowsKept: Infinity, isUsageKept: true, isPlanKept: true }

// A red '● REC' while REC is on, then Alfred Code's mode banner, lead line 1 in every state, never dropped for width:
// the body's first line follows them while it fits what is left, else they take line 1 alone and the body keeps the
// full width, so no gauge, reset or the cost drops for them
export function bandLines(input: BandInput): Line[] {
  // "band": "off" draws none, above or under, and the pinned line counts it as out of view
  if (input.mode === 'off') return []
  const max = input.maxRows
  if (max === undefined) return bandRows(input, KEEP_ALL)
  // Short of rows, the project row gives way first, then the info line's second row, then the open detail rows from
  // the last, then the usage row, then the plan row, then the info line: the line under them holds the buttons, and a
  // digit arms only those in view
  for (const k of [KEEP_ALL, { ...KEEP_ALL, isPlaceKept: false }, { ...KEEP_ALL, isPlaceKept: false, infoUpTo: 1 }]) {
    const lines = bandRows(input, k)
    if (lines.length <= max) return lines
  }
  const core: Keep = { infoUpTo: 1, isPlaceKept: false, toolRowsKept: 0, isUsageKept: true, isPlanKept: true }
  const coreLines = bandRows(input, core)
  if (coreLines.length <= max) return bandRows(input, { ...core, toolRowsKept: max - coreLines.length })
  for (const k of [{ ...core, isUsageKept: false }, { ...core, isUsageKept: false, isPlanKept: false }]) {
    const lines = bandRows(input, k)
    if (lines.length <= max) return lines
  }
  return bandRows(input, { infoUpTo: 0, isPlaceKept: false, toolRowsKept: 0, isUsageKept: false, isPlanKept: false })
}

function bandRows(input: BandInput, k: Keep): Line[] {
  const isNarrow = input.columns < 100
  const marks: Line[] = [input.rec !== undefined && input.rec.level !== 'off' ? [REC_MARK] : [], input.banner ?? []].filter(segs => segs.length > 0)
  if (marks.length === 0) return bandBody(input, isNarrow, k)
  const sep: Seg = { text: ' │ ', tone: 'dim' }
  const alone: Line = marks.flatMap((m, i) => (i === 0 ? m : [sep, ...m]))
  const lead: Line = [...alone, sep]
  // Only line 1 shares its row with the marks: the lines under it are fitted to the band's whole width
  const [first] = bandBody({ ...input, columns: input.columns - widthOf(lead) }, isNarrow, k)
  if (first === undefined) return [alone]
  const body = bandBody(input, isNarrow, k)
  return widthOf(lead) + widthOf(first) <= input.columns ? [[...lead, ...first], ...body.slice(1)] : [alone, ...body]
}

function bandBody(b: BandInput, isNarrow: boolean, k: Keep): Line[] {
  const u = b.usage
  // Before the first reading the calm band waits; the full band draws once the model or a stored window is known
  const isFullKnown = b.mode === 'full' && (b.session.model !== null || u.windows.length > 0)
  if (b.turns.length === 0 && u.percent === null && !isFullKnown) return []
  const invalid: Line = b.isPlanInvalid ? [{ text: ' │ ', tone: 'dim' }, { text: 'plan file invalid', tone: 'warn' }] : []
  const gaugeLine = isNarrow ? narrowGauges(u, b.runway) : withToday(b, gauges(b), invalid)
  const line2 = [...gaugeLine, ...invalid]
  // The info line, then the project, plan and usage rows, then the detail rows while `bandRows` opens them; the full
  // band's alone (the user, 2026-11-11)
  const head = k.infoUpTo > 0 && b.mode === 'full' ? infoRows(b, k.infoUpTo) : []
  const place = head.length > 0 && k.isPlaceKept ? placeRow(b) : []
  const counts = head.length > 0 && k.isUsageKept ? usageRow(b) : []
  const info: Line[] = head.length === 0 ? [] : [
    ...head, ...place, ...(k.isPlanKept ? planRow(b) : []), ...counts, ...(b.isToolsOpen === true ? toolRows(b).slice(0, k.toolRowsKept) : []),
  ]
  const p = fiveHourPace(b)
  const isHot = (b.runway?.percent ?? u.percent ?? 0) >= 60 || u.windows.some(rateWindow => rateWindow.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  const agentsRun = b.agents.some(r => isLive(r.status))
  const warning = cacheWarning(b, true)
  const ask = handoffAsk(b)
  if (!isHot && b.newFailures === 0 && !b.isWorking && !agentsRun && warning === null && ask === null) {
    // Idle and healthy, the full band keeps its colours, as while it works (the user, 2026-11-12: 'colors by default ...
    // not only when active work'); the calm band stays one dim line until something needs you
    if (b.mode === 'full') return [[...gaugeLine, ...invalid], ...info]
    const calm = isNarrow ? gaugeLine : withTimes(b, gaugeLine)
    const dim = (l: Line): Line => l.map(seg => ('text' in seg ? { text: seg.text, tone: 'dim' as const } : seg))
    return [[...dim(calm), ...invalid], ...info.map(dim)]
  }
  if (b.isWorking) return [workingLine(b, isNarrow), line2, ...info]
  const failed: Line = b.newFailures > 0
    ? [{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, underButton(b, { key: 'inspect', label: 'Inspect', hotkey: '1' }, '/inspect')]
    : []
  const items = [warning, ask, failed].filter((l): l is Line => l !== null && l.length > 0)
  const joined: Line = items.flatMap((l, i) => (i === 0 ? l : [{ text: '    ' }, ...l]))
  // Under the input the action row comes first, nearest the input as above it is the last (the user, 2026-11-12, over
  // band-under U2's place after the gauges), so a cut at the screen's edge takes the detail rows first; its commands are
  // longer than the digits above, so the items take a row each when one row cannot hold them
  const action: Line[] = items.length === 0 ? [] : b.under !== undefined && cellsOf(joined) > b.columns ? items : [joined]
  const first = agentsRun ? workingLine(b, isNarrow) : withPlanTail(b, lastTurn(b, isNarrow), head.length > 0 && k.isPlanKept)
  const out = b.under === undefined ? [first, line2, ...info, ...action] : [...action, first, line2, ...info]
  return out.filter(segs => segs.length > 0)
}
