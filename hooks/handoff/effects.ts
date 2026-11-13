// The handoff folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Handoff, PlanPart, SaveTrigger, SaveInput, SaveResult, ScoresPart } from './types'
import { PLANS_DIR, creditedPlan, scoresView } from '../plan/plan'
import { FOREIGN, HANDOFF_PATH, HANDOFF_USAGE, MARKER, MODES, RESUME_WINDOW_MS, RESUME_PROMPT, TOASTS, gitPart, handoffText, nextStep, parseStatus, percentOf, stepUnder, stepsOf } from './handoff'
import { readBreakdown } from '../context/effects'
import { readLive, readMeta, readUsage } from '../session/effects'
import { readStack } from '../stack/effects'
import { readStats } from '../tools/effects'
import { readAgents } from '../agents/effects'
import { mask, maskForFile } from '../rec/mask'
import { compactNow } from '../cache/effects'
import type { Pending, MatchedInput } from '../core/types'
import { planViewOf, readPlans, readTasks } from '../plan/effects'
import { runwayOf } from '../stack/stack'
import { clockText, tokensText } from '../core/format'
import { loadSettings, resolvedSettings, writeUserField, settingsInForce } from '../settings/effects'
import { readView } from '../inspect/effects'
import { toast } from '../core/effects'
import { sourceLabel } from '../settings/settings'

const INITIAL_HANDOFF: Handoff = {
  mode: 'ask', threshold: 80, point: null, handled: null, isAskUp: false, lastSave: null, alfred: { state: 'none', reason: null },
}
const handoffAtom = atom({ plugin: 'alfred-mods', key: 'handoff' } as const, INITIAL_HANDOFF, { shape: 'handoff-1' })
export function readHandoff($: EngineInterface) {
  return read($, handoffAtom)
}
function updateHandoff($: EngineInterface, change: (value: Handoff) => Handoff) {
  return update($, handoffAtom, change)
}
export function resetHandoff($: EngineInterface) {
  return update($, handoffAtom, () => INITIAL_HANDOFF)
}

// F8's memory outside $.state: whether the stack stood F8 down, which outlives a /clear until a read of the new id's
// file says otherwise (the stack writes it in its own SessionStart hook, which may run after the mod's); whether a
// compaction re-arms the steps; the model and window the compaction point was read for; the save running, which a
// second request joins; the step the last save was made at, which c does not save again; and the last save's time,
// which arms the resume prompt and which a /clear does not reset
const handoffMemory = {
  stoodDown: false, rearm: false, pointKey: null as string | null, saving: null as Promise<SaveResult> | null,
  savedStep: null as number | null, armedAt: null as number | null,
  // The reads of the compaction point that gave no breakdown, for one model and window
  pointMiss: { key: null as string | null, count: 0 },
}

