// The band's gauges: ctx, the 5h and 7d windows with their resets and pace, and the session's times
import { isLive } from '../agents/agents'
import { barText, clockText, toneOf, tokensText, usdText, whenText } from '../core/format'
import { paceForecast, turnsLeft } from '../core/forecast'
import { storedMark } from '../session/windows'
import type { BandInput } from './types'
import type { Usage, RateWindow } from '../session/types'
import type { Runway } from '../stack/types'
import type { Line, Seg } from '../core/types'

const ORDER = ['five_hour', 'seven_day']

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const percentText = (percent: number): string => `${Math.round(percent)}%`

// ' 45%' in its bar's threshold colour; ' ≈45%' with `mark` for a window an earlier session read
export const percentSeg = (percent: number, mark = ''): Seg => ({ text: ` ${mark}${percentText(percent)}`, tone: toneOf(percent) })

export function barSegs(percent: number): Seg[] {
  const [filled, empty] = barText(percent)
  return [{ text: filled, tone: toneOf(percent) }, { text: empty, tone: 'dim' }]
}

export function windowsInOrder(windows: RateWindow[]): RateWindow[] {
  const rank = (rateWindow: RateWindow): number => (ORDER.includes(rateWindow.kind) ? ORDER.indexOf(rateWindow.kind) : ORDER.length)
  return [...windows].sort((left, right) => rank(left) - rank(right))
}

// The 5h window's pace: null until there are 3 readings
export function fiveHourPace(input: Pick<BandInput, 'usage' | 'pace' | 'now'>): ReturnType<typeof paceForecast> {
  const fiveHour = input.usage.rateWindows.find(rateWindow => rateWindow.kind === 'five_hour')
  if (fiveHour === undefined) return null
  const reset = fiveHour.resetsAt === null ? NaN : Date.parse(fiveHour.resetsAt)
  return paceForecast('five_hour', input.pace.five_hour?.points ?? [], Number.isNaN(reset) ? null : reset, input.now)
}

// ' (02.11 16:15)': when the window resets, or nothing while it reports none
function resetSegs(rateWindow: RateWindow): Line {
  const reset = rateWindow.resetsAt === null ? NaN : Date.parse(rateWindow.resetsAt)
  return Number.isNaN(reset) ? [] : [{ text: ` (${whenText(reset)})`, tone: 'dim' }]
}

export function gauges(input: BandInput): Line {
  const usage = input.usage
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' │ ', tone: 'dim' })
  }
  out.push(...contextSegs(usage, input.runway))
  if (usage.contextPercent !== null || (input.runway ?? null) !== null) {
    const left = turnsLeft(input.turns.flatMap(turn => (turn.contextPercent === null ? [] : [turn.contextPercent])), input.forecast?.at)
    if (left !== null) out.push({ text: ` ≈${left} turns`, tone: 'dim' })
  }
  const mark = storedMark(usage.rateWindowsAt)
  for (const rateWindow of windowsInOrder(usage.rateWindows)) {
    sep()
    const label = LABEL[rateWindow.kind] ?? rateWindow.kind
    if (rateWindow.kind === 'five_hour') {
      out.push({ text: `${label} `, tone: 'usage' }, ...barSegs(rateWindow.percentUsed), percentSeg(rateWindow.percentUsed, mark), ...resetSegs(rateWindow))
      const pace = fiveHourPace(input)
      if (pace === 'on-pace') out.push({ text: ' on pace', tone: 'ok' })
      else if (pace !== null) out.push({ text: ` full ≈${clockText(pace.limitAt)}`, tone: 'warn' })
    } else out.push({ text: `${label} `, tone: 'usage' }, { text: `${mark}${percentText(rateWindow.percentUsed)}`, tone: toneOf(rateWindow.percentUsed) }, ...resetSegs(rateWindow))
  }
  if (usage.costUsd !== null) {
    sep()
    out.push({ text: usdText(usage.costUsd) })
  }
  return out
}

// The ctx item: against the stack's resume trigger while the runway applies (`ctx ▰▰▰▱▱ 62% of 150k`), else the window
function contextSegs(usage: Usage, runway: Runway | null | undefined): Line {
  if (runway !== undefined && runway !== null) {
    return [{ text: 'ctx ', tone: 'usage' }, ...barSegs(runway.percent), percentSeg(runway.percent), { text: ` of ${tokensText(runway.resumeAt)}`, tone: 'usage' }]
  }
  return usage.contextPercent === null ? [{ text: 'ctx —', tone: 'usage' }] : [{ text: 'ctx ', tone: 'usage' }, ...barSegs(usage.contextPercent), percentSeg(usage.contextPercent)]
}

export function narrowGauges(usage: Usage, runway: Runway | null | undefined): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  out.push(...contextSegs(usage, runway))
  for (const rateWindow of windowsInOrder(usage.rateWindows)) {
    sep()
    out.push({ text: `${LABEL[rateWindow.kind] ?? rateWindow.kind} `, tone: 'usage' }, ...barSegs(rateWindow.percentUsed), percentSeg(rateWindow.percentUsed, storedMark(usage.rateWindowsAt)), ...resetSegs(rateWindow))
  }
  return out
}

// 'you 14:02', 'Claude 14:05': the person's last prompt and Claude's last reply, the first `upTo` of them; with
// `isLive`, the prompt is a running turn's while one runs
export function timeParts(input: BandInput, upTo = 2, isLive = false): string[] {
  const you = (isLive ? input.live.promptAt : null) ?? input.turns[input.turns.length - 1]?.promptAt ?? input.session.lastPromptAt
  return [you === null ? null : `you ${clockText(you)}`, input.session.lastReplyAt === null ? null : `Claude ${clockText(input.session.lastReplyAt)}`]
    .filter((part): part is string => part !== null)
    .slice(0, upTo)
}

// ' │ you 14:02 · Claude 14:05'
export function times(input: BandInput, upTo = 2): Line {
  const parts = timeParts(input, upTo)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}
