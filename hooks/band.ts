// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { bar, clock, duration, elapsed, usd, when } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'

import type { Live, Meta, Pace, Turn, Usage, Window } from '../types'

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'opus' | 'sonnet' | 'haiku' | 'fable'
export type Seg =
  | { text: string; tone?: Tone; bold?: boolean }
  | { button: { key: string; label: string; hotkey?: string } }
  | { code: string }
  | { chart: number[] }
export type Line = Seg[]
export type BandInput = {
  now: number; columns: number; isWorking: boolean; live: Live; usage: Usage; meta: Meta; turns: Turn[]
  newFailures: number; pace: Pace
}

const ORDER = ['five_hour', 'seven_day']
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export function toneOf(percent: number): Tone {
  return percent < 60 ? 'ok' : percent <= 85 ? 'warn' : 'fail'
}

export const pct = (n: number): string => `${Math.round(n)}%`

// ' 45%' in its bar's threshold colour
export const pctSeg = (n: number): Seg => ({ text: ` ${pct(n)}`, tone: toneOf(n) })

export function barSegs(percent: number): Seg[] {
  const [filled, empty] = bar(percent)
  return [{ text: filled, tone: toneOf(percent) }, { text: empty, tone: 'dim' }]
}

export function windowsInOrder(windows: Window[]): Window[] {
  const rank = (w: Window): number => (ORDER.includes(w.kind) ? ORDER.indexOf(w.kind) : ORDER.length)
  return [...windows].sort((a, b) => rank(a) - rank(b))
}

// The 5h window's pace: null until there are 3 readings
export function fiveHourPace(b: Pick<BandInput, 'usage' | 'pace' | 'now'>): ReturnType<typeof pace> {
  const w = b.usage.windows.find(x => x.kind === 'five_hour')
  if (w === undefined) return null
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return pace(b.pace.five_hour?.points ?? [], Number.isNaN(reset) ? null : reset, b.now)
}

// ' ↻16:15': when the window resets, or nothing while it reports none
function resetSegs(w: Window, now: number): Line {
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isNaN(reset) ? [] : [{ text: ` ↻${when(reset, now)}`, tone: 'dim' }]
}

function gauges(b: BandInput): Line {
  const u = b.usage
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' │ ', tone: 'dim' })
  }
  if (u.percent === null) out.push({ text: 'ctx —', tone: 'usage' })
  else {
    out.push({ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), pctSeg(u.percent))
    const left = turnsLeft(b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent])))
    if (left !== null) out.push({ text: ` ≈${left} turns`, tone: 'dim' })
  }
  for (const w of windowsInOrder(u.windows)) {
    sep()
    const label = LABEL[w.kind] ?? w.kind
    if (w.kind === 'five_hour') {
      out.push({ text: `${label} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed), ...resetSegs(w, b.now))
      const p = fiveHourPace(b)
      if (p === 'on-pace') out.push({ text: ' on pace', tone: 'ok' })
      else if (p !== null) out.push({ text: ` limit ≈${clock(p.limitAt)}`, tone: 'warn' })
    } else out.push({ text: `${label} `, tone: 'usage' }, { text: pct(w.percentUsed), tone: toneOf(w.percentUsed) }, ...resetSegs(w, b.now))
  }
  if (u.costUsd !== null) {
    sep()
    out.push({ text: usd(u.costUsd) })
  }
  return out
}

function narrowGauges(u: Usage, now: number): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  if (u.percent === null) out.push({ text: 'ctx —', tone: 'usage' })
  else out.push({ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), pctSeg(u.percent))
  for (const w of windowsInOrder(u.windows)) {
    sep()
    out.push({ text: `${LABEL[w.kind] ?? w.kind} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed), ...resetSegs(w, now))
  }
  return out
}

// ' │ you 14:02 · Claude 14:05': the person's last prompt and Claude's last reply
function times(b: BandInput): Line {
  const you = b.turns[b.turns.length - 1]?.promptAt ?? b.meta.lastPromptAt
  const parts = [you === null ? null : `you ${clock(you)}`, b.meta.lastReplyAt === null ? null : `Claude ${clock(b.meta.lastReplyAt)}`]
    .filter((p): p is string => p !== null)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}

function lastTurn(b: BandInput, isNarrow: boolean): Line {
  const t = b.turns[b.turns.length - 1]
  if (t === undefined) return []
  const ok = t.end === 'answer'
  const line: Line = [{ text: ok ? '✓' : '✗', tone: ok ? 'ok' : 'fail' }, { text: ` Turn ${t.n} · ${duration(t.durationMs)}` }]
  if (isNarrow) return line
  line.push({ text: ` · ${t.tools} ${t.tools === 1 ? 'tool' : 'tools'}` })
  if (t.failures > 0) line.push({ text: ` · ${t.failures} ✗`, tone: 'fail' })
  return [...line, ...times(b)]
}

export function working(b: BandInput, isNarrow: boolean): Line {
  const n = b.meta.turnCount + 1
  const took = elapsed(b.now - (b.live.startedAt ?? b.now))
  if (isNarrow) return [{ text: `⟳ Turn ${n} ${took}`, bold: true }]
  const line: Line = [{ text: `⟳ Turn ${n} · ${took}`, bold: true }]
  const newest = b.live.running[b.live.running.length - 1]
  if (newest !== undefined) {
    line.push({ text: ` │ Bash ▸ ${newest.label} ${elapsed(b.now - newest.startedAt)}` })
    if (b.live.running.length > 1) line.push({ text: ` +${b.live.running.length - 1}`, tone: 'dim' })
  }
  return line
}

export function bandLines(b: BandInput): Line[] {
  const u = b.usage
  if (b.turns.length === 0 && u.percent === null) return []
  const isNarrow = b.columns < 100
  const line2 = isNarrow ? narrowGauges(u, b.now) : gauges(b)
  const p = fiveHourPace(b)
  const isHot = (u.percent ?? 0) >= 60 || u.windows.some(w => w.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  if (!isHot && b.newFailures === 0 && !b.isWorking) {
    const calm = isNarrow ? line2 : [...line2, ...times(b)]
    return [calm.map(s => ('text' in s ? { text: s.text, tone: 'dim' as const } : s))]
  }
  if (b.isWorking) return [working(b, isNarrow), line2]
  const out = [lastTurn(b, isNarrow), line2].filter(l => l.length > 0)
  if (b.newFailures > 0) out.push([{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, { button: { key: 'inspect', label: 'Inspect', hotkey: '1' } }])
  return out
}
