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
export function underButton(input: BandInput, button: ButtonSeg, command: string): Seg {
  if (input.under === undefined) return { button }
  if (input.under.buttons === 'text') return { text: command, tone: 'dim' }
  const { hotkey: _hotkey, plain: _plain, ...rest } = button
  return { button: { ...rest, label: command } }
}

// Line 2's cost with today's after it, `$1.29 · today $10.46`, in full mode while it fits beside what follows
export function withToday(input: BandInput, line: Line, after: Line): Line {
  const usage = input.usage
  if (input.mode !== 'full' || usage.todayUsd === null || usage.costUsd === null) return line
  const full = [...line, { text: ` · today ${usdText(usage.todayUsd)}` }]
  return widthOf([...full, ...after]) <= input.columns ? full : line
}

// The gauges and as many times as fit the width, each dropped whole: Claude's first, then yours
export function withTimes(input: BandInput, line: Line): Line {
  for (const upTo of [2, 1]) {
    const full = [...line, ...times(input, upTo)]
    if (widthOf(full) <= input.columns) return full
  }
  return line
}

export function lastTurn(input: BandInput, isNarrow: boolean): Line {
  const turn = input.turns[input.turns.length - 1]
  if (turn === undefined) return []
  const ok = turn.endReason === 'answer'
  const line: Line = [{ text: ok ? '✓' : '✗', tone: ok ? 'ok' : 'fail' }, { text: ` Turn ${turn.turnNumber} · ${durationText(turn.durationMs)}` }]
  if (isNarrow) return line
  line.push({ text: ` · ${turn.toolCalls} ${turn.toolCalls === 1 ? 'tool' : 'tools'}` })
  if (turn.toolFailures > 0) line.push({ text: ` · ${turn.toolFailures} ✗`, tone: 'fail' })
  // In full mode the times are the info line's
  return input.mode === 'full' ? line : [...line, ...times(input)]
}

const agentCount = (count: number): string => `${count} ${count === 1 ? 'agent' : 'agents'}`

// ' │ PLAN 3/5 · score 81 ▲13', each part only when known, for an idle line 1 that needs you; while the full band
// draws the plan row, the row has the count and the plan's own score, so line 1 keeps only a score of another output
function planTail(input: BandInput, isRowDrawn: boolean): Line {
  const parts: Line[] = []
  const hasRow = isRowDrawn && input.plan !== null
  if (input.plan !== null && !hasRow) parts.push([{ text: 'PLAN', tone: 'plan' }, { text: ` ${input.plan.finished}/${input.plan.total}` }])
  if (input.score !== null && !(hasRow && input.isPlanScore !== false)) parts.push(scoreSeg(input.score, input.scoreLevel ?? null))
  if (parts.length === 0) return []
  return [{ text: ' │ ', tone: 'dim' }, ...parts.flatMap((line, i) => (i === 0 ? line : [{ text: ' · ' }, ...line]))]
}

