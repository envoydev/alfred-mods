// The tools folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ToolCall, CompactCall, Failure, Outcome, Quiet, ToolStat } from './types'
import { addRunningCall, addLoadedSkill, countMainCall, readLive, settleRunningCall } from '../session/effects'
import { classifyCall, foldFailure, tallyOutcome, targetOf, toolKey } from './outcome'
import { isInspectDrawn, readView } from '../inspect/effects'
import { isTrackedLoop, updateAgentRow } from '../agents/effects'
import { keepNewest } from '../core/collections'
import { settingsInForce } from '../settings/effects'
import { syncStatusLine } from '../band/effects'
import { actionOf } from '../agents/agents'
import { isAllWait, waitMsOf } from '../plan/steptime'
import { mask } from '../rec/mask'
import { followEditedFile, pollPlace, workingFolder } from '../place/effects'
import type { Pending, HookInput, HookNext, MatchedInput, MatchedNext } from '../core/types'
import { drawLines } from '../core/draw'
import { DROPS_RESULT, callLine, groupLines } from './compact'
import { maskDeep, maskResult, resultLines } from '../rec/sites'
import { isNoColor } from '../core/effects'
import { rememberCall } from './calls'
import { addWaitTime, closeCallWait, followTaskTools, openCallWait, schedulePlanReload } from '../plan/effects'
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
const failuresAtom = atom({ plugin: 'alfred-mods', key: 'failures' } as const, INITIAL_FAILURES, { shape: 'failures-2' })
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
const permissionMemory = { mode: null as string | null }

// Compact rows' memory (Decisions 4 and 7): each settled call's outcome and reason, and the calls of a group the mod
// unfolded, by call id, each the last 500. A reload empties both: a blocked call then draws ✗.
const rowMemory = { outcomes: new Map<string, { outcome: Outcome; reason: string; isAutoAllowed: boolean }>(), marks: new Set<string>() }

// Each errored call's error text, the one Claude Code draws under it, by call id, the last 500: from the call's result,
// or from its row for a call the mod did not see run (a resumed transcript). Kept in memory only, for REC to mask.
const errorTexts = new Map<string, string>()

// The errored calls whose row drew the masked error text itself, so their result block draws nothing, the last 500
const errorRowIds = new Set<string>()

// A failure row for a call that was not ok; it is seen at once while the pane shows Now or Tools
export async function addFailureRow($: EngineInterface, id: string, call: ToolCall, outcome: Exclude<Outcome, 'ok'>, reason: string, isNew: boolean, drop: string | null, by: string | null): Promise<void> {
  const { tab } = await readView($)
  const isSeen = (tab === 'now' || tab === 'tools') && await isInspectDrawn($)
  const result = call.facts.result
  const row: Failure = {
    id, at: await $.clock.now(), tool: call.tool, target: call.target, outcome, reason,
    detail: (result?.deny ?? result?.text ?? '').slice(0, 4000), count: 1, isNew: isNew && !isSeen, blockedBy: by,
  }
  await updateFailures($, list => {
    const i = drop === null ? -1 : list.findIndex(failure => failure.id === drop)
    const old = list[i]
    const rest = old === undefined ? list
      : old.count > 1 ? list.map(failure => (failure === old ? { ...failure, count: failure.count - 1 } : failure))
      : list.filter(failure => failure !== old)
    // A call settled again keeps its row's number
    const out = foldFailure(rest, old !== undefined && old.count === 1 && old.failureNumber !== undefined ? { ...row, failureNumber: old.failureNumber } : row)
    call.failureId = out[out.length - 1]?.id ?? null
    return out
  })
}

export function markUnfolded(ids: string[]): void {
  for (const id of ids) {
    rowMemory.marks.delete(id)
    rowMemory.marks.add(id)
  }
  keepNewest(rowMemory.marks)
}

// A row's or a group call's facts as a compact row reads them; a refusal draws as a block
export function compactCallOf(
  id: string | undefined, call: { tool: string; input: unknown; output?: unknown; isErrored: boolean; isInterrupted: boolean },
): CompactCall {
  const remembered = id === undefined ? undefined : rowMemory.outcomes.get(id)
  const outcome = remembered?.outcome === 'denied' ? 'denied' : remembered?.outcome === 'blocked' || remembered?.outcome === 'refused' ? 'blocked' : null
  return {
    tool: call.tool, input: call.input, output: call.output, isErrored: call.isErrored, isInterrupted: call.isInterrupted, outcome,
    reason: outcome === null ? null : remembered?.reason ?? null, isAutoAllowed: remembered?.isAutoAllowed === true,
  }
}

