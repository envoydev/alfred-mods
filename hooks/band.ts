// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { actionOf, isLive } from './agents.ts'
import { billingOf, cacheView, minutes } from './cache.ts'
import { bar, clock, duration, elapsed, fitLine, mins, modelParts, modelText, toneOf, tokens, usd, when, widthOf } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'
import { narrowPlan, planLine, scoreSeg } from './planlines.ts'
import type { PlanView, ScoresView } from './plan.ts'
import type { Runway } from './stack.ts'

import type { AgentRow, AgentStatus, BandMode, Cache, Level, Live, Meta, Pace, ToolStat, Totals, Turn, Usage, Window } from '../types'

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'agents' | 'cache' | 'plan' | 'handoff' | 'opus' | 'sonnet' | 'haiku' | 'fable'
export type Seg =
  // With a `width`, a table cell: that many cells wide, its text cut with '…' when longer, at its end with `align: 'end'`
  | { text: string; tone?: Tone; bold?: boolean; width?: number; align?: 'start' | 'end' }
  // A toned button draws its label bold in the colour of the feature it acts on; a plain one draws `<hotkey>: <label>`
  | { button: { key: string; label: string; hotkey?: string; tone?: Tone; plain?: boolean } }
  | { code: string }
  | { chart: number[] }
  // Agents on one time axis (spec C2), alone on its line: text lanes on the terminal and mobile, one Svg elsewhere
  | { lanes: Lane[]; now: number }
export type Line = Seg[]
// One agent on the axis: its label (`task <id>` or its type), when it started, when it ended (null while it runs), its
// status and its time as the tree shows it
export type Lane = { label: string; startAt: number; endAt: number | null; status: AgentStatus; time: string }
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
  // The /band setting: `full` adds the info line, the turn's tool count and today's cost; absent or `calm`, today's two
  // lines. `totals` and `stats` feed the info line's output speed and tool calls.
  mode?: BandMode
  totals?: Totals
  stats?: Record<string, ToolStat>
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

// 'you 14:02', 'Claude 14:05': the person's last prompt and Claude's last reply, the first `upTo` of them
function timeParts(b: BandInput, upTo = 2): string[] {
  const you = b.turns[b.turns.length - 1]?.promptAt ?? b.meta.lastPromptAt
  return [you === null ? null : `you ${clock(you)}`, b.meta.lastReplyAt === null ? null : `Claude ${clock(b.meta.lastReplyAt)}`]
    .filter((p): p is string => p !== null)
    .slice(0, upTo)
}

// ' │ you 14:02 · Claude 14:05'
function times(b: BandInput, upTo = 2): Line {
  const parts = timeParts(b, upTo)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}

// One item of the info line: its forms, fullest first, and its keep rank, 1 going first when the width runs out
type Item = { keep: number; forms: Line[] }

const dimText = (text: string): Line => [{ text, tone: 'dim' }]

// The info line's items in the approved mockup's order, each only when known: the model and effort, the session's
// time, the average output speed, the cache, the tool calls by tool, the last prompt and reply
function infoItems(b: BandInput): Item[] {
  const items: Item[] = []
  const model = b.meta.model
  if (model !== null) {
    const family = modelParts(model)?.family
    const name: Seg = family === undefined ? { text: modelText(model, true) } : { text: modelText(model, true), tone: family }
    items.push({ keep: 6, forms: [b.meta.effort === null ? [name] : [name, { text: ` ◑ ${b.meta.effort}`, tone: 'dim' }]] })
  }
  if (b.usage.startedAt !== null) items.push({ keep: 5, forms: [dimText(mins(b.now - b.usage.startedAt))] })
  const t = b.totals
  if (t !== undefined && t.stepMs > 0) items.push({ keep: 3, forms: [dimText(`≈${Math.round(t.stepOutput / (t.stepMs / 1000))} tok/s avg`)] })
  if (b.cache.session.read + b.cache.session.write > 0) {
    const v = cacheView(b.cache, billingOf(b.usage.windows), b.now, b.usage.tokens)
    items.push({ keep: 4, forms: [dimText(v.leftMs === null ? 'cache cold' : `cache warm ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs)}`)] })
  }
  const used = Object.entries(b.stats ?? {})
    .filter(([, s]) => s.calls > 0)
    .sort(([ka, a], [kb, z]) => z.calls - a.calls || (ka < kb ? -1 : ka > kb ? 1 : 0))
  if (used.length > 0) {
    const forms: Line[] = []
    for (let k = used.length; k >= 1; k--) {
      const names = used.slice(0, k).map(([key, s]) => `${key} ×${s.calls}`).join(' · ')
      forms.push(dimText(k < used.length ? `${names} +${used.length - k}` : names))
    }
    items.push({ keep: 2, forms })
  }
  const parts = timeParts(b)
  if (parts.length > 0) items.push({ keep: 1, forms: parts.map((_, i) => dimText(parts.slice(0, parts.length - i).join(' · '))) })
  return items
}

