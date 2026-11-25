// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { isLive } from '../agents/agents'
import type { BandInput, ModesKeep } from './types'
import type { RecLevel } from '../rec/types'
import type { Line, Seg } from '../core/types'
import { FAILURES_RESERVE_COUNT, ROW_JOIN } from './constants'
import { leadLines, sourceLines } from './lines'
import { fiveHourPace, gauges, narrowGauges, percentText } from './gauges'
import { cellsOf } from './wrap'
import { toolRows } from './detail'
import { placeRow, planRow, usageRow } from './project'
import { infoRows } from './info'
import { cacheWarning, handoffAsk, lastTurn, skipAsk, turnForms, underButton, withPlanTail, withTimes, withToday, workingLine } from './working'

export { REC_MARK } from './lines'

// The status line under the prompt (spec D2), which stays while the band is collapsed: what needs the person, short
// and in the band's order - REC, the context once the band turns hot at 60, the new failures - or null for none. While
// the band is in view it shows REC and the context itself, so the line leaves them out (spec 2026-11-11, D6).
export function statusText(facts: { percent: number | null; newFailures: number; recLevel: RecLevel; isBandShown: boolean }): string | null {
  const parts = [
    facts.recLevel === 'off' || facts.isBandShown ? null : '● REC',
    !facts.isBandShown && facts.percent !== null && Math.round(facts.percent) >= 60 ? `ctx ${percentText(facts.percent)}` : null,
    facts.newFailures > 0 ? `✗ ${facts.newFailures} new` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// The rows the band takes under the input (spec 2026-11-11 band-under, U2, F7): the main screen's whole height, as the
// site above reports there; in fullscreen, half the screen less the prompt and the engine's footer line, less a status
// line's two rows (claude-hud's default; the setting says nothing of the height) and the mod's pinned line
export function underRows(viewport: { rows: number; isFullscreen?: boolean }, chrome: { hasStatusLine: boolean; isPinned: boolean }): number {
  if (viewport.isFullscreen !== true) return viewport.rows
  return Math.max(2, Math.floor(viewport.rows / 2) - 6 - (chrome.hasStatusLine ? 2 : 0) - (chrome.isPinned ? 1 : 0))
}

// What the full band keeps under its identity line: the modes line, the rows the info line may take (none for 0), the
// project row, the open detail rows (how many lines of them), the usage row and the plan row
type Keep = { modes: ModesKeep; infoUpTo: number; isPlaceKept: boolean; toolRowsKept: number; isUsageKept: boolean; isPlanKept: boolean }

const KEEP_ALL: Keep = { modes: 'own', infoUpTo: 2, isPlaceKept: true, toolRowsKept: Infinity, isUsageKept: true, isPlanKept: true }

// Line 1 is the identity ('● REC' while REC is on, the signed-in account and Claude Code's version), left out when it holds
// nothing; then the body: the turn line, the info line, the gauges, the modes lines (alfred-code's, then claude-kit's)
// and the rows under them (the user's order, 2026-11-25).
// The identity is never dropped for rows or width.
export function bandLines(input: BandInput): Line[] {
  // "band": "off" draws none, above or under, and the pinned line counts it as out of view
  if (input.mode === 'off') return []
  const max = input.maxRows
  if (max === undefined) return bandRows(input, KEEP_ALL)
  // Short of rows, the project row gives way first, then the modes lines share one line with no models, then the info
  // line's second row, then the open detail rows from the last, then the usage row, then the plan row, then the modes
  // lines, then the info line: the line under them holds the buttons, and a digit arms only those in view
  const noPlace: Keep = { ...KEEP_ALL, isPlaceKept: false }
  const joined: Keep = { ...noPlace, modes: 'joined' }
  for (const keep of [KEEP_ALL, noPlace, joined, { ...joined, infoUpTo: 1 }] satisfies Keep[]) {
    const lines = bandRows(input, keep)
    if (lines.length <= max) return lines
  }
  const core: Keep = { modes: 'joined', infoUpTo: 1, isPlaceKept: false, toolRowsKept: 0, isUsageKept: true, isPlanKept: true }
  const coreLines = bandRows(input, core)
  if (coreLines.length <= max) return bandRows(input, { ...core, toolRowsKept: max - coreLines.length })
  for (const keep of [{ ...core, isUsageKept: false }, { ...core, isUsageKept: false, isPlanKept: false }, { ...core, modes: 'none', isUsageKept: false, isPlanKept: false }] satisfies Keep[]) {
    const lines = bandRows(input, keep)
    if (lines.length <= max) return lines
  }
  return bandRows(input, { modes: 'none', infoUpTo: 0, isPlaceKept: false, toolRowsKept: 0, isUsageKept: false, isPlanKept: false })
}

// What the band is, in order: the action row where it sits under the input, the identity and modes lines, then the body
function bandRows(input: BandInput, keep: Keep): Line[] {
  const body = bandBody(input, input.columns < 100, keep)
  const lead = leadLines(input, failuresItem(input), { forms: body.turnForms, reserveCells: failuresReserve(input) })
  return [...body.before, ...lead.lines, ...(lead.isTurnTaken || body.turn.length === 0 ? [] : [body.turn]), ...body.rows]
}

// The cells line 1 holds back for the new failures: ' │ ' and the item at its widest count, buttons counted
function failuresReserve(band: BandInput): number {
  return cellsOf([{ text: ROW_JOIN }, ...failuresItem({ ...band, newFailures: FAILURES_RESERVE_COUNT, isWorking: false })])
}

// The new failures with their button, on line 1 once Claude has answered (asks wait for the turn to end); none before
function failuresItem(band: BandInput): Line {
  if (band.isWorking || band.newFailures === 0) return []
  return [{ text: `✗ ${band.newFailures} new `, tone: 'fail' }, underButton(band, { key: 'inspect', label: 'Inspect', hotkey: '1' }, '/inspect')]
}

// The body's rows, and the ones that come before the leading lines: under the input the action row, nearest the input
type Body = { before: Line[]; turn: Line; turnForms: Line[]; rows: Line[] }

function bandBody(band: BandInput, isNarrow: boolean, keep: Keep): Body {
  const usage = band.usage
  // Before the first reading the calm band waits; the full band draws once the model or a stored window is known
  const isFullKnown = band.mode === 'full' && (band.session.model !== null || usage.rateWindows.length > 0)
  const sources = sourceLines(band, keep.modes)
  if (band.turns.length === 0 && usage.contextPercent === null && !isFullKnown) return { before: [], turn: [], turnForms: [], rows: sources }
  const invalid: Line = band.isPlanInvalid ? [{ text: ROW_JOIN, tone: 'dim' }, { text: 'plan file invalid', tone: 'warn' }] : []
  const gaugeLine = isNarrow ? narrowGauges(usage, band.runway) : withToday(band, gauges(band), invalid)
  const line2 = [...gaugeLine, ...invalid]
  // The info line above the gauges, then under them the project, plan and usage rows and the detail rows while `bandRows`
  // opens them; the full band's alone (the user, 2026-11-11; the info line above the gauges, 2026-11-24)
  const head = keep.infoUpTo > 0 && band.mode === 'full' ? infoRows(band, keep.infoUpTo) : []
  const place = head.length > 0 && keep.isPlaceKept ? placeRow(band) : []
  const counts = head.length > 0 && keep.isUsageKept ? usageRow(band) : []
  const info: Line[] = head.length === 0 ? [] : [
    ...place, ...(keep.isPlanKept ? planRow(band) : []), ...counts, ...(band.isToolsOpen === true ? toolRows(band).slice(0, keep.toolRowsKept) : []),
  ]
  const pace = fiveHourPace(band)
  const isHot = (band.runway?.percent ?? usage.contextPercent ?? 0) >= 60
    || usage.rateWindows.some(rateWindow => rateWindow.percentUsed >= 60) || (pace !== null && pace !== 'on-pace')
  const agentsRun = band.agents.some(agent => isLive(agent.status))
  const warning = cacheWarning(band, true)
  const ask = handoffAsk(band)
  const skip = skipAsk(band)
  if (!isHot && band.newFailures === 0 && !band.isWorking && !agentsRun && warning === null && ask === null && skip === null) {
    // Idle and healthy, the full band keeps its colours, as while it works (the user, 2026-11-12: 'colors by default ...
    // not only when active work'); the calm band stays one dim line until something needs you. The identity and modes
    // lines are no part of that line: the account mark, like the red REC mark, keeps its own tones so the account check
    // reads easily (the owner, 2026-11-21)
    if (band.mode === 'full') return { before: [], turn: [], turnForms: [], rows: [...head, [...gaugeLine, ...invalid], ...sources, ...info] }
    const calm = isNarrow ? gaugeLine : withTimes(band, gaugeLine)
    const dim = (line: Line): Line => line.map(seg => ('text' in seg ? { text: seg.text, tone: 'dim' as const } : seg))
    return { before: [], turn: [], turnForms: [], rows: [[...dim(calm), ...invalid], ...sources.map(dim), ...info.map(dim)] }
  }
  const isPlanRowDrawn = head.length > 0 && keep.isPlanKept
  const isFailuresShown = failuresItem(band).length > 0
  if (band.isWorking) return { before: [], turn: workingLine(band, isNarrow), turnForms: turnForms(band, isNarrow, isPlanRowDrawn, isFailuresShown), rows: [...head, line2, ...sources, ...info] }
  const items = [warning, ask, skip].filter((item): item is Line => item !== null && item.length > 0)
  const joined: Line = items.flatMap((item, i) => (i === 0 ? item : [{ text: '    ' }, ...item]))
  // Under the input the action row comes first, nearest the input as above it is the last (the user, 2026-11-12, over
  // band-under U2's place after the gauges), so a cut at the screen's edge takes the detail rows first; its commands are
  // longer than the digits above, so the items take a row each when one row cannot hold them
  const action: Line[] = items.length === 0 ? [] : band.under !== undefined && cellsOf(joined) > band.columns ? items : [joined]
  const first = agentsRun ? workingLine(band, isNarrow) : withPlanTail(band, lastTurn(band, isNarrow), isPlanRowDrawn)
  const nonEmpty = (rows: Line[]): Line[] => rows.filter(segs => segs.length > 0)
  const turn = { turn: first, turnForms: turnForms(band, isNarrow, isPlanRowDrawn, isFailuresShown) }
  return band.under === undefined ? { before: [], ...turn, rows: nonEmpty([...head, line2, ...sources, ...info, ...action]) } : { before: action, ...turn, rows: nonEmpty([...head, line2, ...sources, ...info]) }
}
