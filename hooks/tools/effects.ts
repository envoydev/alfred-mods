// The tools folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Call, CompactCall, Failure, Outcome, Quiet, ToolStat } from './types'
import { addRunningCall, addSkill, countMainCall, readLive, settleRunningCall } from '../session/effects'
import { classify, fold, tally, targetOf, toolKey } from './outcome'
import { isPaneShown, readView } from '../inspect/effects'
import { isCounted, updateRow } from '../agents/effects'
import { keepLast } from '../core/collections'
import { settingsNow } from '../settings/effects'
import { syncStatus } from '../band/effects'
import { actionOf } from '../agents/agents'
import { isAllWait, waitOf } from '../plan/steptime'
import { mask } from '../rec/mask'
import { editPlace, pollPlace, workingFolder } from '../place/effects'
import type { Held, HookInput, HookNext, MatchedInput, MatchedNext } from '../core/types'
import { drawLines } from '../core/draw'
import { DROPS_RESULT, callLine, groupLines } from './compact'
import { maskDeep, maskResult, resultLines } from '../rec/sites'
import { isNoColor } from '../core/effects'
import { remember } from './calls'
import { addWait, closeCallWait, followTaskTools, openCallWait, scheduleReload } from '../plan/effects'
import { isRecOn } from '../rec/effects'

const INITIAL_STATS: Record<string, ToolStat> = {}
const statsAtom = atom({ plugin: 'alfred-mods', key: 'stats' } as const, INITIAL_STATS, { shape: 'stats-1' })
export function readStats($: EngineInterface) {
  return read($, statsAtom)
}
function updateStats($: EngineInterface, change: (value: Record<string, ToolStat>) => Record<string, ToolStat>) {
  return update($, statsAtom, change)
}
export function resetStats($: EngineInterface) {
  return update($, statsAtom, () => INITIAL_STATS)
}

const INITIAL_FAILURES: Failure[] = []
const failuresAtom = atom({ plugin: 'alfred-mods', key: 'failures' } as const, INITIAL_FAILURES, { shape: 'failures-1' })
export function readFailures($: EngineInterface) {
  return read($, failuresAtom)
}
function updateFailures($: EngineInterface, change: (value: Failure[]) => Failure[]) {
  return update($, failuresAtom, change)
}
export function resetFailures($: EngineInterface) {
  return update($, failuresAtom, () => INITIAL_FAILURES)
}

const INITIAL_BLOCKERS: Record<string, number> = {}
const blockersAtom = atom({ plugin: 'alfred-mods', key: 'blockers' } as const, INITIAL_BLOCKERS, { shape: 'blockers-1' })
export function readBlockers($: EngineInterface) {
  return read($, blockersAtom)
}
function updateBlockers($: EngineInterface, change: (value: Record<string, number>) => Record<string, number>) {
  return update($, blockersAtom, change)
}
export function resetBlockers($: EngineInterface) {
  return update($, blockersAtom, () => INITIAL_BLOCKERS)
}

const INITIAL_QUIET: Quiet = { isOn: false }
const quietAtom = atom({ plugin: 'alfred-mods', key: 'quiet' } as const, INITIAL_QUIET, { shape: 'quiet-1' })
export function readQuiet($: EngineInterface) {
  return read($, quietAtom)
}
function updateQuiet($: EngineInterface, change: (value: Quiet) => Quiet) {
  return update($, quietAtom, change)
}
export function resetQuiet($: EngineInterface) {
  return update($, quietAtom, () => INITIAL_QUIET)
}

// The session's permission mode as the classic events last reported it (`permission_mode`), for the failure rule in
// auto mode; null until one arrives
const modeMem = { mode: null as string | null }

// Compact rows' memory (Decisions 4 and 7): each settled call's outcome and reason, and the calls of a group the mod
// unfolded, by call id, each the last 500. A reload empties both: a blocked call then draws ✗.
const compactMem = { outcomes: new Map<string, { outcome: Outcome; reason: string; isAutoAllowed: boolean }>(), marks: new Set<string>() }

