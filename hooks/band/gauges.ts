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

export const percentText = (n: number): string => `${Math.round(n)}%`

// ' 45%' in its bar's threshold colour; ' ≈45%' with `mark` for a window an earlier session read
export const percentSeg = (n: number, mark = ''): Seg => ({ text: ` ${mark}${percentText(n)}`, tone: toneOf(n) })

export function barSegs(percent: number): Seg[] {
  const [filled, empty] = barText(percent)
  return [{ text: filled, tone: toneOf(percent) }, { text: empty, tone: 'dim' }]
}

export function windowsInOrder(windows: RateWindow[]): RateWindow[] {
  const rank = (w: RateWindow): number => (ORDER.includes(w.kind) ? ORDER.indexOf(w.kind) : ORDER.length)
  return [...windows].sort((a, b) => rank(a) - rank(b))
}

// The 5h window's pace: null until there are 3 readings
export function fiveHourPace(b: Pick<BandInput, 'usage' | 'pace' | 'now'>): ReturnType<typeof paceForecast> {
  const w = b.usage.windows.find(x => x.kind === 'five_hour')
  if (w === undefined) return null
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return paceForecast('five_hour', b.pace.five_hour?.points ?? [], Number.isNaN(reset) ? null : reset, b.now)
}

// ' (02.11 16:15)': when the window resets, or nothing while it reports none
function resetSegs(w: RateWindow): Line {
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isNaN(reset) ? [] : [{ text: ` (${whenText(reset)})`, tone: 'dim' }]
}

export function gauges(b: BandInput): Line {
  const u = b.usage
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' │ ', tone: 'dim' })
  }
  out.push(...contextSegs(u, b.runway))
  if (u.percent !== null || (b.runway ?? null) !== null) {
    const left = turnsLeft(b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent])), b.forecast?.at)
    if (left !== null) out.push({ text: ` ≈${left} turns`, tone: 'dim' })
  }
  const mark = storedMark(u.windowsAt)
  for (const w of windowsInOrder(u.windows)) {
    sep()
    const label = LABEL[w.kind] ?? w.kind
    if (w.kind === 'five_hour') {
      out.push({ text: `${label} `, tone: 'usage' }, ...barSegs(w.percentUsed), percentSeg(w.percentUsed, mark), ...resetSegs(w))
      const p = fiveHourPace(b)
      if (p === 'on-pace') out.push({ text: ' on pace', tone: 'ok' })
      else if (p !== null) out.push({ text: ` full ≈${clockText(p.limitAt)}`, tone: 'warn' })
    } else out.push({ text: `${label} `, tone: 'usage' }, { text: `${mark}${percentText(w.percentUsed)}`, tone: toneOf(w.percentUsed) }, ...resetSegs(w))
  }
  if (u.costUsd !== null) {
    sep()
    out.push({ text: usdText(u.costUsd) })
  }
  return out
}

// The ctx item: against the stack's resume trigger while the runway applies (`ctx ▰▰▰▱▱ 62% of 150k`), else the window
function contextSegs(u: Usage, runway: Runway | null | undefined): Line {
  if (runway !== undefined && runway !== null) {
    return [{ text: 'ctx ', tone: 'usage' }, ...barSegs(runway.percent), percentSeg(runway.percent), { text: ` of ${tokensText(runway.resumeAt)}`, tone: 'usage' }]
  }
  return u.percent === null ? [{ text: 'ctx —', tone: 'usage' }] : [{ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), percentSeg(u.percent)]
}

export function narrowGauges(u: Usage, runway: Runway | null | undefined): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  out.push(...contextSegs(u, runway))
  for (const w of windowsInOrder(u.windows)) {
    sep()
    out.push({ text: `${LABEL[w.kind] ?? w.kind} `, tone: 'usage' }, ...barSegs(w.percentUsed), percentSeg(w.percentUsed, storedMark(u.windowsAt)), ...resetSegs(w))
  }
  return out
}

// 'you 14:02', 'Claude 14:05': the person's last prompt and Claude's last reply, the first `upTo` of them; with
// `isLive`, the prompt is a running turn's while one runs
export function timeParts(b: BandInput, upTo = 2, isLive = false): string[] {
  const you = (isLive ? b.live.promptAt : null) ?? b.turns[b.turns.length - 1]?.promptAt ?? b.session.lastPromptAt
  return [you === null ? null : `you ${clockText(you)}`, b.session.lastReplyAt === null ? null : `Claude ${clockText(b.session.lastReplyAt)}`]
    .filter((p): p is string => p !== null)
    .slice(0, upTo)
}

// ' │ you 14:02 · Claude 14:05'
export function times(b: BandInput, upTo = 2): Line {
  const parts = timeParts(b, upTo)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}