// The info line fitted to the width: while it is wider, the present item with the lowest keep takes its next form or
// goes; nothing fitting, or nothing known, draws no line
export function infoLine(b: BandInput): Line {
  const items = infoItems(b)
  const form = items.map(() => 0)
  const shown = items.map(() => true)
  for (;;) {
    const kept = items.flatMap((item, i) => (shown[i] ? [item.forms[form[i] ?? 0] ?? []] : []))
    const line: Line = kept.flatMap((l, i) => (i === 0 ? l : [{ text: ' │ ', tone: 'dim' as const }, ...l]))
    if (widthOf(line) <= b.columns) return line
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

// Line 2's cost with today's after it, `$1.29 · today $10.46`, in full mode while it fits beside what follows
function withToday(b: BandInput, line: Line, after: Line): Line {
  const u = b.usage
  if (b.mode !== 'full' || u.todayUsd === null || u.costUsd === null) return line
  const full = [...line, { text: ` · today ${usd(u.todayUsd)}` }]
  return widthOf([...full, ...after]) <= b.columns ? full : line
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
  // In full mode the times are the info line's
  return b.mode === 'full' ? line : [...line, ...times(b)]
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
  const count = b.mode === 'full' ? ` · ${b.live.tools} ${b.live.tools === 1 ? 'tool' : 'tools'}` : ''
  const head: Seg = b.isWorking
    ? { text: isNarrow ? `⟳ Turn ${n} ${took}` : `⟳ Turn ${n} · ${took}${count}`, bold: true }
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

// The status line under the prompt (spec D2), which stays while the band is collapsed: what needs the person, short
// and in the band's order - REC, the context once the band turns hot at 60, the new failures - or null for none
export function statusText(o: { percent: number | null; newFailures: number; recLevel: Level }): string | null {
  const parts = [
    o.recLevel === 'off' ? null : '● REC',
    o.percent !== null && Math.round(o.percent) >= 60 ? `ctx ${pct(o.percent)}` : null,
    o.newFailures > 0 ? `✗ ${o.newFailures} new` : null,
  ].filter((p): p is string => p !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// A red '● REC' while REC is on, then Alfred Code's mode banner, lead line 1 in every state, never dropped for width:
// the body's first line follows them while it fits what is left, else they take line 1 alone and the body keeps the
// full width, so no gauge, reset or the cost drops for them
export function bandLines(b: BandInput): Line[] {
  const isNarrow = b.columns < 100
  const marks: Line[] = [b.rec !== undefined && b.rec.level !== 'off' ? [REC_MARK] : [], b.banner ?? []].filter(m => m.length > 0)
  if (marks.length === 0) return bandBody(b, isNarrow)
  const sep: Seg = { text: ' │ ', tone: 'dim' }
  const alone: Line = marks.flatMap((m, i) => (i === 0 ? m : [sep, ...m]))
  const lead: Line = [...alone, sep]
  // Only line 1 shares its row with the marks: the lines under it are fitted to the band's whole width
  const [first] = bandBody({ ...b, columns: b.columns - widthOf(lead) }, isNarrow)
  if (first === undefined) return [alone]
  const body = bandBody(b, isNarrow)
  return widthOf(lead) + widthOf(first) <= b.columns ? [[...lead, ...first], ...body.slice(1)] : [alone, ...body]
}

function bandBody(b: BandInput, isNarrow: boolean): Line[] {
  const u = b.usage
  if (b.turns.length === 0 && u.percent === null) return []
  const invalid: Line = b.planInvalid ? [{ text: ' │ ', tone: 'dim' }, { text: 'plan file invalid', tone: 'warn' }] : []
  const gaugeLine = isNarrow ? narrowGauges(u, b.runway) : withToday(b, gauges(b), invalid)
  const line2 = [...gaugeLine, ...invalid]
  const info: Line[] = b.mode === 'full' ? [infoLine(b)].filter(l => l.length > 0) : []
  const p = fiveHourPace(b)
  const isHot = (b.runway?.percent ?? u.percent ?? 0) >= 60 || u.windows.some(w => w.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  const agentsRun = b.agents.some(r => isLive(r.status))
  const warning = cacheWarning(b, true)
  const ask = handoffAsk(b)
  if (!isHot && b.newFailures === 0 && !b.isWorking && !agentsRun && warning === null && ask === null) {
    const calm = isNarrow || b.mode === 'full' ? gaugeLine : withTimes(b, gaugeLine)
    const dim = (l: Line): Line => l.map(s => ('text' in s ? { text: s.text, tone: 'dim' as const } : s))
    return [[...dim(calm), ...invalid], ...info.map(dim)]
  }
  if (b.isWorking) return [working(b, isNarrow), line2, ...info]
  const out = [agentsRun ? working(b, isNarrow) : withPlanTail(b, lastTurn(b, isNarrow)), line2, ...info].filter(l => l.length > 0)
  const failed: Line = b.newFailures > 0
    ? [{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, { button: { key: 'inspect', label: 'Inspect', hotkey: '1' } }]
    : []
  const items = [warning, ask, failed].filter((l): l is Line => l !== null && l.length > 0)
  if (items.length > 0) out.push(items.flatMap((l, i) => (i === 0 ? l : [{ text: '    ' }, ...l])))
  return out
}
