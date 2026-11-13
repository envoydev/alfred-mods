// The lifecycle folder's effects: what it reads and writes through $
import { readBandSetting, resetBandFooter, syncStatusLine } from '../band/effects'
import { armCacheToast, readCache, readCacheConfig, resetCache, takeResumeRate } from '../cache/effects'
import { setCostBaseline, bumpTick, dropPassedWindows, forgetMidTurnRead, forgetStoredWindows, forgetTurnSpend, refreshUsageMidTurn, isMidTurnReadDue, isTodayStale, markResumed, pruneCost, readLive, readModelAndVersion, readUsage, resetLive, resetMeta, resetPace, resetTick, resetTotals, resetTurns, resetUsage, seedRateWindows, refreshUsage, readTodayUsd } from '../session/effects'
import { readAgents, refreshLiveAgents, resetAgents, resetLoops } from '../agents/effects'
import { notePermissionMode, resetBlockers, resetFailures, resetQuiet, resetStats } from '../tools/effects'
import { openKeepWindow, readStatusFile, readStatusAfterStartOver, resetStack } from '../stack/effects'
import { queuePlanReload, resetCredit, resetPlans, resetTasks, restartPlanWatch, schedulePlanReload, seedSessionTimes, startPlanWatch, readStoredTimes } from '../plan/effects'
import { forgetRecNote, readRecHome, resetRec } from '../rec/effects'
import { fillResumePrompt, forgetHandoffSteps, resetHandoff } from '../handoff/effects'
import { isLive } from '../agents/agents'
import { billingOf, needsTick } from '../cache/cache'
import type { EngineInterface } from 'claude-code'
import { forgetBreakdown, readBreakdownSoon, resetParts } from '../context/effects'
import { loadSettings } from '../settings/effects'
import { pollPlace, readPlace } from '../place/effects'
import { resetView } from '../inspect/effects'
import type { ToolCall } from '../tools/types'
import type { Pending, HookInput, HookNext } from '../core/types'
import { staleKeys } from '../plan/steptime'

// The conversation the mod last started, by session id, and the start-over running. A /clear, a resume or a branch goes
// on under a new id: classic.SessionStart starts it over, and where a managed plugin keeps that hook from the mod, the
// tick or the next prompt does once it reads the new id. The id is null until session.start.
const conversationMemory = { id: null as string | null, starting: null as Promise<void> | null }

// The clock's minute the last tick saw: the full band's info line shows the session's time, which moves while idle
const tickMemory = { minute: -1 }

// What the band shows before the first reply: the model, Claude Code's version, the place, the stored windows and the
// context's parts. Each read stands alone: a refusal leaves its value as it was.
export async function readStartFacts($: EngineInterface): Promise<void> {
  await readModelAndVersion($)
  await readPlace($).catch(() => undefined)
  await seedRateWindows($).catch(() => undefined)
  await resetBandFooter($)
  // The rules row's always-on rules (spec 2026-11-11, D4), from a breakdown read on a timer: the start waits on nothing
  readBreakdownSoon($)
}

// Once a second: the engine's list moves the live agent rows, the band's figures are read every 5 seconds and the
// clocks on screen redraw while anything runs, and the clocks redraw once a minute while the band is full
export async function runTick($: EngineInterface): Promise<void> {
  const rows = await readAgents($)
  const anyLive = rows.some(row => isLive(row.status))
  const now = await $.clock.now()
  if (anyLive) await refreshLiveAgents($, rows, now)
  await dropPassedWindows($, now)
  const isWarm = needsTick(await readCache($), billingOf((await readUsage($)).windows), now)
  const minute = Math.floor(now / 60_000)
  const isNewMinute = minute !== tickMemory.minute && (await readBandSetting($)).mode === 'full'
  tickMemory.minute = minute
  // Past local midnight, today's cost is the new date's in the store
  if (isTodayStale(now)) {
    try {
      await refreshUsage($, await readTodayUsd($, now))
    } catch {
      // The next tick tries again
    }
  }
  const isBusy = anyLive || (await readLive($)).turnId !== null
  if (isBusy && isMidTurnReadDue(now)) {
    try {
      await refreshUsageMidTurn($)
    } catch {
      // The band keeps its last figures until the next tick
    }
  }
  if (isBusy || isWarm || isNewMinute) await bumpTick($)
  // A failure the pane marked seen, a /clear or a stack file read leaves the line as it was until here
  await syncStatusLine($)
}

export async function resetState($: EngineInterface): Promise<void> {
  forgetTurnSpend()
  await resetStats($)
  await resetFailures($)
  await resetTurns($)
  await resetLive($)
  await resetUsage($)
  await resetTotals($)
  await resetMeta($)
  await resetView($)
  await resetPace($)
  await resetAgents($)
  await resetCache($)
  await resetTick($)
  await resetPlans($)
  await resetCredit($)
  await resetTasks($)
  await resetRec($)
  await resetQuiet($)
  await resetHandoff($)
  await resetStack($)
  await resetBlockers($)
  await resetParts($)
  await resetLoops($)
  forgetBreakdown()
}