// Each errored call's error text, the one Claude Code draws under it, by call id, the last 500: from the call's result,
// or from its row for a call the mod did not see run (a resumed transcript). Kept in memory only, for REC to mask.
const errorMem = new Map<string, string>()

// The errored calls whose row drew the masked error text itself, so their result block draws nothing, the last 500
const errorRows = new Set<string>()

// A failure row for a call that was not ok; it is seen at once while the pane shows Now or Tools
export async function addRow($: EngineInterface, id: string, call: Call, outcome: Exclude<Outcome, 'ok'>, reason: string, isNew: boolean, drop: string | null, by: string | null): Promise<void> {
  const { tab } = await readView($)
  const isSeen = (tab === 'now' || tab === 'tools') && await isPaneShown($)
  const result = call.facts.result
  const row: Failure = {
    id, at: await $.clock.now(), tool: call.tool, target: call.target, outcome, reason,
    detail: (result?.deny ?? result?.text ?? '').slice(0, 4000), count: 1, isNew: isNew && !isSeen, by,
  }
  await updateFailures($, list => {
    const i = drop === null ? -1 : list.findIndex(f => f.id === drop)
    const old = list[i]
    const rest = old === undefined ? list
      : old.count > 1 ? list.map(f => (f === old ? { ...f, count: f.count - 1 } : f))
      : list.filter(f => f !== old)
    // A call settled again keeps its row's number
    const out = fold(rest, old !== undefined && old.count === 1 && old.n !== undefined ? { ...row, n: old.n } : row)
    call.rowId = out[out.length - 1]?.id ?? null
    return out
  })
}

export function mark(ids: string[]): void {
  for (const id of ids) {
    compactMem.marks.delete(id)
    compactMem.marks.add(id)
  }
  keepLast(compactMem.marks)
}

// A row's or a group call's facts as a compact row reads them; a refusal draws as a block
export function compactOf(id: string | undefined, c: { tool: string; input: unknown; output?: unknown; isErrored: boolean; isInterrupted: boolean }): CompactCall {
  const o = id === undefined ? undefined : compactMem.outcomes.get(id)
  const outcome = o?.outcome === 'denied' ? 'denied' : o?.outcome === 'blocked' || o?.outcome === 'refused' ? 'blocked' : null
  return {
    tool: c.tool, input: c.input, output: c.output, isErrored: c.isErrored, isInterrupted: c.isInterrupted, outcome,
    reason: outcome === null ? null : o?.reason ?? null, isAutoAllowed: o?.isAutoAllowed === true,
  }
}

// Counts a settled call, or counts it again when a later event changed its outcome
export async function settle($: EngineInterface, id: string, call: Call): Promise<void> {
  const { outcome, reason, isNew, by } = classify(call.facts)
  compactMem.outcomes.delete(id)
  // In auto mode a check's ask that no one saw and no hook refused was the classifier's allow (outcome.ts)
  const f = call.facts
  const isAutoAllowed = outcome === 'ok' && f.autoMode && f.checked === 'ask' && !f.asked && f.hookDeny === null
  compactMem.outcomes.set(id, { outcome, reason, isAutoAllowed })
  keepLast(compactMem.outcomes)
  const before = call.outcome
  call.settled = true
  call.outcome = outcome
  const retally = (s: Record<string, ToolStat>): Record<string, ToolStat> =>
    ({ ...s, [call.key]: before === null ? tally(s[call.key], outcome, 1) : tally(tally(s[call.key], before, -1), outcome, 1) })
  await updateStats($, retally)
  if (call.agentId !== null) await updateRow($, call.agentId, r => ({ ...r, tools: retally(r.tools) }))
  if (outcome !== 'ok') await addRow($, id, call, outcome, reason, isNew, before !== null && before !== 'ok' ? call.rowId : null, by)
  // A block counts for the script that made it; a later settle that names another blocker moves the count (spec C6)
  const counted = call.by
  call.by = by
  if (counted !== by) {
    await updateBlockers($, b => {
      const out = { ...b }
      if (counted !== null) {
        const n = (out[counted] ?? 0) - 1
        if (n > 0) out[counted] = n
        else delete out[counted]
      }
      if (by !== null) out[by] = (out[by] ?? 0) + 1
      return out
    })
  }
  const isMain = call.agentId === null
  const failed = (o: Outcome | null): number => (o !== null && o !== 'ok' ? 1 : 0)
  await settleRunningCall($, id, { isMain, isFirstSettle: before === null, failuresDelta: failed(outcome) - failed(before) })
  if (isMain && before === null) await countMainCall($)
  // A Skill call that failed loaded nothing, and one whose skill ran forked loaded it into a subagent
  if (isMain && before === null && outcome === 'ok' && call.isFork !== true && call.key.startsWith('Skill: ')) {
    await addSkill($, call.key.slice('Skill: '.length))
  }
  await syncStatus($)
}

