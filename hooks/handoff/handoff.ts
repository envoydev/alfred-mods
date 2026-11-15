// F8's handoff (spec 'F8 Handoff'): its stored settings, the steps a reading handles, the percent over the point
// where Claude Code compacts by itself, the stack's per-session status file that stands F8 down, what a save writes to
// HANDOFF.md, the Now tab's HANDOFF row and F8's toasts.
import type { ProcessRunResult } from 'claude-code'

import { barSegs, percentSeg } from '../band/gauges'
import { clockText, durationText, minutesText, modelText, tokensText, usdText } from '../core/format'
import type { Line, Seg } from '../core/types'
import type { Handoff, HandoffMode, HandoffView, PlanPart, SaveInput, SaveResult } from './types'
import type { Severity, StepStatus } from '../plan/types'
import type { Runway } from '../stack/types'
import type { Usage } from '../session/types'

export const MODES: HandoffMode[] = ['ask', 'auto', 'off']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// A whole percent from 10 to 95, the only thresholds the command takes
export function isThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 95
}

// The threshold, then every 5 points up to 95
export function stepsOf(threshold: number): number[] {
  const steps: number[] = []
  for (let step = threshold; step <= 95; step += 5) steps.push(step)
  return steps
}

// The tokens in use over the compaction point, as a whole percent rounded down, so no step is reached early
export function percentOf(tokens: number, point: number): number {
  return point > 0 ? Math.floor((tokens * 100) / point) : 0
}

// F8's threshold over the window, so the forecast's turns run to the same moment: 80% of 390k on 1M is 31
export function windowThreshold(threshold: number, point: number, window: number): number {
  return window > 0 ? Math.round((threshold * point) / window) : threshold
}

// The highest step the reading reached that is past the one handled, or null
export function nextStep(handled: number | null, percent: number, steps: number[]): number | null {
  const reached = steps.filter(step => step <= percent && (handled === null || step > handled))
  return reached.length === 0 ? null : Math.max(...reached)
}

// The highest step at or under a reading, which a compaction re-arms from
export function stepUnder(percent: number, steps: number[]): number | null {
  return nextStep(null, percent, steps)
}

// The stack's status file: valid with schema 1 and this session's id; F8 stands down when the stack handles a full
// context itself (`fresh-session` or `compact`), runs otherwise, and says why a file it could not use was ignored
export function parseStatus(text: string, session: string): { state: 'stood-down' | 'runs' | 'ignored'; reason: string | null } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { state: 'ignored', reason: 'not JSON' }
  }
  if (!isRecord(value)) return { state: 'ignored', reason: 'not JSON' }
  if (value.schema === undefined) return { state: 'ignored', reason: 'no schema' }
  if (value.schema !== 1) return { state: 'ignored', reason: `schema ${typeof value.schema === 'number' ? value.schema : 'not 1'}` }
  if (value.session !== session) return { state: 'ignored', reason: 'another session' }
  return value.fullContext === 'fresh-session' || value.fullContext === 'compact' ? { state: 'stood-down', reason: null } : { state: 'runs', reason: null }
}

export const HANDOFF_PATH = '.claude/session-inspector/HANDOFF.md'
export const HANDOFF_USAGE = 'Usage: /auto-handoff [ask|auto|off|at <percent>|now|compact|later]. The mode is the "handoff" field of "alfred-mods" in a settings file ("ask", "auto" or "off"), the first ask "handoffAt" (10 to 95); ask, auto, off and at <percent> set them in ~/.claude/settings.json. now saves a handoff, compact saves one then compacts, later puts the ask off until the next step.'

// The status path for a session id; an id that could leave the folder has none
export function statusPath(id: string): string | null {
  return /^[\w-]+$/.test(id) ? `.claude/session-inspector/status/${id}.json` : null
}

export const MARKER = '<!-- session-inspector handoff v1 -->'
export const FOREIGN = "HANDOFF.md exists and is not the mod's"
export const RESUME_PROMPT = 'Read .claude/session-inspector/HANDOFF.md, check that the branch it names is checked out, and continue from its Next section.'

// F8's toasts (spec 'F8 toasts'), each a function of its values
export const TOASTS = {
  ask: (step: number): string => `Context past ${step}%: press 4 or run /auto-handoff now to save a handoff`,
  autoFirst: (percent: number): string => `Handoff saved at ${percent}% to ${HANDOFF_PATH} - /clear fills a resume prompt`,
  saved: (): string => `Handoff saved to ${HANDOFF_PATH} - /clear fills a resume prompt`,
  // While the stack stands F8 down, a save arms no resume prompt
  savedOnly: (): string => `Handoff saved to ${HANDOFF_PATH}`,
  compacting: (): string => `Handoff saved to ${HANDOFF_PATH} - compacting`,
  filled: (at: number): string => `Resume prompt filled from the handoff saved ${clockText(at)} - press Enter to send`,
  fallback: (at: number): string => `Handoff saved ${clockText(at)}: ask Claude to read ${HANDOFF_PATH}`,
  failed: (reason: string): string => `Handoff not saved: ${reason}`,
}