// A /clear, a resume or a branch starts the session over under a new id: Claude Code resets $.state itself, and the
// mod writes its own start values too, so the reset is the mod's and testable. Each runs after the one before. `source`
// is classic.SessionStart's, 'prompt' where a prompt found the new id, or null where the tick did: then a transcript of
// one prompt at most, the /clear's own row (live, 2026-11-10), was a /clear. A resumed conversation of one prompt reads
// as one too, and gets the resume prompt in an empty draft, never sent. A prompt that found the id has left the box,
// which is not filled after it. No session.end hook tells them apart: a managed plugin that skips the mod's hooks may
// skip that one too, and the mod hooks no event it did not hook before.
export function startOver($: EngineInterface, source: string | null, calls: Map<string, ToolCall>, pending: Pending): Promise<void> {
  const run = (conversationMemory.starting ?? Promise.resolve()).catch(() => undefined).then(async () => {
    conversationMemory.id = await $.session.id()
    const isClear = source === 'clear' || (source === null && (await $.session.turns()) <= 1)
    // The new id's file may land after this read, from the stack's own SessionStart hook: for 10 s a read that finds
    // no file keeps the last values (Phase 5 spec Choice 12). The window opens first, so a poll tick while the stores
    // load is inside it
    openKeepWindow((await $.clock.now()) + 10_000)
    pending.cacheToast?.cancel()
    pending.cacheToast = null
    calls.clear()
    // A cleared or resumed conversation is told of REC again on its first prompt
    forgetRecNote()
    // Its first reading steps afresh: a compaction's pending re-arm and the step saved at belong to the conversation
    // before
    forgetHandoffSteps()
    await resetState($)
    await loadSettings($)
    if (!isClear) await markResumed($)
    // This read, finding no file, reads once more at 2 s
    await readStatusAfterStartOver($)
    if (isClear) await fillResumePrompt($)
    const now = await $.clock.now()
    await restartPlanWatch($, now)
    await seedSessionTimes($)
    schedulePlanReload($, pending)
    await setCostBaseline($, await refreshUsage($, await readTodayUsd($, now)))
    await readStartFacts($)
  })
  const starting: Promise<void> = run.finally(() => {
    if (conversationMemory.starting === starting) conversationMemory.starting = null
  })
  conversationMemory.starting = starting
  return starting
}

// A new id that no classic.SessionStart reported, read at the tick (`by` null) and before a prompt (`by` 'prompt'):
// started over once. A start-over already running answers for it, and is waited for.
export async function followConversation($: EngineInterface, by: 'prompt' | null, calls: Map<string, ToolCall>, pending: Pending): Promise<void> {
  if (conversationMemory.starting !== null) return conversationMemory.starting
  if (conversationMemory.id === null) return
  const id = await $.session.id()
  if (conversationMemory.starting !== null) return conversationMemory.starting
  if (id !== conversationMemory.id) await startOver($, by, calls, pending)
}

export async function followSessionStart($: EngineInterface, e: HookInput<'classic.SessionStart'>, next: HookNext<'classic.SessionStart'>, calls: Map<string, ToolCall>, pending: Pending) {
  notePermissionMode(e.permission_mode)
  if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
    await startOver($, e.source, calls, pending)
    const cost = e.estimated_cache_write_usd
    const tokens = e.context_tokens ?? 0
    if (e.source !== 'clear' && cost !== undefined && tokens > 0) {
      const model = e.model ?? null
      await takeResumeRate($, cost, tokens, model)
    }
  }
  await readCacheConfig($, pending)
  if (e.source !== 'startup') return next(e)
  // A start: the stack's own SessionStart hook, beneath, writes this session's file, so it is read once those hooks
  // have run, not at the next poll. A compaction's rewrite waits for the poll: read here, it would step the handoff
  // on the context from before the compaction
  const result = await next(e)
  await readStatusFile($).catch(() => undefined)
  return result
}

export async function startSession($: EngineInterface, e: HookInput<'session.start'>, next: HookNext<'session.start'>, calls: Map<string, ToolCall>, pending: Pending) {
  const started = await next(e)
  await $.command.register({ name: 'inspect', description: 'Session metrics, agents, tool failures, cache, the timeline and the plan in a pane', argumentHint: '[now|usage|agents|tools|cache|timeline|plan [name]|close|show [n]|copy [n]|report [n]|fill|band off|calm|full]' })
  await $.command.register({ name: 'rec', description: 'Recording mode: set "rec" in ~/.claude/settings.json, show the level, test it, or edit your private words', argumentHint: '[on|strict|off|test|words [close]]' })
  await $.command.register({ name: 'auto-handoff', description: 'Save a handoff now, set the handoff mode or first ask in ~/.claude/settings.json, or show them', argumentHint: '[ask|auto|off|at <percent>|now|compact|later]' })
  await readRecHome($)
  await loadSettings($, true)
  await readStatusFile($)
  forgetMidTurnRead()
  conversationMemory.id = await $.session.id()
  // Starts over a conversation no classic.SessionStart reported, moves the agent rows and redraws the running times,
  // once a second
  $.clock.every(1000, () => {
    followConversation($, null, calls, pending).then(() => runTick($)).catch(() => undefined)
  })
  const now = await $.clock.now()
  await pruneCost($, now)
  for (const key of staleKeys(await readStoredTimes($), now)) await $.store.delete(key)
  await seedSessionTimes($)
  forgetStoredWindows()
  // A process that starts on a conversation with prompts in it resumed one; a reload keeps $.state and its last reading
  const isFresh = (await readUsage($)).at === 0
  const reading = await refreshUsage($, await readTodayUsd($, now))
  await setCostBaseline($, reading)
  await readStartFacts($)
  if (isFresh && (await $.session.turns().catch(() => 0)) > 0) await markResumed($)
  pending.isTerminal = e.surface === 'terminal' && e.isInteractive
  await readCacheConfig($, pending)
  // A reload keeps $.state but not the module's timer: a cache still warm gets its toast armed again
  await armCacheToast($, pending)
  // A plan's file must be written after this to run; a reload keeps the first start's time
  await startPlanWatch($, now)
  $.clock.every(30_000, () => {
    queuePlanReload($, pending)
    // The status file is read whatever the settings read did
    loadSettings($).catch(() => undefined).then(() => readStatusFile($)).catch(() => undefined)
    pollPlace($).catch(() => undefined)
  })
  schedulePlanReload($, pending)
  return started
}