// Counts a settled call, or counts it again when a later event changed its outcome
export async function settleToolCall($: EngineInterface, id: string, call: ToolCall): Promise<void> {
  const { outcome, reason, isNew, by } = classifyCall(call.facts)
  rowMemory.outcomes.delete(id)
  // In auto mode a check's ask that no one saw and no hook refused was the classifier's allow (outcome.ts)
  const facts = call.facts
  const isAutoAllowed = outcome === 'ok' && facts.autoMode && facts.checked === 'ask' && !facts.asked && facts.hookDeny === null
  rowMemory.outcomes.set(id, { outcome, reason, isAutoAllowed })
  keepNewest(rowMemory.outcomes)
  const before = call.outcome
  call.isSettled = true
  call.outcome = outcome
  const retally = (stats: Record<string, ToolStat>): Record<string, ToolStat> =>
    ({ ...stats, [call.key]: before === null ? tallyOutcome(stats[call.key], outcome, 1) : tallyOutcome(tallyOutcome(stats[call.key], before, -1), outcome, 1) })
  await updateStats($, retally)
  if (call.agentId !== null) await updateAgentRow($, call.agentId, row => ({ ...row, tools: retally(row.tools) }))
  if (outcome !== 'ok') await addFailureRow($, id, call, outcome, reason, isNew, before !== null && before !== 'ok' ? call.failureId : null, by)
  // A block counts for the script that made it; a later settle that names another blocker moves the count (spec C6)
  const counted = call.blockedBy
  call.blockedBy = by
  if (counted !== by) {
    await updateBlockers($, blockers => {
      const out = { ...blockers }
      if (counted !== null) {
        const remaining = (out[counted] ?? 0) - 1
        if (remaining > 0) out[counted] = remaining
        else delete out[counted]
      }
      if (by !== null) out[by] = (out[by] ?? 0) + 1
      return out
    })
  }
  const isMain = call.agentId === null
  const failed = (outcome: Outcome | null): number => (outcome !== null && outcome !== 'ok' ? 1 : 0)
  await settleRunningCall($, id, { isMain, isFirstSettle: before === null, failuresDelta: failed(outcome) - failed(before) })
  if (isMain && before === null) await countMainCall($)
  // A Skill call that failed loaded nothing, and one whose skill ran forked loaded it into a subagent
  if (isMain && before === null && outcome === 'ok' && call.isFork !== true && call.key.startsWith('Skill: ')) {
    await addLoadedSkill($, call.key.slice('Skill: '.length))
  }
  await syncStatusLine($)
}

export function keepErrorText(id: string, text: string): void {
  errorTexts.delete(id)
  errorTexts.set(id, text)
  keepNewest(errorTexts)
}

// "quiet" into the quiet atom
export async function applyQuiet($: EngineInterface): Promise<boolean> {
  const isOn = settingsInForce().quiet
  await updateQuiet($, quiet => (quiet.isOn === isOn ? quiet : { isOn }))
  return isOn
}

export async function trackToolCall($: EngineInterface, e: HookInput<'tool.call'>, next: HookNext<'tool.call'>, calls: Map<string, ToolCall>, pending: Pending) {
  if (!(await isTrackedLoop($, e.agentId))) return next(e)
  const input = e as unknown as Record<string, unknown>
  const call = rememberCall(calls, e.tool_use_id, e.tool)
  call.key = toolKey(e.tool, input)
  call.target = targetOf(e.tool, input, await $.session.cwd())
  call.agentId = e.agentId ?? null
  call.facts = { ...call.facts, autoMode: permissionMemory.mode === 'auto' }
  const startedAt = await $.clock.now()
  call.startedAt = startedAt
  if (call.agentId === null) {
    await addRunningCall($, { id: e.tool_use_id, tool: e.tool, label: call.target, startedAt })
  } else {
    const action = actionOf(e.tool, call.target)
    await updateAgentRow($, call.agentId, row => ({ ...row, action }))
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
      (edited === '' ? pollPlace($) : followEditedFile($, edited)).catch(() => undefined)
    })
  }
  const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
  if (ran.isError === true && text !== '') keepErrorText(e.tool_use_id, text)
  call.facts = {
    ...call.facts,
    result: { isError: ran.isError === true || ran.deny !== undefined, deny: ran.deny ?? null, text },
    aborted: ran.isError === true && next.signal.aborted,
  }
  await settleToolCall($, e.tool_use_id, call)
  const endedAt = await $.clock.now()
  const ms = endedAt - startedAt
  const wait = waitMsOf({ tool: e.tool, ms, isMain: call.agentId === null, isAsked: call.facts.asked, outcome: call.outcome, durationMs: call.durationMs })
  let isClosed = false
  if (isWait) isClosed = await closeCallWait($, loop, e.tool_use_id, endedAt)
  if (wait === null) call.pendingMs = ms
  else if (!isClosed) await addWaitTime($, loop, wait, endedAt)
  if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') schedulePlanReload($, pending)
  if (call.agentId === null && call.outcome === 'ok') {
    const result = ran.result
    await followTaskTools($, pending, e.tool, input, result)
  }
  return ran
}

