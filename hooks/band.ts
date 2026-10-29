// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { actionOf, isLive } from './agents.ts'
import { billingOf, cacheView, minutes } from './cache.ts'
import { bar, clock, duration, elapsed, fitLine, toneOf, tokens, usd, when, widthOf } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'
import { narrowPlan, planLine, scoreSeg } from './planlines.ts'
import type { PlanView, ScoresView } from './plan.ts'
import type { Runway } from './stack.ts'

import type { AgentRow, Cache, Level, Live, Meta, Pace, Turn, Usage, Window } from '../types'

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'agents' | 'cache' | 'plan' | 'handoff' | 'opus' | 'sonnet' | 'haiku' | 'fable'
export type Seg =
  | { text: string; tone?: Tone; bold?: boolean }
  // A toned button draws its label bold in the colour of the feature it acts on; a plain one draws `<hotkey>: <label>`
  | { button: { key: string; label: string; hotkey?: string; tone?: Tone; plain?: boolean } }
  | { code: string }
  | { chart: number[] }
export type Line = Seg[]
// `plan`: the shown plan or task list while it runs, or for 10 minutes after it finished; `planInvalid`: the shown
// plan's file failed its last read; `score`: the shown plan's scores, else the newest scores file's; `rec`: REC's level
// and how many private words it hides
export type BandInput = {
  now: number; columns: number; isWorking: boolean; live: Live; usage: Usage; meta: Meta; turns: Turn[]
  newFailures: number; pace: Pace; agents: AgentRow[]; cache: Cache
  plan: PlanView | null; planInvalid: boolean; score: ScoresView | null; rec?: { level: Level; words: number }
  // What the forecast counts turns to: `at` over the window, and `label` as the Usage tab names it, F8's threshold
  // (`80%`) or the stack's resume trigger (`150k`)
  forecast?: { at: number; label: string }
  // The step F8's ask is up for, or null
  handoffAsk?: number | null
  // Alfred Code's runway, which the ctx item measures against while it applies, and the mode banner that leads line 1
  runway?: Runway | null
  banner?: Seg[]
}

const ORDER = ['five_hour', 'seven_day']
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

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
  return pace('five_hour', b.pace.five_hour?.points ?? [], Number.isNaN(reset) ? null : reset, b.now)
}

// ' (02.11 16:15)': when the window resets, or nothing while it reports none
function resetSegs(w: Window): Line {
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isNaN(reset) ? [] : [{ text: ` (${when(reset)})`, tone: 'dim' }]
}

function gauges(b: BandInput): Line {
  const u = b.usage
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' │ ', tone: 'dim' })
  }
  out.push(...ctxSegs(u, b.runway))
  if (u.percent !== null || (b.runway ?? null) !== null) {
    const left = turnsLeft(b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent])), b.forecast?.at)
    if (left !== null) out.push({ text: ` ≈${left} turns`, tone: 'dim' })
  }
  for (const w of windowsInOrder(u.windows)) {
    sep()
    const label = LABEL[w.kind] ?? w.kind
    if (w.kind === 'five_hour') {
      out.push({ text: `${label} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed), ...resetSegs(w))
      const p = fiveHourPace(b)
      if (p === 'on-pace') out.push({ text: ' on pace', tone: 'ok' })
      else if (p !== null) out.push({ text: ` full ≈${clock(p.limitAt)}`, tone: 'warn' })
    } else out.push({ text: `${label} `, tone: 'usage' }, { text: pct(w.percentUsed), tone: toneOf(w.percentUsed) }, ...resetSegs(w))
  }
  if (u.costUsd !== null) {
    sep()
    out.push({ text: usd(u.costUsd) })
  }
  return out
}

// The ctx item: against the stack's resume trigger while the runway applies (`ctx ▰▰▰▱▱ 62% of 150k`), else the window
function ctxSegs(u: Usage, runway: Runway | null | undefined): Line {
  if (runway !== undefined && runway !== null) {
    return [{ text: 'ctx ', tone: 'usage' }, ...barSegs(runway.percent), pctSeg(runway.percent), { text: ` of ${tokens(runway.resumeAt)}`, tone: 'usage' }]
  }
  return u.percent === null ? [{ text: 'ctx —', tone: 'usage' }] : [{ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), pctSeg(u.percent)]
}

function narrowGauges(u: Usage, runway: Runway | null | undefined): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  out.push(...ctxSegs(u, runway))
  for (const w of windowsInOrder(u.windows)) {
    sep()
    out.push({ text: `${LABEL[w.kind] ?? w.kind} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed), ...resetSegs(w))
  }
  return out
}

