// F8's handoff (spec 'F8 Handoff'): its stored settings, the steps a reading handles, the percent over the point
// where Claude Code compacts by itself, the stack's per-session status file that stands F8 down, what a save writes to
// HANDOFF.md, the Now tab's HANDOFF row and F8's toasts.
import type { ProcessRunResult } from 'claude-code'

import type { Handoff, HandoffMode, SaveResult, Severity, StepStatus } from '../types'
import { barSegs, pctSeg } from './band.ts'
import type { Line, Seg } from './band.ts'
import { clock, duration, mins, modelText, tokens, usd } from './format.ts'

const MODES: HandoffMode[] = ['ask', 'auto', 'off']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// A whole percent from 10 to 95, the only thresholds the command takes
export function isThreshold(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 10 && n <= 95
}

// The stored `settings:handoff`, a missing or bad field read as its default
export function parseSettings(v: unknown): { mode: HandoffMode; threshold: number } {
  const s = isRecord(v) ? v : {}
  return { mode: MODES.find(m => m === s.mode) ?? 'ask', threshold: isThreshold(s.threshold) ? s.threshold : 80 }
}

// The threshold, then every 5 points up to 95
export function stepsOf(threshold: number): number[] {
  const steps: number[] = []
  for (let s = threshold; s <= 95; s += 5) steps.push(s)
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
  const reached = steps.filter(s => s <= percent && (handled === null || s > handled))
  return reached.length === 0 ? null : Math.max(...reached)
}

// The highest step at or under a reading, which a compaction re-arms from
export function stepUnder(percent: number, steps: number[]): number | null {
  return nextStep(null, percent, steps)
}

// The stack's status file: valid with schema 1 and this session's id; F8 stands down when the stack handles a full
// context itself (`fresh-session` or `compact`), runs otherwise, and says why a file it could not use was ignored
export function parseStatus(text: string, session: string): { state: 'stood-down' | 'runs' | 'ignored'; reason: string | null } {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { state: 'ignored', reason: 'not JSON' }
  }
  if (!isRecord(v)) return { state: 'ignored', reason: 'not JSON' }
  if (v.schema === undefined) return { state: 'ignored', reason: 'no schema' }
  if (v.schema !== 1) return { state: 'ignored', reason: `schema ${typeof v.schema === 'number' ? v.schema : 'not 1'}` }
  if (v.session !== session) return { state: 'ignored', reason: 'another session' }
  return v.fullContext === 'fresh-session' || v.fullContext === 'compact' ? { state: 'stood-down', reason: null } : { state: 'runs', reason: null }
}

export const HANDOFF_PATH = '.claude/session-inspector/HANDOFF.md'
export const HANDOFF_USAGE = 'Usage: /auto-handoff [ask|auto|off|at <percent>|now]'
export const THRESHOLD_REFUSED = 'Threshold must be a whole percent from 10 to 95.'

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
  compacting: (): string => `Handoff saved to ${HANDOFF_PATH} - compacting`,
  filled: (at: number): string => `Resume prompt filled from the handoff saved ${clock(at)} - press Enter to send`,
  fallback: (at: number): string => `Handoff saved ${clock(at)}: ask Claude to read ${HANDOFF_PATH}`,
  failed: (reason: string): string => `Handoff not saved: ${reason}`,
}

const MAX_PATHS = 50
const INDENT = '    '

// The Git part from the one `git status --porcelain=v1 --branch` call: its lines verbatim, indented so the `##` branch
// line never reads as a heading, up to 50 paths then `+N more`; or why git was not available
export function gitPart(r: ProcessRunResult | Error): string[] {
  const unavailable = (reason: string): string[] => [`Git: not available (${reason})`]
  if (r instanceof Error) {
    if (/timed? ?out/i.test(r.message)) return unavailable('timed out')
    if (/ENOENT|not found|cannot start|spawn/i.test(r.message)) return unavailable('git not found')
    return unavailable(r.message.split('\n')[0] ?? 'failed')
  }
  if (r.exitCode !== 0) return unavailable(/not a git repository/i.test(r.stderr) ? 'not a repository' : `exit ${r.exitCode}`)
  const lines = r.stdout.split('\n').map(l => l.trimEnd()).filter(l => l !== '')
  const [branch, ...paths] = lines
  const shown = paths.slice(0, MAX_PATHS).map(l => INDENT + l)
  const more = paths.length > MAX_PATHS ? [`${INDENT}+${paths.length - MAX_PATHS} more`] : []
  return [...(branch === undefined ? [] : [INDENT + branch]), ...shown, ...more]
}