// After a compaction that stands
export async function rearmAfterCompaction($: EngineInterface): Promise<void> {
  // F8's next reading sets the handled step to the highest at or under it, so a compaction under the threshold re-arms
  handoffMemory.rearm = true
  await updateHandoff($, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
}

// Only ask mode keeps an ask up: a change to auto or off, here or polled from another session, takes it down
export async function applyHandoffSetting($: EngineInterface): Promise<void> {
  const s = { mode: settingsInForce().handoff, threshold: settingsInForce().handoffAt }
  await updateHandoff($, h => (h.mode === s.mode && h.threshold === s.threshold ? h : { ...h, ...s, isAskUp: s.mode === 'ask' && h.isAskUp }))
}

// The tokens where Claude Code compacts by itself (Decision 12): the breakdown's `autoCompactThreshold`, else the
// window; read at the first reading and again when the model or the window changes. A read with no breakdown, or one
// that fails, gives the window for that reading alone and counts a miss; the third miss for one model and window
// keeps the window as the point and asks no more.
export async function compactPointOf($: EngineInterface, window: number): Promise<number> {
  const key = `${(await readMeta($)).model ?? ''}:${window}`
  const known = (await readHandoff($)).point
  if (handoffMemory.pointKey === key && known !== null) return known
  if (handoffMemory.pointMiss.key !== key) handoffMemory.pointMiss = { key, count: 0 }
  const b = await readBreakdown($)
  if (b === null) {
    const count = ++handoffMemory.pointMiss.count
    const point = count >= 3 ? window : null
    if (point !== null) handoffMemory.pointKey = key
    await updateHandoff($, h => (h.point === point ? h : { ...h, point }))
    return window
  }
  const point = b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined ? b.autoCompactThreshold : window
  handoffMemory.pointKey = key
  await updateHandoff($, h => (h.point === point ? h : { ...h, point }))
  return point
}

// A save runs from a 0 ms timer, so no hook waits on git; a request while one runs joins it
export function startSave($: EngineInterface, by: SaveTrigger): Promise<SaveResult> {
  if (handoffMemory.saving !== null) return handoffMemory.saving
  const saving = new Promise<SaveResult>(resolve => {
    $.clock.after(0, () => {
      writeHandoffFile($, by).then(resolve, () => resolve({ at: 0, isOk: false, reason: 'unknown' })).finally(() => {
        handoffMemory.saving = null
      })
    })
  })
  handoffMemory.saving = saving
  return saving
}

// What a save writes (spec 'What a save writes'): never over a file without the marker; the one git call; the text
// masked for keys, emails and phones whatever REC's level. A save arms the resume prompt unless the stack stood F8 down.
export async function writeHandoffFile($: EngineInterface, by: SaveTrigger): Promise<SaveResult> {
  const at = await $.clock.now()
  const before = await readHandoff($)
  let result: SaveResult
  let percent: number | null = null
  try {
    if (await isForeignFile($)) result = { at, isOk: false, reason: FOREIGN }
    else {
      const git = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 2000 })
        .then(gitPart, (err: unknown) => gitPart(err instanceof Error ? err : new Error(String(err))))
      const input = await readSaveInput($, at, git)
      percent = input.percent
      await $.fs.write(HANDOFF_PATH, maskForFile(handoffText(input)))
      result = { at, isOk: true, reason: null }
    }
  } catch (err) {
    result = { at, isOk: false, reason: (err instanceof Error ? err.message : String(err)).split('\n')[0] || 'unknown' }
  }
  await updateHandoff($, h => ({ ...h, lastSave: result }))
  if (!result.isOk) {
    toast($, TOASTS.failed(result.reason ?? 'unknown'))
    return result
  }
  handoffMemory.savedStep = (await readHandoff($)).handled
  if (!handoffMemory.stoodDown) handoffMemory.armedAt = at
  if (by === 'compact') toast($, TOASTS.compacting())
  else if (by === 'press') toast($, handoffMemory.stoodDown ? TOASTS.savedOnly() : TOASTS.saved())
  else if (before.lastSave?.isOk !== true && percent !== null) toast($, TOASTS.autoFirst(percent))
  return result
}

