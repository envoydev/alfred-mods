// The session folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit, SessionUsage } from 'claude-code'
import type { Live, Meta, Pace, RunningCall, Totals, Turn, Usage, RateWindow } from './types'
import type { Place } from '../place/types'
import { withPlace } from '../place/place'
import { baseWrites, dayUsd, recordWrites } from './cost'
import type { TimeEntries } from '../plan/types'
import { localDate } from '../core/forecast'
import { staleKeys } from '../plan/steptime'
import { fingerprint, whenText } from '../core/format'
import { dropPassed, nextWindows, storedWindows, rateWindowsOf } from './windows'
import { syncStatusLine } from '../band/effects'
import { trackAgentStep, finishLoop, readAgents, readLoops, updateAgentRow } from '../agents/effects'
import { addStepMark, closeLoopSlices, openLoopSlice, schedulePlanReload } from '../plan/effects'
import type { Pending, HookInput, HookNext } from '../core/types'
import { addCacheRequest, armCacheToast, readCacheConfig } from '../cache/effects'
import { stepMarkOf, statusAt } from '../agents/agents'
import { stepHandoff } from '../handoff/effects'
import { toast } from '../core/effects'
import { takeRecNote } from '../rec/effects'
import { followConversation } from '../lifecycle/effects'
import type { ToolCall } from '../tools/types'

const INITIAL_TURNS: Turn[] = []
const turnsAtom = atom({ plugin: 'alfred-mods', key: 'turns' } as const, INITIAL_TURNS, { shape: 'turns-1' })
export function readTurns($: EngineInterface) {
  return read($, turnsAtom)
}
function updateTurns($: EngineInterface, change: (value: Turn[]) => Turn[]) {
  return update($, turnsAtom, change)
}
export function resetTurns($: EngineInterface) {
  return update($, turnsAtom, () => INITIAL_TURNS)
}

const INITIAL_LIVE: Live = { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null }
const liveAtom = atom({ plugin: 'alfred-mods', key: 'live' } as const, INITIAL_LIVE, { shape: 'live-3' })
export function readLive($: EngineInterface) {
  return read($, liveAtom)
}
function updateLive($: EngineInterface, change: (value: Live) => Live) {
  return update($, liveAtom, change)
}
export function resetLive($: EngineInterface) {
  return update($, liveAtom, () => INITIAL_LIVE)
}

const INITIAL_USAGE: Usage = {
  tokens: null, window: null, percent: null, startedAt: null, windows: [], costUsd: null, todayUsd: null, at: 0,
}
const usageAtom = atom({ plugin: 'alfred-mods', key: 'usage' } as const, INITIAL_USAGE, { shape: 'usage-1' })
export function readUsage($: EngineInterface) {
  return read($, usageAtom)
}
function updateUsage($: EngineInterface, change: (value: Usage) => Usage) {
  return update($, usageAtom, change)
}
export function resetUsage($: EngineInterface) {
  return update($, usageAtom, () => INITIAL_USAGE)
}

const INITIAL_TOTALS: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 }
const totalsAtom = atom({ plugin: 'alfred-mods', key: 'totals' } as const, INITIAL_TOTALS, { shape: 'totals-1' })
export function readTotals($: EngineInterface) {
  return read($, totalsAtom)
}
function updateTotals($: EngineInterface, change: (value: Totals) => Totals) {
  return update($, totalsAtom, change)
}
export function resetTotals($: EngineInterface) {
  return update($, totalsAtom, () => INITIAL_TOTALS)
}

const INITIAL_META: Meta = {
  model: null, effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0,
  waiting: [], mainCalls: 0,
}
const metaAtom = atom({ plugin: 'alfred-mods', key: 'meta' } as const, INITIAL_META, { shape: 'meta-3' })
export function readMeta($: EngineInterface) {
  return read($, metaAtom)
}
function updateMeta($: EngineInterface, change: (value: Meta) => Meta) {
  return update($, metaAtom, change)
}
export function resetMeta($: EngineInterface) {
  return update($, metaAtom, () => INITIAL_META)
}

