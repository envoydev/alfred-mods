// Alfred Code's status file past Phase 4's fields (Phase 5 spec 'The reader'): each field checked alone, a bad one
// read as unknown and named in `ignored`, the rest of the file still used.
import type { FullContext, Stack, StackScorer, Usage } from '../types'
import type { Line, Seg } from './band.ts'
import { clock, fitLine, tokens } from './format.ts'
import { parseStatus } from './handoff.ts'

export const NO_FILE = 'no status file for this session'
export const UNREADABLE = 'unreadable'

export type StackFields = Omit<Stack, 'state' | 'reason' | 'hasPrompt' | 'readAt'>
export type StackRead = { state: 'ignored'; reason: string } | { state: 'used'; fields: StackFields; prompt: string | null }

const CONTEXTS: FullContext[] = ['fresh-session', 'compact', 'off']
// Control characters, C0, DEL and C1
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
// The prompt's: every control character but a line feed and a tab
const PROMPT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

// A field's rule: the value it reads as, or `bad`; a missing field never reaches a rule
type Rule<T> = (v: unknown) => T | 'bad'

const fullContextRule: Rule<FullContext> = v => CONTEXTS.find(c => c === v) ?? 'bad'
const modelRule: Rule<string | null> = v => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= 100 && !CONTROL.test(v)) ? v : 'bad'
const windowRule: Rule<number | null> = v => v === null || isWhole(v, 1000, 10_000_000) ? v : 'bad'
const autoRunRule: Rule<boolean> = v => typeof v === 'boolean' ? v : 'bad'
const scorerRule: Rule<StackScorer | null> = v => {
  if (v === null) return null
  if (!isRecord(v) || typeof v.on !== 'boolean' || !isWhole(v.level, 1, 100) || !isWhole(v.rounds, 1, 10)) return 'bad'
  return { on: v.on, level: v.level, rounds: v.rounds }
}
const promptRule: Rule<string | null> = v => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= 1000 && !PROMPT_CONTROL.test(v)) ? v : 'bad'

export function parseStack(text: string, session: string): StackRead {
  const status = parseStatus(text, session)
  if (status.state === 'ignored') return { state: 'ignored', reason: status.reason ?? 'not JSON' }
  // parseStatus has read the text as a record
  const v = JSON.parse(text) as Record<string, unknown>
  const ignored: string[] = []
  const field = <T>(name: string, rule: Rule<T>): T | null => {
    if (!(name in v) || v[name] === undefined) return null
    const got = rule(v[name])
    if (got !== 'bad') return got
    ignored.push(name)
    return null
  }
  const fullContext = field('fullContext', fullContextRule)
  const model = field('model', modelRule)
  const window = field('window', windowRule)
  // Under the file's own valid window, else under 10,000,000; a file's own null means no offer at this window
  const resumeAt = field<number | null>('resumeAt', r => r === null || isWhole(r, 1000, (window ?? 10_000_001) - 1) ? r : 'bad')
  const noOffer = v.resumeAt === null
  const autoRun = field('autoRun', autoRunRule)
  const scorer = field('scorer', scorerRule)
  const prompt = field('handoffPrompt', promptRule)
  const parsed = typeof v.updatedAt === 'string' ? Date.parse(v.updatedAt) : NaN
  return {
    state: 'used',
    fields: { fullContext, model, window, resumeAt, noOffer, autoRun, scorer, updatedAt: Number.isNaN(parsed) ? null : parsed, ignored },
    prompt,
  }
}

// A model id as both sides spell it: lowercase, a trailing `[...]` suffix dropped (`claude-opus-5-5[1m]`)
const bareModel = (m: string): string => m.toLowerCase().replace(/\[[^\]]*\]$/, '')

// The file's model and the session's agree when either is unknown or both name the same model
export function modelsAgree(a: string | null, b: string | null): boolean {
  return a === null || b === null || bareModel(a) === bareModel(b)
}

// The context against the stack's resume trigger (spec 'The runway'): `percent` rounded down, past 100 past the
// trigger; `at`, the trigger over the session's window, which the forecast counts turns to, or null when unknown
export type Runway = { percent: number; resumeAt: number; at: number | null }

export function runwayOf(s: Stack, u: Usage, sessionModel: string | null): Runway | null {
  if (s.state !== 'used' || s.fullContext !== 'fresh-session' || s.resumeAt === null || u.tokens === null) return null
  if (!modelsAgree(s.model, sessionModel)) return null
  return { percent: Math.floor((u.tokens * 100) / s.resumeAt), resumeAt: s.resumeAt, at: u.window === null ? null : Math.round((s.resumeAt * 100) / u.window) }
}

