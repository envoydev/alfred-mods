// The session folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit, SessionUsage } from 'claude-code'
import type { Live, Meta, Pace, Running, Totals, Turn, Usage, Window } from './types'
import type { Place } from '../place/types'
import { setPlace } from '../place/place'
import { baseWrites, dayUsd, recordWrites } from './cost'
import type { Entries } from '../plan/types'
import { localDate } from '../core/forecast'
import { staleKeys } from '../plan/steptime'
import { fingerprint, when } from '../core/format'
import { dropPassed, nextWindows, storedWindows, windowsOf } from './windows'
import { syncStatus } from '../band/effects'
import { agentStep, finishLoop, readAgents, readLoops, updateRow } from '../agents/effects'
import { addMark, closeLoops, openSlice, scheduleReload } from '../plan/effects'
import type { Held, HookInput, HookNext } from '../core/types'
import { addCacheRequest, armCacheClose, readCacheConfig } from '../cache/effects'
import { markOf, statusAt } from '../agents/agents'
import { stepHandoff } from '../handoff/effects'
import { toast } from '../core/effects'
import { takeRecNote } from '../rec/effects'
import { followConversation } from '../lifecycle/effects'
import type { Call } from '../tools/types'

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
const windowsMem = { stored: null as string | null }

// When the band's figures were last read mid-turn: the tick reads them at most this often while a turn runs or an
// agent is live, since a foreground agent holds the main loop and no main step fires until it ends
const freshMem = { at: -Infinity }

const FRESH_EVERY_MS = 5000

// The session's cost at the main loop's turn.start, by turn id (spec C4); the main loop runs one turn at a time, so it
// holds one. A /clear empties it: a turn across it has no start read in the new session.
const spendMem = new Map<string, number>()

// One more agent of this type spawned this session
export async function countAgentType($: EngineInterface, type: string): Promise<void> {
  await updateMeta($, m => ({ ...m, agentTypes: { ...m.agentTypes, [type]: (m.agentTypes?.[type] ?? 0) + 1 } }))
}

// The project row's place, its counts kept until the next count replaces them
export async function showPlace($: EngineInterface, place: Place): Promise<void> {
  await updateMeta($, setPlace(place))
}

// The place's uncommitted lines and its distance from upstream, written only when they moved
export async function showPlaceCounts($: EngineInterface, changes: { added: number; removed: number } | null, sync: { ahead: number; behind: number } | null): Promise<void> {
  await updateMeta($, m => {
    if (m.place === undefined) return m
    const p = m.place
    const isSame = JSON.stringify(p.changes ?? null) === JSON.stringify(changes) && JSON.stringify(p.sync ?? null) === JSON.stringify(sync)
    if (isSame) return m
    return {
      ...m,
      place: {
        project: p.project, ...(p.folder === undefined ? {} : { folder: p.folder }), branch: p.branch,
        ...(changes === null ? {} : { changes }), ...(sync === null ? {} : { sync }),
      },
    }
  })
}

// A rule the main context loaded by path, listed once
export async function addPathRule($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, m => (m.pathRules?.includes(name) === true ? m : { ...m, pathRules: [...(m.pathRules ?? []), name] }))
}

// A main-loop compaction that stands, counted
export async function noteCompaction($: EngineInterface, at: number): Promise<void> {
  await updateMeta($, m => ({ ...m, compactions: m.compactions + 1, lastCompactAt: at }))
}

// The model a switch moved to, before its first step names it
export async function setModel($: EngineInterface, model: string): Promise<void> {
  await updateMeta($, m => ({ ...m, model }))
}

// A skill the main loop loaded: in its context from then on, until the conversation starts over
export async function addSkill($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, m => ({ ...m, skills: { ...m.skills, [name]: (m.skills?.[name] ?? 0) + 1 } }))
}

// A settled call off the running list, and the turn's tool and failure counts moved by it
export async function settleRunningCall($: EngineInterface, callId: string, counts: { isMain: boolean; isFirstSettle: boolean; failuresDelta: number }): Promise<void> {
  await updateLive($, l => ({
    ...l,
    tools: counts.isMain && l.turnId !== null && counts.isFirstSettle ? l.tools + 1 : l.tools,
    failures: counts.isMain && l.turnId !== null ? l.failures + counts.failuresDelta : l.failures,
    running: l.running.filter(r => r.id !== callId),
  }))
}

