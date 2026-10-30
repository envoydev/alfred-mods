// The session-inspector hooks module. Every hook observes and draws; none approves, denies or rewrites a tool call.
// Every $.state atom is made, read and updated here alone: `claude plugin validate` refuses an atom or a ref
// imported from another module.
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface, Register, SessionRateLimit, SessionUsage, Timer, TurnStepInput, TurnStepResult, UiOpenResult,
} from 'claude-code'

import { actionOf, isLive, newRow, refreshAgents, statusAt, upsertSpawn } from './agents.ts'
import { bandLines, spinnerSuffix } from './band.ts'
import {
  addRequest, afterCompact, billingOf, cacheView, idleOf, minutes, needsTick, pinOf, takeRate, takeSwitch, toastAt,
} from './cache.ts'
import { baseCost, pruneCost, recordCost, todayUsd } from './cost.ts'
import { drawLines, drawWithInput } from './draw.tsx'
import { clock, fingerprint, mins, oneLine, printable, tokens, usd, when } from './format.ts'
import { mask, maskForFile, maskSpans, recLevel, setRec, toast } from './mask.ts'
import { maskDeep, maskDialog, maskResult, resultLines } from './sites.ts'
import { DROPS_RESULT, callLine, emptyPreview, groupLines } from './compact.ts'
import type { CompactCall } from './compact.ts'
import {
  FOREIGN, HANDOFF_PATH, HANDOFF_USAGE, MARKER, RESUME_PROMPT, THRESHOLD_REFUSED, TOASTS, gitPart, handoffText, isThreshold, nextStep, parseSettings,
  parseStatus, percentOf, statusPath, stepUnder, stepsOf, windowThreshold,
} from './handoff.ts'
import type { HandoffView, PlanPart, SaveInput, ScoresPart } from './handoff.ts'
import { NO_FILE, STACK_TOASTS, UNREADABLE, bannerSegs, fillReady, fillToast, parseStack, runwayOf } from './stack.ts'
import type { Runway } from './stack.ts'
import { creditedPlan, isFinishedStep, parsePlan, parseScores, planView, runs, scoresView, shownPlan, taskView, tasksAfter } from './plan.ts'
import type { PlanView, ScoresView } from './plan.ts'
import { PLANS_DIR, SCORES_DIR, readFolder } from './planfiles.ts'
import { planLines, scoresLabel } from './planlines.ts'
import { closeOf, closeSlices, closeWait, isAllWait, liveSpans, mineOf, openWait, overheadKey, sliceMs, staleKeys, stepKey, sumTimes, waitOf } from './steptime.ts'
import type { Close } from './steptime.ts'
import { agentsLines, cacheLines, nowLines, tabBar, timelineLines, toolsLines, usageLines } from './tabs.ts'
import { classify, fold, targetOf, toolKey } from './outcome.ts'
import { LEVELS, REC_HELP, addWord, parseLevel, parseWords, recNote, recPaneLines, recStatus, recTest } from './rec.ts'
import type { CallFacts } from './outcome.ts'
import type {
  AgentRow, Cache, CacheConfig, Credit, Failure, Handoff, Live, Meta, Outcome, Pace, Plan, PlanChange, Level, Plans, Quiet, RecState, SaveResult, Scores, Stack, Tab, TaskItem, ToolStat, Totals, Turn, Usage, View,
  Watched, Window,
} from '../types'

// What the events said about one call. Never drawn, so a reload losing the calls in flight costs only those.
// `pendingMs`: a call the person was asked about, settled before its `duration_ms` arrived, waits for it.
type Call = {
  facts: CallFacts; key: string; tool: string; target: string; agentId: string | null
  settled: boolean; outcome: Outcome | null; rowId: string | null
  startedAt: number | null; durationMs: number | null; pendingMs: number | null
}

// What outlives one hook but is no $.state value: the cache's toast timer, a [Compact] in flight, the compactions the
// mod's own hook counted, whether the session started in the terminal's REPL, which only session.start says and
// /clear does not repeat, the plan folders' next read and the read running, one at a time, and the step-time writes,
// in order
type Held = {
  close: Timer | null; compacting: boolean; counted: number; isTerminal: boolean; reload: Timer | null; reading: Promise<void>
  writes: Promise<void>
}

const INITIAL = {
  stats: {} as Record<string, ToolStat>,
  failures: [] as Failure[],
  turns: [] as Turn[],
  live: { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null } as Live,
  usage: {
    tokens: null, window: null, percent: null, startedAt: null, windows: [], costUsd: null, todayUsd: null, at: 0,
  } as Usage,
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 } as Totals,
  meta: {
    model: null, effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0,
    waiting: [], mainCalls: 0,
  } as Meta,
  view: { tab: 'now', shown: [], planSlug: null } as View,
  pace: {} as Pace,
  agents: [] as AgentRow[],
  cache: {
    tier: null, tierAt: null, tierBilling: null,
    config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
    ratePerToken: null, rateModel: null, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 }, toastedFor: null,
  } as Cache,
  plans: { plans: [], scores: [], times: {}, overhead: {}, finished: {}, toasted: [], since: null } as Plans,
  credit: { slices: {}, mine: {} } as Credit,
  tasks: [] as TaskItem[],
  rec: { level: 'off', count: 0, note: null } as RecState,
  quiet: { isOn: false } as Quiet,
  handoff: {
    mode: 'ask', threshold: 80, point: null, handled: null, isAskUp: false, lastSave: null, alfred: { state: 'none', reason: null },
  } as Handoff,
  stack: {
    state: 'none', reason: null, fullContext: null, model: null, window: null, resumeAt: null, noOffer: false, autoRun: null, scorer: null,
    hasPrompt: false, updatedAt: null, readAt: null, ignored: [],
  } as Stack,
}

// Change a tag when that value's fields change: it declines what an earlier version stored, which outlives a reload.
const stats = atom({ plugin: 'session-inspector', key: 'stats' } as const, INITIAL.stats, { shape: 'stats-1' })
const failures = atom({ plugin: 'session-inspector', key: 'failures' } as const, INITIAL.failures, { shape: 'failures-1' })
const turns = atom({ plugin: 'session-inspector', key: 'turns' } as const, INITIAL.turns, { shape: 'turns-1' })
const live = atom({ plugin: 'session-inspector', key: 'live' } as const, INITIAL.live, { shape: 'live-3' })
const usage = atom({ plugin: 'session-inspector', key: 'usage' } as const, INITIAL.usage, { shape: 'usage-1' })
const totals = atom({ plugin: 'session-inspector', key: 'totals' } as const, INITIAL.totals, { shape: 'totals-1' })
const meta = atom({ plugin: 'session-inspector', key: 'meta' } as const, INITIAL.meta, { shape: 'meta-3' })
const view = atom({ plugin: 'session-inspector', key: 'view' } as const, INITIAL.view, { shape: 'view-3' })
const pace = atom({ plugin: 'session-inspector', key: 'pace' } as const, INITIAL.pace, { shape: 'pace-1' })
const agents = atom({ plugin: 'session-inspector', key: 'agents' } as const, INITIAL.agents, { shape: 'agents-2' })
const cache = atom({ plugin: 'session-inspector', key: 'cache' } as const, INITIAL.cache, { shape: 'cache-1' })
const tick = atom({ plugin: 'session-inspector', key: 'tick' } as const, 0)
const plans = atom({ plugin: 'session-inspector', key: 'plans' } as const, INITIAL.plans, { shape: 'plans-1' })
const credit = atom({ plugin: 'session-inspector', key: 'credit' } as const, INITIAL.credit, { shape: 'credit-1' })
const tasks = atom({ plugin: 'session-inspector', key: 'tasks' } as const, INITIAL.tasks, { shape: 'tasks-1' })
const rec = atom({ plugin: 'session-inspector', key: 'rec' } as const, INITIAL.rec, { shape: 'rec-1' })
const quiet = atom({ plugin: 'session-inspector', key: 'quiet' } as const, INITIAL.quiet, { shape: 'quiet-1' })
const handoff = atom({ plugin: 'session-inspector', key: 'handoff' } as const, INITIAL.handoff, { shape: 'handoff-1' })
const stack = atom({ plugin: 'session-inspector', key: 'stack' } as const, INITIAL.stack, { shape: 'stack-1' })

const NO_FACTS: Omit<CallFacts, 'tool'> = {
  checked: null, checkReason: null, asked: false, failedInTool: false, interrupted: false, classifierReason: null, hookDeny: null, result: null,
}

function tally(stat: ToolStat | undefined, outcome: Outcome, by: 1 | -1): ToolStat {
  const t = stat ?? { calls: 0, ok: 0, failed: 0, stopped: 0 }
  return {
    calls: t.calls + by,
    ok: t.ok + (outcome === 'ok' ? by : 0),
    failed: t.failed + (outcome === 'error' ? by : 0),
    stopped: t.stopped + (outcome === 'ok' || outcome === 'error' ? 0 : by),
  }
}

// Calls of the main loop, and of agents whose spawn was seen; anything else is not counted
async function isCounted($: EngineInterface, agentId: string | undefined): Promise<boolean> {
  return agentId === undefined || (await read($, agents)).some(r => r.id === agentId)
}

// Changes the row of an agent whose spawn was seen; an unknown id writes nothing
async function updateRow($: EngineInterface, id: string, fn: (r: AgentRow) => AgentRow): Promise<void> {
  if (!(await read($, agents)).some(r => r.id === id)) return
  await update($, agents, rows => rows.map(r => (r.id === id ? fn(r) : r)))
}

// Whether the person sees the pane now, from the engine's record: it outlives a /clear and a reload, and knows a
// pane placed after it waited undrawn
async function isPaneShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === 'inspect' && p.isShown && p.isPlaced)
}

// A failure row for a call that was not ok; it is seen at once while the pane shows Now or Tools
async function addRow($: EngineInterface, id: string, call: Call, outcome: Exclude<Outcome, 'ok'>, reason: string, isNew: boolean, drop: string | null): Promise<void> {
  const { tab } = await read($, view)
  const isSeen = (tab === 'now' || tab === 'tools') && await isPaneShown($)
  const result = call.facts.result
  const row: Failure = {
    id, at: await $.clock.now(), tool: call.tool, target: call.target, outcome, reason,
    detail: (result?.deny ?? result?.text ?? '').slice(0, 4000), count: 1, isNew: isNew && !isSeen,
  }
  await update($, failures, list => {
    const i = drop === null ? -1 : list.findIndex(f => f.id === drop)
    const old = list[i]
    const rest = old === undefined ? list
      : old.count > 1 ? list.map(f => (f === old ? { ...f, count: f.count - 1 } : f))
      : list.filter(f => f !== old)
    const out = fold(rest, row)
    call.rowId = out[out.length - 1]?.id ?? null
    return out
  })
}