// The mode banner (spec 'The mode banner'): `auto-run` in warn and `scorer <level>`, only while a mode is on
export function bannerSegs(s: Stack): Seg[] {
  if (s.state !== 'used') return []
  const parts: Seg[][] = []
  if (s.autoRun === true) parts.push([{ text: 'auto-run', tone: 'warn' }])
  if (s.scorer?.on === true) parts.push([{ text: `scorer ${s.scorer.level}` }])
  return parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' · ', tone: 'dim' as const }, ...p]))
}

const HEAD: Line = [{ text: 'ALFRED CODE', bold: true, tone: 'handoff' }]
const FILL: Seg = { button: { key: 'stack-fill', label: 'fill prompt', hotkey: 'f', tone: 'handoff', plain: true } }
// 'resume: ' before the prompt's line, two spaces and 'f: fill prompt' after it
const BESIDE = 'resume: '.length + 2 + 'f: fill prompt'.length

// Line 2 by fullContext; an unknown resumeAt or window drops its part, an unknown fullContext the line
function contextLine(s: Stack, runway: Runway | null): string | null {
  if (s.fullContext === 'compact') return 'compacts where Claude Code compacts'
  if (s.fullContext === 'off') return 'full context: off · Handoff runs'
  if (s.fullContext === null) return null
  if (s.noOffer) return 'fresh session: no offer at this window'
  if (s.resumeAt === null) return 'fresh session offered'
  const of = s.window === null ? '' : ` of ${tokens(s.window)}`
  return `fresh session offered from ${tokens(s.resumeAt)}${of}${runway === null ? '' : ` · ctx ${runway.percent}% of it`}`
}

// Line 3: the modes known, joined
function modesLine(s: Stack): string | null {
  const scorer = s.scorer === null ? null
    : s.scorer.on ? `scorer on (level ${s.scorer.level}, ${s.scorer.rounds} round${s.scorer.rounds === 1 ? '' : 's'})` : 'scorer off'
  const parts = [s.autoRun === null ? null : `auto-run ${s.autoRun ? 'on' : 'off'}`, scorer].filter((p): p is string => p !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// The Now tab's ALFRED CODE section (spec 'The ALFRED CODE section'), the brief's diagnostics row: the reason a file
// was not used, else what the stack reports, with the resume prompt's first line and its fill while the stack owns the
// full context
export function stackLines(s: Stack, o: { prompt: string | null; runway: Runway | null; sessionModel: string | null; columns: number }): Line[] {
  if (s.state === 'none') return [HEAD, [{ text: `Alfred Code: ${NO_FILE}`, tone: 'dim' }]]
  if (s.state === 'ignored') return [HEAD, [{ text: `Alfred Code status file not used: ${s.reason ?? 'unknown'}`, tone: 'dim' }]]
  const out: Line[] = [HEAD]
  const context = contextLine(s, o.runway)
  if (context !== null) out.push([{ text: context }])
  const modes = modesLine(s)
  if (modes !== null) out.push([{ text: modes }])
  if (s.model !== null) {
    const row: Line = [{ text: `model ${s.model}` }]
    if (!modelsAgree(s.model, o.sessionModel)) row.push({ text: ` · this session runs ${o.sessionModel ?? ''}: runway not used`, tone: 'warn' })
    out.push(row)
  }
  if (o.prompt !== null && (s.fullContext === 'fresh-session' || s.fullContext === 'compact')) {
    out.push([{ text: `resume: ${fitLine(o.prompt, Math.max(1, o.columns - BESIDE))}  ` }, FILL])
  }
  const written = s.updatedAt === null ? '' : ` · written ${clock(s.updatedAt)}`
  const ignored = s.ignored.length === 0 ? '' : ` · ignored: ${s.ignored.join(', ')}`
  out.push([{ text: `read ${s.readAt === null ? '–' : clock(s.readAt)}${written}${ignored}`, tone: 'dim' }])
  return out
}

// The fill's toasts (spec 'The fill'), none carrying the prompt's text
export const STACK_TOASTS = {
  filled: "Alfred Code's resume prompt filled - Enter in the prompt box sends it",
  notEmpty: "Prompt not empty: clear it, then press f to fill Alfred Code's resume prompt",
  dialog: 'A dialog holds the keys: close it, then press f again',
  noBox: 'No prompt box here to fill',
  notFilled: "Alfred Code's resume prompt was not filled",
  gone: 'Alfred Code has no resume prompt now',
}

// A press fills only while line 5 would draw: a used file that owns the full context, with a prompt (Decision 7), so a
// press from a frame drawn before the file changed fills nothing
export function fillReady(s: Stack, prompt: string | null): prompt is string {
  return prompt !== null && s.state === 'used' && (s.fullContext === 'fresh-session' || s.fullContext === 'compact')
}

// The toast for what the prompt box answered; an absent cause is a hook's refusal, unknown
export function fillToast(r: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' }): string {
  if (r.isFilled) return STACK_TOASTS.filled
  return r.refusal === 'dialog' ? STACK_TOASTS.dialog : r.refusal === 'no_composer' ? STACK_TOASTS.noBox : STACK_TOASTS.notFilled
}
