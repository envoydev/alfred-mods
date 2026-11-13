// The alfred-mods hooks module. Every hook observes and draws; none approves, denies or rewrites a tool call.
// Each $.state atom is made, read and updated in its owner folder's effects.ts: `claude plugin validate` refuses an atom
// or a ref handed to another module.
import type {
  EngineInterface, Register, SessionContextBreakdown, SessionRateLimit, SessionUsage, Timer, TurnStepInput, TurnStepResult, UiOpenResult,
} from 'claude-code'

import { isLive, markOf, refreshAgents, statusAt } from './agents/agents'
import { spinnerSuffix } from './band/working'
import { bandLines, underRows } from './band/band'
import { addRequest, billingOf, needsTick, takeRate } from './cache/cache'
import { baseCost, pruneCost, recordCost, todayUsd } from './session/cost'
import { drawLines, drawNote, drawUnder, drawUnderNote } from './core/draw'
import { localDate } from './core/forecast'
import { REC_HIDDEN, SPINNER_WORD, bandFailed, paneFailed } from './core/failsafe'
import { clock, fingerprint, oneLine, printable, tokens, usd, when } from './core/format'
import { mask, recLevel } from './rec/mask'
import { neutralDialog } from './rec/sites'
import { DROPS_RESULT } from './tools/compact'
import { forecastOf, handoffView } from './handoff/handoff'
import { bannerSegs, runwayOf } from './stack/stack'
import { PLANS_DIR, runs } from './plan/plan'
import { planLines } from './plan/planlines'
import { staleKeys } from './plan/steptime'
import { agentsLines, asCommands, cacheLines, nowLines, paneCommands, reportRows, tabBar, timelineLines, toolsLines, usageLines } from './inspect/tabs'
import { numberOf } from './tools/outcome'
import { recNote, recOf } from './rec/rec'
import { BAND_MODES, DEFAULTS, sourceName } from './settings/settings'
import { dropPassed, nextWindows, storedWindows } from './session/windows'
import { countSkillPrompt, drawToolGroup, drawToolResult, drawToolUse, modeMem, notePermissionAsk, notePermissionDenied, notePromptMode, noteToolCheck, noteToolFailure, noteToolTime, readBlockers, readFailures, readStats, resetBlockers, resetFailures, resetQuiet, resetStats, trackToolCall, updateFailures } from './tools/effects'
import { FRESH_EVERY_MS, freshMem, readLive, readMeta, readPace, readTick, readTotals, readTurns, readUsage, resetLive, resetMeta, resetPace, resetTotals, resetTurns, resetUsage, spendMem, updateLive, updateMeta, updatePace, updateTick, updateTotals, updateTurns, updateUsage, windowsMem } from './session/effects'
import { agentStep, readAgents, readLoops, resetAgents, resetLoops, trackSpawn, updateAgents, updateLoops, updateRow } from './agents/effects'
import { afterModelSwitch, armCacheClose, beforeModelSwitch, compactNow, followCompaction, readCache, readCacheConfig, resetCache, updateCache } from './cache/effects'
import { addMark, closeLoops, openSlice, planDraw, queueReload, readPlans, resetCredit, resetPlans, resetTasks, scheduleReload, seedMine, storedTimes, updatePlans } from './plan/effects'
import { fillStack, readStack, readStatus, resetStack, scoreLevel, stackMem } from './stack/effects'
import { dismissAsk, fillResume, handoffMem, readHandoff, resetHandoff, runAutoHandoffCommand, saveNow, saveThenCompact, stepHandoff } from './handoff/effects'
import { drawRecPane, maskAssistantMessage, maskCommandOutput, maskQuestionDialog, maskUserMessage, noteMem, readRec, recMem, resetRec, runRecCommand } from './rec/effects'
import { bandMem, isPassingAbove, readBandSetting, statusMem, syncStatus } from './band/effects'
import { noteLoadedRule, partsMem, readBreakdownSoon, readParts, resetParts } from './context/effects'
import { readView, resetView, updateView } from './inspect/effects'
import type { BandInput } from './band/types'
import type { Tab } from './inspect/types'
import type { Plans } from './plan/types'
import type { Turn, Usage, Window } from './session/types'
import type { Call } from './tools/types'
import type { Held } from './core/types'
import { pollPlace, readPlace } from './place/effects'
import { followConfigChange, loadSettings, setField, settingsMem } from './settings/effects'
import { conversationMem, tickMem } from './lifecycle/effects'
import { closePane, isNoColor, toast } from './core/effects'

const windowsOf = (limits: readonly SessionRateLimit[]): Window[] =>
  limits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null }))

// The status line's figures now; today's cost is the store's, so it is only replaced when given
async function takeUsage($: EngineInterface, today?: number | null): Promise<SessionUsage> {
  const reading = await $.session.usage()
  await writeUsage($, reading, today)
  return reading
}

// Today's cost as the store last gave it, with the session's cost at that reading and the local date it was for: a
// step adds what the session spent since, so today's figure moves mid-turn with no store work (spec B). The store is
// written at the turn's end, and read again by the tick once the date has turned.
let todayMem: { cost: number; today: number; date: string } | null = null