// One more call of the main loop
export async function countMainCall($: EngineInterface): Promise<void> {
  await updateMeta($, m => ({ ...m, mainCalls: m.mainCalls + 1 }))
}

// A main-loop call on the running list until it settles
export async function addRunningCall($: EngineInterface, call: Running): Promise<void> {
  await updateLive($, l => ({ ...l, running: [...l.running, call] }))
}

// The cost keys `keep` names, with their values; no other value is read, as the store holds 7 days of sessions
export async function readEntries($: EngineInterface, keep: (key: string) => boolean): Promise<Entries> {
  const entries: Entries = {}
  for (const key of await $.store.keys()) {
    if (keep(key)) entries[key] = await $.store.get(key)
  }
  return entries
}

export async function writeEntries($: EngineInterface, writes: Entries): Promise<void> {
  for (const [key, value] of Object.entries(writes)) await $.store.set(key, value)
}

export async function baseCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  await writeEntries($, baseWrites(await readEntries($, key => key === last), sessionId, usd, now))
}

export async function recordCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  const day = `cost:${localDate(now)}:${sessionId}`
  await writeEntries($, recordWrites(await readEntries($, key => key === last || key === day), sessionId, usd, now))
}

export async function todayUsd($: EngineInterface, now: number): Promise<number> {
  const prefix = `cost:${localDate(now)}:`
  return dayUsd(await readEntries($, key => key.startsWith(prefix)), now)
}

// A day key is judged by its date alone; a last reading by when it was taken
export async function pruneCost($: EngineInterface, now: number): Promise<void> {
  const entries: Entries = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('cost:')) entries[key] = null
    else if (key.startsWith('cost-last:')) entries[key] = await $.store.get(key)
  }
  for (const key of staleKeys(entries, now)) await $.store.delete(key)
}

// The status line's figures now; today's cost is the store's, so it is only replaced when given
export async function takeUsage($: EngineInterface, today?: number | null): Promise<SessionUsage> {
  const reading = await $.session.usage()
  await writeUsage($, reading, today)
  return reading
}

// Today's cost as the store last gave it, with the session's cost at that reading and the local date it was for: a
// step adds what the session spent since, so today's figure moves mid-turn with no store work (spec B). The store is
// written at the turn's end, and read again by the tick once the date has turned.
let todayMem: { cost: number; today: number; date: string } | null = null

export async function writeUsage($: EngineInterface, reading: SessionUsage, today?: number | null): Promise<void> {
  const at = await $.clock.now()
  if (typeof today === 'number') todayMem = reading.cost === undefined ? null : { cost: reading.cost.usd, today, date: localDate(at) }
  const fresh = windowsOf(reading.rateLimits)
  await updateUsage($, u => ({
    tokens: reading.context.tokens ?? null, window: reading.context.window, percent: reading.context.percent ?? null,
    startedAt: reading.startedAt, ...nextWindows(u, fresh, reading.context.tokens !== undefined), costUsd: reading.cost?.usd ?? null,
    todayUsd: today === undefined ? u.todayUsd : today, at,
  }))
}

export async function storeWindows($: EngineInterface, windows: Window[], at: number): Promise<void> {
  const json = JSON.stringify(windows.map(w => [w.kind, Math.round(w.percentUsed), w.resetsAt]))
  if (windows.length === 0 || json === windowsMem.stored) return
  windowsMem.stored = json
  await $.store.set('usage:windows', { at, windows })
}

// A session with no windows of its own yet shows the ones the last reading on this machine stored, while their reset is
// ahead, marked as read before
export async function seedWindows($: EngineInterface): Promise<void> {
  if ((await readUsage($)).windows.length > 0) return
  const stored = storedWindows(await $.store.get('usage:windows'), await $.clock.now())
  if (stored !== null) await updateUsage($, u => ({ ...u, windows: stored.windows, windowsAt: stored.at }))
}