// ' │ you 14:02 · Claude 14:05': the person's last prompt and Claude's last reply, the first `upTo` of them
function times(b: BandInput, upTo = 2): Line {
  const you = b.turns[b.turns.length - 1]?.promptAt ?? b.meta.lastPromptAt
  const parts = [you === null ? null : `you ${clock(you)}`, b.meta.lastReplyAt === null ? null : `Claude ${clock(b.meta.lastReplyAt)}`]
    .filter((p): p is string => p !== null)
    .slice(0, upTo)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}

// The gauges and as many times as fit the width, each dropped whole: Claude's first, then yours
function withTimes(b: BandInput, line: Line): Line {
  for (const upTo of [2, 1]) {
    const full = [...line, ...times(b, upTo)]
    if (widthOf(full) <= b.columns) return full
  }
  return line
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

const agentCount = (k: number): string => `${k} ${k === 1 ? 'agent' : 'agents'}`

// ' │ PLAN 3/5 · score 81 ▲13', each part only when known, for an idle line 1 that needs you
function planTail(b: BandInput): Line {
  const parts: Line[] = []
  if (b.plan !== null) parts.push([{ text: 'PLAN', tone: 'plan' }, { text: ` ${b.plan.finished}/${b.plan.total}` }])
  if (b.score !== null) parts.push(scoreSeg(b.score))
  if (parts.length === 0) return []
  return [{ text: ' │ ', tone: 'dim' }, ...parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' · ' }, ...p]))]
}

// The turn, or the agents while only they run, or the plan line while a plan runs; then each live agent's action and
// the running Bash. Past the width the agent parts fold into ' +N agents', then the Bash part goes, then the plan's
// step, then its title is cut.
export function working(b: BandInput, isNarrow: boolean): Line {
  const running = b.agents.filter(r => isLive(r.status))
  if (b.plan !== null && isNarrow) return narrowPlan(b.plan, running.length)
  const n = b.meta.turnCount + 1
  const took = elapsed(b.now - (b.live.startedAt ?? b.now))
  const head: Seg = b.isWorking
    ? { text: isNarrow ? `⟳ Turn ${n} ${took}` : `⟳ Turn ${n} · ${took}`, bold: true }
    : { text: `⟳ ${agentCount(running.length)}`, bold: true }
  if (isNarrow) return b.isWorking && running.length > 0 ? [head, { text: ` · ${agentCount(running.length)}` }] : [head]
  const bash: Line = []
  const calls = b.live.running.filter(r => r.tool === 'Bash')
  const newest = calls[calls.length - 1]
  if (newest !== undefined) {
    bash.push({ text: ` │ Bash ▸ ${newest.label} ${elapsed(b.now - newest.startedAt)}` })
    if (calls.length > 1) bash.push({ text: ` +${calls.length - 1}`, tone: 'dim' })
  }
  const parts: Line = running.map(r => ({ text: r.action === null ? ` │ ${r.type}` : ` │ ${r.type} ▸ ${r.action}` }))
  const folded = (kept: number): Line => {
    const rest = parts.length - kept
    return [...parts.slice(0, kept), ...(rest > 0 ? [{ text: ` +${agentCount(rest)}`, tone: 'dim' as const }] : [])]
  }
  const lead: Line = b.plan === null ? [head] : planLine(b.plan, Infinity)
  for (let kept = parts.length; kept >= 0; kept--) {
    const line: Line = [...lead, ...folded(kept), ...bash]
    if (widthOf(line) <= b.columns) return line
  }
  if (b.plan === null) return [head, ...folded(0), ...bash]
  return [...planLine(b.plan, b.columns - widthOf(folded(0))), ...folded(0)]
}