async function writeUsage($: EngineInterface, reading: SessionUsage, today?: number | null): Promise<void> {
  const at = await $.clock.now()
  if (typeof today === 'number') todayMem = reading.cost === undefined ? null : { cost: reading.cost.usd, today, date: localDate(at) }
  const fresh = windowsOf(reading.rateLimits)
  await updateUsage($, u => ({
    tokens: reading.context.tokens ?? null, window: reading.context.window, percent: reading.context.percent ?? null,
    startedAt: reading.startedAt, ...nextWindows(u, fresh, reading.context.tokens !== undefined), costUsd: reading.cost?.usd ?? null,
    todayUsd: today === undefined ? u.todayUsd : today, at,
  }))
}

async function storeWindows($: EngineInterface, windows: Window[], at: number): Promise<void> {
  const json = JSON.stringify(windows.map(w => [w.kind, Math.round(w.percentUsed), w.resetsAt]))
  if (windows.length === 0 || json === windowsMem.stored) return
  windowsMem.stored = json
  await $.store.set('usage:windows', { at, windows })
}

// A session with no windows of its own yet shows the ones the last reading on this machine stored, while their reset is
// ahead, marked as read before
async function seedWindows($: EngineInterface): Promise<void> {
  if ((await readUsage($)).windows.length > 0) return
  const stored = storedWindows(await $.store.get('usage:windows'), await $.clock.now())
  if (stored !== null) await updateUsage($, u => ({ ...u, windows: stored.windows, windowsAt: stored.at }))
}

// What the band shows before the first reply: the model, Claude Code's version, the place, the stored windows and the
// context's parts. Each read stands alone: a refusal leaves its value as it was.
async function readStart($: EngineInterface): Promise<void> {
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
  await readPlace($).catch(() => undefined)
  await seedWindows($).catch(() => undefined)
  // Each session, and each start-over, proves its footer again before the site above passes (spec band-under U2)
  bandMem.hasFooter = false
  bandMem.columns = null
  const statusLine = await $.settings.read({ key: 'statusLine' }).catch(() => null)
  bandMem.hasStatusLine = statusLine !== null && statusLine !== undefined
  // The rules row's always-on rules (spec 2026-11-11, D4), from a breakdown read on a timer: the start waits on nothing
  readBreakdownSoon($)
}

// A main-loop step's reading: the band's ctx and cost before the turn ends (session.measure fires after it)
async function freshUsage($: EngineInterface): Promise<void> {
  freshMem.at = await $.clock.now()
  const reading = await $.session.usage()
  const mem = todayMem
  const isToday = mem !== null && mem.date === localDate(freshMem.at)
  const today = isToday && reading.cost !== undefined ? mem.today + Math.max(0, reading.cost.usd - mem.cost) : undefined
  await writeUsage($, reading, today)
  await syncStatus($)
}

// A session first seen now takes its cost so far as the baseline: spend a /clear or a resume carries over
async function baseline($: EngineInterface, reading: SessionUsage): Promise<void> {
  if (reading.cost !== undefined) await baseCost($, await $.session.id(), reading.cost.usd, await $.clock.now())
}

// Once a second: the engine's list moves the live agent rows, the band's figures are read every 5 seconds and the
// clocks on screen redraw while anything runs, and the clocks redraw once a minute while the band is full
async function tickOnce($: EngineInterface): Promise<void> {
  const rows = await readAgents($)
  const anyLive = rows.some(r => isLive(r.status))
  const now = await $.clock.now()
  if (anyLive) {
    const listed = await $.agent.list()
    if (JSON.stringify(refreshAgents(rows, listed, now)) !== JSON.stringify(rows)) {
      await updateAgents($, current => refreshAgents(current, listed, now))
    }
  }
  const u = await readUsage($)
  if (dropPassed(u, now) !== null) await updateUsage($, x => dropPassed(x, now) ?? x)
  const isWarm = needsTick(await readCache($), billingOf((await readUsage($)).windows), now)
  const minute = Math.floor(now / 60_000)
  const isNewMinute = minute !== tickMem.minute && (await readBandSetting($)).mode === 'full'
  tickMem.minute = minute
  // Past local midnight, today's cost is the new date's in the store
  if (todayMem !== null && todayMem.date !== localDate(now)) {
    try {
      await takeUsage($, await todayUsd($, now))
    } catch {
      // The next tick tries again
    }
  }
  const isBusy = anyLive || (await readLive($)).turnId !== null
  if (isBusy && now - freshMem.at >= FRESH_EVERY_MS) {
    try {
      await freshUsage($)
    } catch {
      // The band keeps its last figures until the next tick
    }
  }
  if (isBusy || isWarm || isNewMinute) await updateTick($, n => n + 1)
  // A failure the pane marked seen, a /clear or a stack file read leaves the line as it was until here
  await syncStatus($)
}

