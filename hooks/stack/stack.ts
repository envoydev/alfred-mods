// Alfred Code's status file past Phase 4's fields (Phase 5 spec 'The reader'): each field checked alone, a bad one
// read as unknown and named in `ignored`, the rest of the file still used.
import { clockText, fitLine, tokensText } from '../core/format'
import { parseStatus } from '../handoff/handoff'
import type { Line, Seg } from '../core/types'
import type { Usage } from '../session/types'
import type { FullContext, Runway, Stack, StackAutoCompact, StackRead, StackScorer } from './types'

export const NO_FILE = 'no status file for this session'
export const UNREADABLE = 'unreadable'


const CONTEXTS: FullContext[] = ['fresh-session', 'compact', 'off']
// Control characters, C0, DEL and C1
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
// The prompt's: every control character but a line feed and a tab
const PROMPT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

// A field's rule: the value it reads as, or `bad`; a missing field never reaches a rule
type Rule<T> = (value: unknown) => T | 'bad'

const fullContextRule: Rule<FullContext> = value => CONTEXTS.find(context => context === value) ?? 'bad'
const modelRule: Rule<string | null> = value => value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 100 && !CONTROL.test(value)) ? value : 'bad'
const windowRule: Rule<number | null> = value => value === null || isWhole(value, 1000, 10_000_000) ? value : 'bad'
const autoRunRule: Rule<boolean> = value => typeof value === 'boolean' ? value : 'bad'
const scorerRule: Rule<StackScorer | null> = value => {
  if (value === null) return null
  if (!isRecord(value) || typeof value.on !== 'boolean' || !isWhole(value.level, 1, 100) || !isWhole(value.rounds, 1, 10)) return 'bad'
  return { on: value.on, level: value.level, rounds: value.rounds }
}
const autoCompactRule: Rule<StackAutoCompact | null> = value => {
  if (value === null) return null
  if (!isRecord(value) || typeof value.on !== 'boolean' || !(value.at === null || isWhole(value.at, 1, 10_000_000))) return 'bad'
  return { on: value.on, at: value.at }
}
// The plan folder (alfred-code's plan folder contract): relative to the project root, forward slashes, each segment a
// plain name, so a read never leaves the project; the trailing slash dropped
const planRule: Rule<string | null> = value => {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 300 || CONTROL.test(value) || value.includes('\\') || /^[A-Za-z]:/.test(value)) return 'bad'
  const segs = value.replace(/\/$/, '').split('/')
  return segs.every(segment => segment !== '' && segment !== '.' && segment !== '..') ? segs.join('/') : 'bad'
}
const promptRule: Rule<string | null> = value => value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 1000 && !PROMPT_CONTROL.test(value)) ? value : 'bad'

export function parseStack(text: string, session: string): StackRead {
  const status = parseStatus(text, session)
  if (status.state === 'ignored') return { state: 'ignored', reason: status.reason ?? 'not JSON' }
  // parseStatus has read the text as a record
  const value = JSON.parse(text) as Record<string, unknown>
  const ignored: string[] = []
  const field = <T>(name: string, rule: Rule<T>): T | null => {
    if (!(name in value) || value[name] === undefined) return null
    const got = rule(value[name])
    if (got !== 'bad') return got
    ignored.push(name)
    return null
  }
  const fullContext = field('fullContext', fullContextRule)
  const model = field('model', modelRule)
  const window = field('window', windowRule)
  // Under the file's own valid window, else under 10,000,000; a file's own null means no offer at this window
  const resumeAt = field<number | null>('resumeAt', value => value === null || isWhole(value, 1000, (window ?? 10_000_000) - 1) ? value : 'bad')
  const noOffer = value.resumeAt === null
  const autoRun = field('autoRun', autoRunRule)
  const scorer = field('scorer', scorerRule)
  const autoCompact = field('autoCompact', autoCompactRule)
  const plan = field('plan', planRule)
  const prompt = field('handoffPrompt', promptRule)
  const parsed = typeof value.updatedAt === 'string' ? Date.parse(value.updatedAt) : NaN
  return {
    state: 'used',
    fields: { fullContext, model, window, resumeAt, hasNoOffer: noOffer, autoRun, scorer, autoCompact, plan, updatedAt: Number.isNaN(parsed) ? null : parsed, ignoredFields: ignored },
    prompt,
  }
}

// A model id as both sides spell it: lowercase, a trailing `[...]` suffix dropped (`claude-opus-5-5[1m]`)
const bareModel = (model: string): string => model.toLowerCase().replace(/\[[^\]]*\]$/, '')

// The file's model and the session's agree when either is unknown or both name the same model
export function modelsAgree(left: string | null, right: string | null): boolean {
  return left === null || right === null || bareModel(left) === bareModel(right)
}


export function runwayOf(stack: Stack, usage: Usage, sessionModel: string | null): Runway | null {
  if (stack.state !== 'used' || stack.fullContext !== 'fresh-session' || stack.resumeAt === null || usage.contextTokens === null) return null
  if (!modelsAgree(stack.model, sessionModel)) return null
  return { percent: Math.floor((usage.contextTokens * 100) / stack.resumeAt), resumeAt: stack.resumeAt, at: usage.contextWindow === null ? null : Math.round((stack.resumeAt * 100) / usage.contextWindow) }
}

// A compaction point in whole thousands, `490k`
const thousands = (at: number): string => `${Math.round(at / 1000)}k`