// The turn, or the agents while only they run, or the plan line while a plan runs; then each live agent's action and
// the running Bash. Past the width the agent parts fold into ' +N agents', then the Bash part goes, then the plan's
// step, then its title is cut.
export function workingLine(input: BandInput, isNarrow: boolean): Line {
  const running = input.agents.filter(agent => isLive(agent.status))
  // The full band's plan has its own row, so line 1 keeps the turn there
  const plan = input.mode === 'full' ? null : input.plan
  if (plan !== null && isNarrow) return narrowPlan(plan, running.length)
  const turnNumber = input.session.turnCount + 1
  const took = elapsedText(input.now - (input.live.startedAt ?? input.now))
  const count = input.mode === 'full' ? ` · ${input.live.toolCalls} ${input.live.toolCalls === 1 ? 'tool' : 'tools'}` : ''
  const head: Seg = input.isWorking
    ? { text: isNarrow ? `⟳ Turn ${turnNumber} ${took}` : `⟳ Turn ${turnNumber} · ${took}${count}`, bold: true }
    : { text: `⟳ ${agentCount(running.length)}`, bold: true }
  if (isNarrow) return input.isWorking && running.length > 0 ? [head, { text: ` · ${agentCount(running.length)}` }] : [head]
  const bash: Line = []
  const calls = input.live.runningCalls.filter(call => call.tool === 'Bash')
  const newest = calls[calls.length - 1]
  if (newest !== undefined) {
    bash.push({ text: ` │ Bash ▸ ${newest.label} ${elapsedText(input.now - newest.startedAt)}` })
    if (calls.length > 1) bash.push({ text: ` +${calls.length - 1}`, tone: 'dim' })
  }
  const parts: Line = running.map(agent => ({ text: agent.action === null ? ` │ ${agent.type}` : ` │ ${agent.type} ▸ ${agent.action}` }))
  const folded = (kept: number): Line => {
    const rest = parts.length - kept
    return [...parts.slice(0, kept), ...(rest > 0 ? [{ text: ` +${agentCount(rest)}`, tone: 'dim' as const }] : [])]
  }
  const lead: Line = plan === null ? [head] : planLine(plan, Infinity)
  for (let kept = parts.length; kept >= 0; kept--) {
    const line: Line = [...lead, ...folded(kept), ...bash]
    if (widthOf(line) <= input.columns) return line
  }
  if (plan === null) return [head, ...folded(0), ...bash]
  return [...planLine(plan, input.columns - widthOf(folded(0))), ...folded(0)]
}

// What the spinner adds after the engine's suffix: an agent's action and context on that agent's spinner; on the main
// loop's, its newest call in flight, its context percent and the agents running. Null with nothing to add.
export function spinnerSuffix(spinner: { requestId: string; live: Live; percent: number | null; agents: AgentRow[] }): string | null {
  const parts: string[] = []
  const row = spinner.agents.find(agent => agent.id === spinner.requestId)
  if (row !== undefined) {
    if (row.action !== null) parts.push(fitLine(row.action, 40))
    if (row.contextTokens !== null) parts.push(`ctx ${tokensText(row.contextTokens)}`)
  } else {
    const newest = spinner.live.runningCalls[spinner.live.runningCalls.length - 1]
    if (newest !== undefined) parts.push(fitLine(actionOf(newest.tool, newest.label), 40))
    if (spinner.percent !== null) parts.push(percentText(spinner.percent))
    const liveCount = spinner.agents.filter(agent => isLive(agent.status)).length
    if (liveCount > 0) parts.push(agentCount(liveCount))
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

// The cache's warning while the main loop is idle: a 1h cache's last 5 minutes, or its last 3 where Claude Code should
// compact the conversation first, and a 5m cache's last minute. The band's button takes hotkey 3.
export function cacheWarning(input: BandInput, hasHotkey: boolean): Line | null {
  if (input.isWorking) return null
  const cacheState = cacheView(input.cache, billingOf(input.usage.rateWindows), input.now, input.usage.contextTokens)
  if (!cacheState.isClosing) return null
  const button = hasHotkey
    ? { key: 'compact', label: 'Compact', hotkey: '3', tone: 'cache' as const }
    : { key: 'compact', label: 'Compact', tone: 'cache' as const }
  return [{ text: `⚠ cache cold in ${cacheState.tier.isEstimate ? '≈' : ''}${minutesLeftText(cacheState.leftMs ?? 0)} `, tone: 'warn' }, underButton(input, button, '/compact')]
}

// F8's ask on line 3: the step the context passed, its violet button on hotkey 4
export function handoffAsk(input: BandInput): Line | null {
  if (input.handoffAskStep === undefined || input.handoffAskStep === null) return null
  return [{ text: `⚠ ctx past ${input.handoffAskStep}% `, tone: 'warn' }, underButton(input, { key: 'handoff', label: 'Handoff', hotkey: '4', tone: 'handoff' }, '/auto-handoff now')]
}

// The idle line 1 with ' │ PLAN 3/5 · score 81 ▲13' while it fits
export function withPlanTail(input: BandInput, line: Line, isRowDrawn: boolean): Line {
  const full = [...line, ...planTail(input, isRowDrawn)]
  return line.length > 0 && widthOf(full) <= input.columns ? full : line
}