const MAX_PATHS = 50
const INDENT = '    '

// The Git part from the one `git status --porcelain=v1 --branch` call: its lines verbatim, indented so the `##` branch
// line never reads as a heading, up to 50 paths then `+N more`; or why git was not available
export function gitPart(result: ProcessRunResult | Error): string[] {
  const unavailable = (reason: string): string[] => [`Git: not available (${reason})`]
  if (result instanceof Error) {
    if (/timed? ?out/i.test(result.message)) return unavailable('timed out')
    if (/ENOENT|not found|cannot start|spawn/i.test(result.message)) return unavailable('git not found')
    return unavailable(result.message.split('\n')[0] ?? 'failed')
  }
  if (result.exitCode !== 0) return unavailable(/not a git repository/i.test(result.stderr) ? 'not a repository' : `exit ${result.exitCode}`)
  const lines = result.stdout.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  const [branch, ...paths] = lines
  const shown = paths.slice(0, MAX_PATHS).map(path => INDENT + path)
  const more = paths.length > MAX_PATHS ? [`${INDENT}+${paths.length - MAX_PATHS} more`] : []
  return [...(branch === undefined ? [] : [INDENT + branch]), ...shown, ...more]
}

// The branch from the Git part's `## <branch>...<upstream>` line, or null with no git
function branchOf(git: string[]): string | null {
  const line = git[0]?.trimStart() ?? ''
  if (!line.startsWith('## ')) return null
  return line.slice(3).replace(/^No commits yet on /, '').split('...')[0]?.split(' ')[0] || null
}

const pad = (value: number): string => String(value).padStart(2, '0')
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

function nextLine(plan: SaveInput['plan']): string {
  if (plan === null) return 'No plan file this session; see Git below.'
  if (plan === 'tasks') return 'Task list in use; its items are not written to this file.'
  const running = plan.steps.find(step => step.status === 'in_progress')
  if (running !== undefined) {
    const of = running.forecastMs === null ? '' : ` of ≈${minutesText(running.forecastMs)}`
    return `${running.id} ${running.title} - in progress, ${minutesText(running.actualMs)}${of}.`
  }
  const next = plan.steps.find(step => step.status === 'pending')
  return next === undefined ? 'Plan finished.' : `${next.id} ${next.title} - next.`
}

function stepLine(step: PlanPart['steps'][number]): string {
  const isDone = step.status === 'done' || step.status === 'skipped'
  const state = step.status === 'done' ? `done in ${minutesText(step.actualMs)}` : step.status === 'in_progress' ? 'in progress' : step.status
  const notes = step.notes > 0 ? ` - ✎ ${plural(step.notes, 'note')}` : ''
  return `- [${isDone ? 'x' : ' '}] ${step.id} ${step.title} - ${state}${notes}`
}

// HANDOFF.md, as the spec's example shows it; the caller masks keys, emails and phones in it before the write
export function handoffText(save: SaveInput): string {
  const date = new Date(save.at)
  const branch = branchOf(save.git)
  const about = [
    save.percent === null ? `Saved before a context reading (asks at ${save.threshold}%) by alfred-mods` : `Saved at ${save.percent}% context (asks at ${save.threshold}%) by alfred-mods`,
    `session ${save.session.slice(0, 8)}`,
    ...(save.model === null ? [] : [modelText(save.model, true)]),
    ...(branch === null ? [] : [`branch ${branch}`]),
  ]
  const out = [
    MARKER,
    `# Handoff - ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clockText(save.at)}`,
    '',
    `${about.join(' · ')}.`,
    `To continue in a new session, ask Claude to read ${HANDOFF_PATH} and resume from Next.`,
    '', '## Next', '', nextLine(save.plan),
  ]
  if (save.plan !== null && save.plan !== 'tasks') {
    out.push('', `## Plan - ${save.plan.title}, ${save.plan.finished}/${save.plan.total}`, '', `From ${save.plan.file}.`, '', ...save.plan.steps.map(stepLine))
    if (save.scores !== null) {
      const totals = save.scores.totals.map(total => `R${total.round} ${total.total}`).join(' → ')
      const open = save.scores.open.map(finding =>
        `${finding.id === null ? '' : `${finding.id} `}${finding.text}${finding.severity === null ? '' : ` (${finding.severity})`}`)
      out.push('', `Scores (${save.scores.name}): ${totals}${open.length > 0 ? ` · open: ${open.join('; ')}` : ''}`)
    }
  }
  out.push('', '## Git', '', ...save.git)
  const counts = save.counts
  const session = [
    `Turn ${counts.turn}`,
    ...(counts.durationMs === null ? [] : [durationText(counts.durationMs)]),
    `${plural(counts.calls, 'tool call')}${counts.failed > 0 ? `, ${counts.failed} failed` : ''}`,
    ...(counts.agents > 0 ? [plural(counts.agents, 'agent')] : []),
    ...(counts.costUsd === null ? [] : [`${usdText(counts.costUsd)}${counts.isEstimate ? ' est.' : ''}`]),
  ]
  out.push('', '## Session', '', session.join(' · '), '')
  return out.join('\n')
}