// The mode banner (spec 'The mode banner'): `auto-run` in warn, `auto-compact <at>` and `scoring <level>`, only while
// a mode is on (the owner, 2026-11-12: '"auto-run | auto-compact 490k | scorer 80"'; the scorer named scoring as
// alfred-code 3.11.0 names it, the user, 2026-11-12). The status file's field keeps its schema 1 name, `scorer`
export function bannerSegs(stack: Stack): Seg[] {
  if (stack.state !== 'used') return []
  const parts: Seg[][] = []
  if (stack.autoRun === true) parts.push([{ text: 'auto-run', tone: 'warn' }])
  if (stack.autoCompact?.on === true) parts.push([{ text: stack.autoCompact.at === null ? 'auto-compact' : `auto-compact ${thousands(stack.autoCompact.at)}` }])
  if (stack.scorer?.on === true) parts.push([{ text: `scoring ${stack.scorer.level}` }])
  return parts.flatMap((segs, i) => (i === 0 ? segs : [{ text: ' · ', tone: 'dim' as const }, ...segs]))
}

const HEAD: Line = [{ text: 'ALFRED CODE', bold: true, tone: 'handoff' }]
const FILL: Seg = { button: { key: 'stack-fill', label: 'fill prompt', hotkey: 'f', tone: 'handoff', plain: true } }
// 'resume: ' before the prompt's line, two spaces and 'f: fill prompt' after it
const BESIDE = 'resume: '.length + 2 + 'f: fill prompt'.length

// Line 2 by fullContext; an unknown resumeAt or window drops its part, an unknown fullContext the line
function contextLine(stack: Stack, runway: Runway | null): string | null {
  if (stack.fullContext === 'compact') return 'compacts where Claude Code compacts'
  if (stack.fullContext === 'off') return 'full context: off · Handoff runs'
  if (stack.fullContext === null) return null
  if (stack.hasNoOffer) return 'fresh session: no offer at this window'
  if (stack.resumeAt === null) return 'fresh session offered'
  const of = stack.window === null ? '' : ` of ${tokensText(stack.window)}`
  return `fresh session offered from ${tokensText(stack.resumeAt)}${of}${runway === null ? '' : ` · ctx ${runway.percent}% of it`}`
}

// Line 3: the modes known, joined
function modesLine(stack: Stack): string | null {
  const scorer = stack.scorer === null ? null
    : stack.scorer.on ? `scoring on (level ${stack.scorer.level}, ${stack.scorer.rounds} round${stack.scorer.rounds === 1 ? '' : 's'})` : 'scoring off'
  const compact = stack.autoCompact === null ? null
    : !stack.autoCompact.on ? 'auto-compact off' : stack.autoCompact.at === null ? 'auto-compact on' : `auto-compact on (at ${thousands(stack.autoCompact.at)})`
  const parts = [stack.autoRun === null ? null : `auto-run ${stack.autoRun ? 'on' : 'off'}`, compact, scorer].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// The Now tab's ALFRED CODE section (spec 'The ALFRED CODE section'), the brief's diagnostics row: the reason a file
// was not used, else what the stack reports, with the resume prompt's first line and its fill while the stack owns the
// full context
export function stackLines(stack: Stack, opts: { prompt: string | null; runway: Runway | null; sessionModel: string | null; columns: number }): Line[] {
  if (stack.state === 'none') return [HEAD, [{ text: `Alfred Code: ${NO_FILE}`, tone: 'dim' }]]
  if (stack.state === 'ignored') return [HEAD, [{ text: `Alfred Code status file not used: ${stack.reason ?? 'unknown'}`, tone: 'dim' }]]
  const out: Line[] = [HEAD]
  const context = contextLine(stack, opts.runway)
  if (context !== null) out.push([{ text: context }])
  const modes = modesLine(stack)
  if (modes !== null) out.push([{ text: modes }])
  if (stack.model !== null) {
    const row: Line = [{ text: `model ${stack.model}` }]
    if (!modelsAgree(stack.model, opts.sessionModel)) row.push({ text: ` · this session runs ${opts.sessionModel ?? ''}: runway not used`, tone: 'warn' })
    out.push(row)
  }
  if (opts.prompt !== null && (stack.fullContext === 'fresh-session' || stack.fullContext === 'compact')) {
    out.push([{ text: `resume: ${fitLine(opts.prompt, Math.max(1, opts.columns - BESIDE))}  ` }, FILL])
  }
  const written = stack.updatedAt === null ? '' : ` · written ${clockText(stack.updatedAt)}`
  const ignored = stack.ignoredFields.length === 0 ? '' : ` · ignored: ${stack.ignoredFields.join(', ')}`
  out.push([{ text: `read ${stack.readAt === null ? '–' : clockText(stack.readAt)}${written}${ignored}`, tone: 'dim' }])
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
export function fillReady(stack: Stack, prompt: string | null): prompt is string {
  return prompt !== null && stack.state === 'used' && (stack.fullContext === 'fresh-session' || stack.fullContext === 'compact')
}

// The toast for what the prompt box answered; an absent cause is a hook's refusal, unknown
export function fillToast(result: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' }): string {
  if (result.isFilled) return STACK_TOASTS.filled
  return result.refusal === 'dialog' ? STACK_TOASTS.dialog : result.refusal === 'no_composer' ? STACK_TOASTS.noBox : STACK_TOASTS.notFilled
}