// Compact rows' memory (Decisions 4 and 7): each settled call's outcome and reason, and the calls of a group the mod
// unfolded, by call id, each the last 500. A reload empties both: a blocked call then draws ✗.
const compactMem = { outcomes: new Map<string, { outcome: Outcome; reason: string }>(), marks: new Set<string>() }

function keepLast<K>(items: Map<K, unknown> | Set<K>, limit = 500): void {
  for (const k of items.keys()) {
    if (items.size <= limit) return
    items.delete(k)
  }
}

function mark(ids: string[]): void {
  for (const id of ids) {
    compactMem.marks.delete(id)
    compactMem.marks.add(id)
  }
  keepLast(compactMem.marks)
}

// A row's or a group call's facts as a compact row reads them; a refusal draws as a block
function compactOf(id: string | undefined, c: { tool: string; input: unknown; output?: unknown; isErrored: boolean; isInterrupted: boolean }): CompactCall {
  const o = id === undefined ? undefined : compactMem.outcomes.get(id)
  const outcome = o?.outcome === 'denied' ? 'denied' : o?.outcome === 'blocked' || o?.outcome === 'refused' ? 'blocked' : null
  return { tool: c.tool, input: c.input, output: c.output, isErrored: c.isErrored, isInterrupted: c.isInterrupted, outcome, reason: outcome === null ? null : o?.reason ?? null }
}

// Counts a settled call, or counts it again when a later event changed its outcome
async function settle($: EngineInterface, id: string, call: Call): Promise<void> {
  const { outcome, reason, isNew } = classify(call.facts)
  compactMem.outcomes.delete(id)
  compactMem.outcomes.set(id, { outcome, reason })
  keepLast(compactMem.outcomes)
  const before = call.outcome
  call.settled = true
  call.outcome = outcome
  const retally = (s: Record<string, ToolStat>): Record<string, ToolStat> =>
    ({ ...s, [call.key]: before === null ? tally(s[call.key], outcome, 1) : tally(tally(s[call.key], before, -1), outcome, 1) })
  await update($, stats, retally)
  if (call.agentId !== null) await updateRow($, call.agentId, r => ({ ...r, tools: retally(r.tools) }))
  if (outcome !== 'ok') await addRow($, id, call, outcome, reason, isNew, before !== null && before !== 'ok' ? call.rowId : null)
  const isMain = call.agentId === null
  const failed = (o: Outcome | null): number => (o !== null && o !== 'ok' ? 1 : 0)
  await update($, live, l => ({
    ...l,
    tools: isMain && l.turnId !== null && before === null ? l.tools + 1 : l.tools,
    failures: isMain && l.turnId !== null ? l.failures + failed(outcome) - failed(before) : l.failures,
    running: l.running.filter(r => r.id !== id),
  }))
  if (isMain && before === null) await update($, meta, m => ({ ...m, mainCalls: m.mainCalls + 1 }))
}

const windowsOf = (limits: readonly SessionRateLimit[]): Window[] =>
  limits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null }))

// The status line's figures now; today's cost is the store's, so it is only replaced when given
async function takeUsage($: EngineInterface, today?: number | null): Promise<SessionUsage> {
  const reading = await $.session.usage()
  const at = await $.clock.now()
  await update($, usage, u => ({
    tokens: reading.context.tokens ?? null, window: reading.context.window, percent: reading.context.percent ?? null,
    startedAt: reading.startedAt, windows: windowsOf(reading.rateLimits), costUsd: reading.cost?.usd ?? null,
    todayUsd: today === undefined ? u.todayUsd : today, at,
  }))
  return reading
}

// A session first seen now takes its cost so far as the baseline: spend a /clear or a resume carries over
async function baseline($: EngineInterface, reading: SessionUsage): Promise<void> {
  if (reading.cost !== undefined) await baseCost($, await $.session.id(), reading.cost.usd, await $.clock.now())
}

// Once a second: the engine's list moves the live agent rows, and the clocks on screen redraw while anything runs
async function tickOnce($: EngineInterface): Promise<void> {
  const rows = await read($, agents)
  const anyLive = rows.some(r => isLive(r.status))
  const now = await $.clock.now()
  if (anyLive) {
    const listed = await $.agent.list()
    if (JSON.stringify(refreshAgents(rows, listed, now)) !== JSON.stringify(rows)) {
      await update($, agents, current => refreshAgents(current, listed, now))
    }
  }
  const isWarm = needsTick(await read($, cache), billingOf((await read($, usage)).windows), now)
  if (anyLive || isWarm || (await read($, live)).turnId !== null) await update($, tick, n => n + 1)
}

// The variables and settings that pin the cache's tier or turn idle compaction off, written only on a change
async function readCacheConfig($: EngineInterface, held: Held): Promise<void> {
  const config: CacheConfig = {
    pin: pinOf({
      force5m: await $.env.get('FORCE_PROMPT_CACHING_5M'),
      ttl: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      setting: await $.settings.read({ key: 'promptCacheTtl' }),
      enable1h: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    }),
    ...idleOf({
      idleCompaction: await $.settings.read({ key: 'idleCompaction' }),
      autoCompactEnabled: await $.settings.read({ key: 'autoCompactEnabled' }),
      disableAutoCompact: await $.env.get('DISABLE_AUTO_COMPACT'),
      minTokens: await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'),
    }),
    isTerminal: held.isTerminal,
  }
  if (JSON.stringify((await read($, cache)).config) !== JSON.stringify(config)) await update($, cache, c => ({ ...c, config }))
}

// Sets the toast's timer afresh: due 5 minutes before a 1h cache goes cold, or 3 where Claude Code should compact it
// itself first
async function armCacheClose($: EngineInterface, held: Held): Promise<void> {
  held.close?.cancel()
  held.close = null
  const c = await read($, cache)
  const u = await read($, usage)
  const at = toastAt(c, billingOf(u.windows), u.tokens)
  if (at === null) return
  const now = await $.clock.now()
  held.close = $.clock.after(Math.max(0, at - now), () => {
    cacheClose($).catch(() => undefined)
  })
}

// The toast, once per warm stretch, while the main loop is idle and the cache is still 1h and warm by then; a
// compaction of Claude Code's own has made it cold
async function cacheClose($: EngineInterface): Promise<void> {
  const c = await read($, cache)
  const u = await read($, usage)
  const v = cacheView(c, billingOf(u.windows), await $.clock.now(), u.tokens)
  if (v.tier.tier !== '1h' || !v.isClosing || c.toastedFor === c.lastAt) return
  if ((await read($, live)).turnId !== null) return
  const rewrite = v.rewriteUsd === null ? '' : ` (rewrite ≈ ${usd(v.rewriteUsd)})`
  toast($, `Cache cold in ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs ?? 0)}${rewrite}: press 3 to compact, or /inspect cache`)
  const lastAt = c.lastAt
  await update($, cache, x => ({ ...x, toastedFor: lastAt }))
}

// An agent's step: its model and effort, and its context as the sum the engine's own `context_tokens` uses
async function agentStep($: EngineInterface, e: TurnStepInput, step: TurnStepResult): Promise<void> {
  const u = step.usage
  await updateRow($, e.agentId ?? '', r => ({
    ...r, model: e.model, effort: e.effort === undefined ? r.effort : String(e.effort),
    contextTokens: u === null ? r.contextTokens : u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens,
  }))
}

async function resetAll($: EngineInterface): Promise<void> {
  await update($, stats, () => INITIAL.stats)
  await update($, failures, () => INITIAL.failures)
  await update($, turns, () => INITIAL.turns)
  await update($, live, () => INITIAL.live)
  await update($, usage, () => INITIAL.usage)
  await update($, totals, () => INITIAL.totals)
  await update($, meta, () => INITIAL.meta)
  await update($, view, () => INITIAL.view)
  await update($, pace, () => INITIAL.pace)
  await update($, agents, () => INITIAL.agents)
  await update($, cache, () => INITIAL.cache)
  await update($, tick, () => 0)
  await update($, plans, () => INITIAL.plans)
  await update($, credit, () => INITIAL.credit)
  await update($, tasks, () => INITIAL.tasks)
  await update($, rec, () => INITIAL.rec)
  await update($, quiet, () => INITIAL.quiet)
  await update($, handoff, () => INITIAL.handoff)
  await update($, stack, () => INITIAL.stack)
}

// Every session's step and overhead time in the store; this session's own totals are the credit atom's
async function storedTimes($: EngineInterface): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('step:') || key.startsWith('overhead:')) entries[key] = await $.store.get(key)
  }
  return entries
}

// Each plan's time: every other session's from the store, this session's from its own totals
async function timesOf($: EngineInterface, files: Watched<Plan>[]): Promise<Pick<Plans, 'times' | 'overhead'>> {
  const entries = { ...(await storedTimes($)), ...(await read($, credit)).mine }
  const times: Plans['times'] = {}
  const overhead: Plans['overhead'] = {}
  for (const w of files) {
    const sum = sumTimes(entries, w.name)
    times[w.name] = sum.times
    overhead[w.name] = sum.overhead
  }
  return { times, overhead }
}

const statusesOfTasks = (items: TaskItem[]): string => JSON.stringify(items.map(t => [t.id, t.status]))

const statusesOf = (files: Watched<Plan>[]): string =>
  JSON.stringify(files.map(w => [w.name, w.value?.steps.map(s => [s.id, s.status]) ?? null]))

// The loops named (every open one when null) close at `now`: each span goes to its keys (Decision 9) in one update,
// so a span two closers race for counts once. This session's totals are then stored whole, in order.
async function closeLoops($: EngineInterface, held: Held, loops: string[] | null, now: number, reopen: boolean, given?: Plans): Promise<void> {
  const c = await read($, credit)
  const open = Object.keys(c.slices).filter(loop => loops === null || loops.includes(loop))
  if (open.length === 0) return
  const p = given ?? await read($, plans)
  const rows = await read($, agents)
  const shown = creditedPlan(p, (await read($, view)).planSlug, (await read($, tasks)).length > 0)
  const closes = await closesOf($, c, open, p, shown)
  let spans: Record<string, number> = {}
  const after = await update($, credit, cur => {
    const closed = closeSlices(cur, closes, now, reopen)
    spans = closed.spans
    return closed.credit
  })
  // With the task list shown, the main loop's span and those of agents whose spawn was seen go to its running items
  if (shown === 'tasks') {
    const ms = Object.entries(spans).filter(([loop]) => loop === 'main' || rows.some(r => r.id === loop)).reduce((n, [, x]) => n + x, 0)
    const running = (await read($, tasks)).filter(t => t.status === 'in_progress').length
    if (ms > 0 && running > 0) {
      await update($, tasks, list => {
        const n = list.filter(t => t.status === 'in_progress').length
        return n === 0 ? list : list.map(t => (t.status === 'in_progress' ? { ...t, ms: t.ms + ms / n } : t))
      })
    }
  }
  const keys = [...new Set(closes.flatMap(x => x.keys))]
  for (const key of keys) {
    const t = after.mine[key]
    if (t === undefined) continue
    const value = key.startsWith('overhead:') ? { ms: t.ms, at: now } : { ms: t.ms, isShared: t.isShared, at: now }
    held.writes = held.writes.then(() => $.store.set(key, value)).catch(() => undefined)
  }
  await held.writes
  if (keys.length === 0) return
  const files = (await read($, plans)).plans
  const sums = await timesOf($, files)
  await update($, plans, x => ({ ...x, ...sums }))
}

