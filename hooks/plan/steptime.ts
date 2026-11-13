// Where a loop's working time goes, and its $.store keys: `step:<plan>:<step id>:<session id>` holds
// `{ ms, isShared, at }` and `overhead:<plan>:<session id>` holds `{ ms, at }`. Each session writes only its own keys,
// so two sessions never race; a read sums them all. Pure functions; register.ts reads and writes the store.
import { isFinishedStep, isPlanRunning } from './plan'
import type { CallWait, SliceClose, Credit, NamedStep, Plan, Slice, StepTime, CloseTarget, Watched } from './types'
import type { Outcome } from '../tools/types'
import type { CostEntries } from '../session/types'


const KEPT_MS = 30 * 86_400_000

// The brief's 'Crediting subagent time': an agent naming one of this plan's steps credits it alone. Any other slice
// is overhead while an agent built a named step during it, else split among the running steps, else overhead while
// the plan is begun and not finished. The caller passes only a plan that runs this session.
export function targetsOf(name: string, plan: Plan, loop: NamedStep | null, isAgentBuilt: boolean): CloseTarget {
  if (loop !== null && loop.plan === name && plan.steps.some(step => step.id === loop.task)) return { steps: [loop.task as string], isShared: false }
  if (isAgentBuilt) return 'overhead'
  const running = plan.steps.filter(step => step.status === 'in_progress').map(step => step.id)
  if (running.length > 0) return { steps: running, isShared: running.length > 1 }
  const isBegun = plan.steps.some(step => step.status !== 'pending')
  return isBegun && !plan.steps.every(isFinishedStep) ? 'overhead' : null
}

// A slice's working time: its age less the waits settled in it and the part of each open wait (`waits`, by call id,
// with its start) that falls inside it
export function sliceMs(slice: Slice, now: number): number {
  const open = Object.values(slice.openWaits ?? {}).reduce((total, start) => total + Math.max(0, now - Math.max(start, slice.openedAt)), 0)
  return Math.max(0, now - slice.openedAt - slice.waitMs - open)
}

// A call that is all wait: AskUserQuestion, and an Agent call the main loop waits inside, whose agent's own turns
// count for themselves
export const isAllWait = (tool: string, isMain: boolean): boolean => tool === 'AskUserQuestion' || (isMain && tool === 'Agent')

// For `update`: an all-wait call opens on its loop's slice, so a close while it runs leaves it out
export function openWait(credit: Credit, loop: string, id: string, at: number): Credit {
  const slice = credit.slices[loop]
  return slice === undefined ? credit : { ...credit, slices: { ...credit.slices, [loop]: { ...slice, openWaits: { ...slice.openWaits, [id]: at } } } }
}

// For `update`: the call settles, and the part of it inside the slice now open becomes settled wait; null when its
// slice holds no such open wait, as when the slice opened after the call began
export function closeWait(credit: Credit, loop: string, id: string, now: number): Credit | null {
  const slice = credit.slices[loop]
  const start = slice?.openWaits?.[id]
  if (slice === undefined || start === undefined) return null
  const waits = Object.fromEntries(Object.entries(slice.openWaits ?? {}).filter(([key]) => key !== id))
  return { ...credit, slices: { ...credit.slices, [loop]: { ...slice, openWaits: waits, waitMs: slice.waitMs + Math.max(0, now - Math.max(start, slice.openedAt)) } } }
}

export const stepKey = (name: string, step: string, session: string): string => `step:${name}:${step}:${session}`
export const overheadKey = (name: string, session: string): string => `overhead:${name}:${session}`

const msOf = (value: unknown): number | null =>
  typeof value === 'object' && value !== null && typeof (value as { ms?: unknown }).ms === 'number' && Number.isFinite((value as { ms: number }).ms)
    ? (value as { ms: number }).ms
    : null

// Every session's time for one plan
export function sumTimes(entries: CostEntries, name: string): { times: Record<string, StepTime>; overhead: number } {
  const times: Record<string, StepTime> = {}
  let overhead = 0
  for (const [key, value] of Object.entries(entries)) {
    const ms = msOf(value)
    if (ms === null) continue
    if (key.startsWith(`overhead:${name}:`)) overhead += ms
    else if (key.startsWith(`step:${name}:`)) {
      const rest = key.slice(`step:${name}:`.length)
      const step = rest.slice(0, rest.lastIndexOf(':'))
      if (step === '') continue
      const isShared = (value as { isShared?: unknown }).isShared === true
      times[step] = { ms: (times[step]?.ms ?? 0) + ms, isShared: (times[step]?.isShared ?? false) || isShared }
    }
  }
  return { times, overhead }
}

