// The session-inspector hooks module. Every hook observes and draws; none approves, denies or rewrites a tool call.
// Every $.state atom is made, read and updated here alone: `claude plugin validate` refuses an atom or a ref
// imported from another module.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage, UiOpenResult } from 'claude-code'

import { bandLines } from './band.ts'
import { baseCost, pruneCost, recordCost, todayUsd } from './cost.ts'
import { drawLines } from './draw.tsx'
import { fingerprint, when } from './format.ts'
import { toast } from './mask.ts'
import { nowLines, tabBar, timelineLines, toolsLines, usageLines } from './tabs.ts'
import { classify, fold, targetOf, toolKey } from './outcome.ts'
import type { CallFacts } from './outcome.ts'
import type { Failure, Live, Meta, Outcome, Pace, Tab, ToolStat, Totals, Turn, Usage, View, Window } from '../types'

// What the events said about one call. Never drawn, so a reload losing the calls in flight costs only those.
type Call = {
  facts: CallFacts; key: string; tool: string; target: string; agentId: string | null
  settled: boolean; outcome: Outcome | null; rowId: string | null
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
    waiting: [],
  } as Meta,
  view: { tab: 'now', shown: [] } as View,
  pace: {} as Pace,
  agents: [] as string[],
}

// Change a tag when that value's fields change: it declines what an earlier version stored, which outlives a reload.
const stats = atom({ plugin: 'session-inspector', key: 'stats' } as const, INITIAL.stats, { shape: 'stats-1' })
const failures = atom({ plugin: 'session-inspector', key: 'failures' } as const, INITIAL.failures, { shape: 'failures-1' })
const turns = atom({ plugin: 'session-inspector', key: 'turns' } as const, INITIAL.turns, { shape: 'turns-1' })
const live = atom({ plugin: 'session-inspector', key: 'live' } as const, INITIAL.live, { shape: 'live-2' })
const usage = atom({ plugin: 'session-inspector', key: 'usage' } as const, INITIAL.usage, { shape: 'usage-1' })
const totals = atom({ plugin: 'session-inspector', key: 'totals' } as const, INITIAL.totals, { shape: 'totals-1' })
const meta = atom({ plugin: 'session-inspector', key: 'meta' } as const, INITIAL.meta, { shape: 'meta-2' })
const view = atom({ plugin: 'session-inspector', key: 'view' } as const, INITIAL.view, { shape: 'view-2' })
const pace = atom({ plugin: 'session-inspector', key: 'pace' } as const, INITIAL.pace, { shape: 'pace-1' })
const agents = atom({ plugin: 'session-inspector', key: 'agents' } as const, INITIAL.agents, { shape: 'agents-1' })
const tick = atom({ plugin: 'session-inspector', key: 'tick' } as const, 0)

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
  return agentId === undefined || (await read($, agents)).includes(agentId)
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
  await update($, stats, s => ({ ...s, [call.key]: before === null ? tally(s[call.key], outcome, 1) : tally(tally(s[call.key], before, -1), outcome, 1) }))
  if (outcome !== 'ok') await addRow($, id, call, outcome, reason, isNew, before !== null && before !== 'ok' ? call.rowId : null)
  const isMain = call.agentId === null
  const failed = (o: Outcome | null): number => (o !== null && o !== 'ok' ? 1 : 0)
  await update($, live, l => ({
    ...l,
    tools: isMain && l.turnId !== null && before === null ? l.tools + 1 : l.tools,
    failures: isMain && l.turnId !== null ? l.failures + failed(outcome) - failed(before) : l.failures,
    running: l.running.filter(r => r.id !== id),
  }))
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

