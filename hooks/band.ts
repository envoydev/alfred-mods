// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { actionOf, isLive } from './agents.ts'
import { billingOf, cacheView, minutes } from './cache.ts'
import { bar, clock, duration, elapsed, oneLine, toneOf, tokens, usd, when } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'

import type { AgentRow, Cache, Live, Meta, Pace, Turn, Usage, Window } from '../types'

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'agents' | 'cache' | 'opus' | 'sonnet' | 'haiku' | 'fable'
export type Seg =
  | { text: string; tone?: Tone; bold?: boolean }
  // A toned button draws its label bold in the colour of the feature it acts on
  | { button: { key: string; label: string; hotkey?: string; tone?: Tone } }
  | { code: string }
  | { chart: number[] }
export type Line = Seg[]
export type BandInput = {
  now: number; columns: number; isWorking: boolean; live: Live; usage: Usage; meta: Meta; turns: Turn[]
  newFailures: number; pace: Pace; agents: AgentRow[]; cache: Cache
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

function narrowGauges(u: Usage): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  if (u.percent === null) out.push({ text: 'ctx —', tone: 'usage' })
  else out.push({ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), pctSeg(u.percent))
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

const widthOf = (line: Line): number => line.reduce((n, s) => n + ('text' in s ? s.text.length : 0), 0)

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

// The turn, or the agents while only they run; then each live agent's action and the running Bash. Agent parts past
// the width fold into ' +N agents'.
export function working(b: BandInput, isNarrow: boolean): Line {
  const running = b.agents.filter(r => isLive(r.status))
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
  for (let kept = parts.length; ; kept--) {
    const rest = parts.length - kept
    const line: Line = [head, ...parts.slice(0, kept), ...(rest > 0 ? [{ text: ` +${agentCount(rest)}`, tone: 'dim' as const }] : []), ...bash]
    if (kept === 0 || widthOf(line) <= b.columns) return line
  }
}

// What the spinner adds after the engine's suffix: an agent's action and context on that agent's spinner; on the main
// loop's, its newest call in flight, its context percent and the agents running. Null with nothing to add.
export function spinnerSuffix(s: { requestId: string; live: Live; percent: number | null; agents: AgentRow[] }): string | null {
  const parts: string[] = []
  const row = s.agents.find(r => r.id === s.requestId)
  if (row !== undefined) {
    if (row.action !== null) parts.push(oneLine(row.action, 40))
    if (row.contextTokens !== null) parts.push(`ctx ${tokens(row.contextTokens)}`)
  } else {
    const newest = s.live.running[s.live.running.length - 1]
    if (newest !== undefined) parts.push(oneLine(actionOf(newest.tool, newest.label), 40))
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

export function bandLines(b: BandInput): Line[] {
  const u = b.usage
  if (b.turns.length === 0 && u.percent === null) return []
  const isNarrow = b.columns < 100
  const line2 = isNarrow ? narrowGauges(u) : gauges(b)
  const p = fiveHourPace(b)
  const isHot = (u.percent ?? 0) >= 60 || u.windows.some(w => w.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  const agentsRun = b.agents.some(r => isLive(r.status))
  const warning = cacheWarning(b, true)
  if (!isHot && b.newFailures === 0 && !b.isWorking && !agentsRun && warning === null) {
    const calm = isNarrow ? line2 : withTimes(b, line2)
    return [calm.map(s => ('text' in s ? { text: s.text, tone: 'dim' as const } : s))]
  }
  if (b.isWorking) return [working(b, isNarrow), line2]
  const out = [agentsRun ? working(b, isNarrow) : lastTurn(b, isNarrow), line2].filter(l => l.length > 0)
  const failed: Line = b.newFailures > 0
    ? [{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, { button: { key: 'inspect', label: 'Inspect', hotkey: '1' } }]
    : []
  if (warning !== null) out.push(failed.length > 0 ? [...warning, { text: '    ' }, ...failed] : warning)
  else if (failed.length > 0) out.push(failed)
  return out
}