const INITIAL_PACE: Pace = {}
const paceAtom = atom({ plugin: 'alfred-mods', key: 'pace' } as const, INITIAL_PACE, { shape: 'pace-1' })
export function readPace($: EngineInterface) {
  return read($, paceAtom)
}
function updatePace($: EngineInterface, change: (value: Pace) => Pace) {
  return update($, paceAtom, change)
}
export function resetPace($: EngineInterface) {
  return update($, paceAtom, () => INITIAL_PACE)
}

const tickAtom = atom({ plugin: 'alfred-mods', key: 'tick' } as const, 0)
export function readTick($: EngineInterface) {
  return read($, tickAtom)
}
function updateTick($: EngineInterface, change: (value: number) => number) {
  return update($, tickAtom, change)
}

// The windows this session last stored for the next one, as the band shows them: a turn's measure stores them only when
// that changed, since each store write rewrites the file every session on the machine shares (the review, 2026-11-11)
const storedWindowsMemory = { stored: null as string | null }

// When the band's figures were last read mid-turn: the tick reads them at most this often while a turn runs or an
// agent is live, since a foreground agent holds the main loop and no main step fires until it ends
const midTurnMemory = { at: -Infinity }

const MID_TURN_READ_MS = 5000

// The session's cost at the main loop's turn.start, by turn id (spec C4); the main loop runs one turn at a time, so it
// holds one. A /clear empties it: a turn across it has no start read in the new session.
const turnSpendMemory = new Map<string, number>()

// One more agent of this type spawned this session
export async function countAgentType($: EngineInterface, type: string): Promise<void> {
  await updateMeta($, session => ({ ...session, agentTypes: { ...session.agentTypes, [type]: (session.agentTypes?.[type] ?? 0) + 1 } }))
}

// The project row's place, its counts kept until the next count replaces them
export async function showPlace($: EngineInterface, place: Place): Promise<void> {
  await updateMeta($, withPlace(place))
}

// The place's uncommitted lines and its distance from upstream, written only when they moved
export async function showPlaceCounts($: EngineInterface, changes: { added: number; removed: number } | null, sync: { ahead: number; behind: number } | null): Promise<void> {
  await updateMeta($, session => {
    if (session.place === undefined) return session
    const p = session.place
    const isSame = JSON.stringify(p.changes ?? null) === JSON.stringify(changes) && JSON.stringify(p.sync ?? null) === JSON.stringify(sync)
    if (isSame) return session
    return {
      ...session,
      place: {
        project: p.project, ...(p.folder === undefined ? {} : { folder: p.folder }), branch: p.branch,
        ...(changes === null ? {} : { changes }), ...(sync === null ? {} : { sync }),
      },
    }
  })
}

// A rule the main context loaded by path, listed once
export async function addPathRule($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, session => (session.pathRules?.includes(name) === true ? session : { ...session, pathRules: [...(session.pathRules ?? []), name] }))
}

// A main-loop compaction that stands, counted
export async function noteCompaction($: EngineInterface, at: number): Promise<void> {
  await updateMeta($, session => ({ ...session, compactions: session.compactions + 1, lastCompactAt: at }))
}

// The model a switch moved to, before its first step names it
export async function setModel($: EngineInterface, model: string): Promise<void> {
  await updateMeta($, session => ({ ...session, model }))
}

// A skill the main loop loaded: in its context from then on, until the conversation starts over
export async function addLoadedSkill($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, session => ({ ...session, skills: { ...session.skills, [name]: (session.skills?.[name] ?? 0) + 1 } }))
}

// A settled call off the running list, and the turn's tool and failure counts moved by it
export async function settleRunningCall($: EngineInterface, callId: string, counts: { isMain: boolean; isFirstSettle: boolean; failuresDelta: number }): Promise<void> {
  await updateLive($, live => ({
    ...live,
    tools: counts.isMain && live.turnId !== null && counts.isFirstSettle ? live.tools + 1 : live.tools,
    failures: counts.isMain && live.turnId !== null ? live.failures + counts.failuresDelta : live.failures,
    running: live.running.filter(r => r.id !== callId),
  }))
}

