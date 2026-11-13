// The band while a turn runs: the working line, its spinner suffix, the cache and handoff asks, the plan's tail
import { actionOf, isLive } from '../agents/agents'
import { billingOf, cacheView, minutesLeftText } from '../cache/cache'
import { durationText, elapsedText, fitLine, tokensText, usdText, widthOf } from '../core/format'
import { narrowPlan, planLine, scoreSeg } from '../plan/planlines'
import type { AgentRow } from '../agents/types'
import type { BandInput } from './types'
import type { Live, Turn } from '../session/types'
import type { Line, Seg } from '../core/types'
import { percentText, times } from './gauges'

type ButtonSeg = Extract<Seg, { button: unknown }>['button']

// A band button where it draws (spec 2026-11-11 band-under, U3): above, as it is; under in fullscreen, where a click
// presses it, labelled with the command that does its job and with no hotkey; under on the main screen, where nothing
// presses it, that command as dim text
export function underButton(b: BandInput, button: ButtonSeg, command: string): Seg {
  if (b.under === undefined) return { button }
  if (b.under.buttons === 'text') return { text: command, tone: 'dim' }
  const { hotkey: _hotkey, plain: _plain, ...rest } = button
  return { button: { ...rest, label: command } }
}

// Line 2's cost with today's after it, `$1.29 · today $10.46`, in full mode while it fits beside what follows
export function withToday(b: BandInput, line: Line, after: Line): Line {
  const u = b.usage
  if (b.mode !== 'full' || u.todayUsd === null || u.costUsd === null) return line
  const full = [...line, { text: ` · today ${usdText(u.todayUsd)}` }]
  return widthOf([...full, ...after]) <= b.columns ? full : line
}

// The gauges and as many times as fit the width, each dropped whole: Claude's first, then yours
export function withTimes(b: BandInput, line: Line): Line {
  for (const upTo of [2, 1]) {
    const full = [...line, ...times(b, upTo)]
    if (widthOf(full) <= b.columns) return full
  }
  return line
}

export function lastTurn(b: BandInput, isNarrow: boolean): Line {
  const t = b.turns[b.turns.length - 1]
  if (t === undefined) return []
  const ok = t.end === 'answer'
  const line: Line = [{ text: ok ? '✓' : '✗', tone: ok ? 'ok' : 'fail' }, { text: ` Turn ${t.n} · ${durationText(t.durationMs)}` }]
  if (isNarrow) return line
  line.push({ text: ` · ${t.tools} ${t.tools === 1 ? 'tool' : 'tools'}` })
  if (t.failures > 0) line.push({ text: ` · ${t.failures} ✗`, tone: 'fail' })
  // In full mode the times are the info line's
  return b.mode === 'full' ? line : [...line, ...times(b)]
}

const agentCount = (k: number): string => `${k} ${k === 1 ? 'agent' : 'agents'}`

// ' │ PLAN 3/5 · score 81 ▲13', each part only when known, for an idle line 1 that needs you; while the full band
// draws the plan row, the row has the count and the plan's own score, so line 1 keeps only a score of another output
function planTail(b: BandInput, isRowDrawn: boolean): Line {
  const parts: Line[] = []
  const hasRow = isRowDrawn && b.plan !== null
  if (b.plan !== null && !hasRow) parts.push([{ text: 'PLAN', tone: 'plan' }, { text: ` ${b.plan.finished}/${b.plan.total}` }])
  if (b.score !== null && !(hasRow && b.isPlanScore !== false)) parts.push(scoreSeg(b.score, b.scoreLevel ?? null))
  if (parts.length === 0) return []
  return [{ text: ' │ ', tone: 'dim' }, ...parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' · ' }, ...p]))]
}