export function keepError(id: string, text: string): void {
  errorMem.delete(id)
  errorMem.set(id, text)
  keepLast(errorMem)
}

// "quiet" into the quiet atom
export async function loadQuiet($: EngineInterface): Promise<boolean> {
  const isOn = settingsNow().quiet
  await updateQuiet($, q => (q.isOn === isOn ? q : { isOn }))
  return isOn
}

export async function trackToolCall($: EngineInterface, e: HookInput<'tool.call'>, next: HookNext<'tool.call'>, calls: Map<string, Call>, held: Held) {
  if (!(await isCounted($, e.agentId))) return next(e)
  const input = e as unknown as Record<string, unknown>
  const call = remember(calls, e.tool_use_id, e.tool)
  call.key = toolKey(e.tool, input)
  call.target = targetOf(e.tool, input, await $.session.cwd())
  call.agentId = e.agentId ?? null
  call.facts = { ...call.facts, autoMode: modeMem.mode === 'auto' }
  const startedAt = await $.clock.now()
  call.startedAt = startedAt
  if (call.agentId === null) {
    await addRunningCall($, { id: e.tool_use_id, tool: e.tool, label: call.target, startedAt })
  } else {
    const action = actionOf(e.tool, call.target)
    await updateRow($, call.agentId, r => ({ ...r, action }))
  }
  const loop = call.agentId ?? 'main'
  const isWait = isAllWait(e.tool, call.agentId === null)
  if (isWait) await openCallWait($, loop, e.tool_use_id, startedAt)
  const ran = await next(e)
  // A `cd` in the main loop's Bash, or a file it edited or wrote, moves the folder Claude works in: the place is read
  // again off the hook
  const isEdit = ['Edit', 'Write', 'NotebookEdit'].includes(e.tool) && ran.isError !== true && ran.deny === undefined
  const edited = isEdit ? String(input.file_path ?? input.notebook_path ?? '') : ''
  if (call.agentId === null && (e.tool === 'Bash' || edited !== '')) {
    $.clock.after(0, () => {
      (edited === '' ? pollPlace($) : editPlace($, edited)).catch(() => undefined)
    })
  }
  const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
  if (ran.isError === true && text !== '') keepError(e.tool_use_id, text)
  call.facts = {
    ...call.facts,
    result: { isError: ran.isError === true || ran.deny !== undefined, deny: ran.deny ?? null, text },
    aborted: ran.isError === true && next.signal.aborted,
  }
  await settle($, e.tool_use_id, call)
  const endedAt = await $.clock.now()
  const ms = endedAt - startedAt
  const wait = waitOf({ tool: e.tool, ms, isMain: call.agentId === null, isAsked: call.facts.asked, outcome: call.outcome, durationMs: call.durationMs })
  let isClosed = false
  if (isWait) isClosed = await closeCallWait($, loop, e.tool_use_id, endedAt)
  if (wait === null) call.pendingMs = ms
  else if (!isClosed) await addWait($, loop, wait, endedAt)
  if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') scheduleReload($, held)
  if (call.agentId === null && call.outcome === 'ok') {
    const result = ran.result
    await followTaskTools($, held, e.tool, input, result)
  }
  return ran
}