// The branch from the Git part's `## <branch>...<upstream>` line, or null with no git
function branchOf(git: string[]): string | null {
  const line = git[0]?.trimStart() ?? ''
  if (!line.startsWith('## ')) return null
  return line.slice(3).replace(/^No commits yet on /, '').split('...')[0]?.split(' ')[0] || null
}

export type PlanPart = {
  file: string; title: string; finished: number; total: number
  steps: { id: string; title: string; status: StepStatus; actualMs: number; forecastMs: number | null; notes: number }[]
}
export type ScoresPart = { name: string; totals: { round: number; total: number }[]; open: { id: string | null; text: string; severity: Severity | null }[] }
// What a save copies: only what is on disk in the project or what the mod counts, never a prompt, a note's text, a
// tool input, a failure's reason or an agent's description
export type SaveInput = {
  at: number; percent: number | null; threshold: number; session: string; model: string | null; git: string[]
  plan: PlanPart | 'tasks' | null; scores: ScoresPart | null
  counts: { turn: number; durationMs: number | null; calls: number; failed: number; agents: number; costUsd: number | null; isEstimate: boolean }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function nextLine(plan: SaveInput['plan']): string {
  if (plan === null) return 'No plan file this session; see Git below.'
  if (plan === 'tasks') return 'Task list in use; its items are not written to this file.'
  const running = plan.steps.find(s => s.status === 'in_progress')
  if (running !== undefined) {
    const of = running.forecastMs === null ? '' : ` of ≈${mins(running.forecastMs)}`
    return `${running.id} ${running.title} - in progress, ${mins(running.actualMs)}${of}.`
  }
  const next = plan.steps.find(s => s.status === 'pending')
  return next === undefined ? 'Plan finished.' : `${next.id} ${next.title} - next.`
}

function stepLine(s: PlanPart['steps'][number]): string {
  const isDone = s.status === 'done' || s.status === 'skipped'
  const state = s.status === 'done' ? `done in ${mins(s.actualMs)}` : s.status === 'in_progress' ? 'in progress' : s.status
  const notes = s.notes > 0 ? ` - ✎ ${plural(s.notes, 'note')}` : ''
  return `- [${isDone ? 'x' : ' '}] ${s.id} ${s.title} - ${state}${notes}`
}

// HANDOFF.md, as the spec's example shows it; the caller masks keys, emails and phones in it before the write
export function handoffText(s: SaveInput): string {
  const d = new Date(s.at)
  const branch = branchOf(s.git)
  const about = [
    s.percent === null ? `Saved before a context reading (asks at ${s.threshold}%) by session-inspector` : `Saved at ${s.percent}% context (asks at ${s.threshold}%) by session-inspector`,
    `session ${s.session.slice(0, 8)}`,
    ...(s.model === null ? [] : [modelText(s.model, true)]),
    ...(branch === null ? [] : [`branch ${branch}`]),
  ]
  const out = [
    MARKER,
    `# Handoff - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(s.at)}`,
    '',
    `${about.join(' · ')}.`,
    `To continue in a new session, ask Claude to read ${HANDOFF_PATH} and resume from Next.`,
    '', '## Next', '', nextLine(s.plan),
  ]
  if (s.plan !== null && s.plan !== 'tasks') {
    out.push('', `## Plan - ${s.plan.title}, ${s.plan.finished}/${s.plan.total}`, '', `From ${s.plan.file}.`, '', ...s.plan.steps.map(stepLine))
    if (s.scores !== null) {
      const totals = s.scores.totals.map(t => `R${t.round} ${t.total}`).join(' → ')
      const open = s.scores.open.map(f => `${f.id === null ? '' : `${f.id} `}${f.text}${f.severity === null ? '' : ` (${f.severity})`}`)
      out.push('', `Scores (${s.scores.name}): ${totals}${open.length > 0 ? ` · open: ${open.join('; ')}` : ''}`)
    }
  }
  out.push('', '## Git', '', ...s.git)
  const c = s.counts
  const session = [
    `Turn ${c.turn}`,
    ...(c.durationMs === null ? [] : [duration(c.durationMs)]),
    `${plural(c.calls, 'tool call')}${c.failed > 0 ? `, ${c.failed} failed` : ''}`,
    ...(c.agents > 0 ? [plural(c.agents, 'agent')] : []),
    ...(c.costUsd === null ? [] : [`${usd(c.costUsd)}${c.isEstimate ? ' est.' : ''}`]),
  ]
  out.push('', '## Session', '', session.join(' · '), '')
  return out.join('\n')
}

// What the Now tab's HANDOFF section reads: the atom with F8's context percent and whether a main-loop turn runs
export type HandoffView = Pick<Handoff, 'mode' | 'threshold' | 'isAskUp' | 'point' | 'handled' | 'lastSave' | 'alfred'> & {
  percent: number | null; window: number | null; isWorking: boolean
}

const button = (key: string, hotkey: string, label: string): Seg => ({ button: { key, label, hotkey, tone: 'handoff', plain: true } })
const SEP: Seg = { text: ' · ' }

// The HANDOFF section (spec 'The HANDOFF row and the keys'): its violet heading and one row by state, then a failed
// save's reason or the last save's path, and why a stack status file was not used; nothing while F8 is off
export function handoffLines(h: HandoffView, _columns: number): Line[] {
  if (h.mode === 'off') return []
  const of = h.point !== null && h.window !== null && h.point !== h.window ? ` of ${tokens(h.point)}` : ''
  const plain = h.percent === null ? 'ctx –' : `ctx ${h.percent}%${of}`
  const gauge = (p: number): Seg[] => [{ text: 'ctx ' }, ...barSegs(p), pctSeg(p), { text: of }]
  const steps = stepsOf(h.threshold)
  const after = (step: number | null): number | null => steps.find(s => step === null || s > step) ?? null
  let row: Line
  if (h.alfred.state === 'stood-down') row = [{ text: `${plain} · handoff by Alfred Code` }]
  else if (h.mode === 'auto') {
    const next = after(h.handled)
    const saved = h.lastSave?.isOk === true
      ? ` · saved${h.handled === null ? '' : ` at ${h.handled}%`} (${clock(h.lastSave.at)})${next === null ? '' : ` · next save at ${next}%`}`
      : ` · saves at ${h.threshold}%`
    row = [{ text: plain + saved }]
  } else if (h.percent === null) row = [{ text: `ctx – · asks at ${h.threshold}%` }]
  else if (!h.isAskUp) {
    const next = after(h.handled)
    row = [...gauge(h.percent), { text: next === null ? ' · ' : ` · asks at ${next}% · ` }, button('handoff-save', 'h', 'save now')]
  } else {
    const next = after(h.handled)
    row = [
      { text: '⚠ ', tone: 'warn' }, ...gauge(h.percent), { text: ` · past ${h.handled ?? h.threshold}% · ` }, button('handoff-save', 'h', 'save handoff'),
      ...(h.isWorking ? [] : [SEP, button('handoff-compact', 'c', 'compact')]),
      SEP, button('handoff-dismiss', 'r', next === null ? 'dismiss' : `remind at ${next}%`),
    ]
  }
  const out: Line[] = [[{ text: 'HANDOFF', bold: true, tone: 'handoff' }], row]
  const last: SaveResult | null = h.lastSave
  if (last !== null && !last.isOk) out.push([{ text: `✗ save failed ${clock(last.at)}: ${last.reason ?? 'unknown'}`, tone: 'fail' }])
  else if (last !== null) out.push([{ text: `last save ${clock(last.at)} · ${HANDOFF_PATH}`, tone: 'dim' }])
  if (h.alfred.state === 'ignored') out.push([{ text: `Alfred Code status file not used: ${h.alfred.reason ?? 'unknown'}`, tone: 'dim' }])
  return out
}