// One more call of the main loop
export async function countMainCall($: EngineInterface): Promise<void> {
  await updateMeta($, session => ({ ...session, mainCalls: session.mainCalls + 1 }))
}

// A main-loop call on the running list until it settles
export async function addRunningCall($: EngineInterface, call: RunningCall): Promise<void> {
  await updateLive($, live => ({ ...live, running: [...live.running, call] }))
}

// The cost keys `keep` names, with their values; no other value is read, as the store holds 7 days of sessions
export async function readCostEntries($: EngineInterface, keep: (key: string) => boolean): Promise<TimeEntries> {
  const entries: TimeEntries = {}
  for (const key of await $.store.keys()) {
    if (keep(key)) entries[key] = await $.store.get(key)
  }
  return entries
}

export async function writeCostEntries($: EngineInterface, writes: TimeEntries): Promise<void> {
  for (const [key, value] of Object.entries(writes)) await $.store.set(key, value)
}

export async function baseCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  await writeCostEntries($, baseWrites(await readCostEntries($, key => key === last), sessionId, usd, now))
}

export async function recordCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  const day = `cost:${localDate(now)}:${sessionId}`
  await writeCostEntries($, recordWrites(await readCostEntries($, key => key === last || key === day), sessionId, usd, now))
}

export async function readTodayUsd($: EngineInterface, now: number): Promise<number> {
  const prefix = `cost:${localDate(now)}:`
  return dayUsd(await readCostEntries($, key => key.startsWith(prefix)), now)
}

// A day key is judged by its date alone; a last reading by when it was taken
export async function pruneCost($: EngineInterface, now: number): Promise<void> {
  const entries: TimeEntries = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('cost:')) entries[key] = null
    else if (key.startsWith('cost-last:')) entries[key] = await $.store.get(key)
  }
  for (const key of staleKeys(entries, now)) await $.store.delete(key)
}

// The status line's figures now; today's cost is the store's, so it is only replaced when given
export async function refreshUsage($: EngineInterface, today?: number | null): Promise<SessionUsage> {
  const reading = await $.session.usage()
  await writeUsageReading($, reading, today)
  return reading
}

// Today's cost as the store last gave it, with the session's cost at that reading and the local date it was for: a
// step adds what the session spent since, so today's figure moves mid-turn with no store work (spec B). The store is
// written at the turn's end, and read again by the tick once the date has turned.
let todayCostMemory: { cost: number; today: number; date: string } | null = null

export async function writeUsageReading($: EngineInterface, reading: SessionUsage, today?: number | null): Promise<void> {
  const at = await $.clock.now()
  if (typeof today === 'number') todayCostMemory = reading.cost === undefined ? null : { cost: reading.cost.usd, today, date: localDate(at) }
  const fresh = rateWindowsOf(reading.rateLimits)
  await updateUsage($, usage => ({
    tokens: reading.context.tokens ?? null, window: reading.context.window, percent: reading.context.percent ?? null,
    startedAt: reading.startedAt, ...nextWindows(usage, fresh, reading.context.tokens !== undefined), costUsd: reading.cost?.usd ?? null,
    todayUsd: today === undefined ? usage.todayUsd : today, at,
  }))
}

export async function storeRateWindows($: EngineInterface, windows: RateWindow[], at: number): Promise<void> {
  const json = JSON.stringify(windows.map(rateWindow => [rateWindow.kind, Math.round(rateWindow.percentUsed), rateWindow.resetsAt]))
  if (windows.length === 0 || json === storedWindowsMemory.stored) return
  storedWindowsMemory.stored = json
  await $.store.set('usage:windows', { at, windows })
}

