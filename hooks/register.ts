// The alfred-mods hooks module. Every hook observes and draws; none approves, denies or rewrites a tool call.
// Each $.state atom is made, read and updated in its owner folder's effects.ts: `claude plugin validate` refuses an atom
// or a ref handed to another module.
import type {
  EngineInterface, Register, SessionContextBreakdown, SessionRateLimit, SessionUsage, Timer, TurnStepInput, TurnStepResult, UiOpenResult,
} from 'claude-code'

import { isLive, refreshAgents } from './agents/agents'
import { spinnerSuffix } from './band/working'
import { bandLines, underRows } from './band/band'
import { billingOf, needsTick, takeRate } from './cache/cache'
import { drawLines, drawNote, drawUnder, drawUnderNote } from './core/draw'
import { localDate } from './core/forecast'
import { REC_HIDDEN, SPINNER_WORD, bandFailed, paneFailed } from './core/failsafe'
import { clock, fingerprint, printable, tokens, when } from './core/format'
import { mask, recLevel } from './rec/mask'
import { neutralDialog } from './rec/sites'
import { DROPS_RESULT } from './tools/compact'
import { forecastOf } from './handoff/handoff'
import { bannerSegs, runwayOf } from './stack/stack'
import { runs } from './plan/plan'
import { staleKeys } from './plan/steptime'
import { recNote, recOf } from './rec/rec'
import { dropPassed } from './session/windows'
import { countSkillPrompt, drawToolGroup, drawToolResult, drawToolUse, modeMem, notePermissionAsk, notePermissionDenied, notePromptMode, noteToolCheck, noteToolFailure, noteToolTime, readFailures, readStats, resetBlockers, resetFailures, resetQuiet, resetStats, trackToolCall } from './tools/effects'
import { FRESH_EVERY_MS, baseline, completeTurn, freshMem, freshUsage, pruneCost, readLive, readMeta, readPace, readTick, readTotals, readTurns, readUsage, resetLive, resetMeta, resetPace, resetTotals, resetTurns, resetUsage, seedWindows, spendMem, startTurn, takeMeasure, takeUsage, todayMem, todayUsd, trackTurnStep, updateMeta, updateTick, updateUsage, windowsMem } from './session/effects'
import { readAgents, resetAgents, resetLoops, trackSpawn, updateAgents } from './agents/effects'
import { afterModelSwitch, armCacheClose, beforeModelSwitch, compactNow, followCompaction, readCache, readCacheConfig, resetCache, updateCache } from './cache/effects'
import { planDraw, queueReload, resetCredit, resetPlans, resetTasks, scheduleReload, seedMine, storedTimes, updatePlans } from './plan/effects'
import { readStack, readStatus, resetStack, scoreLevel, stackMem } from './stack/effects'
import { fillResume, handoffMem, readHandoff, resetHandoff, runAutoHandoffCommand, saveNow } from './handoff/effects'
import { drawRecPane, maskAssistantMessage, maskCommandOutput, maskQuestionDialog, maskUserMessage, noteMem, readRec, recMem, resetRec, runRecCommand } from './rec/effects'
import { bandMem, isPassingAbove, readBandSetting, statusMem, syncStatus } from './band/effects'
import { noteLoadedRule, partsMem, readBreakdownSoon, readParts, resetParts } from './context/effects'
import { drawInspectPane, inspectFromBand, resetView, runInspectCommand } from './inspect/effects'
import type { BandInput } from './band/types'
import type { Call } from './tools/types'
import type { Held } from './core/types'
import { pollPlace, readPlace } from './place/effects'
import { followConfigChange, loadSettings } from './settings/effects'
import { conversationMem, tickMem } from './lifecycle/effects'
import { isNoColor, toast } from './core/effects'

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

  on('turn.start', ($, e, next) => startTurn($, e, next)).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    return yield* trackTurnStep($, e, next, held)
  })

  on('turn.complete', ($, e, next) => completeTurn($, e, next, held)).catch(($, e, next) => next(e))

  on('session.measure', ($, e, next) => takeMeasure($, e, next)).catch(($, e, next) => next(e))

  on('session.compact', ($, e, next) => followCompaction($, e, next, held)).catch(($, e, next) => next(e))

  // A switch forfeits the cache; its report gives the tier under the billing now and prices the rewrite
  on('classic.PostModelSwitch', ($, e, next) => afterModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // Claude Code may still ask to confirm the switch, so the cache stays warm; a switch a hook stops reports nothing
  on('classic.PreModelSwitch', ($, e, next) => beforeModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // '/inspect [tab]': opens the pane, never on its own. '/inspect plan <name>' pins that plan; 'plan' alone clears it.
  on('command.run', { command: 'inspect' }, ($, e) => runInspectCommand($, e))

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

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, ($, e) => drawInspectPane($, e, held)).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))

  // The private-words pane: words are added only here, never through a command's arguments, which the transcript echoes
  on('ui.render', { component: 'Pane', requestId: 'rec' }, ($, e) => drawRecPane($, e)).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))
}