export async function noteToolCheck($: EngineInterface, e: HookInput<'tool.check'>, next: HookNext<'tool.check'>, calls: Map<string, ToolCall>) {
  const verdict = await next(e)
  if (e.tool_use_id !== undefined && (await isTrackedLoop($, e.agentId))) {
    const call = rememberCall(calls, e.tool_use_id, e.tool)
    call.facts = { ...call.facts, checked: verdict.decision, checkReason: verdict.reason ?? null }
  }
  return verdict
}

export function notePromptMode($: EngineInterface, e: HookInput<'classic.UserPromptSubmit'>, next: HookNext<'classic.UserPromptSubmit'>) {
  if (typeof e.permission_mode === 'string') permissionMemory.mode = e.permission_mode
  return next(e)
}

export function noteToolFailure($: EngineInterface, e: HookInput<'classic.PostToolUseFailure'>, next: HookNext<'classic.PostToolUseFailure'>, calls: Map<string, ToolCall>) {
  const call = calls.get(e.tool_use_id)
  if (call !== undefined) call.facts = { ...call.facts, failedInTool: true, interrupted: e.is_interrupt === true }
  return next(e)
}

export async function noteToolDuration($: EngineInterface, e: HookInput<'classic.PostToolUse'>, next: HookNext<'classic.PostToolUse'>, calls: Map<string, ToolCall>) {
  if (e.agent_id === undefined && typeof e.permission_mode === 'string') permissionMemory.mode = e.permission_mode
  const call = calls.get(e.tool_use_id)
  if (call !== undefined) {
    call.durationMs = e.duration_ms ?? null
    const ms = call.pendingMs
    if (ms !== null && call.durationMs !== null) {
      call.pendingMs = null
      await addWaitTime($, call.agentId ?? 'main', Math.max(0, ms - call.durationMs), await $.clock.now())
    }
  }
  return next(e)
}

export async function notePermissionRequest($: EngineInterface, e: HookInput<'classic.PermissionRequest'>, next: HookNext<'classic.PermissionRequest'>, calls: Map<string, ToolCall>) {
  const answered = await next(e)
  const call = [...calls.values()].reverse()
    .find(askedCall => !askedCall.isSettled && askedCall.facts.tool === e.tool_name && askedCall.facts.checked === 'ask')
  const decision = answered.decision
  if (call !== undefined && decision === undefined) call.facts = { ...call.facts, asked: true }
  if (call !== undefined && decision?.behavior === 'deny') call.facts = { ...call.facts, hookDeny: decision.message ?? '' }
  return answered
}

export async function notePermissionDenied($: EngineInterface, e: HookInput<'classic.PermissionDenied'>, next: HookNext<'classic.PermissionDenied'>, calls: Map<string, ToolCall>) {
  const call = calls.get(e.tool_use_id)
  if (call !== undefined) {
    call.facts = { ...call.facts, classifierReason: e.reason }
    if (call.isSettled) await settleToolCall($, e.tool_use_id, call)
  }
  return next(e)
}

export async function trackSkillPrompt($: EngineInterface, e: HookInput<'skill.prompt'>, next: HookNext<'skill.prompt'>, calls: Map<string, ToolCall>) {
  const prompted = await next(e)
  const key = `Skill: ${e.skill}`
  const isFork = e.frontmatter.context === 'fork'
  const pending = [...calls.values()].find(call => !call.isSettled && call.key === key)
  if (pending !== undefined) {
    if (isFork) pending.isFork = true
  } else {
    await updateStats($, stats => ({ ...stats, [key]: tallyOutcome(stats[key], 'ok', 1) }))
    if (!isFork && (await readLive($)).turnId === null) await addLoadedSkill($, e.skill)
  }
  return prompted
}