export async function noteToolCheck($: EngineInterface, e: HookInput<'tool.check'>, next: HookNext<'tool.check'>, calls: Map<string, Call>) {
  const verdict = await next(e)
  if (e.tool_use_id !== undefined && (await isCounted($, e.agentId))) {
    const call = remember(calls, e.tool_use_id, e.tool)
    call.facts = { ...call.facts, checked: verdict.decision, checkReason: verdict.reason ?? null }
  }
  return verdict
}

export function notePromptMode($: EngineInterface, e: HookInput<'classic.UserPromptSubmit'>, next: HookNext<'classic.UserPromptSubmit'>) {
  if (typeof e.permission_mode === 'string') modeMem.mode = e.permission_mode
  return next(e)
}

export function noteToolFailure($: EngineInterface, e: HookInput<'classic.PostToolUseFailure'>, next: HookNext<'classic.PostToolUseFailure'>, calls: Map<string, Call>) {
  const call = calls.get(e.tool_use_id)
  if (call !== undefined) call.facts = { ...call.facts, failedInTool: true, interrupted: e.is_interrupt === true }
  return next(e)
}

export async function noteToolTime($: EngineInterface, e: HookInput<'classic.PostToolUse'>, next: HookNext<'classic.PostToolUse'>, calls: Map<string, Call>) {
  if (e.agent_id === undefined && typeof e.permission_mode === 'string') modeMem.mode = e.permission_mode
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
}

export async function notePermissionAsk($: EngineInterface, e: HookInput<'classic.PermissionRequest'>, next: HookNext<'classic.PermissionRequest'>, calls: Map<string, Call>) {
  const answered = await next(e)
  const call = [...calls.values()].reverse().find(c => !c.settled && c.facts.tool === e.tool_name && c.facts.checked === 'ask')
  const decision = answered.decision
  if (call !== undefined && decision === undefined) call.facts = { ...call.facts, asked: true }
  if (call !== undefined && decision?.behavior === 'deny') call.facts = { ...call.facts, hookDeny: decision.message ?? '' }
  return answered
}

export async function notePermissionDenied($: EngineInterface, e: HookInput<'classic.PermissionDenied'>, next: HookNext<'classic.PermissionDenied'>, calls: Map<string, Call>) {
  const call = calls.get(e.tool_use_id)
  if (call !== undefined) {
    call.facts = { ...call.facts, classifierReason: e.reason }
    if (call.settled) await settle($, e.tool_use_id, call)
  }
  return next(e)
}

export async function countSkillPrompt($: EngineInterface, e: HookInput<'skill.prompt'>, next: HookNext<'skill.prompt'>, calls: Map<string, Call>) {
  const prompted = await next(e)
  const key = `Skill: ${e.skill}`
  const isFork = e.frontmatter.context === 'fork'
  const pending = [...calls.values()].find(c => !c.settled && c.key === key)
  if (pending !== undefined) {
    if (isFork) pending.isFork = true
  } else {
    await updateStats($, s => ({ ...s, [key]: tally(s[key], 'ok', 1) }))
    if (!isFork && (await readLive($)).turnId === null) await addSkill($, e.skill)
  }
  return prompted
}