async function resetAll($: EngineInterface): Promise<void> {
  spendMem.clear()
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
  await updateTick($, () => 0)
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
  partsMem.lastAt = null
}

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// Appends each window's reading while its reset is unchanged; a new reset starts it over. Returns the toasts due:
// the highest of 75 and 90 that the 5h or weekly window crossed upward since its last reading, once per window.
async function trackPace($: EngineInterface, limits: readonly SessionRateLimit[], now: number): Promise<string[]> {
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
async function endTurn($: EngineInterface, turnId: string, durationMs: number, end: Turn['end'], used: { tokensIn: number; tokensOut: number }): Promise<void> {
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

// Opens the pane on a tab. The failures it shows are seen once a surface draws it, never while it waits undrawn.
// The open starts before the first await: a Button's press counts as the person's only while its closure runs.
async function openInspect($: EngineInterface, tab: Tab): Promise<UiOpenResult> {
  // Esc at an idle, empty prompt closes it: on the terminal's main screen nothing takes a click (the user, 2026-11-12)
  const opening = $.ui.open({ id: 'inspect', title: 'Inspect', closeOnEscape: true })
  await updateView($, v => ({ ...v, tab }))
  // The Usage tab reads the context's parts again when the last read is over a minute old
  if (tab === 'usage' && (partsMem.lastAt === null || (await $.clock.now()) - partsMem.lastAt > 60_000)) readBreakdownSoon($)
  const opened = await opening
  if (!opened.isPlaced) return opened
  if (tab === 'now' || tab === 'tools') {
    await updateFailures($, list => (list.some(f => f.isNew) ? list.map(f => ({ ...f, isNew: false })) : list))
  }
  return opened
}

// The commands for what a click or a key does in the pane (the user, 2026-11-12: in iTerm's main screen, with tabs,
// neither reaches the mod). Each answers with what it did, masked while REC is on.
const INSPECT_HELP = 'Usage: /inspect [now|usage|agents|tools|cache|timeline|plan [name]] opens a tab, /inspect close closes the pane. ' +
  '/inspect show [n] and copy [n] act on tool failure n (1 the newest), report [n] on agent report n (1 the top), ' +
  "fill fills Alfred Code's resume prompt, band off|calm|full sets \"band\" in ~/.claude/settings.json."
const BAND_HELP = '/inspect band off, calm or full sets "band" in ~/.claude/settings.json.'
const COPY_WHY = { 'no-surface': 'no screen to copy on', 'no-clipboard': 'this terminal has no clipboard path', refused: 'the terminal refused it' } as const

// '2' as 2; left out, 1; anything else, 0, which no item has
const ordinal = (word: string | undefined): number => (word === undefined ? 1 : /^\d+$/.test(word) ? Number(word) : 0)
const outOf = (what: string, word: string | undefined, count: number, first: string): string =>
  `No ${what} ${oneLine(printable(word ?? ''), 20)}: there ${count === 1 ? 'is 1' : `are ${count}`}, 1 the ${first}.`

// The pane on `tab`, unless it is open on one of `tabs` already: '' when drawn, else why not
async function showOn($: EngineInterface, tab: Tab, tabs: Tab[]): Promise<string> {
  const isOpen = (await $.ui.panes().catch(() => [])).some(p => p.id === 'inspect')
  if (isOpen && tabs.includes((await readView($)).tab)) return ''
  const opened = await openInspect($, tab)
  return opened.isPlaced ? '' : ` The pane is open but not drawn: ${opened.reason}.`
}

// '/inspect band [off|calm|full]': writes "band" into the user file, or names the mode in force and its source
async function bandCommand($: EngineInterface, word: string): Promise<string> {
  const mode = BAND_MODES.find(m => m === word)
  if (mode !== undefined) return setField($, 'band', mode)
  await loadSettings($)
  const r = settingsMem.resolved
  return `Band: ${r?.values.band ?? DEFAULTS.band} - from ${sourceName(r?.from.band ?? 'default', '/band')}. ${BAND_HELP}`
}

// '/inspect show [n]' and '/inspect copy [n]': the failure whose row starts with n, the newest when n is left out
async function failureCommand($: EngineInterface, action: 'show' | 'copy', word: string | undefined): Promise<string> {
  const list = (await readFailures($)).map((f, i) => ({ f, n: numberOf(f, i) }))
  const newest = list[list.length - 1]
  if (newest === undefined) return `No tool failure to ${action}.`
  const n = word === undefined ? newest.n : ordinal(word)
  const f = list.find(x => x.n === n)?.f
  const oldest = list[0]?.n ?? newest.n
  if (f === undefined) {
    const range = oldest === newest.n ? `the pane lists failure ${oldest}` : `the pane lists failures ${oldest} to ${newest.n}`
    return `No failure ${oneLine(printable(word ?? ''), 20)}: ${range}.`
  }
  const name = `failure ${n} (${f.tool}${f.target === '' ? '' : `  ${oneLine(printable(f.target), 40)}`})`
  if (action === 'copy') {
    if (f.outcome !== 'error') return `Nothing to copy: ${name} was ${f.outcome}, not an error.`
    const done = await $.ui.copy({ text: f.detail })
    return done.isCopied ? `Copied the error of ${name}.` : `Not copied: ${COPY_WHY[done.reason]}.`
  }
  if (f.outcome !== 'error' && f.outcome !== 'blocked') return `Nothing to show: ${name} was ${f.outcome}.`
  return toggleCommand($, f.id, name, 'now', ['now', 'tools'])
}

// '/inspect report [n]': report n of the agents that finished with one, in the Agents tab's order, the top first
async function reportCommand($: EngineInterface, word: string | undefined): Promise<string> {
  const list = reportRows(await readAgents($))
  if (list.length === 0) return 'No agent report to show.'
  const n = ordinal(word)
  const r = list[n - 1]
  if (r === undefined) return outOf('report', word, list.length, 'top')
  return toggleCommand($, `report:${r.id}`, `report ${n} (${r.type} · ${oneLine(printable(r.description), 40)})`, 'agents', ['agents'])
}

// Show and Hide as one toggle, as the button: shown, the pane comes up on a tab that lists it
async function toggleCommand($: EngineInterface, id: string, name: string, tab: Tab, tabs: Tab[]): Promise<string> {
  const isShown = (await readView($)).shown.includes(id)
  await toggleShown($, id)
  if (isShown) return `Hid ${name}.`
  return `Showing ${name} in the inspect pane.${await showOn($, tab, tabs)}`
}

// The band's Inspect button: a pane the surface leaves undrawn says why
async function inspectFromBand($: EngineInterface): Promise<void> {
  const opened = await openInspect($, 'now')
  if (!opened.isPlaced) toast($, `Inspect pane not drawn: ${opened.reason}`)
}

async function toggleShown($: EngineInterface, id: string): Promise<void> {
  await updateView($, v => ({ ...v, shown: v.shown.includes(id) ? v.shown.filter(x => x !== id) : [...v.shown, id] }))
}

const TABS: Tab[] = ['now', 'usage', 'agents', 'tools', 'cache', 'timeline', 'plan']

// The band's lines from the session's state, for the site above or the footer (spec band-under U2): the same reads, the
// place's own width, rows and turn
async function bandInputOf(
  $: EngineInterface, at: { columns: number; maxRows: number | undefined; isWorking: boolean; under?: BandInput['under']; isLeftOut: boolean },
): Promise<BandInput> {
  // Read so the running times redraw each second while a turn runs
  await readTick($)
  const now = await $.clock.now()
  const d = await planDraw($, now)
  const u = await readUsage($)
  const h = await readHandoff($)
  const st = await readStack($)
  const m = await readMeta($)
  const runway = runwayOf(st, u, m.model)
  const setting = await readBandSetting($)
  const p = await readParts($)
  return {
    now, columns: at.columns, ...(at.maxRows === undefined ? {} : { maxRows: at.maxRows }), isWorking: at.isWorking,
    live: await readLive($), usage: u, meta: m, turns: await readTurns($),
    newFailures: (await readFailures($)).filter(f => f.isNew).length, pace: await readPace($), agents: await readAgents($),
    cache: await readCache($), plan: d.band, planInvalid: d.invalid, score: d.score, isPlanScore: d.isPlanScore, scoreLevel: await scoreLevel($), rec: recOf(await readRec($)),
    forecast: forecastOf(h, u, runway), handoffAsk: h.isAskUp ? h.handled : null, runway, banner: bannerSegs(st),
    mode: setting.mode, totals: await readTotals($), stats: await readStats($),
    isToolsOpen: setting.isToolsOpen === true, listing: p.skills ?? null,
    rules: { always: p.rules ?? [], byPath: m.pathRules ?? [], isTracked: !at.isLeftOut },
    ...(at.under === undefined ? {} : { under: at.under }),
  }
}

// What the band's buttons do, above or under
function bandPress($: EngineInterface, held: Held): Record<string, () => unknown> {
  return { inspect: () => inspectFromBand($), compact: () => compactNow($, held), handoff: () => saveNow($) }
}

// A /clear, a resume or a branch starts the session over under a new id: Claude Code resets $.state itself, and the
// mod writes its own start values too, so the reset is the mod's and testable. Each runs after the one before. `source`
// is classic.SessionStart's, 'prompt' where a prompt found the new id, or null where the tick did: then a transcript of
// one prompt at most, the /clear's own row (live, 2026-11-10), was a /clear. A resumed conversation of one prompt reads
// as one too, and gets the resume prompt in an empty draft, never sent. A prompt that found the id has left the box,
// which is not filled after it. No session.end hook tells them apart: a managed plugin that skips the mod's hooks may
// skip that one too, and the mod hooks no event it did not hook before.
function startOver($: EngineInterface, source: string | null, calls: Map<string, Call>, held: Held): Promise<void> {
  const run = (conversationMem.starting ?? Promise.resolve()).catch(() => undefined).then(async () => {
    conversationMem.id = await $.session.id()
    const isClear = source === 'clear' || (source === null && (await $.session.turns()) <= 1)
    // The new id's file may land after this read, from the stack's own SessionStart hook: for 10 s a read that finds
    // no file keeps the last values (Phase 5 spec Choice 12). The window opens first, so a poll tick while the stores
    // load is inside it
    stackMem.keepUntil = (await $.clock.now()) + 10_000
    stackMem.reread?.cancel()
    stackMem.reread = null
    held.close?.cancel()
    held.close = null
    calls.clear()
    // A cleared or resumed conversation is told of REC again on its first prompt
    noteMem.told = 'off'
    // Its first reading steps afresh: a compaction's pending re-arm and the step saved at belong to the conversation
    // before
    handoffMem.rearm = false
    handoffMem.savedStep = null
    await resetAll($)
    await loadSettings($)
    if (!isClear) await updateMeta($, m => ({ ...m, isResumed: true }))
    // This read, finding no file, reads once more at 2 s
    if (!(await readStatus($, true))) {
      stackMem.reread = $.clock.after(2000, () => {
        stackMem.reread = null
        readStatus($).catch(() => undefined)
      })
    }
    if (isClear) await fillResume($)
    const now = await $.clock.now()
    await updatePlans($, p => ({ ...p, since: now }))
    await seedMine($)
    scheduleReload($, held)
    await baseline($, await takeUsage($, await todayUsd($, now)))
    await readStart($)
  })
  const starting: Promise<void> = run.finally(() => {
    if (conversationMem.starting === starting) conversationMem.starting = null
  })
  conversationMem.starting = starting
  return starting
}

// A new id that no classic.SessionStart reported, read at the tick (`by` null) and before a prompt (`by` 'prompt'):
// started over once. A start-over already running answers for it, and is waited for.
async function followConversation($: EngineInterface, by: 'prompt' | null, calls: Map<string, Call>, held: Held): Promise<void> {
  if (conversationMem.starting !== null) return conversationMem.starting
  if (conversationMem.id === null) return
  const id = await $.session.id()
  if (conversationMem.starting !== null) return conversationMem.starting
  if (id !== conversationMem.id) await startOver($, by, calls, held)
}

export const register: Register = (on, options) => {
  // The person's word that a managed plugin sends these events on past the mod: Claude Code then tells the model, once
  // per event and conversation, that the mod's hook was skipped. Left out, the hooks never join the chain; they never ran
  // there anyway, and a new conversation is read off the session id. The rules hook goes with the six on the safe side
  // (spec 2026-11-11, D4, A1): such a plugin may skip it too, and the rules row then says by path is not tracked.
  const isLeftOut = options.leave_out_skipped_hooks === true
  // Keyed by call id, at most 100, the oldest dropped first
  const calls = new Map<string, Call>()
  const held: Held = {
    close: null, compacting: false, counted: 0, isTerminal: false, reload: null, reading: Promise.resolve(), writes: Promise.resolve(),
  }

  on('agent.spawn', ($, e, next) => trackSpawn($, e, next)).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => trackToolCall($, e, next, calls, held)).catch(($, e, next) => next(e))

  on('tool.check', ($, e, next) => noteToolCheck($, e, next, calls)).catch(($, e, next) => next(e))

  // The permission mode only: the prompt itself is never read or kept
  on('classic.UserPromptSubmit', ($, e, next) => notePromptMode($, e, next)).catch(($, e, next) => next(e))

  // The six hooks a managed plugin's notices named (2026-11-10), each of which it can send on past the mod. Left out
  // with `leave_out_skipped_hooks`, as they never run there: Claude Code then has no skipped hook to tell the model of.
  if (!isLeftOut) {
    on('classic.PostToolUseFailure', ($, e, next) => noteToolFailure($, e, next, calls)).catch(($, e, next) => next(e))

    // The tool's own time, without the permission prompt or hooks: a call the person was asked about waited the rest
    on('classic.PostToolUse', ($, e, next) => noteToolTime($, e, next, calls)).catch(($, e, next) => next(e))

    // The person is asked only when no hook answered the request. It names no call id: it marks the newest unsettled
    // call of the tool whose check said ask.
    on('classic.PermissionRequest', ($, e, next) => notePermissionAsk($, e, next, calls)).catch(($, e, next) => next(e))

    // It can arrive after the call settled: the call is classified again, its row and counts replaced
    on('classic.PermissionDenied', ($, e, next) => notePermissionDenied($, e, next, calls)).catch(($, e, next) => next(e))

    // A skill the person runs as /name raises no Skill call; one the model runs raises both, and counts once. One with
    // no Skill call behind it while no main turn runs is the person's /name, in the main context; mid-turn, it is a
    // subagent's preload.
    // A `context: fork` skill runs in a subagent of its own (code.claude.com/docs/en/skills, read 2026-11-11).
    on('skill.prompt', ($, e, next) => countSkillPrompt($, e, next, calls)).catch(($, e, next) => next(e))

    // A /clear, a resume or a branch starts over at once; a resumed one also takes the cache rate its event carries
    on('classic.SessionStart', async ($, e, next) => {
      if (typeof e.permission_mode === 'string') modeMem.mode = e.permission_mode
      if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
        await startOver($, e.source, calls, held)
        const cost = e.estimated_cache_write_usd
        const tokens = e.context_tokens ?? 0
        if (e.source !== 'clear' && cost !== undefined && tokens > 0) {
          const model = e.model ?? null
          await updateCache($, c => takeRate(c, cost, tokens, model))
        }
      }
      await readCacheConfig($, held)
      if (e.source !== 'startup') return next(e)
      // A start: the stack's own SessionStart hook, beneath, writes this session's file, so it is read once those hooks
      // have run, not at the next poll. A compaction's rewrite waits for the poll: read here, it would step the handoff
      // on the context from before the compaction
      const result = await next(e)
      await readStatus($).catch(() => undefined)
      return result
    }).catch(($, e, next) => next(e))

    // A rule the main context loaded by path (spec 2026-11-11, D4): a match of its `paths:` globs, or a nested folder's
    // rules. A subagent's load is in its own context; a start-up or compaction load is the breakdown's to list. Only a
    // rule's frontmatter matches by path, so that file is a rule wherever a link under `.claude/rules/` lands it.
    on('classic.InstructionsLoaded', ($, e, next) => noteLoadedRule($, e, next)).catch(($, e, next) => next(e))

    // An edit to a settings file (spec settings-values S4): a read inside this hook still answers the old value (F4),
    // so the files are read again at the clock's next tick; left out, the 30 s poll reads them
    on('classic.ConfigChange', ($, e, next) => followConfigChange($, e, next)).catch(($, e, next) => next(e))
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'inspect', description: 'Session metrics, agents, tool failures, cache, the timeline and the plan in a pane', argumentHint: '[now|usage|agents|tools|cache|timeline|plan [name]|close|show [n]|copy [n]|report [n]|fill|band off|calm|full]' })
    await $.command.register({ name: 'rec', description: 'Recording mode: set "rec" in ~/.claude/settings.json, show the level, test it, or edit your private words', argumentHint: '[on|strict|off|test|words [close]]' })
    await $.command.register({ name: 'auto-handoff', description: 'Save a handoff now, set the handoff mode or first ask in ~/.claude/settings.json, or show them', argumentHint: '[ask|auto|off|at <percent>|now|compact|later]' })
    recMem.home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? null
    await loadSettings($, true)
    await readStatus($)
    freshMem.at = -Infinity
    conversationMem.id = await $.session.id()
    // Starts over a conversation no classic.SessionStart reported, moves the agent rows and redraws the running times,
    // once a second
    $.clock.every(1000, () => {
      followConversation($, null, calls, held).then(() => tickOnce($)).catch(() => undefined)
    })
    const now = await $.clock.now()
    await pruneCost($, now)
    for (const key of staleKeys(await storedTimes($), now)) await $.store.delete(key)
    await seedMine($)
    windowsMem.stored = null
    // A process that starts on a conversation with prompts in it resumed one; a reload keeps $.state and its last reading
    const isFresh = (await readUsage($)).at === 0
    const reading = await takeUsage($, await todayUsd($, now))
    await baseline($, reading)
    await readStart($)
    if (isFresh && (await $.session.turns().catch(() => 0)) > 0) await updateMeta($, m => ({ ...m, isResumed: true }))
    held.isTerminal = e.surface === 'terminal' && e.isInteractive
    await readCacheConfig($, held)
    // A reload keeps $.state but not the module's timer: a cache still warm gets its toast armed again
    await armCacheClose($, held)
    // A plan's file must be written after this to run; a reload keeps the first start's time
    await updatePlans($, p => (p.since === null ? { ...p, since: now } : p))
    $.clock.every(30_000, () => {
      queueReload($, held)
      // The status file is read whatever the settings read did
      loadSettings($).catch(() => undefined).then(() => readStatus($)).catch(() => undefined)
      pollPlace($).catch(() => undefined)
    })
    scheduleReload($, held)
    return started
  }).catch(($, e, next) => next(e))

  // Your prompt, typed at the terminal or sent through Remote Control, waits for the turn that answers it: the engine
  // queues one typed during a turn, and a slash command may start no turn at all. It waits before `next`, as the
  // engine may start its turn before this hook resumes; a prompt dropped beneath leaves, one rewritten is re-keyed.
  on('prompt.submit', async ($, e, next) => {
    // A conversation no classic.SessionStart reported starts over before its first prompt, which carries REC's note
    // even when the start-over fails
    await followConversation($, 'prompt', calls, held).catch(() => undefined)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const at = await $.clock.now()
    const key = fingerprint(e.text)
    await updateMeta($, m => ({ ...m, waiting: [...m.waiting, { at, key }].slice(-5) }))
    const level = recLevel()
    const note = level === noteMem.told ? null : recNote(level)
    noteMem.told = level
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
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
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
      await updateMeta($, m => ({ ...m, model: e.model, effort: e.effort === undefined ? m.effort : String(e.effort) }))
      const output = step.usage?.output_tokens
      if (output !== undefined && startedAt !== null) {
        const ms = (await $.clock.now()) - startedAt
        await updateTotals($, t => ({ ...t, stepOutput: t.stepOutput + output, stepMs: t.stepMs + ms }))
      }
      const u = step.usage
      const at = startedAt
      if (u !== null && at !== null && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
        await updateCache($, c => addRequest(c, u, at))
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
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await closeLoops($, held, [e.agentId ?? 'main'], await $.clock.now(), false)
    if (e.agentId !== undefined && !(await readAgents($)).some(r => r.id === e.agentId)) {
      const id = e.agentId
      if ((await readLoops($)).some(l => l.id === id)) await updateLoops($, list => list.map(l => (l.id === id ? { ...l, isDone: true } : l)))
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
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
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
  }).catch(($, e, next) => next(e))

  on('session.compact', ($, e, next) => followCompaction($, e, next, held)).catch(($, e, next) => next(e))

  // A switch forfeits the cache; its report gives the tier under the billing now and prices the rewrite
  on('classic.PostModelSwitch', ($, e, next) => afterModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // Claude Code may still ask to confirm the switch, so the cache stays warm; a switch a hook stops reports nothing
  on('classic.PreModelSwitch', ($, e, next) => beforeModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // '/inspect [tab]': opens the pane, never on its own. '/inspect plan <name>' pins that plan; 'plan' alone clears it.
  on('command.run', { command: 'inspect' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/)
    const word = (words[0] ?? '').toLowerCase()
    if (word === 'close') return { text: await closePane($, 'inspect', 'inspect pane') }
    if (word === 'band') return { text: mask(await bandCommand($, (words[1] ?? '').toLowerCase())) }
    if (word === 'show' || word === 'copy') return { text: mask(await failureCommand($, word, words[1])) }
    if (word === 'report') return { text: mask(await reportCommand($, words[1])) }
    if (word === 'fill') return { text: await fillStack($) }
    const tab = TABS.find(t => t === (word === '' ? 'now' : word))
    if (tab === undefined) return { text: INSPECT_HELP }
    if (tab === 'plan') {
      const name = words[1] ?? null
      const good = (await readPlans($)).plans.filter(w => w.value !== null).map(w => w.name).sort()
      if (name !== null && !good.includes(name)) {
        const asked = oneLine(printable(name), 40)
        return { text: good.length === 0 ? `No plan named ${asked}. No plan file in ${PLANS_DIR}/.` : `No plan named ${asked}. Plans: ${good.join(', ')}.` }
      }
      await updateView($, v => (v.planSlug === name ? v : { ...v, planSlug: name }))
    }
    const opened = await openInspect($, tab)
    return { text: opened.isPlaced ? 'Opened the inspect pane.' : `The inspect pane is open but not drawn: ${opened.reason}.` }
  })

  // '/rec [on|strict|off|test|words]': the level is a settings value (S5) that on, strict and off write into the user
  // file (the user's ruling, 2026-11-12); every form but words reads the files first, so a session that has not polled
  // answers with the level in force, never its own copy
  on('command.run', { command: 'rec' }, ($, e) => runRecCommand($, e))

  // '/auto-handoff [ask|auto|off|at <percent>|now]': the mode and the first ask are settings values (S5) that ask, auto,
  // off and at <percent> write into the user file (the user's ruling, 2026-11-12); a bare form reads the files first
  // and prints the state with each value's source, and while Alfred Code owns the handoff, its state alone
  on('command.run', { command: 'auto-handoff' }, ($, e) => runAutoHandoffCommand($, e, held))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Decided on module memory, so a person above meets no new read before the survey's check; the read keeps this
    // hook drawn again on a later "bandPlace": "above". The width it lends the footer redraws it only on a change.
    if (isPassingAbove(e.surface)) {
      await readBandSetting($)
      if (bandMem.columns !== e.props.bodyColumns) {
        bandMem.columns = e.props.bodyColumns
        $.ui.invalidate('ui.render')
      }
      return next(e)
    }
    if (e.props.hasSurvey) {
      bandMem.isShown = false
      return next(e)
    }
    const lines = bandLines(await bandInputOf($, { columns: e.props.bodyColumns, maxRows: e.props.maxRows, isWorking: e.props.isWorking, isLeftOut }))
    bandMem.isShown = lines.length > 0 && e.props.isCollapsed === false
    if (lines.length === 0) return next(e)
    return drawLines($, e, lines, { noColor: await isNoColor($), press: bandPress($, held), columns: e.props.bodyColumns })
  }).catch(($, e, next) => {
    if (isPassingAbove(e.surface)) return next(e)
    bandMem.isShown = false
    return drawNote($, e, bandFailed(next.error.kind))
  })

  // The band under the input, in Claude Code's footer on the terminal (spec band-under U2): Claude Code's own line first,
  // then the band, at the site above's width and the rows the screen leaves; above, or elsewhere, the footer as it was
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const setting = await readBandSetting($)
    const v = e.viewport
    if (setting.isUnder !== true || e.surface !== 'terminal' || v === undefined) return next(e)
    if (!bandMem.hasFooter) {
      bandMem.hasFooter = true
      $.ui.invalidate('ui.render')
    }
    const columns = Math.min(v.columns - 5, bandMem.columns ?? Infinity)
    const isPinned = typeof statusMem.last === 'string' && statusMem.last !== ''
    const maxRows = underRows(v, { hasStatusLine: bandMem.hasStatusLine, isPinned })
    const under = { buttons: v.isFullscreen === true ? 'click' as const : 'text' as const }
    const lines = bandLines(await bandInputOf($, { columns, maxRows, isWorking: e.props.isWorking, under, isLeftOut }))
    bandMem.isShown = lines.length > 0
    const beneath = await next(e)
    if (lines.length === 0) return beneath
    return drawUnder($, e, beneath, lines, { noColor: await isNoColor($), press: bandPress($, held), columns })
  }).catch(async ($, e, next) => {
    if (!bandMem.isUnder || e.surface !== 'terminal') return next(e)
    bandMem.isShown = false
    return drawUnderNote($, e, await next(e), bandFailed(next.error.kind))
  })

  // The main loop's spinner adds its action, context and the agents running; an agent's spinner, that agent's
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const text = spinnerSuffix({
      requestId: e.requestId ?? '', live: await readLive($), percent: (await readUsage($)).percent, agents: await readAgents($),
    })
    // REC masks the engine's word and message as well as the mod's own suffix
    const word = mask(e.props.word)
    const message = e.props.message === null ? null : mask(e.props.message)
    const props = word === e.props.word && message === e.props.message ? e.props : { ...e.props, word, message }
    if (text === null) return props === e.props ? next(e) : next({ ...e, props })
    return next({ ...e, props: { ...props, suffix: `${e.props.suffix} ${mask(printable(text))}` } })
  }).catch(($, e, next) => (recLevel() === 'off' ? next(e) : next({ ...e, props: { ...e.props, word: SPINNER_WORD, message: null } })))

  // REC on Claude Code's rows: each site rewrites its props only while REC is on and masking changes something, else
  // passes next(e) as it came. The stored messages and what the model reads stay as they are.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => maskUserMessage($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => maskAssistantMessage($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => maskCommandOutput($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // The tool sites in two steps (Decision 14): "quiet"'s compact row or emptied result first, then REC over whatever
  // the first hands on. A settled row that is not expanded, or that a group unfolded, draws its compact line.
  // An unfolded group's rows draw `output` inline, so a row's input and output are both masked
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => drawToolUse($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // With "quiet" on an errored result draws an empty Box, as Claude Code would draw its whole error text and the compact
  // row above carries ✗ and its error lines, and so does a result whose row carries what it said (DROPS_RESULT: Bash,
  // Edit, Write and more); any other keeps next(e)'s tree, the classifier line in it. Under REC, so does an errored
  // result whose row drew its masked error text
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => drawToolResult($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // With "quiet" on a settled group of calls alone draws its compact lines. One holding another row, or an errored or
  // interrupted call, is unfolded and its calls marked, so each draws its own compact line; a group drawn expanded (the
  // main screen's ctrl+o) unmarks them, so ctrl+o shows all. A group's folded line shows its calls' paths, patterns and
  // git results, and `isExpanded` is the one prop a rewrite changes, so REC unfolds it into ToolUse rows, which the
  // hook above masks, live or settled.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => drawToolGroup($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'AskUserQuestion' }, ($, e, next) => maskQuestionDialog($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : next({ ...e, props: { ...e.props, questions: neutralDialog(e.props.questions) } })))

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, async ($, e) => {
    await readTick($)
    const now = await $.clock.now()
    const counts = await readLive($)
    const shown = await readView($)
    const rows = await readFailures($)
    const d = await planDraw($, now)
    const u = await readUsage($)
    const h = await readHandoff($)
    const m = await readMeta($)
    const st = await readStack($)
    const runway = runwayOf(st, u, m.model)
    const input = {
      now, columns: e.props.bodyColumns, isWorking: counts.turnId !== null, live: counts, usage: u,
      meta: m, turns: await readTurns($), newFailures: rows.filter(f => f.isNew).length,
      pace: await readPace($), failures: rows, stats: await readStats($), totals: await readTotals($), view: shown,
      agents: await readAgents($), cache: await readCache($), plan: d.band, planInvalid: d.invalid, score: d.score, isPlanScore: d.isPlanScore, scoreLevel: await scoreLevel($), blockers: await readBlockers($), parts: await readParts($),
      loops: await readLoops($),
      rec: recOf(await readRec($)), forecast: forecastOf(h, u, runway), handoff: handoffView(h, u, counts.turnId !== null, runway),
      stack: { view: st, prompt: stackMem.prompt, runway, sessionModel: m.model },
    }
    const bar = tabBar(shown.tab, counts.turnId !== null, e.props.bodyColumns)
    const body = shown.tab === 'usage' ? usageLines(input)
      : shown.tab === 'agents' ? agentsLines(input)
      : shown.tab === 'cache' ? cacheLines(input)
      : shown.tab === 'tools' ? toolsLines(input)
      : shown.tab === 'timeline' ? timelineLines(input.turns, Math.max(3, e.props.scroll.bodyRows - 1 - bar.length), u.windows.length > 0, e.props.bodyColumns)
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
      'stack-fill': async () => toast($, await fillStack($)),
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
    // On the terminal's main screen nothing takes a click, and the pane's keys may not reach the mod (the user,
    // 2026-11-12): each button draws as its command
    const isMain = e.surface === 'terminal' && e.viewport?.isFullscreen === false
    const lines = isMain ? asCommands([...bar, ...body], paneCommands(rows, input.agents)) : [...bar, ...body]
    return drawLines($, e, lines, { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
  }).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))

  // The private-words pane: words are added only here, never through a command's arguments, which the transcript echoes
  on('ui.render', { component: 'Pane', requestId: 'rec' }, ($, e) => drawRecPane($, e)).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))
}