// A session with no windows of its own yet shows the ones the last reading on this machine stored, while their reset is
// ahead, marked as read before
export async function seedRateWindows($: EngineInterface): Promise<void> {
  if ((await readUsage($)).windows.length > 0) return
  const stored = storedWindows(await $.store.get('usage:windows'), await $.clock.now())
  if (stored !== null) await updateUsage($, u => ({ ...u, windows: stored.windows, windowsAt: stored.at }))
}

// A main-loop step's reading: the band's ctx and cost before the turn ends (session.measure fires after it)
export async function refreshUsageMidTurn($: EngineInterface): Promise<void> {
  midTurnMemory.at = await $.clock.now()
  const reading = await $.session.usage()
  const mem = todayCostMemory
  const isToday = mem !== null && mem.date === localDate(midTurnMemory.at)
  const today = isToday && reading.cost !== undefined ? mem.today + Math.max(0, reading.cost.usd - mem.cost) : undefined
  await writeUsageReading($, reading, today)
  await syncStatusLine($)
}

// A session first seen now takes its cost so far as the baseline: spend a /clear or a resume carries over
export async function setCostBaseline($: EngineInterface, reading: SessionUsage): Promise<void> {
  if (reading.cost !== undefined) await baseCost($, await $.session.id(), reading.cost.usd, await $.clock.now())
}

export const PACE_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// Appends each window's reading while its reset is unchanged; a new reset starts it over. Returns the toasts due:
// the highest of 75 and 90 that the 5h or weekly window crossed upward since its last reading, once per window.
export async function trackPace($: EngineInterface, limits: readonly SessionRateLimit[], now: number): Promise<string[]> {
  let due: string[] = []
  await updatePace($, pace => {
    due = []
    const out = { ...pace }
    for (const w of limits) {
      const resetsAt = w.resetsAt ?? null
      const prev = pace[w.kind]
      const same = prev !== undefined && prev.resetsAt === resetsAt
      const points = same ? prev.points : []
      const toasted = same ? prev.toasted : []
      const last = points[points.length - 1]
      const marks = PACE_LABEL[w.kind] !== undefined && last !== undefined
        ? [75, 90].filter(m => last.percent < m && w.percentUsed >= m && !toasted.includes(m))
        : []
      if (marks.length > 0) {
        const reset = resetsAt === null ? NaN : Date.parse(resetsAt)
        due.push(`${PACE_LABEL[w.kind]} limit at ${Math.max(...marks)}%, resets ${Number.isNaN(reset) ? 'later' : whenText(reset)}`)
      }
      out[w.kind] = { resetsAt, points: [...points, { at: now, percent: w.percentUsed }].slice(-20), toasted: [...toasted, ...marks] }
    }
    return out
  })
  return due
}

// The main loop's turn ends: it joins the timeline, the live counts start over, and today's cost is brought up
export async function endMainTurn($: EngineInterface, turnId: string, durationMs: number, end: Turn['end'], used: { tokensIn: number; tokensOut: number }): Promise<void> {
  const reading = await $.session.usage()
  const now = await $.clock.now()
  const before = await readMeta($)
  const counts = await readLive($)
  // The cost between the turn's start and end; none when either read failed, or under half a cent or negative
  const start = turnSpendMemory.get(turnId)
  turnSpendMemory.delete(turnId)
  const spend = start === undefined || reading.cost === undefined ? null : reading.cost.usd - start
  await updateTurns($, list => {
    const turn: Turn = {
      n: before.turnCount + 1, turnId, promptAt: counts.promptAt,
      replyAt: now, durationMs, ...used, tools: counts.tools, failures: counts.failures,
      contextPercent: reading.context.percent ?? null, end, spendUsd: spend !== null && spend >= 0.005 ? spend : null,
    }
    return [...list, turn].slice(-50)
  })
  await updateMeta($, session => ({ ...session, lastReplyAt: now, turnCount: session.turnCount + 1 }))
  await resetLive($)
  if (reading.cost !== undefined) await recordCost($, await $.session.id(), reading.cost.usd, now)
  await refreshUsage($, reading.cost !== undefined ? await readTodayUsd($, now) : undefined)
}