export async function drawToolUse($: EngineInterface, e: MatchedInput<'ui.render', { component: 'ToolUse' }>, next: MatchedNext<'ui.render', { component: 'ToolUse' }>) {
  if (e.props.isErrored && typeof e.props.output === 'string' && !errorMem.has(e.props.tool_use_id)) keepError(e.props.tool_use_id, e.props.output)
  if ((await readQuiet($)).isOn && !e.props.isRunning && (e.props.isExpanded !== true || compactMem.marks.has(e.props.tool_use_id))) {
    const columns = e.viewport?.columns ?? 120
    const lines = callLine(compactOf(e.props.tool_use_id, e.props), columns, { cwd: workingFolder() })
    return drawLines($, e, lines, { noColor: await isNoColor($), press: {}, columns , fill: true })
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
      const columns = e.viewport?.columns ?? 120
      const head = callLine(compactOf(e.props.tool_use_id, e.props), columns, { cwd: workingFolder() }).slice(0, 1)
      const isExpanded = e.props.isExpanded === true
      return drawLines($, e, [...head, ...resultLines(failed.text, { isExpanded, isErrored: true, gutter: e.surface === 'terminal' })], { noColor: await isNoColor($), press: {}, columns , fill: true })
    }
  }
  const input = maskDeep(e.props.input, mask)
  const output = maskDeep(e.props.output, mask)
  if (input === e.props.input && output === e.props.output) return next(e)
  return next({ ...e, props: { ...e.props, input, ...(output === e.props.output ? {} : { output }) } })
}

export async function drawToolResult($: EngineInterface, e: MatchedInput<'ui.render', { component: 'ToolResult' }>, next: MatchedNext<'ui.render', { component: 'ToolResult' }>) {
  // Fullscreen's ctrl+o draws no group, so nothing there unmarks the rows a group unfolded; an expanded result draws
  // only in that view (an unfolded group draws its rows' output inline), so it unmarks its row and redraws it in full
  if (e.props.isExpanded === true && compactMem.marks.delete(e.props.tool_use_id)) $.ui.invalidate('ui.render')
  const isDropped = e.props.isErrored || DROPS_RESULT.includes(e.props.tool)
  if (isDropped && e.props.isExpanded !== true && (await readQuiet($)).isOn) return drawLines($, e, [], { noColor: false, press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
  if (!(await isRecOn($))) return next(e)
  if (e.props.isErrored && errorRows.has(e.props.tool_use_id)) return drawLines($, e, [], { noColor: false, press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
  const masked = maskResult({ ...e.props, error: errorMem.get(e.props.tool_use_id) ?? null }, mask)
  if (masked.kind === 'same') return next(e)
  if (masked.kind === 'output') return next({ ...e, props: { ...e.props, output: masked.output } })
  const lines = resultLines(masked.text, { isExpanded: e.props.isExpanded === true, isErrored: e.props.isErrored, gutter: e.surface === 'terminal' })
  return drawLines($, e, lines, { noColor: await isNoColor($), press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
}

export async function drawToolGroup($: EngineInterface, e: MatchedInput<'ui.render', { component: 'ToolGroup' }>, next: MatchedNext<'ui.render', { component: 'ToolGroup' }>) {
  const isQuiet = (await readQuiet($)).isOn
  const isRec = await isRecOn($)
  const ids = e.props.calls.flatMap(c => (c.tool_use_id === undefined ? [] : [c.tool_use_id]))
  if (e.props.isExpanded) {
    if (isQuiet) for (const id of ids) compactMem.marks.delete(id)
    return next(e)
  }
  if (isQuiet && !e.props.isActive && e.props.isCallsOnly === true) {
    const columns = e.viewport?.columns ?? 120
    const lines = groupLines(e.props.calls.map(c => compactOf(c.tool_use_id, c)), columns, { cwd: workingFolder() })
    return drawLines($, e, lines, { noColor: await isNoColor($), press: {}, columns , fill: true })
  }
  if (isQuiet && (isRec || !e.props.isActive)) mark(ids)
  else if (!isRec) return next(e)
  return next({ ...e, props: { ...e.props, isExpanded: true } })
}

// The failures a shown tab listed are no longer new
export async function markFailuresSeen($: EngineInterface): Promise<void> {
  await updateFailures($, list => (list.some(f => f.isNew) ? list.map(f => ({ ...f, isNew: false })) : list))
}

// The session's permission mode, when an event reports one
export function notePermissionMode(mode: unknown): void {
  if (typeof mode === 'string') modeMem.mode = mode
}