async function tickOnce($: EngineInterface): Promise<void> {
  if ((await read($, live)).turnId !== null) await update($, tick, n => n + 1)
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
  await update($, tick, () => 0)
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

const TABS: Tab[] = ['now', 'usage', 'tools', 'timeline']

async function isNoColor($: EngineInterface): Promise<boolean> {
  return ((await $.env.get('NO_COLOR')) ?? '') !== ''
}

export const register: Register = on => {
  // Keyed by call id, at most 100, the oldest dropped first
  const calls = new Map<string, Call>()

  const remember = (id: string, tool: string): Call => {
    let call = calls.get(id)
    if (call === undefined) {
      call = { facts: { tool, ...NO_FACTS }, key: tool, tool, target: '', agentId: null, settled: false, outcome: null, rowId: null }
      calls.set(id, call)
      if (calls.size > 100) calls.delete(calls.keys().next().value as string)
    }
    return call
  }

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const id = e.resume?.agentId ?? spawned.agentId
    if (id !== undefined) await update($, agents, list => (list.includes(id) ? list : [...list, id]))
    return spawned
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (!(await isCounted($, e.agentId))) return next(e)
    const input = e as unknown as Record<string, unknown>
    const call = remember(e.tool_use_id, e.tool)
    call.key = toolKey(e.tool, input)
    call.target = targetOf(e.tool, input, await $.session.cwd())
    call.agentId = e.agentId ?? null
    if (call.agentId === null && e.tool === 'Bash') {
      const startedAt = await $.clock.now()
      await update($, live, l => ({ ...l, running: [...l.running, { id: e.tool_use_id, label: call.target, startedAt }] }))
    }
    const ran = await next(e)
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
    call.facts = { ...call.facts, result: { isError: ran.isError === true || ran.deny !== undefined, deny: ran.deny ?? null, text } }
    await settle($, e.tool_use_id, call)
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
    await $.command.register({ name: 'inspect', description: 'Session metrics, tool failures and the timeline in a pane', argumentHint: '[now|usage|tools|timeline]' })
    // Redraws the running times once a second, and only while a turn runs
    $.clock.every(1000, () => {
      void tickOnce($)
    })
    const now = await $.clock.now()
    await pruneCost($, now)
    const reading = await takeUsage($, await todayUsd($, now))
    await baseline($, reading)
    return started
  }).catch(($, e, next) => next(e))

  // A /clear, a resume or a fork starts the session over under a new id: Claude Code resets $.state itself, and the
  // mod writes its own start values too, so the reset is the mod's and testable
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      calls.clear()
      await resetAll($)
      await baseline($, await takeUsage($, await todayUsd($, await $.clock.now())))
    }
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
    if (e.agentId === undefined) {
      const startedAt = await $.clock.now()
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
    if (e.agentId !== undefined) return yield* next(e)
    const startedAt = await $.clock.now()
    const step = yield* next(e)
    try {
      const ms = (await $.clock.now()) - startedAt
      await update($, meta, m => ({ ...m, model: e.model, effort: e.effort === undefined ? m.effort : String(e.effort) }))
      const output = step.usage?.output_tokens
      if (output !== undefined) await update($, totals, t => ({ ...t, stepOutput: t.stepOutput + output, stepMs: t.stepMs + ms }))
    } catch {
      // The step's figures are lost; the step itself stands
    }
    return step
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined && !(await read($, agents)).includes(e.agentId)) return done
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
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) {
      const at = await $.clock.now()
      await update($, meta, m => ({ ...m, compactions: m.compactions + 1, lastCompactAt: at }))
    }
    return compacted
  }).catch(($, e, next) => next(e))

  // '/inspect [tab]': opens the pane, never on its own
  on('command.run', { command: 'inspect' }, async ($, e) => {
    const word = (e.args.trim().split(/\s+/)[0] ?? '').toLowerCase()
    const tab = TABS.find(t => t === (word === '' ? 'now' : word))
    if (tab === undefined) return { text: 'Tabs: now, usage, tools, timeline.' }
    const opened = await openInspect($, tab)
    return { text: opened.isPlaced ? 'Opened the inspect pane.' : `The inspect pane is open but not drawn: ${opened.reason}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Read so the running times redraw each second while a turn runs
    await read($, tick)
    const lines = bandLines({
      now: await $.clock.now(), columns: e.props.bodyColumns, isWorking: e.props.isWorking,
      live: await read($, live), usage: await read($, usage), meta: await read($, meta), turns: await read($, turns),
      newFailures: (await read($, failures)).filter(f => f.isNew).length, pace: await read($, pace),
    })
    if (lines.length === 0) return next(e)
    return drawLines($, e, lines, { noColor: await isNoColor($), press: { inspect: () => inspectFromBand($) } })
  })

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, async ($, e) => {
    await read($, tick)
    const now = await $.clock.now()
    const counts = await read($, live)
    const shown = await read($, view)
    const rows = await read($, failures)
    const input = {
      now, columns: e.props.bodyColumns, isWorking: counts.turnId !== null, live: counts, usage: await read($, usage),
      meta: await read($, meta), turns: await read($, turns), newFailures: rows.filter(f => f.isNew).length,
      pace: await read($, pace), failures: rows, stats: await read($, stats), totals: await read($, totals), view: shown,
    }
    const body = shown.tab === 'usage' ? usageLines(input)
      : shown.tab === 'tools' ? toolsLines(input)
      : shown.tab === 'timeline' ? timelineLines(input.turns, Math.max(3, e.props.scroll.bodyRows - 2))
      : nowLines(input)
    const press: Record<string, () => unknown> = {
      'tab-now': () => openInspect($, 'now'),
      'tab-usage': () => openInspect($, 'usage'),
      'tab-tools': () => openInspect($, 'tools'),
      'tab-timeline': () => openInspect($, 'timeline'),
    }
    for (const row of rows) {
      press[`show-${row.id}`] = () => toggleShown($, row.id)
      press[`copy-${row.id}`] = () => $.ui.copy({ text: row.detail, surface: e.surface })
    }
    return drawLines($, e, [tabBar(shown.tab, counts.turnId !== null), ...body], { noColor: await isNoColor($), press })
  })
}