// The turn, or the agents while only they run, or the plan line while a plan runs; then each live agent's action and
// the running Bash. Past the width the agent parts fold into ' +N agents', then the Bash part goes, then the plan's
// step, then its title is cut.
export function workingLine(b: BandInput, isNarrow: boolean): Line {
  const running = b.agents.filter(r => isLive(r.status))
  // The full band's plan has its own row, so line 1 keeps the turn there
  const plan = b.mode === 'full' ? null : b.plan
  if (plan !== null && isNarrow) return narrowPlan(plan, running.length)
  const n = b.session.turnCount + 1
  const took = elapsedText(b.now - (b.live.startedAt ?? b.now))
  const count = b.mode === 'full' ? ` · ${b.live.tools} ${b.live.tools === 1 ? 'tool' : 'tools'}` : ''
  const head: Seg = b.isWorking
    ? { text: isNarrow ? `⟳ Turn ${n} ${took}` : `⟳ Turn ${n} · ${took}${count}`, bold: true }
    : { text: `⟳ ${agentCount(running.length)}`, bold: true }
  if (isNarrow) return b.isWorking && running.length > 0 ? [head, { text: ` · ${agentCount(running.length)}` }] : [head]
  const bash: Line = []
  const calls = b.live.running.filter(r => r.tool === 'Bash')
  const newest = calls[calls.length - 1]
  if (newest !== undefined) {
    bash.push({ text: ` │ Bash ▸ ${newest.label} ${elapsedText(b.now - newest.startedAt)}` })
    if (calls.length > 1) bash.push({ text: ` +${calls.length - 1}`, tone: 'dim' })
  }
  const parts: Line = running.map(r => ({ text: r.action === null ? ` │ ${r.type}` : ` │ ${r.type} ▸ ${r.action}` }))
  const folded = (kept: number): Line => {
    const rest = parts.length - kept
    return [...parts.slice(0, kept), ...(rest > 0 ? [{ text: ` +${agentCount(rest)}`, tone: 'dim' as const }] : [])]
  }
  const lead: Line = plan === null ? [head] : planLine(plan, Infinity)
  for (let kept = parts.length; kept >= 0; kept--) {
    const line: Line = [...lead, ...folded(kept), ...bash]
    if (widthOf(line) <= b.columns) return line
  }
  if (plan === null) return [head, ...folded(0), ...bash]
  return [...planLine(plan, b.columns - widthOf(folded(0))), ...folded(0)]
}

// What the spinner adds after the engine's suffix: an agent's action and context on that agent's spinner; on the main
// loop's, its newest call in flight, its context percent and the agents running. Null with nothing to add.
export function spinnerSuffix(s: { requestId: string; live: Live; percent: number | null; agents: AgentRow[] }): string | null {
  const parts: string[] = []
  const row = s.agents.find(r => r.id === s.requestId)
  if (row !== undefined) {
    if (row.action !== null) parts.push(fitLine(row.action, 40))
    if (row.contextTokens !== null) parts.push(`ctx ${tokensText(row.contextTokens)}`)
  } else {
    const newest = s.live.running[s.live.running.length - 1]
    if (newest !== undefined) parts.push(fitLine(actionOf(newest.tool, newest.label), 40))
    if (s.percent !== null) parts.push(percentText(s.percent))
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
  return [{ text: `⚠ cache cold in ${v.tier.isEstimate ? '≈' : ''}${minutesLeftText(v.leftMs ?? 0)} `, tone: 'warn' }, underButton(b, button, '/compact')]
}

// F8's ask on line 3: the step the context passed, its violet button on hotkey 4
export function handoffAsk(b: BandInput): Line | null {
  if (b.handoffAskStep === undefined || b.handoffAskStep === null) return null
  return [{ text: `⚠ ctx past ${b.handoffAskStep}% `, tone: 'warn' }, underButton(b, { key: 'handoff', label: 'Handoff', hotkey: '4', tone: 'handoff' }, '/auto-handoff now')]
}

// The idle line 1 with ' │ PLAN 3/5 · score 81 ▲13' while it fits
export function withPlanTail(b: BandInput, line: Line, isRowDrawn: boolean): Line {
  const full = [...line, ...planTail(b, isRowDrawn)]
  return line.length > 0 && widthOf(full) <= b.columns ? full : line
}