// A main-loop step's reading: the band's ctx and cost before the turn ends (session.measure fires after it)
export async function freshUsage($: EngineInterface): Promise<void> {
  freshMem.at = await $.clock.now()
  const reading = await $.session.usage()
  const mem = todayMem
  const isToday = mem !== null && mem.date === localDate(freshMem.at)
  const today = isToday && reading.cost !== undefined ? mem.today + Math.max(0, reading.cost.usd - mem.cost) : undefined
  await writeUsage($, reading, today)
  await syncStatus($)
}

// A session first seen now takes its cost so far as the baseline: spend a /clear or a resume carries over
export async function baseline($: EngineInterface, reading: SessionUsage): Promise<void> {
  if (reading.cost !== undefined) await baseCost($, await $.session.id(), reading.cost.usd, await $.clock.now())
}

export const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// Appends each window's reading while its reset is unchanged; a new reset starts it over. Returns the toasts due:
// the highest of 75 and 90 that the 5h or weekly window crossed upward since its last reading, once per window.
export async function trackPace($: EngineInterface, limits: readonly SessionRateLimit[], now: number): Promise<string[]> {
  let due: string[] = []
  await updatePace($, p => {
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
export async function endTurn($: EngineInterface, turnId: string, durationMs: number, end: Turn['end'], used: { tokensIn: number; tokensOut: number }): Promise<void> {
  const reading = await $.session.usage()
  const now = await $.clock.now()
  const before = await readMeta($)
  const counts = await readLive($)
  // The cost between the turn's start and end; none when either read failed, or under half a cent or negative
  const start = spendMem.get(turnId)
  spendMem.delete(turnId)
  const spend = start === undefined || reading.cost === undefined ? null : reading.cost.usd - start
  await updateTurns($, list => {
    const turn: Turn = {
      n: before.turnCount + 1, turnId, promptAt: counts.promptAt,
      replyAt: now, durationMs, ...used, tools: counts.tools, failures: counts.failures,
      contextPercent: reading.context.percent ?? null, end, spendUsd: spend !== null && spend >= 0.005 ? spend : null,
    }
    return [...list, turn].slice(-50)
  })
  await updateMeta($, m => ({ ...m, lastReplyAt: now, turnCount: m.turnCount + 1 }))
  await resetLive($)
  if (reading.cost !== undefined) await recordCost($, await $.session.id(), reading.cost.usd, now)
  await takeUsage($, reading.cost !== undefined ? await todayUsd($, now) : undefined)
}

export async function startTurn($: EngineInterface, e: HookInput<'turn.start'>, next: HookNext<'turn.start'>) {
  const now = await $.clock.now()
  // An agent's turn can start before its spawn resolves: its slice opens either way
  await openSlice($, e.agentId ?? 'main', now)
  if (e.agentId !== undefined) {
    await updateRow($, e.agentId, r => ({ ...r, status: 'running', endedAt: null }))
    const row = (await readAgents($)).find(r => r.id === e.agentId)
    if (row !== undefined) await addMark($, markOf(row))
  }
  if (e.agentId === undefined) {
    const startedAt = now
    // The turn answers the waiting prompt with its text; the prompts waiting before it never started a turn
    const key = fingerprint(e.text)
    const waiting = (await readMeta($)).waiting
    const promptAt = waiting.find(w => w.key === key)?.at ?? null
    if (promptAt !== null) {
      await updateMeta($, m => {
        const i = m.waiting.findIndex(w => w.key === key)
        return { ...m, lastPromptAt: promptAt, waiting: i < 0 ? m.waiting : m.waiting.slice(i + 1) }
      })
    }
    await updateLive($, () => ({ turnId: e.turnId, startedAt, tools: 0, failures: 0, running: [], promptAt }))
    spendMem.clear()
    try {
      const cost = (await $.session.usage()).cost
      if (cost !== undefined) spendMem.set(e.turnId, cost.usd)
    } catch {
      // No start read: the turn's spend is unknown
    }
  }
  return next(e)
}

export async function* trackTurnStep($: EngineInterface, e: HookInput<'turn.step'>, next: HookNext<'turn.step'>, held: Held) {
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
    await updateMeta($, m => ({ ...m, model: e.model, effort: e.effort === undefined ? m.effort : String(e.effort) }))
    const output = step.usage?.output_tokens
    if (output !== undefined && startedAt !== null) {
      const ms = (await $.clock.now()) - startedAt
      await updateTotals($, t => ({ ...t, stepOutput: t.stepOutput + output, stepMs: t.stepMs + ms }))
    }
    const u = step.usage
    const at = startedAt
    if (u !== null && at !== null && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
      await addCacheRequest($, u, at)
      await armCacheClose($, held)
    }
  } catch {
    // The step's figures are lost; the step itself stands
  }
  try {
    await freshUsage($)
  } catch {
    // The band keeps its last figures; the step itself stands
  }
  return step
}

export async function completeTurn($: EngineInterface, e: HookInput<'turn.complete'>, next: HookNext<'turn.complete'>, held: Held) {
  const done = await next(e)
  await closeLoops($, held, [e.agentId ?? 'main'], await $.clock.now(), false)
  if (e.agentId !== undefined && !(await readAgents($)).some(r => r.id === e.agentId)) {
    const id = e.agentId
    if ((await readLoops($)).some(l => l.id === id)) await finishLoop($, id)
    return done
  }
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
    await updateTotals($, t => ({
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
}

export async function takeMeasure($: EngineInterface, e: HookInput<'session.measure'>, next: HookNext<'session.measure'>) {
  const measured = await next(e)
  const at = await $.clock.now()
  const fresh = windowsOf(e.rateLimits)
  await updateUsage($, u => {
    const { windowsAt: _stored, ...rest } = u
    return {
      ...rest, tokens: e.context.tokens ?? null, window: e.context.window, percent: e.context.percent ?? null,
      ...nextWindows(u, fresh, e.context.tokens !== undefined), costUsd: e.cost?.usd ?? u.costUsd, at,
    }
  })
  await storeWindows($, fresh, at)
  for (const text of await trackPace($, e.rateLimits, at)) toast($, text)
  await stepHandoff($, e.context.tokens, e.context.window)
  await syncStatus($)
  return measured
}

export async function submitPrompt($: EngineInterface, e: HookInput<'prompt.submit'>, next: HookNext<'prompt.submit'>, calls: Map<string, Call>, held: Held) {
  // A conversation no classic.SessionStart reported starts over before its first prompt, which carries REC's note
  // even when the start-over fails
  await followConversation($, 'prompt', calls, held).catch(() => undefined)
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
  const at = await $.clock.now()
  const key = fingerprint(e.text)
  await updateMeta($, m => ({ ...m, waiting: [...m.waiting, { at, key }].slice(-5) }))
  const note = takeRecNote()
  const entered = await next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
  const settled = entered.drop === undefined ? fingerprint(entered.text) : null
  if (settled !== key) {
    await updateMeta($, m => ({
      ...m,
      waiting: settled === null ? m.waiting.filter(w => w.at !== at || w.key !== key)
        : m.waiting.map(w => (w.at === at && w.key === key ? { at, key: settled } : w)),
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
    await updateMeta($, m => ({ ...m, version: engine.version }))
  } catch {
    // No version item
  }
}

// A rate window whose reset has passed, dropped
export async function dropPassedWindows($: EngineInterface, now: number): Promise<void> {
  const u = await readUsage($)
  if (dropPassed(u, now) !== null) await updateUsage($, x => dropPassed(x, now) ?? x)
}

// Past local midnight, today's cost is the new date's
export function isTodayStale(now: number): boolean {
  return todayMem !== null && todayMem.date !== localDate(now)
}

// Whether the band's figures are due a read while something runs
export function isMidTurnReadDue(now: number): boolean {
  return now - freshMem.at >= FRESH_EVERY_MS
}

// The next tick reads the band's figures at once
export function forgetMidTurnRead(): void {
  freshMem.at = -Infinity
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
  windowsMem.stored = null
}

// The turn's spend read at its start is dropped
export function forgetTurnSpend(): void {
  spendMem.clear()
}

// The conversation was resumed, not started
export async function markResumed($: EngineInterface): Promise<void> {
  await updateMeta($, m => ({ ...m, isResumed: true }))
}