// Step and overhead keys no session has written for 30 days
export function staleKeys(entries: CostEntries, now: number): string[] {
  return Object.entries(entries)
    .filter(([key, value]) => (key.startsWith('step:') || key.startsWith('overhead:'))
      && typeof (value as { at?: unknown } | null)?.at === 'number' && (value as { at: number }).at < now - KEPT_MS)
    .map(([key]) => key)
}

// For `update`'s change function, so it stays pure: each named loop still open gives its span, split among its keys
// into this session's totals; its slice ends, or with `reopen` starts over at `now` keeping its marks. A slice another
// closer took first gives nothing, so a span is never counted twice.
export function closeSlices(before: Credit, closes: SliceClose[], now: number, reopen: boolean): { credit: Credit; spans: Record<string, number> } {
  const slices = { ...before.slices }
  const mine = { ...before.sessionTimes }
  const spans: Record<string, number> = {}
  for (const close of closes) {
    const slice = slices[close.loop]
    if (slice === undefined) continue
    const ms = sliceMs(slice, now)
    spans[close.loop] = (spans[close.loop] ?? 0) + ms
    for (const key of close.keys) {
      const had = mine[key]
      mine[key] = { ms: (had?.ms ?? 0) + ms / close.keys.length, isShared: (had?.isShared ?? false) || close.isShared }
    }
    if (reopen) slices[close.loop] = { openedAt: now, waitMs: 0, namedSteps: slice.namedSteps, ...(slice.openWaits === undefined ? {} : { openWaits: slice.openWaits }) }
    else delete slices[close.loop]
  }
  return { credit: { slices, sessionTimes: mine }, spans }
}

// What each key would take if every open slice closed now, for a drawing; no slice closes
export function liveSpans(credit: Credit, closes: SliceClose[], now: number): Record<string, number> {
  const spans: Record<string, number> = {}
  for (const close of closes) {
    const slice = credit.slices[close.loop]
    if (slice === undefined) continue
    const ms = sliceMs(slice, now)
    for (const key of close.keys) spans[key] = (spans[key] ?? 0) + ms / close.keys.length
  }
  return spans
}


// Phase 0 answer 11: a call the person was asked about waited its time less the tool's own `duration_ms`, or all of it
// when declined, as a declined call has none; null while its `duration_ms` has yet to arrive. An all-wait call waited
// all of it.
export function waitMsOf(call: CallWait): number | null {
  if (isAllWait(call.tool, call.isMain)) return call.ms
  if (!call.isAsked) return 0
  if (call.outcome === 'denied') return call.ms
  return call.durationMs === null ? null : Math.max(0, call.ms - call.durationMs)
}

// A session resumed under its own id starts its totals from what it stored before
export function sessionTimesOf(entries: CostEntries, session: string): Record<string, StepTime> {
  const mine: Record<string, StepTime> = {}
  for (const [key, value] of Object.entries(entries)) {
    const ms = msOf(value)
    if (ms === null || !key.endsWith(`:${session}`) || !(key.startsWith('step:') || key.startsWith('overhead:'))) continue
    mine[key] = { ms, isShared: (value as { isShared?: unknown }).isShared === true }
  }
  return mine
}

// The keys one loop's span goes to (Decision 9). `lines`: an agent's plan and task lines, null for the main loop,
// undefined for an agent whose spawn was never seen, whose span goes nowhere. `shown`: the plan the Plan tab shows.
export function closeTargetOf(loop: string, slice: Slice, lines: NamedStep | null | undefined, files: Watched<Plan>[], since: number | null, shown: Watched<Plan> | null, session: string): SliceClose {
  const none: SliceClose = { loop, keys: [], isShared: false }
  if (lines === undefined) return none
  if (lines !== null && lines.plan !== null && lines.task !== null) {
    const named = files.find(file => file.name === lines.plan)
    if (named?.value != null && isPlanRunning(named, since) && named.value.steps.some(step => step.id === lines.task)) {
      return { loop, keys: [stepKey(named.name, lines.task, session)], isShared: false }
    }
  }
  if (shown === null || shown.value === null || !isPlanRunning(shown, since)) return none
  const plan = shown.value
  const isAgentBuilt = slice.namedSteps.some(mark => plan.steps.some(step => mark === `${shown.name}:${step.id}`))
  const target = targetsOf(shown.name, plan, lines, isAgentBuilt)
  if (target === null) return none
  if (target === 'overhead') return { loop, keys: [overheadKey(shown.name, session)], isShared: false }
  return { loop, keys: target.steps.map(step => stepKey(shown.name, step, session)), isShared: target.isShared }
}