// Where each named open loop's span goes (Decision 9)
async function closesOf($: EngineInterface, c: Credit, loops: string[], p: Plans, shown: Watched<Plan> | 'tasks' | null): Promise<Close[]> {
  const rows = await read($, agents)
  const session = await $.session.id()
  return loops.map(loop => {
    const row = rows.find(r => r.id === loop)
    const lines = loop === 'main' ? null : row === undefined ? undefined : { plan: row.plan, task: row.task }
    const slice = c.slices[loop] ?? { at: 0, waitMs: 0, named: [] }
    return closeOf(loop, slice, lines, p.plans, p.since, shown === 'tasks' ? null : shown, session)
  })
}

// The open slices' time so far, by step id (or task id) and as overhead, for the shown plan or task list to draw
async function liveOf($: EngineInterface, p: Plans, shown: Watched<Plan> | 'tasks' | null, now: number): Promise<{ steps: Record<string, number>; overhead: number }> {
  const c = await read($, credit)
  const loops = Object.keys(c.slices)
  if (loops.length === 0 || shown === null) return { steps: {}, overhead: 0 }
  if (shown === 'tasks') {
    const rows = await read($, agents)
    const ms = loops.filter(loop => loop === 'main' || rows.some(r => r.id === loop))
      .reduce((n, loop) => n + sliceMs(c.slices[loop] ?? { at: now, waitMs: 0, named: [] }, now), 0)
    const running = (await read($, tasks)).filter(t => t.status === 'in_progress')
    return { steps: Object.fromEntries(running.map(t => [t.id, ms / running.length])), overhead: 0 }
  }
  const spans = liveSpans(c, await closesOf($, c, loops, p, shown), now)
  const session = await $.session.id()
  const steps: Record<string, number> = {}
  for (const s of shown.value?.steps ?? []) {
    const ms = spans[stepKey(shown.name, s.id, session)]
    if (ms !== undefined) steps[s.id] = ms
  }
  return { steps, overhead: spans[overheadKey(shown.name, session)] ?? 0 }
}

const FINISH_SHOWN_MS = 10 * 60_000

// What the band and the Plan tab draw of the plans (Decisions 5, 7, 18): the tab the shown plan or task list, the
// band the one this session's time goes to, only while it runs or for 10 minutes after it finished this session;
// their scores, else the newest; the rest
type PlanDraw = {
  shown: PlanView | null; band: PlanView | null; invalid: boolean; scores: ScoresView | null; score: ScoresView | null
  others: string[]; otherScores: string[]; updatedAt: number | null
}