// What the spinner adds after the engine's suffix: an agent's action and context on that agent's spinner; on the main
// loop's, its newest call in flight, its context percent and the agents running. Null with nothing to add.
export function spinnerSuffix(s: { requestId: string; live: Live; percent: number | null; agents: AgentRow[] }): string | null {
  const parts: string[] = []
  const row = s.agents.find(r => r.id === s.requestId)
  if (row !== undefined) {
    if (row.action !== null) parts.push(fitLine(row.action, 40))
    if (row.contextTokens !== null) parts.push(`ctx ${tokens(row.contextTokens)}`)
  } else {
    const newest = s.live.running[s.live.running.length - 1]
    if (newest !== undefined) parts.push(fitLine(actionOf(newest.tool, newest.label), 40))
    if (s.percent !== null) parts.push(pct(s.percent))
    const k = s.agents.filter(r => isLive(r.status)).length
    if (k > 0) parts.push(agentCount(k))
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

// The cache's warning while the main loop is idle: a 1h cache's last 5 minutes, or its last 3 where Claude Code should
// compact the conversation first, and a 5m cache's last minute. The band's button takes hotkey 3.
export function cacheWarning(b: BandInput, hasHotkey: boolean): Line | null {
  if (b.isWorking) return null
  const v = cacheView(b.cache, billingOf(b.usage.windows), b.now, b.usage.tokens)
  if (!v.isClosing) return null
  const button = hasHotkey
    ? { key: 'compact', label: 'Compact', hotkey: '3', tone: 'cache' as const }
    : { key: 'compact', label: 'Compact', tone: 'cache' as const }
  return [{ text: `⚠ cache cold in ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs ?? 0)} `, tone: 'warn' }, { button }]
}

// F8's ask on line 3: the step the context passed, its violet button on hotkey 4
function handoffAsk(b: BandInput): Line | null {
  if (b.handoffAsk === undefined || b.handoffAsk === null) return null
  return [{ text: `⚠ ctx past ${b.handoffAsk}% `, tone: 'warn' }, { button: { key: 'handoff', label: 'Handoff', hotkey: '4', tone: 'handoff' } }]
}

// The idle line 1 with ' │ PLAN 3/5 · score 81 ▲13' while it fits
function withPlanTail(b: BandInput, line: Line): Line {
  const full = [...line, ...planTail(b)]
  return line.length > 0 && widthOf(full) <= b.columns ? full : line
}

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

// A red '● REC' while REC is on, then Alfred Code's mode banner, lead line 1 in every state, never dropped for width:
// the rest fits what is left
export function bandLines(b: BandInput): Line[] {
  const isNarrow = b.columns < 100
  const marks: Line[] = [b.rec !== undefined && b.rec.level !== 'off' ? [REC_MARK] : [], b.banner ?? []].filter(m => m.length > 0)
  if (marks.length === 0) return bandBody(b, isNarrow)
  const sep: Seg = { text: ' │ ', tone: 'dim' }
  const alone: Line = marks.flatMap((m, i) => (i === 0 ? m : [sep, ...m]))
  const lead: Line = [...alone, sep]
  const [first, ...rest] = bandBody({ ...b, columns: b.columns - widthOf(lead) }, isNarrow)
  return first === undefined ? [alone] : [[...lead, ...first], ...rest]
}

function bandBody(b: BandInput, isNarrow: boolean): Line[] {
  const u = b.usage
  if (b.turns.length === 0 && u.percent === null) return []
  const invalid: Line = b.planInvalid ? [{ text: ' │ ', tone: 'dim' }, { text: 'plan file invalid', tone: 'warn' }] : []
  const gaugeLine = isNarrow ? narrowGauges(u, b.runway) : gauges(b)
  const line2 = [...gaugeLine, ...invalid]
  const p = fiveHourPace(b)
  const isHot = (b.runway?.percent ?? u.percent ?? 0) >= 60 || u.windows.some(w => w.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  const agentsRun = b.agents.some(r => isLive(r.status))
  const warning = cacheWarning(b, true)
  const ask = handoffAsk(b)
  if (!isHot && b.newFailures === 0 && !b.isWorking && !agentsRun && warning === null && ask === null) {
    const calm = isNarrow ? gaugeLine : withTimes(b, gaugeLine)
    return [[...calm.map(s => ('text' in s ? { text: s.text, tone: 'dim' as const } : s)), ...invalid]]
  }
  if (b.isWorking) return [working(b, isNarrow), line2]
  const out = [agentsRun ? working(b, isNarrow) : withPlanTail(b, lastTurn(b, isNarrow)), line2].filter(l => l.length > 0)
  const failed: Line = b.newFailures > 0
    ? [{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, { button: { key: 'inspect', label: 'Inspect', hotkey: '1' } }]
    : []
  const items = [warning, ask, failed].filter((l): l is Line => l !== null && l.length > 0)
  if (items.length > 0) out.push(items.flatMap((l, i) => (i === 0 ? l : [{ text: '    ' }, ...l])))
  return out
}