const button = (key: string, hotkey: string, label: string): Seg => ({ button: { key, label, hotkey, tone: 'handoff', plain: true } })
const SEP: Seg = { text: ' · ' }

// The HANDOFF section (spec 'The HANDOFF row and the keys'): its violet heading and one row by state, then a failed
// save's reason or the last save's path; nothing while F8 is off. Why a stack status file was not used is the ALFRED
// CODE section's (Phase 5).
export function handoffLines(view: HandoffView, _columns: number): Line[] {
  if (view.mode === 'off') return []
  const of = view.compactPoint !== null && view.window !== null && view.compactPoint !== view.window ? ` of ${tokensText(view.compactPoint)}` : ''
  const plain = view.percent === null ? 'ctx –' : `ctx ${view.percent}%${of}`
  const gauge = (percent: number): Seg[] => [{ text: 'ctx ' }, ...barSegs(percent), percentSeg(percent), { text: of }]
  const steps = stepsOf(view.threshold)
  const after = (step: number | null): number | null => steps.find(known => step === null || known > step) ?? null
  let row: Line
  if (view.stackStatus.state === 'stood-down') {
    const ctx = view.runway === null ? plain : `ctx ${view.runway.percent}% of ${tokensText(view.runway.resumeAt)}`
    row = [{ text: `${ctx} · handoff by Alfred Code` }]
  }
  else if (view.mode === 'auto') {
    const next = after(view.handledStep)
    const saved = view.lastSave?.isOk === true
      ? ` · saved${view.handledStep === null ? '' : ` at ${view.handledStep}%`} (${clockText(view.lastSave.at)})`
        + `${next === null ? '' : ` · next save at ${next}%`}`
      : ` · saves at ${view.threshold}%`
    row = [{ text: plain + saved }]
  } else if (view.percent === null) row = [{ text: `ctx – · asks at ${view.threshold}%` }]
  else if (!view.isAskUp) {
    const next = after(view.handledStep)
    row = [...gauge(view.percent), { text: next === null ? ' · ' : ` · asks at ${next}% · ` }, button('handoff-save', 'h', 'save now')]
  } else {
    const next = after(view.handledStep)
    row = [
      { text: '⚠ ', tone: 'warn' }, ...gauge(view.percent), { text: ` · past ${view.handledStep ?? view.threshold}% · ` },
      button('handoff-save', 'h', 'save handoff'),
      ...(view.isWorking ? [] : [SEP, button('handoff-compact', 'c', 'compact')]),
      SEP, button('handoff-dismiss', 'r', next === null ? 'dismiss' : `remind at ${next}%`),
    ]
  }
  const out: Line[] = [[{ text: 'HANDOFF', bold: true, tone: 'handoff' }], row]
  const last: SaveResult | null = view.lastSave
  if (last !== null && !last.isOk) out.push([{ text: `✗ save failed ${clockText(last.at)}: ${last.reason ?? 'unknown'}`, tone: 'fail' }])
  else if (last !== null) out.push([{ text: `last save ${clockText(last.at)} · ${HANDOFF_PATH}`, tone: 'dim' }])
  return out
}

export const RESUME_WINDOW_MS = 2 * 60 * 60_000

// The Now tab's HANDOFF section reads the atom with F8's percent and the runway
export function handoffViewOf(handoff: Handoff, usage: Usage, isWorking: boolean, runway: Runway | null): HandoffView {
  const point = handoff.compactPoint ?? usage.contextWindow
  return { ...handoff, percent: usage.contextTokens === null || point === null ? null : percentOf(usage.contextTokens, point), window: usage.contextWindow, isWorking, runway }
}

// What the forecast counts to: the stack's resume trigger over the window while the runway applies and the window is
// known, else F8's threshold over the window, to the compaction point's moment
export function forecastTargetOf(handoff: Handoff, usage: Usage, runway: Runway | null): { at: number; label: string } {
  if (runway !== null && runway.at !== null) return { at: runway.at, label: tokensText(runway.resumeAt) }
  return { at: handoff.compactPoint !== null && usage.contextWindow !== null ? windowThreshold(handoff.threshold, handoff.compactPoint, usage.contextWindow) : handoff.threshold, label: `${handoff.threshold}%` }
}