export async function trackTurnStart($: EngineInterface, e: HookInput<'turn.start'>, next: HookNext<'turn.start'>) {
  const now = await $.clock.now()
  // An agent's turn can start before its spawn resolves: its slice opens either way
  await openLoopSlice($, e.agentId ?? 'main', now)
  if (e.agentId !== undefined) {
    await updateAgentRow($, e.agentId, r => ({ ...r, status: 'running', endedAt: null }))
    const row = (await readAgents($)).find(r => r.id === e.agentId)
    if (row !== undefined) await addStepMark($, stepMarkOf(row))
  }
  if (e.agentId === undefined) {
    const startedAt = now
    // The turn answers the waiting prompt with its text; the prompts waiting before it never started a turn
    const key = fingerprint(e.text)
    const waiting = (await readMeta($)).waiting
    const promptAt = waiting.find(w => w.key === key)?.at ?? null
    if (promptAt !== null) {
      await updateMeta($, session => {
        const i = session.waiting.findIndex(w => w.key === key)
        return { ...session, lastPromptAt: promptAt, waiting: i < 0 ? session.waiting : session.waiting.slice(i + 1) }
      })
    }
    await updateLive($, () => ({ turnId: e.turnId, startedAt, tools: 0, failures: 0, running: [], promptAt }))
    turnSpendMemory.clear()
    try {
      const cost = (await $.session.usage()).cost
      if (cost !== undefined) turnSpendMemory.set(e.turnId, cost.usd)
    } catch {
      // No start read: the turn's spend is unknown
    }
  }
  return next(e)
}