// A file at the path whose first line is not the marker is the person's own; no file is none
// A file there that the mod cannot read (over 4 MiB, locked, no access) is foreign too: only a missing file is none
export async function isForeignFile($: EngineInterface): Promise<boolean> {
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
export async function readSaveInput($: EngineInterface, at: number, git: string[]): Promise<SaveInput> {
  const h = await readHandoff($)
  const usage = await readUsage($)
  const m = await readMeta($)
  const plans = await readPlans($)
  const items = await readTasks($)
  const w = creditedPlan(plans, (await readView($)).planSlug, items.length > 0)
  let plan: SaveInput['plan'] = w === 'tasks' ? 'tasks' : null
  let scores: ScoresPart | null = null
  if (w !== null && w !== 'tasks' && w.value !== null && plans.since !== null && w.mtimeMs >= plans.since) {
    const view = (await planViewOf($, plans, items, w, at)).v
    if (view !== null) {
      const steps: PlanPart['steps'] = view.rows.map(r => ({
        id: r.step.id, title: r.step.title, status: r.step.status, actualMs: r.actualMs, forecastMs: r.forecastMs, notes: r.notes.length,
      }))
      plan = { file: `${PLANS_DIR}/${w.name}.json`, title: view.title, finished: view.finished, total: view.total, steps }
      const own = plans.scores.find(s => s.value !== null && s.value.subject.kind === 'plan' && s.value.subject.ref === w.name)
      const sv = own === undefined || own.value === null ? null : scoresView(own.value)
      if (own !== undefined && sv !== null) {
        scores = { name: own.name, totals: sv.totals, open: sv.open.map(f => ({ id: f.id, text: f.text, severity: f.severity })) }
      }
    }
  }
  const counted = Object.values(await readStats($))
  const isWorking = (await readLive($)).turnId !== null
  const point = h.point ?? usage.window
  return {
    at, percent: usage.tokens === null || point === null ? null : percentOf(usage.tokens, point), threshold: h.threshold,
    session: await $.session.id(), model: m.model, git, plan, scores,
    counts: {
      turn: m.turnCount + (isWorking ? 1 : 0), durationMs: usage.startedAt === null ? null : at - usage.startedAt,
      calls: counted.reduce((n, t) => n + t.calls, 0), failed: counted.reduce((n, stat) => n + stat.failed, 0),
      agents: (await readAgents($)).length, costUsd: usage.costUsd, isEstimate: usage.windows.length > 0,
    },
  }
}

// h, 4 and `/auto-handoff now`: the ask comes down and a save starts
export async function saveNow($: EngineInterface): Promise<void> {
  await updateHandoff($, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
  void startSave($, 'press')
}

// r: the ask comes down until the next step
export async function dismissAsk($: EngineInterface): Promise<void> {
  await updateHandoff($, h => (h.isAskUp ? { ...h, isAskUp: false } : h))
}

// c: a save first, unless one was made at this step, then Phase 2's compaction; a failed save compacts nothing, so
// the context is never lost without its handoff
export async function saveThenCompact($: EngineInterface, pending: Pending): Promise<void> {
  const h = await readHandoff($)
  await dismissAsk($)
  if (!(h.lastSave?.isOk === true && handoffMemory.savedStep === h.handled)) {
    if (!(await startSave($, 'compact')).isOk) return
  }
  await compactNow($, pending)
}

// A /clear within 2 hours of the last save fills the resume prompt into an empty draft, once; a draft that is not
// empty, or a fill a dialog refuses, gets the toast that names the file. A stood-down session fills nothing.
export async function fillResumePrompt($: EngineInterface): Promise<void> {
  const at = handoffMemory.armedAt
  handoffMemory.armedAt = null
  if (at === null || handoffMemory.stoodDown || (await $.clock.now()) - at > RESUME_WINDOW_MS) return
  const draft = await $.prompt.read()
  if (draft.text.trim() === '' && (await $.prompt.fill({ text: RESUME_PROMPT })).isFilled) toast($, TOASTS.filled(at))
  else toast($, TOASTS.fallback(at))
}

// A main-loop reading against F8's steps: ask mode puts up the ask, auto mode saves, once per step
export async function stepHandoff($: EngineInterface, tokens: number | undefined, window: number): Promise<void> {
  if (tokens === undefined) return
  const percent = percentOf(tokens, await compactPointOf($, window))
  const h = await readHandoff($)
  const steps = stepsOf(h.threshold)
  if (handoffMemory.rearm) {
    handoffMemory.rearm = false
    await updateHandoff($, x => ({ ...x, handled: stepUnder(percent, steps) }))
    return
  }
  if (h.mode === 'off' || h.alfred.state === 'stood-down') return
  const step = nextStep(h.handled, percent, steps)
  if (step === null) return
  await updateHandoff($, handoff => ({ ...handoff, handled: step, isAskUp: handoff.mode === 'ask' }))
  if (h.mode === 'ask') toast($, TOASTS.ask(step))
  else void startSave($, 'auto')
}

// The state line a bare /auto-handoff prints: the mode, the threshold, F8's context percent and the last save; stood
// down, the runway while it applies, as the HANDOFF row
export async function handoffStateLine($: EngineInterface): Promise<string> {
  const h = await readHandoff($)
  const usage = await readUsage($)
  const point = h.point ?? usage.window
  const ctx = usage.tokens === null || point === null ? 'ctx –' : `ctx ${percentOf(usage.tokens, point)}%`
  if (h.alfred.state === 'stood-down') {
    const runway = runwayOf(await readStack($), usage, (await readMeta($)).model)
    return `${runway === null ? ctx : `ctx ${runway.percent}% of ${tokensText(runway.resumeAt)}`} · handoff by Alfred Code`
  }
  if (h.mode === 'off') return `Handoff: off · ${ctx}`
  const saved = h.lastSave?.isOk === true ? ` · last save ${clockText(h.lastSave.at)} (${HANDOFF_PATH})` : ''
  return `Handoff: ${h.mode} at ${h.threshold}% · ${ctx}${saved}`
}

// The handoff's side of a status file read (F8's stand-down, Decision 13): Alfred Code's state, and a stand-down lifted
// steps at the last reading
export async function followStatusFile($: EngineInterface, text: string | null, id: string, inWindow: boolean): Promise<void> {
  let found: ReturnType<typeof parseStatus> | null = text === null ? null : parseStatus(text, id)
  if (found === null && inWindow && handoffMemory.stoodDown) found = { state: 'stood-down', reason: null }
  const wasStoodDown = handoffMemory.stoodDown
  handoffMemory.stoodDown = found?.state === 'stood-down'
  const alfred: Handoff['alfred'] = found === null || found.state === 'runs' ? { state: 'none', reason: null } : { state: found.state, reason: found.reason }
  await updateHandoff($, h => {
    if (h.alfred.state === alfred.state && h.alfred.reason === alfred.reason) return h
    return { ...h, alfred, isAskUp: alfred.state === 'stood-down' ? false : h.isAskUp }
  })
  // A stand-down lifted by this read steps at the last reading, so the ask returns without waiting for a turn; a
  // compaction's re-arm waits for a fresh reading instead
  if (!wasStoodDown || handoffMemory.stoodDown || handoffMemory.rearm) return
  const usage = await readUsage($)
  if (usage.tokens !== null && usage.window !== null) await stepHandoff($, usage.tokens, usage.window)
}

export async function runHandoffCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'auto-handoff' }>, pending: Pending) {
  const args = e.args.trim().toLowerCase()
  if (args === 'now') {
    await saveNow($)
    return { text: `Saving a handoff to ${HANDOFF_PATH}.` }
  }
  // The ask's c and r, for a screen where its keys and clicks do not reach the mod (the user, 2026-11-12)
  if (args === 'compact') {
    void saveThenCompact($, pending)
    return { text: `Saving a handoff to ${HANDOFF_PATH}, then compacting.` }
  }
  if (args === 'later') {
    if (!(await readHandoff($)).isAskUp) return { text: 'No handoff ask is up.' }
    await dismissAsk($)
    return { text: 'The handoff ask is down until the next step.' }
  }
  const mode = MODES.find(m => m === args)
  if (mode !== undefined) return { text: mask(await writeUserField($, 'handoff', mode)) }
  // 'at 70', as 0.7 took it, or a bare '70'
  const at = /^(?:at(?:\s+(.*))?|(\d.*))$/.exec(args)
  if (at !== null) {
    const word = at[1] ?? at[2] ?? ''
    const percent = /^\d+$/.test(word) ? Number(word) : NaN
    if (!(percent >= 10 && percent <= 95)) return { text: `The first ask takes a whole number from 10 to 95.\n${HANDOFF_USAGE}` }
    return { text: mask(await writeUserField($, 'handoffAt', percent)) }
  }
  await loadSettings($)
  const state = await handoffStateLine($)
  const from = resolvedSettings()?.from
  const sources = (await readHandoff($)).alfred.state === 'stood-down' || from === undefined
    ? ''
    : ` · mode from ${sourceLabel(from.handoff, '/auto-handoff')} · first ask from ${sourceLabel(from.handoffAt, '/auto-handoff')}`
  return { text: mask(`${state}${sources}\n${HANDOFF_USAGE}`) }
}

// A compaction's pending re-arm and the step saved at belong to the conversation before
export function forgetHandoffSteps(): void {
  handoffMemory.rearm = false
  handoffMemory.savedStep = null
}