export async function drawToolUse($: EngineInterface, e: MatchedInput<'ui.render', { component: 'ToolUse' }>, next: MatchedNext<'ui.render', { component: 'ToolUse' }>) {
  if (e.props.isErrored && typeof e.props.output === 'string' && !errorTexts.has(e.props.tool_use_id)) keepErrorText(e.props.tool_use_id, e.props.output)
  if ((await readQuiet($)).isOn && !e.props.isRunning && (e.props.isExpanded !== true || rowMemory.marks.has(e.props.tool_use_id))) {
    const columns = e.viewport?.columns ?? 120
    const lines = callLine(compactCallOf(e.props.tool_use_id, e.props), columns, { cwd: workingFolder() })
    return drawLines($.ui.resolve(e), e, lines, { noColor: await isNoColor($), press: {}, columns , fill: true })
  }
  if (!(await isRecOn($))) return next(e)
  // An unfolded group's errored row draws its error text inline, and Claude Code draws that text, not `output` (live,
  // fullscreen, 2026-10-28): with a sample in it, the row draws its compact head and the masked text itself, once
  if (e.props.isErrored && !e.props.isRunning) {
    const failed = maskResult({ tool: e.props.tool, output: e.props.output, isErrored: true, error: errorTexts.get(e.props.tool_use_id) ?? null }, mask)
    if (failed.kind === 'tree') {
      errorRowIds.delete(e.props.tool_use_id)
      errorRowIds.add(e.props.tool_use_id)
      keepNewest(errorRowIds)
      const columns = e.viewport?.columns ?? 120
      const head = callLine(compactCallOf(e.props.tool_use_id, e.props), columns, { cwd: workingFolder() }).slice(0, 1)
      const isExpanded = e.props.isExpanded === true
      return drawLines($.ui.resolve(e), e, [...head, ...resultLines(failed.text, { isExpanded, isErrored: true, gutter: e.surface === 'terminal' })], { noColor: await isNoColor($), press: {}, columns , fill: true })
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
  if (e.props.isExpanded === true && rowMemory.marks.delete(e.props.tool_use_id)) $.ui.invalidate('ui.render')
  const isDropped = e.props.isErrored || DROPS_RESULT.includes(e.props.tool)
  if (isDropped && e.props.isExpanded !== true && (await readQuiet($)).isOn) return drawLines($.ui.resolve(e), e, [], { noColor: false, press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
  if (!(await isRecOn($))) return next(e)
  if (e.props.isErrored && errorRowIds.has(e.props.tool_use_id)) return drawLines($.ui.resolve(e), e, [], { noColor: false, press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
  const masked = maskResult({ ...e.props, error: errorTexts.get(e.props.tool_use_id) ?? null }, mask)
  if (masked.kind === 'same') return next(e)
  if (masked.kind === 'output') return next({ ...e, props: { ...e.props, output: masked.output } })
  const lines = resultLines(masked.text, { isExpanded: e.props.isExpanded === true, isErrored: e.props.isErrored, gutter: e.surface === 'terminal' })
  return drawLines($.ui.resolve(e), e, lines, { noColor: await isNoColor($), press: {}, columns: e.viewport?.columns ?? 120 , fill: true })
}

export async function drawToolGroup($: EngineInterface, e: MatchedInput<'ui.render', { component: 'ToolGroup' }>, next: MatchedNext<'ui.render', { component: 'ToolGroup' }>) {
  const isQuiet = (await readQuiet($)).isOn
  const isRec = await isRecOn($)
  const ids = e.props.calls.flatMap(batchCall => (batchCall.tool_use_id === undefined ? [] : [batchCall.tool_use_id]))
  if (e.props.isExpanded) {
    if (isQuiet) for (const id of ids) rowMemory.marks.delete(id)
    return next(e)
  }
  if (isQuiet && !e.props.isActive && e.props.isCallsOnly === true) {
    const columns = e.viewport?.columns ?? 120
    const lines = groupLines(e.props.calls.map(batchCall => compactCallOf(batchCall.tool_use_id, batchCall)), columns, { cwd: workingFolder() })
    return drawLines($.ui.resolve(e), e, lines, { noColor: await isNoColor($), press: {}, columns , fill: true })
  }
  if (isQuiet && (isRec || !e.props.isActive)) markUnfolded(ids)
  else if (!isRec) return next(e)
  return next({ ...e, props: { ...e.props, isExpanded: true } })
}

// The failures a shown tab listed are no longer new
export async function markFailuresSeen($: EngineInterface): Promise<void> {
  await updateFailures($, list => (list.some(entry => entry.isNew) ? list.map(failure => ({ ...failure, isNew: false })) : list))
}

// The session's permission mode, when an event reports one
export function notePermissionMode(mode: unknown): void {
  if (typeof mode === 'string') permissionMemory.mode = mode
}