export async function* trackTurnStep($: EngineInterface, e: HookInput<'turn.step'>, next: HookNext<'turn.step'>, pending: Pending) {
  if (e.agentId !== undefined) {
    const step = yield* next(e)
    try {
      await trackAgentStep($, e, step)
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
    await updateMeta($, session => ({ ...session, model: e.model, effort: e.effort === undefined ? session.effort : String(e.effort) }))
    const output = step.usage?.output_tokens
    if (output !== undefined && startedAt !== null) {
      const ms = (await $.clock.now()) - startedAt
      await updateTotals($, totals => ({ ...totals, stepOutput: totals.stepOutput + output, stepMs: totals.stepMs + ms }))
    }
    const u = step.usage
    const at = startedAt
    if (u !== null && at !== null && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
      await addCacheRequest($, u, at)
      await armCacheToast($, pending)
    }
  } catch {
    // The step's figures are lost; the step itself stands
  }
  try {
    await refreshUsageMidTurn($)
  } catch {
    // The band keeps its last figures; the step itself stands
  }
  return step
}

export async function trackTurnEnd($: EngineInterface, e: HookInput<'turn.complete'>, next: HookNext<'turn.complete'>, pending: Pending) {
  const done = await next(e)
  await closeLoopSlices($, pending, [e.agentId ?? 'main'], await $.clock.now(), false)
  if (e.agentId !== undefined && !(await readAgents($)).some(r => r.id === e.agentId)) {
    const id = e.agentId
    if ((await readLoops($)).some(loop => loop.id === id)) await finishLoop($, id)
    return done
  }
  if (e.agentId !== undefined) {
    const now = await $.clock.now()
    const reason = e.reason
    const answer = e.answer
    await updateAgentRow($, e.agentId, row => ({
      ...row, status: statusAt(reason, row.isTeammate), endedAt: now, report: answer === '' ? row.report : answer.slice(0, 4000),
    }))
  }
  const u = e.usage
  if (u !== undefined) {
    await updateTotals($, totals => ({
      ...totals,
      input: totals.input + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      output: totals.output + u.output_tokens,
      cacheRead: totals.cacheRead + u.cache_read_input_tokens,
      cacheWrite: totals.cacheWrite + u.cache_creation_input_tokens,
    }))
  }
  if (e.agentId === undefined) {
    const tokensIn = u === undefined ? 0 : u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    await endMainTurn($, e.turnId, e.durationMs, e.reason, { tokensIn, tokensOut: u?.output_tokens ?? 0 })
    await readCacheConfig($, pending)
    await armCacheToast($, pending)
    schedulePlanReload($, pending)
  }
  return done
}

export async function trackMeasure($: EngineInterface, e: HookInput<'session.measure'>, next: HookNext<'session.measure'>) {
  const measured = await next(e)
  const at = await $.clock.now()
  const fresh = rateWindowsOf(e.rateLimits)
  await updateUsage($, usage => {
    const { windowsAt: _stored, ...rest } = usage
    return {
      ...rest, tokens: e.context.tokens ?? null, window: e.context.window, percent: e.context.percent ?? null,
      ...nextWindows(usage, fresh, e.context.tokens !== undefined), costUsd: e.cost?.usd ?? usage.costUsd, at,
    }
  })
  await storeRateWindows($, fresh, at)
  for (const text of await trackPace($, e.rateLimits, at)) toast($, text)
  await stepHandoff($, e.context.tokens, e.context.window)
  await syncStatusLine($)
  return measured
}

export async function trackPrompt($: EngineInterface, e: HookInput<'prompt.submit'>, next: HookNext<'prompt.submit'>, calls: Map<string, ToolCall>, pending: Pending) {
  // A conversation no classic.SessionStart reported starts over before its first prompt, which carries REC's note
  // even when the start-over fails
  await followConversation($, 'prompt', calls, pending).catch(() => undefined)
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
  const at = await $.clock.now()
  const key = fingerprint(e.text)
  await updateMeta($, m => ({ ...m, waiting: [...m.waiting, { at, key }].slice(-5) }))
  const note = takeRecNote()
  const entered = await next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
  const settled = entered.drop === undefined ? fingerprint(entered.text) : null
  if (settled !== key) {
    await updateMeta($, session => ({
      ...session,
      waiting: settled === null ? session.waiting.filter(w => w.at !== at || w.key !== key)
        : session.waiting.map(w => (w.at === at && w.key === key ? { at, key: settled } : w)),
    }))
  }
  return entered
}

// The model and Claude Code's version before the first step names them; a refused read leaves its value
export async function readModelAndVersion($: EngineInterface): Promise<void> {
  try {
    const model = await $.session.model()
    await updateMeta($, m => (m.model === null ? { ...m, model } : m))
  } catch {
    // The first step names the model
  }
  try {
    const engine = await $.session.version()
    await updateMeta($, session => ({ ...session, version: engine.version }))
  } catch {
    // No version item
  }
}

// A rate window whose reset has passed, dropped
export async function dropPassedWindows($: EngineInterface, now: number): Promise<void> {
  const u = await readUsage($)
  if (dropPassed(u, now) !== null) await updateUsage($, usage => dropPassed(usage, now) ?? usage)
}

// Past local midnight, today's cost is the new date's
export function isTodayStale(now: number): boolean {
  return todayCostMemory !== null && todayCostMemory.date !== localDate(now)
}

// Whether the band's figures are due a read while something runs
export function isMidTurnReadDue(now: number): boolean {
  return now - midTurnMemory.at >= MID_TURN_READ_MS
}

// The next tick reads the band's figures at once
export function forgetMidTurnRead(): void {
  midTurnMemory.at = -Infinity
}

// The clocks on screen redraw
export async function bumpTick($: EngineInterface): Promise<void> {
  await updateTick($, n => n + 1)
}

export async function resetTick($: EngineInterface): Promise<void> {
  await updateTick($, () => 0)
}

// The stored windows are read afresh
export function forgetStoredWindows(): void {
  storedWindowsMemory.stored = null
}

// The turn's spend read at its start is dropped
export function forgetTurnSpend(): void {
  turnSpendMemory.clear()
}

// The conversation was resumed, not started
export async function markResumed($: EngineInterface): Promise<void> {
  await updateMeta($, session => ({ ...session, isResumed: true }))
}