async function planDraw($: EngineInterface, now: number): Promise<PlanDraw> {
  const p = await read($, plans)
  const items = await read($, tasks)
  const pinned = (await read($, view)).planSlug
  const shown = shownPlan(p, pinned, items.length > 0)
  const credited = creditedPlan(p, pinned, items.length > 0)
  const tab = await drawnPlan($, p, items, shown, now)
  const band = credited === shown ? tab : await drawnPlan($, p, items, credited, now)
  const nameOf = (w: Watched<Plan> | 'tasks' | null): string | null => (w === null || w === 'tasks' ? null : w.name)
  const name = nameOf(shown)
  const scored = p.scores.filter((w): w is Watched<Scores> & { value: Scores } => w.value !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const ownOf = (n: string | null) => (n === null ? undefined : scored.find(w => w.value.subject.kind === 'plan' && w.value.subject.ref === n))
  const full = name === null ? scored[0] : ownOf(name)
  const newest = ownOf(nameOf(credited)) ?? scored[0]
  return {
    shown: tab.v, band: band.isRunning ? band.v : null, invalid: shown !== null && shown !== 'tasks' && shown.isInvalid,
    scores: full === undefined ? null : scoresView(full.value), score: newest === undefined ? null : scoresView(newest.value),
    others: p.plans.filter(w => w.name !== name).map(w => (w.value === null ? `${w.name} (invalid)` : w.name)).sort(),
    otherScores: scored.filter(w => w !== full).slice(0, 3).map(w => scoresLabel(w.name, w.value)),
    updatedAt: shown === null || shown === 'tasks' ? null : shown.value?.updatedAt ?? null,
  }
}

// One plan's view with its live time, and whether the band draws it
async function drawnPlan($: EngineInterface, p: Plans, items: TaskItem[], w: Watched<Plan> | 'tasks' | null, now: number): Promise<{ v: PlanView | null; isRunning: boolean }> {
  const live = await liveOf($, p, w, now)
  if (w === 'tasks') {
    return { v: taskView(items, live.steps), isRunning: items.some(t => t.status !== 'completed') && items.some(t => t.status !== 'pending') }
  }
  if (w === null || w.value === null) return { v: null, isRunning: false }
  const doneAt = p.finished[w.name]
  return {
    v: planView(w.value, p.times[w.name] ?? {}, (p.overhead[w.name] ?? 0) + live.overhead, live.steps, now),
    isRunning: runs(w, p.since) || (doneAt !== undefined && now - doneAt < FINISH_SHOWN_MS),
  }
}

// A loop's slice opens at its turn's start; the main slice marks each live agent that names a step
async function openSlice($: EngineInterface, loop: string, now: number): Promise<void> {
  const named = loop === 'main' ? (await read($, agents)).filter(r => isLive(r.status)).map(markOf).filter((m): m is string => m !== null) : []
  await update($, credit, c => ({ ...c, slices: { ...c.slices, [loop]: { at: now, waitMs: 0, named } } }))
}

const markOf = (r: AgentRow): string | null => (r.plan !== null && r.task !== null ? `${r.plan}:${r.task}` : null)

// An agent naming a step, spawned or starting a turn while the main loop's turn runs, makes that turn overhead
async function addMark($: EngineInterface, mark: string | null): Promise<void> {
  if (mark === null) return
  const main = (await read($, credit)).slices.main
  if (main === undefined || main.named.includes(mark)) return
  await update($, credit, c => {
    const m = c.slices.main
    return m === undefined || m.named.includes(mark) ? c : { ...c, slices: { ...c.slices, main: { ...m, named: [...m.named, mark] } } }
  })
}

// A wait known only once its call settles goes to the slice open now, at most that slice's age, so a slice reopened
// during the call never loses the work after the reopen
async function addWait($: EngineInterface, loop: string, ms: number, now: number): Promise<void> {
  if (ms <= 0 || (await read($, credit)).slices[loop] === undefined) return
  await update($, credit, c => {
    const s = c.slices[loop]
    return s === undefined ? c : { ...c, slices: { ...c.slices, [loop]: { ...s, waitMs: s.waitMs + Math.min(ms, Math.max(0, now - s.at)) } } }
  })
}

// A session resumed under its own id starts from its stored totals, so its first close adds to them
async function seedMine($: EngineInterface): Promise<void> {
  if (Object.keys((await read($, credit)).mine).length > 0) return
  const mine = mineOf(await storedTimes($), await $.session.id())
  if (Object.keys(mine).length > 0) await update($, credit, c => ({ ...c, mine: { ...mine, ...c.mine } }))
}

// The plan and scores folders read again. A step whose status changed closes and reopens the open slices first, so
// the time before the change goes to the steps that were running then. A note the file's previous good parse this
// session lacks, and a plan that finishes this session (its previous good parse unfinished), raise their toasts once.
async function reloadPlans($: EngineInterface, held: Held): Promise<void> {
  const before = await read($, plans)
  const planFiles = await readFolder($, PLANS_DIR, before.plans, parsePlan)
  const scoreFiles = await readFolder($, SCORES_DIR, before.scores, parseScores)
  const now = await $.clock.now()
  if (statusesOf(before.plans) !== statusesOf(planFiles)) await closeLoops($, held, null, now, true, before)
  const { times, overhead } = await timesOf($, planFiles)
  const seen = new Set(before.toasted)
  const finished: Record<string, number> = {}
  const due: string[] = []
  for (const w of planFiles) {
    const plan = w.value
    if (plan === null || w.isInvalid) continue
    const had = before.plans.find(b => b.name === w.name)?.value ?? null
    if (had !== null) {
      for (const c of newNotes(had.changes, plan.changes)) due.push(`✎ Note folded into ${c.step ?? 'the plan'}: '${oneLine(c.note ?? '', 60)}'`)
    }
    const key = `done:${w.name}`
    if (!plan.steps.every(isFinishedStep) || seen.has(key)) continue
    seen.add(key)
    if (had !== null && !had.steps.every(isFinishedStep)) {
      finished[w.name] = now
      due.push(`Plan done: ${plan.title} in ${mins(planView(plan, times[w.name] ?? {}, overhead[w.name] ?? 0, {}, now).workedMs)}`)
    }
  }
  const toasted = [...seen].slice(-100)
  await update($, plans, p => ({ ...p, plans: planFiles, scores: scoreFiles, times, overhead, finished: { ...p.finished, ...finished }, toasted }))
  for (const text of due) toast($, text)
}

// The user's notes in `after` that `before` lacks, each counted by its time, step and text, so two alike are two
function newNotes(before: PlanChange[], after: PlanChange[]): PlanChange[] {
  const idOf = (c: PlanChange): string => JSON.stringify([c.at, c.step, c.note])
  const isNote = (c: PlanChange): boolean => c.kind === 'integrated' && c.source === 'user' && c.note !== null
  const left = new Map<string, number>()
  for (const c of before.filter(isNote)) left.set(idOf(c), (left.get(idOf(c)) ?? 0) + 1)
  return after.filter(isNote).filter(c => {
    const n = left.get(idOf(c)) ?? 0
    if (n > 0) left.set(idOf(c), n - 1)
    return n === 0
  })
}

// Reads run one at a time, so two never raise the same toast
function queueReload($: EngineInterface, held: Held): void {
  held.reading = held.reading.then(() => reloadPlans($, held)).catch(() => undefined)
}

// The folders are read 300 ms after a file edit settles and after each main turn, never inside the hook
function scheduleReload($: EngineInterface, held: Held): void {
  held.reload?.cancel()
  held.reload = $.clock.after(300, () => {
    held.reload = null
    queueReload($, held)
  })
}

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// Appends each window's reading while its reset is unchanged; a new reset starts it over. Returns the toasts due:
// the highest of 75 and 90 that the 5h or weekly window crossed upward since its last reading, once per window.
async function trackPace($: EngineInterface, limits: readonly SessionRateLimit[], now: number): Promise<string[]> {
  let due: string[] = []
  await update($, pace, p => {
    due = []
    const out = { ...p }
    for (const w of limits) {
      const resetsAt = w.resetsAt ?? null
      const prev = p[w.kind]
      const same = prev !== undefined && prev.resetsAt === resetsAt
      const points = same ? prev.points : []
      const toasted = same ? prev.toasted : []
      const last = points[points.length - 1]
      const marks = LABEL[w.kind] !== undefined && last !== undefined
        ? [75, 90].filter(m => last.percent < m && w.percentUsed >= m && !toasted.includes(m))
        : []
      if (marks.length > 0) {
        const reset = resetsAt === null ? NaN : Date.parse(resetsAt)
        due.push(`${LABEL[w.kind]} limit at ${Math.max(...marks)}%, resets ${Number.isNaN(reset) ? 'later' : when(reset)}`)
      }
      out[w.kind] = { resetsAt, points: [...points, { at: now, percent: w.percentUsed }].slice(-20), toasted: [...toasted, ...marks] }
    }
    return out
  })
  return due
}

// The main loop's turn ends: it joins the timeline, the live counts start over, and today's cost is brought up
async function endTurn($: EngineInterface, turnId: string, durationMs: number, end: Turn['end'], used: { tokensIn: number; tokensOut: number }): Promise<void> {
  const reading = await $.session.usage()
  const now = await $.clock.now()
  const before = await read($, meta)
  const counts = await read($, live)
  await update($, turns, list => {
    const turn: Turn = {
      n: before.turnCount + 1, turnId, promptAt: counts.promptAt,
      replyAt: now, durationMs, ...used, tools: counts.tools, failures: counts.failures,
      contextPercent: reading.context.percent ?? null, end,
    }
    return [...list, turn].slice(-50)
  })
  await update($, meta, m => ({ ...m, lastReplyAt: now, turnCount: m.turnCount + 1 }))
  await update($, live, () => INITIAL.live)
  if (reading.cost !== undefined) await recordCost($, await $.session.id(), reading.cost.usd, now)
  await takeUsage($, reading.cost !== undefined ? await todayUsd($, now) : undefined)
}

// Opens the pane on a tab. The failures it shows are seen once a surface draws it, never while it waits undrawn.
// The open starts before the first await: a Button's press counts as the person's only while its closure runs.
async function openInspect($: EngineInterface, tab: Tab): Promise<UiOpenResult> {
  const opening = $.ui.open({ id: 'inspect', title: 'Inspect' })
  await update($, view, v => ({ ...v, tab }))
  const opened = await opening
  if (!opened.isPlaced) return opened
  if (tab === 'now' || tab === 'tools') {
    await update($, failures, list => (list.some(f => f.isNew) ? list.map(f => ({ ...f, isNew: false })) : list))
  }
  return opened
}

// The band's Inspect button: a pane the surface leaves undrawn says why
async function inspectFromBand($: EngineInterface): Promise<void> {
  const opened = await openInspect($, 'now')
  if (!opened.isPlaced) toast($, `Inspect pane not drawn: ${opened.reason}`)
}

async function toggleShown($: EngineInterface, id: string): Promise<void> {
  await update($, view, v => ({ ...v, shown: v.shown.includes(id) ? v.shown.filter(x => x !== id) : [...v.shown, id] }))
}

const TABS: Tab[] = ['now', 'usage', 'agents', 'tools', 'cache', 'timeline', 'plan']

// The REC level the model was last told of, in module memory: the person's next prompt carries the note while the
// level differs (Decision 11)
const noteMem = { told: 'off' as Level }

// A main-loop compaction that stands: counted, and the cache cold, as its cached prefix is gone; a compaction can drop
// REC's note from the history, so the next prompt carries it again
async function countCompaction($: EngineInterface, held: Held): Promise<void> {
  held.counted++
  if (recLevel() !== 'off') noteMem.told = 'off'
  // F8's next reading sets the handled step to the highest at or under it, so a compaction under the threshold re-arms
  handoffMem.rearm = true
  await update($, handoff, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
  const at = await $.clock.now()
  await update($, meta, m => ({ ...m, compactions: m.compactions + 1, lastCompactAt: at }))
  await update($, cache, afterCompact)
  await armCacheClose($, held)
}

// [Compact]: the call comes first, so the press counts as the person's. The compaction is counted once: by the mod's
// own session.compact hook when the call passes through it, else here, as a host may skip the calling plugin whole.
// A skip or a failure is said, and a second press while one runs starts none.
async function compactNow($: EngineInterface, held: Held): Promise<void> {
  if (held.compacting) {
    toast($, 'Compact is already running.')
    return
  }
  held.compacting = true
  const seen = held.counted
  try {
    const done = await $.session.compact()
    if (done.skip !== undefined) toast($, `Compact skipped: ${done.skip}`)
    else if (held.counted === seen) await countCompaction($, held)
  } catch (err) {
    toast($, `Compact did not run: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    held.compacting = false
  }
}

// REC's private words and the home folder, in module memory only: never in $.state, a log or a file
// `compiled` names the level, words and home mask.ts holds, which a reload starts over at off
const recMem = { words: [] as string[], home: null as string | null, compiled: JSON.stringify(['off', [], null]) }

// Each errored call's error text, the one Claude Code draws under it, by call id, the last 500: from the call's result,
// or from its row for a call the mod did not see run (a resumed transcript). Kept in memory only, for REC to mask.
const errorMem = new Map<string, string>()
// The errored calls whose row drew the masked error text itself, so their result block draws nothing, the last 500
const errorRows = new Set<string>()

function keepError(id: string, text: string): void {
  errorMem.delete(id)
  errorMem.set(id, text)
  keepLast(errorMem)
}

// The stored level and words into the masker and the rec atom: at the start, on the poll, after a /clear and after
// each change, so a word or a level set in one session reaches every session within 30 seconds
async function loadRec($: EngineInterface, note: string | null = null): Promise<void> {
  const level = parseLevel(await $.store.get('settings:rec'))
  const words = parseWords(await $.store.get('rec:words'))
  recMem.words = words
  // Recompiled and every site redrawn only on a change: a word swapped for another keeps the atom's count, and rows a
  // reload drew before this read were drawn at off
  const compiled = JSON.stringify([level, words, recMem.home])
  if (compiled !== recMem.compiled) {
    recMem.compiled = compiled
    setRec(level, words, recMem.home)
    $.ui.invalidate('ui.render')
  }
  await update($, rec, r => (r.level === level && r.count === words.length && r.note === note ? r : { level, count: words.length, note }))
}

// Whether a site masks: mask.ts's level, which a /clear, a resume or a fork leaves as it was while the atom is reset;
// the atom is read so the site redraws when REC changes
async function isRecOn($: EngineInterface): Promise<boolean> {
  await read($, rec)
  return recLevel() !== 'off'
}

// An add or a remove reads the stored words again, applies its one change and writes, so no stale copy is written back
async function addRecWord($: EngineInterface, raw: string): Promise<void> {
  const added = addWord(parseWords(await $.store.get('rec:words')), raw)
  if ('reason' in added) return loadRec($, added.reason)
  await $.store.set('rec:words', added.words)
  await loadRec($)
}

async function removeRecWord($: EngineInterface, word: string): Promise<void> {
  const words = parseWords(await $.store.get('rec:words'))
  await $.store.set('rec:words', words.filter(w => w.toLowerCase() !== word.toLowerCase()))
  await loadRec($)
}

const recOf = (r: RecState): { level: RecState['level']; words: number } => ({ level: r.level, words: r.count })

const OTHER_SESSIONS = 'Other open sessions follow within 30 s; run /rec in each one on screen.'

// /quiet's stored setting into the quiet atom, at the same points as REC's: only `true` is on
async function loadQuiet($: EngineInterface): Promise<boolean> {
  const isOn = (await $.store.get('settings:quiet')) === true
  await update($, quiet, q => (q.isOn === isOn ? q : { isOn }))
  return isOn
}

// F8's memory outside $.state: whether the stack stood F8 down, which outlives a /clear until a read of the new id's
// file says otherwise (the stack writes it in its own SessionStart hook, which may run after the mod's); whether a
// compaction re-arms the steps; the model and window the compaction point was read for; the save running, which a
// second request joins; the step the last save was made at, which c does not save again; and the last save's time,
// which arms the resume prompt and which a /clear does not reset
const handoffMem = {
  stoodDown: false, rearm: false, pointKey: null as string | null, saving: null as Promise<SaveResult> | null,
  savedStep: null as number | null, armedAt: null as number | null,
}

// Only ask mode keeps an ask up: a change to auto or off, here or polled from another session, takes it down
async function loadHandoff($: EngineInterface): Promise<void> {
  const s = parseSettings(await $.store.get('settings:handoff'))
  await update($, handoff, h => (h.mode === s.mode && h.threshold === s.threshold ? h : { ...h, ...s, isAskUp: s.mode === 'ask' && h.isAskUp }))
}

// The stack's resume prompt, in module memory only (Phase 5 spec 'Where values live'); `last`, the `stack` value the
// last read wrote, which a read inside `keepUntil` (10 s after a /clear, a resume or a fork) writes back when the new
// id has no file yet; `reading`, the read running, so reads never interleave; `reread`, the handler's one reread
const stackMem = {
  prompt: null as string | null, last: null as Stack | null, keepUntil: 0, reading: Promise.resolve(false) as Promise<boolean>,
  reread: null as Timer | null,
}

// Reads run one at a time; each resolves to whether the session's status file exists
function readStatus($: EngineInterface, keep = false): Promise<boolean> {
  const next = stackMem.reading.then(() => readStatusNow($, keep))
  stackMem.reading = next.catch(() => false)
  return next
}

// The stack's status file for this session, one read for both atoms. F8's stand-down (Decision 13): a missing or
// unreadable file is no file, unless `keep` or the window holds a stand-down across a /clear until a later read. The
// `stack` atom (Phase 5): no file, unreadable, ignored with Phase 4's reason, or used field by field.
async function readStatusNow($: EngineInterface, keep: boolean): Promise<boolean> {
  const id = await $.session.id()
  const path = statusPath(id)
  const now = await $.clock.now()
  const inWindow = keep || now < stackMem.keepUntil
  let exists = false
  let text: string | null = null
  if (path !== null) {
    try {
      exists = await $.fs.exists(path)
      if (exists) text = await $.fs.read(path)
    } catch {
      text = null
    }
  }
  await readStack($, { exists, text, id, now, inWindow })
  let found: ReturnType<typeof parseStatus> | null = text === null ? null : parseStatus(text, id)
  if (found === null && inWindow && handoffMem.stoodDown) found = { state: 'stood-down', reason: null }
  const wasStoodDown = handoffMem.stoodDown
  handoffMem.stoodDown = found?.state === 'stood-down'
  const alfred: Handoff['alfred'] = found === null || found.state === 'runs' ? { state: 'none', reason: null } : { state: found.state, reason: found.reason }
  await update($, handoff, h => {
    if (h.alfred.state === alfred.state && h.alfred.reason === alfred.reason) return h
    return { ...h, alfred, isAskUp: alfred.state === 'stood-down' ? false : h.isAskUp }
  })
  // A stand-down lifted by this read steps at the last reading, so the ask returns without waiting for a turn; a
  // compaction's re-arm waits for a fresh reading instead
  if (!wasStoodDown || handoffMem.stoodDown || handoffMem.rearm) return exists
  const u = await read($, usage)
  if (u.tokens !== null && u.window !== null) await stepHandoff($, u.tokens, u.window)
  return exists
}

// The `stack` atom from one read: inside the window a missing file writes back the last value and keeps the prompt;
// every other read writes its own value, and `last` with it
async function readStack($: EngineInterface, r: { exists: boolean; text: string | null; id: string; now: number; inWindow: boolean }): Promise<void> {
  if (!r.exists && r.inWindow) {
    const last = stackMem.last
    if (last !== null) await update($, stack, s => (JSON.stringify(s) === JSON.stringify(last) ? s : last))
    return
  }
  const parsed = r.text === null ? null : parseStack(r.text, r.id)
  const base: Stack = { ...INITIAL.stack, readAt: r.now }
  const next: Stack = !r.exists ? { ...base, reason: NO_FILE }
    : parsed === null ? { ...base, state: 'ignored', reason: UNREADABLE }
    : parsed.state === 'ignored' ? { ...base, state: 'ignored', reason: parsed.reason }
    : { ...base, ...parsed.fields, state: 'used', hasPrompt: parsed.prompt !== null }
  stackMem.prompt = parsed?.state === 'used' ? parsed.prompt : null
  stackMem.last = next
  await update($, stack, s => (JSON.stringify(s) === JSON.stringify(next) ? s : next))
}

// The tokens where Claude Code compacts by itself (Decision 12): the breakdown's `autoCompactThreshold`, else the
// window; read at the first reading and again when the model or the window changes
async function pointOf($: EngineInterface, window: number): Promise<number> {
  const key = `${(await read($, meta)).model ?? ''}:${window}`
  const known = (await read($, handoff)).point
  if (handoffMem.pointKey === key && known !== null) return known
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  const point = b !== undefined && b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined ? b.autoCompactThreshold : window
  handoffMem.pointKey = key
  await update($, handoff, h => (h.point === point ? h : { ...h, point }))
  return point
}

// Who asked for a save: auto mode, a press of h or 4 or `/auto-handoff now`, or c, which compacts after it
type SaveBy = 'auto' | 'press' | 'compact'

// A save runs from a 0 ms timer, so no hook waits on git; a request while one runs joins it
function startSave($: EngineInterface, by: SaveBy): Promise<SaveResult> {
  if (handoffMem.saving !== null) return handoffMem.saving
  const saving = new Promise<SaveResult>(resolve => {
    $.clock.after(0, () => {
      writeHandoff($, by).then(resolve, () => resolve({ at: 0, isOk: false, reason: 'unknown' })).finally(() => {
        handoffMem.saving = null
      })
    })
  })
  handoffMem.saving = saving
  return saving
}

// What a save writes (spec 'What a save writes'): never over a file without the marker; the one git call; the text
// masked for keys, emails and phones whatever REC's level. A save arms the resume prompt unless the stack stood F8 down.
async function writeHandoff($: EngineInterface, by: SaveBy): Promise<SaveResult> {
  const at = await $.clock.now()
  const before = await read($, handoff)
  let result: SaveResult
  let percent: number | null = null
  try {
    if (await isForeign($)) result = { at, isOk: false, reason: FOREIGN }
    else {
      const git = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 2000 })
        .then(gitPart, (err: unknown) => gitPart(err instanceof Error ? err : new Error(String(err))))
      const input = await saveInput($, at, git)
      percent = input.percent
      await $.fs.write(HANDOFF_PATH, maskForFile(handoffText(input)))
      result = { at, isOk: true, reason: null }
    }
  } catch (err) {
    result = { at, isOk: false, reason: (err instanceof Error ? err.message : String(err)).split('\n')[0] || 'unknown' }
  }
  await update($, handoff, h => ({ ...h, lastSave: result }))
  if (!result.isOk) {
    toast($, TOASTS.failed(result.reason ?? 'unknown'))
    return result
  }
  handoffMem.savedStep = (await read($, handoff)).handled
  if (!handoffMem.stoodDown) handoffMem.armedAt = at
  if (by === 'compact') toast($, TOASTS.compacting())
  else if (by === 'press') toast($, handoffMem.stoodDown ? TOASTS.savedOnly() : TOASTS.saved())
  else if (before.lastSave?.isOk !== true && percent !== null) toast($, TOASTS.autoFirst(percent))
  return result
}

// A file at the path whose first line is not the marker is the person's own; no file is none
// A file there that the mod cannot read (over 4 MiB, locked, no access) is foreign too: only a missing file is none
async function isForeign($: EngineInterface): Promise<boolean> {
  if (!(await $.fs.exists(HANDOFF_PATH))) return false
  let text: string
  try {
    text = await $.fs.read(HANDOFF_PATH)
  } catch {
    return true
  }
  return text.split('\n')[0]?.trimEnd() !== MARKER
}

// What a save copies: the plan this session works on, its scores, git and the mod's counts. A plan file written
// before this session began is none of this session's.
async function saveInput($: EngineInterface, at: number, git: string[]): Promise<SaveInput> {
  const h = await read($, handoff)
  const u = await read($, usage)
  const m = await read($, meta)
  const p = await read($, plans)
  const items = await read($, tasks)
  const w = creditedPlan(p, (await read($, view)).planSlug, items.length > 0)
  let plan: SaveInput['plan'] = w === 'tasks' ? 'tasks' : null
  let scores: ScoresPart | null = null
  if (w !== null && w !== 'tasks' && w.value !== null && p.since !== null && w.mtimeMs >= p.since) {
    const v = (await drawnPlan($, p, items, w, at)).v
    if (v !== null) {
      const steps: PlanPart['steps'] = v.rows.map(r => ({
        id: r.step.id, title: r.step.title, status: r.step.status, actualMs: r.actualMs, forecastMs: r.forecastMs, notes: r.notes.length,
      }))
      plan = { file: `${PLANS_DIR}/${w.name}.json`, title: v.title, finished: v.finished, total: v.total, steps }
      const own = p.scores.find(s => s.value !== null && s.value.subject.kind === 'plan' && s.value.subject.ref === w.name)
      const sv = own === undefined || own.value === null ? null : scoresView(own.value)
      if (own !== undefined && sv !== null) {
        scores = { name: own.name, totals: sv.totals, open: sv.open.map(f => ({ id: f.id, text: f.text, severity: f.severity })) }
      }
    }
  }
  const counted = Object.values(await read($, stats))
  const isWorking = (await read($, live)).turnId !== null
  const point = h.point ?? u.window
  return {
    at, percent: u.tokens === null || point === null ? null : percentOf(u.tokens, point), threshold: h.threshold,
    session: await $.session.id(), model: m.model, git, plan, scores,
    counts: {
      turn: m.turnCount + (isWorking ? 1 : 0), durationMs: u.startedAt === null ? null : at - u.startedAt,
      calls: counted.reduce((n, t) => n + t.calls, 0), failed: counted.reduce((n, t) => n + t.failed, 0),
      agents: (await read($, agents)).length, costUsd: u.costUsd, isEstimate: u.windows.length > 0,
    },
  }
}

// h, 4 and `/auto-handoff now`: the ask comes down and a save starts
async function saveNow($: EngineInterface): Promise<void> {
  await update($, handoff, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
  void startSave($, 'press')
}

// r: the ask comes down until the next step
async function dismissAsk($: EngineInterface): Promise<void> {
  await update($, handoff, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
}

// c: a save first, unless one was made at this step, then Phase 2's compaction; a failed save compacts nothing, so
// the context is never lost without its handoff
async function saveThenCompact($: EngineInterface, held: Held): Promise<void> {
  const h = await read($, handoff)
  await dismissAsk($)
  if (!(h.lastSave?.isOk === true && handoffMem.savedStep === h.handled)) {
    if (!(await startSave($, 'compact')).isOk) return
  }
  await compactNow($, held)
}

const RESUME_MS = 2 * 60 * 60_000

// A /clear within 2 hours of the last save fills the resume prompt into an empty draft, once; a draft that is not
// empty, or a fill a dialog refuses, gets the toast that names the file. A stood-down session fills nothing.
async function fillResume($: EngineInterface): Promise<void> {
  const at = handoffMem.armedAt
  handoffMem.armedAt = null
  if (at === null || handoffMem.stoodDown || (await $.clock.now()) - at > RESUME_MS) return
  const draft = await $.prompt.read()
  if (draft.text.trim() === '' && (await $.prompt.fill({ text: RESUME_PROMPT })).isFilled) toast($, TOASTS.filled(at))
  else toast($, TOASTS.fallback(at))
}

// `f` in the ALFRED CODE section: the stack's resume prompt into an empty draft, never sent. A press from a frame drawn
// before the prompt went away or the file stopped owning the full context fills nothing (Decision 7).
async function fillStack($: EngineInterface): Promise<void> {
  const text = stackMem.prompt
  if (!fillReady(await read($, stack), text)) toast($, STACK_TOASTS.gone)
  else if ((await $.prompt.read()).text.trim() !== '') toast($, STACK_TOASTS.notEmpty)
  else toast($, fillToast(await $.prompt.fill({ text })))
}

// The Now tab's HANDOFF section reads the atom with F8's percent and the runway
function handoffView(h: Handoff, u: Usage, isWorking: boolean, runway: Runway | null): HandoffView {
  const point = h.point ?? u.window
  return { ...h, percent: u.tokens === null || point === null ? null : percentOf(u.tokens, point), window: u.window, isWorking, runway }
}

// A main-loop reading against F8's steps: ask mode puts up the ask, auto mode saves, once per step
async function stepHandoff($: EngineInterface, tokens: number | undefined, window: number): Promise<void> {
  if (tokens === undefined) return
  const percent = percentOf(tokens, await pointOf($, window))
  const h = await read($, handoff)
  const steps = stepsOf(h.threshold)
  if (handoffMem.rearm) {
    handoffMem.rearm = false
    await update($, handoff, x => ({ ...x, handled: stepUnder(percent, steps) }))
    return
  }
  if (h.mode === 'off' || h.alfred.state === 'stood-down') return
  const step = nextStep(h.handled, percent, steps)
  if (step === null) return
  await update($, handoff, x => ({ ...x, handled: step, isAskUp: x.mode === 'ask' }))
  if (h.mode === 'ask') toast($, TOASTS.ask(step))
  else void startSave($, 'auto')
}

// The state line a bare /auto-handoff prints: the mode, the threshold, F8's context percent and the last save; stood
// down, the runway while it applies, as the HANDOFF row
async function handoffState($: EngineInterface): Promise<string> {
  const h = await read($, handoff)
  const u = await read($, usage)
  const point = h.point ?? u.window
  const ctx = u.tokens === null || point === null ? 'ctx –' : `ctx ${percentOf(u.tokens, point)}%`
  if (h.alfred.state === 'stood-down') {
    const runway = runwayOf(await read($, stack), u, (await read($, meta)).model)
    return `${runway === null ? ctx : `ctx ${runway.percent}% of ${tokens(runway.resumeAt)}`} · handoff by Alfred Code`
  }
  if (h.mode === 'off') return `Handoff: off · ${ctx}`
  const saved = h.lastSave?.isOk === true ? ` · last save ${clock(h.lastSave.at)} (${HANDOFF_PATH})` : ''
  return `Handoff: ${h.mode} at ${h.threshold}% · ${ctx}${saved}`
}

// What the forecast counts to: the stack's resume trigger over the window while the runway applies and the window is
// known, else F8's threshold over the window, to the compaction point's moment
function forecastOf(h: Handoff, u: Usage, runway: Runway | null): { at: number; label: string } {
  if (runway !== null && runway.at !== null) return { at: runway.at, label: tokens(runway.resumeAt) }
  return { at: h.point !== null && u.window !== null ? windowThreshold(h.threshold, h.point, u.window) : h.threshold, label: `${h.threshold}%` }
}

const QUIET_USAGE = 'Usage: /quiet [on|off]'
const quietText = (isOn: boolean): string => `Compact tool rows: ${isOn ? 'on' : 'off'}`

async function isNoColor($: EngineInterface): Promise<boolean> {
  return ((await $.env.get('NO_COLOR')) ?? '') !== ''
}

export const register: Register = on => {
  // Keyed by call id, at most 100, the oldest dropped first
  const calls = new Map<string, Call>()
  const held: Held = {
    close: null, compacting: false, counted: 0, isTerminal: false, reload: null, reading: Promise.resolve(), writes: Promise.resolve(),
  }

  const remember = (id: string, tool: string): Call => {
    let call = calls.get(id)
    if (call === undefined) {
      call = {
        facts: { tool, ...NO_FACTS }, key: tool, tool, target: '', agentId: null, settled: false, outcome: null, rowId: null,
        startedAt: null, durationMs: null, pendingMs: null,
      }
      calls.set(id, call)
      if (calls.size > 100) calls.delete(calls.keys().next().value as string)
    }
    return call
  }

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined) return spawned
    const id = e.resume?.agentId ?? spawned.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      const row = newRow({
        id, parentId: e.parentAgentId ?? null, type: e.subagentType, description: e.description, prompt: e.prompt,
        isTeammate: e.isTeammate === true, model: spawned.model,
      }, now)
      await update($, agents, rows => upsertSpawn(rows, row, e.resume !== undefined))
      await addMark($, markOf(row))
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (!(await isCounted($, e.agentId))) return next(e)
    const input = e as unknown as Record<string, unknown>
    const call = remember(e.tool_use_id, e.tool)
    call.key = toolKey(e.tool, input)
    call.target = targetOf(e.tool, input, await $.session.cwd())
    call.agentId = e.agentId ?? null
    const startedAt = await $.clock.now()
    call.startedAt = startedAt
    if (call.agentId === null) {
      await update($, live, l => ({ ...l, running: [...l.running, { id: e.tool_use_id, tool: e.tool, label: call.target, startedAt }] }))
    } else {
      const action = actionOf(e.tool, call.target)
      await updateRow($, call.agentId, r => ({ ...r, action }))
    }
    const loop = call.agentId ?? 'main'
    const isWait = isAllWait(e.tool, call.agentId === null)
    if (isWait) await update($, credit, c => openWait(c, loop, e.tool_use_id, startedAt))
    const ran = await next(e)
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
    if (ran.isError === true && text !== '') keepError(e.tool_use_id, text)
    call.facts = { ...call.facts, result: { isError: ran.isError === true || ran.deny !== undefined, deny: ran.deny ?? null, text } }
    await settle($, e.tool_use_id, call)
    const endedAt = await $.clock.now()
    const ms = endedAt - startedAt
    const wait = waitOf({ tool: e.tool, ms, isMain: call.agentId === null, isAsked: call.facts.asked, outcome: call.outcome, durationMs: call.durationMs })
    let isClosed = false
    if (isWait) {
      await update($, credit, c => {
        const closed = closeWait(c, loop, e.tool_use_id, endedAt)
        isClosed = closed !== null
        return closed ?? c
      })
    }
    if (wait === null) call.pendingMs = ms
    else if (!isClosed) await addWait($, loop, wait, endedAt)
    if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') scheduleReload($, held)
    if (call.agentId === null && call.outcome === 'ok') {
      const result = ran.result
      const list = await read($, tasks)
      const after = tasksAfter(list, e.tool, input, result)
      if (after !== null) {
        // As with a plan's steps, a status change closes and reopens the open slices first, so the time before it goes
        // to the items in progress then
        if (statusesOfTasks(after) !== statusesOfTasks(list)) await closeLoops($, held, null, await $.clock.now(), true)
        await update($, tasks, items => tasksAfter(items, e.tool, input, result) ?? items)
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id !== undefined && (await isCounted($, e.agentId))) {
      const call = remember(e.tool_use_id, e.tool)
      call.facts = { ...call.facts, checked: verdict.decision, checkReason: verdict.reason ?? null }
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', ($, e, next) => {
    const call = calls.get(e.tool_use_id)
    if (call !== undefined) call.facts = { ...call.facts, failedInTool: true, interrupted: e.is_interrupt === true }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The tool's own time, without the permission prompt or hooks: a call the person was asked about waited the rest
  on('classic.PostToolUse', async ($, e, next) => {
    const call = calls.get(e.tool_use_id)
    if (call !== undefined) {
      call.durationMs = e.duration_ms ?? null
      const ms = call.pendingMs
      if (ms !== null && call.durationMs !== null) {
        call.pendingMs = null
        await addWait($, call.agentId ?? 'main', Math.max(0, ms - call.durationMs), await $.clock.now())
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The person is asked only when no hook answered the request. It names no call id: it marks the newest unsettled
  // call of the tool whose check said ask.
  on('classic.PermissionRequest', async ($, e, next) => {
    const answered = await next(e)
    const call = [...calls.values()].reverse().find(c => !c.settled && c.facts.tool === e.tool_name && c.facts.checked === 'ask')
    const decision = answered.decision
    if (call !== undefined && decision === undefined) call.facts = { ...call.facts, asked: true }
    if (call !== undefined && decision?.behavior === 'deny') call.facts = { ...call.facts, hookDeny: decision.message ?? '' }
    return answered
  }).catch(($, e, next) => next(e))

  // It can arrive after the call settled: the call is classified again, its row and counts replaced
  on('classic.PermissionDenied', async ($, e, next) => {
    const call = calls.get(e.tool_use_id)
    if (call !== undefined) {
      call.facts = { ...call.facts, classifierReason: e.reason }
      if (call.settled) await settle($, e.tool_use_id, call)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A skill the person runs as /name raises no Skill call; one the model runs raises both, and counts once
  on('skill.prompt', async ($, e, next) => {
    const prompted = await next(e)
    const key = `Skill: ${e.skill}`
    if (![...calls.values()].some(c => !c.settled && c.key === key)) {
      await update($, stats, s => ({ ...s, [key]: tally(s[key], 'ok', 1) }))
    }
    return prompted
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'inspect', description: 'Session metrics, agents, tool failures, cache, the timeline and the plan in a pane', argumentHint: '[now|usage|agents|tools|cache|timeline|plan [name]]' })
    await $.command.register({ name: 'rec', description: 'Recording mode: hide keys, emails, phones and your private words on screen', argumentHint: '[on|strict|off|test|words]' })
    await $.command.register({ name: 'quiet', description: 'Compact tool rows: one line per tool call', argumentHint: '[on|off]' })
    await $.command.register({ name: 'auto-handoff', description: 'Save a handoff before the context fills: ask, save by itself, or off', argumentHint: '[ask|auto|off|at <percent>|now]' })
    recMem.home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? null
    await loadRec($)
    await loadQuiet($)
    await loadHandoff($)
    await readStatus($)
    // Moves the agent rows and redraws the running times once a second
    $.clock.every(1000, () => {
      tickOnce($).catch(() => undefined)
    })
    const now = await $.clock.now()
    await pruneCost($, now)
    for (const key of staleKeys(await storedTimes($), now)) await $.store.delete(key)
    await seedMine($)
    const reading = await takeUsage($, await todayUsd($, now))
    await baseline($, reading)
    held.isTerminal = e.surface === 'terminal' && e.isInteractive
    await readCacheConfig($, held)
    // A reload keeps $.state but not the module's timer: a cache still warm gets its toast armed again
    await armCacheClose($, held)
    // A plan's file must be written after this to run; a reload keeps the first start's time
    await update($, plans, p => (p.since === null ? { ...p, since: now } : p))
    $.clock.every(30_000, () => {
      queueReload($, held)
      loadRec($).catch(() => undefined)
      loadQuiet($).catch(() => undefined)
      loadHandoff($).then(() => readStatus($)).catch(() => undefined)
    })
    scheduleReload($, held)
    return started
  }).catch(($, e, next) => next(e))

  // A /clear, a resume or a fork starts the session over under a new id: Claude Code resets $.state itself, and the
  // mod writes its own start values too, so the reset is the mod's and testable
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      // The new id's file may land after this handler's read, from the stack's own SessionStart hook: for 10 s a read
      // that finds no file keeps the last values (Phase 5 spec Choice 12). The window opens first, so a poll tick while
      // the stores load is inside it
      stackMem.keepUntil = (await $.clock.now()) + 10_000
      stackMem.reread?.cancel()
      stackMem.reread = null
      held.close?.cancel()
      held.close = null
      calls.clear()
      // A cleared or resumed conversation is told of REC again on its first prompt
      noteMem.told = 'off'
      // Its first reading steps afresh: a compaction's pending re-arm and the step saved at belong to the conversation before
      handoffMem.rearm = false
      handoffMem.savedStep = null
      await resetAll($)
      await loadRec($)
      await loadQuiet($)
      await loadHandoff($)
      // This read, finding no file, reads once more at 2 s
      if (!(await readStatus($, true))) {
        stackMem.reread = $.clock.after(2000, () => {
          stackMem.reread = null
          readStatus($).catch(() => undefined)
        })
      }
      if (e.source === 'clear') await fillResume($)
      const now = await $.clock.now()
      await update($, plans, p => ({ ...p, since: now }))
      await seedMine($)
      scheduleReload($, held)
      await baseline($, await takeUsage($, await todayUsd($, now)))
      const cost = e.estimated_cache_write_usd
      const tokens = e.context_tokens ?? 0
      if (e.source !== 'clear' && cost !== undefined && tokens > 0) {
        const model = e.model ?? null
        await update($, cache, c => takeRate(c, cost, tokens, model))
      }
    }
    await readCacheConfig($, held)
    if (e.source !== 'startup') return next(e)
    // A start: the stack's own SessionStart hook, beneath, writes this session's file, so it is read once those hooks
    // have run, not at the next poll. A compaction's rewrite waits for the poll: read here, it would step the handoff on
    // the context from before the compaction
    const result = await next(e)
    await readStatus($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // Your prompt, typed at the terminal or sent through Remote Control, waits for the turn that answers it: the engine
  // queues one typed during a turn, and a slash command may start no turn at all. It waits before `next`, as the
  // engine may start its turn before this hook resumes; a prompt dropped beneath leaves, one rewritten is re-keyed.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const at = await $.clock.now()
    const key = fingerprint(e.text)
    await update($, meta, m => ({ ...m, waiting: [...m.waiting, { at, key }].slice(-5) }))
    const level = recLevel()
    const note = level === noteMem.told ? null : recNote(level)
    noteMem.told = level
    const entered = await next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
    const settled = entered.drop === undefined ? fingerprint(entered.text) : null
    if (settled !== key) {
      await update($, meta, m => ({
        ...m,
        waiting: settled === null ? m.waiting.filter(w => w.at !== at || w.key !== key)
          : m.waiting.map(w => (w.at === at && w.key === key ? { at, key: settled } : w)),
      }))
    }
    return entered
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    // An agent's turn can start before its spawn resolves: its slice opens either way
    await openSlice($, e.agentId ?? 'main', now)
    if (e.agentId !== undefined) {
      await updateRow($, e.agentId, r => ({ ...r, status: 'running', endedAt: null }))
      const row = (await read($, agents)).find(r => r.id === e.agentId)
      if (row !== undefined) await addMark($, markOf(row))
    }
    if (e.agentId === undefined) {
      const startedAt = now
      // The turn answers the waiting prompt with its text; the prompts waiting before it never started a turn
      const key = fingerprint(e.text)
      const waiting = (await read($, meta)).waiting
      const promptAt = waiting.find(w => w.key === key)?.at ?? null
      if (promptAt !== null) {
        await update($, meta, m => {
          const i = m.waiting.findIndex(w => w.key === key)
          return { ...m, lastPromptAt: promptAt, waiting: i < 0 ? m.waiting : m.waiting.slice(i + 1) }
        })
      }
      await update($, live, () => ({ turnId: e.turnId, startedAt, tools: 0, failures: 0, running: [], promptAt }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const step = yield* next(e)
      try {
        await agentStep($, e, step)
      } catch {
        // The row's figures are lost; the step itself stands
      }
      return step
    }
    let startedAt: number | null = null
    try {
      startedAt = await $.clock.now()
    } catch {
      // A step with no start time streams with no timing
    }
    const step = yield* next(e)
    try {
      await update($, meta, m => ({ ...m, model: e.model, effort: e.effort === undefined ? m.effort : String(e.effort) }))
      const output = step.usage?.output_tokens
      if (output !== undefined && startedAt !== null) {
        const ms = (await $.clock.now()) - startedAt
        await update($, totals, t => ({ ...t, stepOutput: t.stepOutput + output, stepMs: t.stepMs + ms }))
      }
      const u = step.usage
      const at = startedAt
      if (u !== null && at !== null && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
        await update($, cache, c => addRequest(c, u, at))
        await armCacheClose($, held)
      }
    } catch {
      // The step's figures are lost; the step itself stands
    }
    return step
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await closeLoops($, held, [e.agentId ?? 'main'], await $.clock.now(), false)
    if (e.agentId !== undefined && !(await read($, agents)).some(r => r.id === e.agentId)) return done
    if (e.agentId !== undefined) {
      const now = await $.clock.now()
      const reason = e.reason
      const answer = e.answer
      await updateRow($, e.agentId, r => ({
        ...r, status: statusAt(reason, r.isTeammate), endedAt: now, report: answer === '' ? r.report : answer.slice(0, 4000),
      }))
    }
    const u = e.usage
    if (u !== undefined) {
      await update($, totals, t => ({
        ...t,
        input: t.input + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
    }
    if (e.agentId === undefined) {
      const tokensIn = u === undefined ? 0 : u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await endTurn($, e.turnId, e.durationMs, e.reason, { tokensIn, tokensOut: u?.output_tokens ?? 0 })
      await readCacheConfig($, held)
      await armCacheClose($, held)
      scheduleReload($, held)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const at = await $.clock.now()
    await update($, usage, u => ({
      ...u, tokens: e.context.tokens ?? null, window: e.context.window, percent: e.context.percent ?? null,
      windows: windowsOf(e.rateLimits), costUsd: e.cost?.usd ?? u.costUsd, at,
    }))
    for (const text of await trackPace($, e.rateLimits, at)) toast($, text)
    await stepHandoff($, e.context.tokens, e.context.window)
    return measured
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) await countCompaction($, held)
    return compacted
  }).catch(($, e, next) => next(e))

  // A switch forfeits the cache; its report gives the tier under the billing now and prices the rewrite
  on('classic.PostModelSwitch', async ($, e, next) => {
    const done = await next(e)
    const billing = billingOf((await read($, usage)).windows)
    const now = await $.clock.now()
    const s = { ttl: e.cache_ttl, contextTokens: e.context_tokens, usd: e.estimated_cache_write_usd, model: e.to_model, billing }
    await update($, cache, c => takeSwitch(c, s, now, true))
    await armCacheClose($, held)
    return done
  }).catch(($, e, next) => next(e))

  // Claude Code may still ask to confirm the switch, so the cache stays warm; a switch a hook stops reports nothing
  on('classic.PreModelSwitch', async ($, e, next) => {
    const done = await next(e)
    if (done.block !== undefined || done.permissionDecision === 'deny' || done.permissionDecision === 'ask') return done
    const billing = billingOf((await read($, usage)).windows)
    const now = await $.clock.now()
    const s = { ttl: e.cache_ttl, contextTokens: e.context_tokens, usd: e.estimated_cache_write_usd, model: e.to_model, billing }
    await update($, cache, c => takeSwitch(c, s, now, false))
    await armCacheClose($, held)
    return done
  }).catch(($, e, next) => next(e))

  // '/inspect [tab]': opens the pane, never on its own. '/inspect plan <name>' pins that plan; 'plan' alone clears it.
  on('command.run', { command: 'inspect' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/)
    const word = (words[0] ?? '').toLowerCase()
    const tab = TABS.find(t => t === (word === '' ? 'now' : word))
    if (tab === undefined) return { text: 'Tabs: now, usage, agents, tools, cache, timeline, plan.' }
    if (tab === 'plan') {
      const name = words[1] ?? null
      const good = (await read($, plans)).plans.filter(w => w.value !== null).map(w => w.name).sort()
      if (name !== null && !good.includes(name)) {
        const asked = oneLine(printable(name), 40)
        return { text: good.length === 0 ? `No plan named ${asked}. No plan file in ${PLANS_DIR}/.` : `No plan named ${asked}. Plans: ${good.join(', ')}.` }
      }
      await update($, view, v => (v.planSlug === name ? v : { ...v, planSlug: name }))
    }
    const opened = await openInspect($, tab)
    return { text: opened.isPlaced ? 'Opened the inspect pane.' : `The inspect pane is open but not drawn: ${opened.reason}.` }
  })

  // '/rec [on|strict|off|test|words]': every form reads the stored level first, so a session that has not polled acts on
  // it, never on its own copy. A bare /rec turns REC on over off and never turns it off or down.
  on('command.run', { command: 'rec' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const stored = parseLevel(await $.store.get('settings:rec'))
    if (word === 'test') {
      await loadRec($)
      return { text: mask(recTest(stored === 'off' ? 'on' : stored, recMem.words, recMem.home)) }
    }
    if (word === 'words') {
      const opened = await $.ui.open({ id: 'rec', title: 'REC words', focus: true })
      return { text: opened.isPlaced ? 'Opened the REC words pane.' : `The REC words pane is open but not drawn: ${opened.reason}.` }
    }
    const target = word === '' ? (stored === 'off' ? 'on' : stored) : LEVELS.find(l => l === word)
    if (target === undefined) return { text: mask(REC_HELP) }
    const before = recLevel()
    if (target !== stored) await $.store.set('settings:rec', target)
    await loadRec($)
    const status = recStatus(target, recMem.words.length)
    if (target !== before) toast($, status)
    return { text: mask(target === stored ? status : `${status}\n${OTHER_SESSIONS}`) }
  })

  // '/auto-handoff [ask|auto|off|at <percent>|now]': each change reads `settings:handoff` first and changes only the
  // field it names, so a session that has not polled never writes back an old mode or threshold
  on('command.run', { command: 'auto-handoff' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const raw = await $.store.get('settings:handoff')
    const stored = parseSettings(raw)
    const write = async (s: ReturnType<typeof parseSettings>): Promise<string> => {
      await $.store.set('settings:handoff', { ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}), ...s })
      await loadHandoff($)
      return mask(await handoffState($))
    }
    if (word === 'now') {
      await saveNow($)
      return { text: `Saving a handoff to ${HANDOFF_PATH}.` }
    }
    if (word === 'ask' || word === 'auto' || word === 'off') return { text: await write({ ...stored, mode: word }) }
    const at = /^at(?:\s+(\S*))?$/.exec(word)
    if (at !== null) {
      const n = Number(at[1])
      if (!/^\d+$/.test(at[1] ?? '') || !isThreshold(n)) return { text: THRESHOLD_REFUSED }
      return { text: await write({ ...stored, threshold: n }) }
    }
    if (word !== '') return { text: HANDOFF_USAGE }
    await loadHandoff($)
    return { text: mask(`${await handoffState($)}\n${HANDOFF_USAGE}`) }
  })

  // '/quiet [on|off]': reads the stored setting first; on or off writes it only when it changes, any other form prints it
  on('command.run', { command: 'quiet' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const stored = await loadQuiet($)
    if (word !== 'on' && word !== 'off') return { text: `${quietText(stored)}\n${QUIET_USAGE}` }
    const isOn = word === 'on'
    if (isOn !== stored) await $.store.set('settings:quiet', isOn)
    await loadQuiet($)
    return { text: quietText(isOn) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Read so the running times redraw each second while a turn runs
    await read($, tick)
    const now = await $.clock.now()
    const d = await planDraw($, now)
    const u = await read($, usage)
    const h = await read($, handoff)
    const st = await read($, stack)
    const m = await read($, meta)
    const runway = runwayOf(st, u, m.model)
    const lines = bandLines({
      now, columns: e.props.bodyColumns, isWorking: e.props.isWorking,
      live: await read($, live), usage: u, meta: m, turns: await read($, turns),
      newFailures: (await read($, failures)).filter(f => f.isNew).length, pace: await read($, pace), agents: await read($, agents),
      cache: await read($, cache), plan: d.band, planInvalid: d.invalid, score: d.score, rec: recOf(await read($, rec)),
      forecast: forecastOf(h, u, runway), handoffAsk: h.isAskUp ? h.handled : null, runway, banner: bannerSegs(st),
    })
    if (lines.length === 0) return next(e)
    const press = { inspect: () => inspectFromBand($), compact: () => compactNow($, held), handoff: () => saveNow($) }
    return drawLines($, e, lines, { noColor: await isNoColor($), press })
  })

  // The main loop's spinner adds its action, context and the agents running; an agent's spinner, that agent's
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const text = spinnerSuffix({
      requestId: e.requestId ?? '', live: await read($, live), percent: (await read($, usage)).percent, agents: await read($, agents),
    })
    // REC masks the engine's word and message as well as the mod's own suffix
    const word = mask(e.props.word)
    const message = e.props.message === null ? null : mask(e.props.message)
    const props = word === e.props.word && message === e.props.message ? e.props : { ...e.props, word, message }
    if (text === null) return props === e.props ? next(e) : next({ ...e, props })
    return next({ ...e, props: { ...props, suffix: `${e.props.suffix} ${mask(printable(text))}` } })
  })

  // REC on Claude Code's rows: each site rewrites its props only while REC is on and masking changes something, else
  // passes next(e) as it came. The stored messages and what the model reads stay as they are.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await isRecOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isRecOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!(await isRecOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
  })

  // The tool sites in two steps (Decision 14): /quiet's compact row or emptied result first, then REC over whatever
  // the first hands on. A settled row that is not expanded, or that a group unfolded, draws its compact line.
  // An unfolded group's rows draw `output` inline, so a row's input and output are both masked
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isErrored && typeof e.props.output === 'string' && !errorMem.has(e.props.tool_use_id)) keepError(e.props.tool_use_id, e.props.output)
    if ((await read($, quiet)).isOn && !e.props.isRunning && (e.props.isExpanded !== true || compactMem.marks.has(e.props.tool_use_id))) {
      const lines = callLine(compactOf(e.props.tool_use_id, e.props), e.viewport?.columns ?? 120)
      return drawLines($, e, lines, { noColor: await isNoColor($), press: {} })
    }
    if (!(await isRecOn($))) return next(e)
    // An unfolded group's errored row draws its error text inline, and Claude Code draws that text, not `output` (live,
    // fullscreen, 2026-10-28): with a sample in it, the row draws its compact head and the masked text itself, once
    if (e.props.isErrored && !e.props.isRunning) {
      const failed = maskResult({ tool: e.props.tool, output: e.props.output, isErrored: true, error: errorMem.get(e.props.tool_use_id) ?? null }, mask)
      if (failed.kind === 'tree') {
        errorRows.delete(e.props.tool_use_id)
        errorRows.add(e.props.tool_use_id)
        keepLast(errorRows)
        const head = callLine(compactOf(e.props.tool_use_id, e.props), e.viewport?.columns ?? 120).slice(0, 1)
        const isExpanded = e.props.isExpanded === true
        return drawLines($, e, [...head, ...resultLines(failed.text, { isExpanded, isErrored: true, gutter: e.surface === 'terminal' })], { noColor: await isNoColor($), press: {} })
      }
    }
    const input = maskDeep(e.props.input, mask)
    const output = maskDeep(e.props.output, mask)
    if (input === e.props.input && output === e.props.output) return next(e)
    return next({ ...e, props: { ...e.props, input, ...(output === e.props.output ? {} : { output }) } })
  })

  // Under /quiet an errored result draws an empty Box, as Claude Code would draw its whole error text and the compact
  // row above carries ✗ and its error lines, and so does an Edit or Write result (DROPS_RESULT); any other keeps
  // next(e)'s tree, the classifier line in it, its preview gone. Under REC, so does an errored result whose row drew
  // its masked error text
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    // Fullscreen's ctrl+o draws no group, so nothing there unmarks the rows a group unfolded; an expanded result draws
    // only in that view (an unfolded group draws its rows' output inline), so it unmarks its row and redraws it in full
    if (e.props.isExpanded === true && compactMem.marks.delete(e.props.tool_use_id)) $.ui.invalidate('ui.render')
    let props = e.props
    if ((await read($, quiet)).isOn && e.props.isExpanded !== true) {
      if (e.props.isErrored || DROPS_RESULT.includes(e.props.tool)) return drawLines($, e, [], { noColor: false, press: {} })
      const output = emptyPreview(e.props.tool, e.props.output)
      if (output !== e.props.output) props = { ...e.props, output }
    }
    if (!(await isRecOn($))) return props === e.props ? next(e) : next({ ...e, props })
    if (e.props.isErrored && errorRows.has(e.props.tool_use_id)) return drawLines($, e, [], { noColor: false, press: {} })
    const masked = maskResult({ ...props, error: errorMem.get(e.props.tool_use_id) ?? null }, mask)
    if (masked.kind === 'same') return props === e.props ? next(e) : next({ ...e, props })
    if (masked.kind === 'output') return next({ ...e, props: { ...props, output: masked.output } })
    const lines = resultLines(masked.text, { isExpanded: e.props.isExpanded === true, isErrored: e.props.isErrored, gutter: e.surface === 'terminal' })
    return drawLines($, e, lines, { noColor: await isNoColor($), press: {} })
  })

  // Under /quiet a settled group of calls alone draws its compact lines. One holding another row, or an errored or
  // interrupted call, is unfolded and its calls marked, so each draws its own compact line; a group drawn expanded (the
  // main screen's ctrl+o) unmarks them, so ctrl+o shows all. A group's folded line shows its calls' paths, patterns and
  // git results, and `isExpanded` is the one prop a rewrite changes, so REC unfolds it into ToolUse rows, which the
  // hook above masks, live or settled.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const isQuiet = (await read($, quiet)).isOn
    const isRec = await isRecOn($)
    const ids = e.props.calls.flatMap(c => (c.tool_use_id === undefined ? [] : [c.tool_use_id]))
    if (e.props.isExpanded) {
      if (isQuiet) for (const id of ids) compactMem.marks.delete(id)
      return next(e)
    }
    if (isQuiet && !e.props.isActive && e.props.isCallsOnly === true) {
      const lines = groupLines(e.props.calls.map(c => compactOf(c.tool_use_id, c)), e.viewport?.columns ?? 120)
      return drawLines($, e, lines, { noColor: await isNoColor($), press: {} })
    }
    if (isQuiet && (isRec || !e.props.isActive)) mark(ids)
    else if (!isRec) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await isRecOn($))) return next(e)
    const questions = maskDialog(e.props.questions, maskSpans)
    return questions === e.props.questions ? next(e) : next({ ...e, props: { ...e.props, questions } })
  })

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, async ($, e) => {
    await read($, tick)
    const now = await $.clock.now()
    const counts = await read($, live)
    const shown = await read($, view)
    const rows = await read($, failures)
    const d = await planDraw($, now)
    const u = await read($, usage)
    const h = await read($, handoff)
    const m = await read($, meta)
    const st = await read($, stack)
    const runway = runwayOf(st, u, m.model)
    const input = {
      now, columns: e.props.bodyColumns, isWorking: counts.turnId !== null, live: counts, usage: u,
      meta: m, turns: await read($, turns), newFailures: rows.filter(f => f.isNew).length,
      pace: await read($, pace), failures: rows, stats: await read($, stats), totals: await read($, totals), view: shown,
      agents: await read($, agents), cache: await read($, cache), plan: d.band, planInvalid: d.invalid, score: d.score,
      rec: recOf(await read($, rec)), forecast: forecastOf(h, u, runway), handoff: handoffView(h, u, counts.turnId !== null, runway),
      stack: { view: st, prompt: stackMem.prompt, runway, sessionModel: m.model },
    }
    const bar = tabBar(shown.tab, counts.turnId !== null, e.props.bodyColumns)
    const body = shown.tab === 'usage' ? usageLines(input)
      : shown.tab === 'agents' ? agentsLines(input)
      : shown.tab === 'cache' ? cacheLines(input)
      : shown.tab === 'tools' ? toolsLines(input)
      : shown.tab === 'timeline' ? timelineLines(input.turns, Math.max(3, e.props.scroll.bodyRows - 1 - bar.length))
      : shown.tab === 'plan' ? planLines(d.shown, d.scores, { invalid: d.invalid, others: d.others, otherScores: d.otherScores, updatedAt: d.updatedAt, now, columns: e.props.bodyColumns })
      : nowLines(input)
    const press: Record<string, () => unknown> = {
      'tab-now': () => openInspect($, 'now'),
      'tab-usage': () => openInspect($, 'usage'),
      'tab-agents': () => openInspect($, 'agents'),
      'tab-tools': () => openInspect($, 'tools'),
      'tab-cache': () => openInspect($, 'cache'),
      compact: () => compactNow($, held),
      'handoff-save': () => saveNow($),
      'stack-fill': () => fillStack($),
      'handoff-compact': () => saveThenCompact($, held),
      'handoff-dismiss': () => dismissAsk($),
      'tab-timeline': () => openInspect($, 'timeline'),
      'tab-plan': () => openInspect($, 'plan'),
    }
    for (const row of rows) {
      press[`show-${row.id}`] = () => toggleShown($, row.id)
      press[`copy-${row.id}`] = () => $.ui.copy({ text: row.detail, surface: e.surface })
    }
    for (const agent of input.agents) {
      if (agent.report !== null) press[`report-${agent.id}`] = () => toggleShown($, `report:${agent.id}`)
    }
    return drawLines($, e, [...bar, ...body], { noColor: await isNoColor($), press })
  })

  // The private-words pane: words are added only here, never through a command's arguments, which the transcript echoes
  on('ui.render', { component: 'Pane', requestId: 'rec' }, async ($, e) => {
    const r = await read($, rec)
    const words = recMem.words
    const press: Record<string, () => unknown> = {}
    if (r.level === 'off') words.forEach((w, i) => { press[`remove-${i}`] = () => removeRecWord($, w) })
    const note = r.note === null ? [] : [[{ text: r.note, tone: 'warn' as const }]]
    const input = { key: 'word', label: 'Add a word', submitLabel: 'Add', onSubmit: (value: string) => { void addRecWord($, value) } }
    return drawWithInput($, e, recPaneLines(r.level, words), input, note, { noColor: await isNoColor($), press })
  })
}
