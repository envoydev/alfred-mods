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
import { drawLines } from './draw.tsx'
import { fingerprint, mins, oneLine, printable, usd, when } from './format.ts'
import { mask, toast } from './mask.ts'
import { creditedPlan, isFinishedStep, parsePlan, parseScores, planView, runs, scoresView, shownPlan, taskView, tasksAfter } from './plan.ts'
import type { PlanView, ScoresView } from './plan.ts'
import { PLANS_DIR, SCORES_DIR, readFolder } from './planfiles.ts'
import { planLines, scoresLabel } from './planlines.ts'
import { closeOf, closeSlices, closeWait, isAllWait, liveSpans, mineOf, openWait, overheadKey, sliceMs, staleKeys, stepKey, sumTimes, waitOf } from './steptime.ts'
import type { Close } from './steptime.ts'
import { agentsLines, cacheLines, nowLines, tabBar, timelineLines, toolsLines, usageLines } from './tabs.ts'
import { classify, fold, targetOf, toolKey } from './outcome.ts'
import type { CallFacts } from './outcome.ts'
import type {
  AgentRow, Cache, CacheConfig, Credit, Failure, Live, Meta, Outcome, Pace, Plan, PlanChange, Plans, Scores, Tab, TaskItem, ToolStat, Totals, Turn, Usage, View,
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

// Counts a settled call, or counts it again when a later event changed its outcome
async function settle($: EngineInterface, id: string, call: Call): Promise<void> {
  const { outcome, reason, isNew } = classify(call.facts)
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

// A main-loop compaction that stands: counted, and the cache cold, as its cached prefix is gone
async function countCompaction($: EngineInterface, held: Held): Promise<void> {
  held.counted++
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
    })
    scheduleReload($, held)
    return started
  }).catch(($, e, next) => next(e))

  // A /clear, a resume or a fork starts the session over under a new id: Claude Code resets $.state itself, and the
  // mod writes its own start values too, so the reset is the mod's and testable
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      held.close?.cancel()
      held.close = null
      calls.clear()
      await resetAll($)
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
    return next(e)
  }).catch(($, e, next) => next(e))

  // Your prompt, typed at the terminal or sent through Remote Control, waits for the turn that answers it: the engine
  // queues one typed during a turn, and a slash command may start no turn at all. It waits before `next`, as the
  // engine may start its turn before this hook resumes; a prompt dropped beneath leaves, one rewritten is re-keyed.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const at = await $.clock.now()
    const key = fingerprint(e.text)
    await update($, meta, m => ({ ...m, waiting: [...m.waiting, { at, key }].slice(-5) }))
    const entered = await next(e)
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Read so the running times redraw each second while a turn runs
    await read($, tick)
    const now = await $.clock.now()
    const d = await planDraw($, now)
    const lines = bandLines({
      now, columns: e.props.bodyColumns, isWorking: e.props.isWorking,
      live: await read($, live), usage: await read($, usage), meta: await read($, meta), turns: await read($, turns),
      newFailures: (await read($, failures)).filter(f => f.isNew).length, pace: await read($, pace), agents: await read($, agents),
      cache: await read($, cache), plan: d.band, planInvalid: d.invalid, score: d.score,
    })
    if (lines.length === 0) return next(e)
    const press = { inspect: () => inspectFromBand($), compact: () => compactNow($, held) }
    return drawLines($, e, lines, { noColor: await isNoColor($), press })
  })

  // The main loop's spinner adds its action, context and the agents running; an agent's spinner, that agent's
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const text = spinnerSuffix({
      requestId: e.requestId ?? '', live: await read($, live), percent: (await read($, usage)).percent, agents: await read($, agents),
    })
    if (text === null) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${mask(printable(text))}` } })
  })

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, async ($, e) => {
    await read($, tick)
    const now = await $.clock.now()
    const counts = await read($, live)
    const shown = await read($, view)
    const rows = await read($, failures)
    const d = await planDraw($, now)
    const input = {
      now, columns: e.props.bodyColumns, isWorking: counts.turnId !== null, live: counts, usage: await read($, usage),
      meta: await read($, meta), turns: await read($, turns), newFailures: rows.filter(f => f.isNew).length,
      pace: await read($, pace), failures: rows, stats: await read($, stats), totals: await read($, totals), view: shown,
      agents: await read($, agents), cache: await read($, cache), plan: d.band, planInvalid: d.invalid, score: d.score,
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
}
