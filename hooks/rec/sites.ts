// REC on Claude Code's own rows (spec 'Where REC masks'): the strings inside a row's props masked with every key, type
// and non-string value kept, the AskUserQuestion dialog kept inside the tool's limits, and the result blocks a rewrite
// cannot carry drawn as the mod's own masked lines.
import { cutMasked, printable } from '../core/format'
import type { Line } from '../core/types'
import type { Hit, ResultMask } from './types'

// Tools whose masked result does not draw; the live check adds any it finds (spec Risks row 1)
export const REFUSED: readonly string[] = []

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Keys whose strings are data no site draws as text (a Read image's or PDF's `base64`): never masked, as a private
// word inside them would only corrupt the data and a multi-MB string would be scanned again on each redraw
const OPAQUE = new Set(['base64'])

const PEM_BEGIN = /-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----/
const PEM_END = /-----END[A-Z ]{0,40}PRIVATE KEY-----/

// The indexes of a list of lines (an Edit diff's, one string per line) that a private key spans past its BEGIN line,
// through its END line or the list's end, where `fn` hides the BEGIN line: the key class needs both in one string
function keyLines(lines: unknown[], fn: (text: string) => string): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (typeof line !== 'string' || !PEM_BEGIN.test(line) || PEM_END.test(line) || fn(line) === line) continue
    while (++i < lines.length && typeof lines[i] === 'string') {
      out.add(i)
      if (PEM_END.test(lines[i] as string)) break
    }
  }
  return out
}

// Every string inside a value through `fn`, arrays and plain objects rebuilt only where a string changed: an unchanged
// value comes back as the same reference, so a hook can pass next(e) untouched. A private key's lines in a list draw
// `‹key›` each, after any diff mark, so the list keeps its length.
export function maskDeep(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) {
    const keyed = keyLines(value, fn)
    const out = value.map((item, i) => (keyed.has(i) ? `${/^[ +-]/.exec(item as string)?.[0] ?? ''}‹key›` : maskDeep(item, fn)))
    return out.some((item, i) => item !== value[i]) ? out : value
  }
  if (isRecord(value)) {
    const out = Object.entries(value).map(([key, entryValue]) => [key, OPAQUE.has(key) ? entryValue : maskDeep(entryValue, fn)] as const)
    return out.some(([key, entryValue]) => entryValue !== value[key]) ? Object.fromEntries(out) : value
  }
  return value
}

// Every non-empty string inside a value, in order
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (isRecord(value)) return Object.entries(value).flatMap(([key, entryValue]) => (OPAQUE.has(key) ? [] : stringsOf(entryValue)))
  return []
}


// The line an errored result draws under REC when the mod never saw its error text
export const HIDDEN_ERROR = 'Error · text hidden while REC is on'

// A result block's masked form: its output rewritten in place; for a tool on the refused list, the masked strings as
// text for the mod's own lines; 'same' when masking changes nothing. An errored call draws its error text and not
// `output` (types), which live is no string (2026-10-28): its masked form is that text, as the mod saw it at the call
// or on the row above (`error`), else a string `output`, else HIDDEN_ERROR in its place.
export function maskResult(result: { tool: string; output: unknown; isErrored: boolean; error?: string | null }, fn: (text: string) => string, refused: readonly string[] = REFUSED): ResultMask {
  if (result.isErrored) {
    const error = result.error ?? (typeof result.output === 'string' ? result.output : null)
    if (error === null) return { kind: 'tree', text: HIDDEN_ERROR }
    const masked = fn(error)
    return masked === error ? { kind: 'same' } : { kind: 'tree', text: masked }
  }
  const output = maskDeep(result.output, fn)
  if (output === result.output) return { kind: 'same' }
  if (refused.includes(result.tool)) return { kind: 'tree', text: stringsOf(output).join('\n') }
  return { kind: 'output', output }
}

// The mod's own result block: the first 5 lines, or 500 in an expanded view, then a count of the rest; red for an
// error; under the terminal's ⎿ gutter, two columns in as Claude Code draws its own, where `gutter` is set
export function resultLines(text: string, opts: { isExpanded: boolean; isErrored: boolean; gutter: boolean }): Line[] {
  const all = printable(text).split('\n')
  const shown = all.slice(0, opts.isExpanded ? 500 : 5)
  const lead = (i: number): string => (opts.gutter ? (i === 0 ? '  ⎿  ' : '     ') : '')
  const lines: Line[] = shown.map((line, i) => [opts.isErrored ? { text: lead(i) + line, tone: 'fail' } : { text: lead(i) + line }])
  if (all.length > shown.length) lines.push([{ text: `${lead(1)}… +${all.length - shown.length} lines`, tone: 'dim' }])
  return lines
}

// A bare token, after the ':' a URL password's token keeps
const BARE = /^(:?)‹(key|email|phone|private|user)›$/
const HEADER_MAX = 12

// The dialog's strings masked inside the tool's limits: a kind hiding two or more distinct values numbers them across
// the dialog (`‹email 1›`, `‹email 2›`), and a masked header over 12 characters is cut to 11 and `…`. Option labels stay
// exactly as asked: Claude Code 2.1.312 draws the original dialog, unmasked, when a rewrite changes one (its debug log:
// 'a rewrite may relabel the questions but not change question 1's options', read live 2026-10-28). The same array
// comes back when nothing changes.
export function maskDialog(questions: unknown[], spans: (text: string) => Hit[]): unknown[] {
  // The distinct values each kind hides, in the order the dialog shows them; a token already in the text is no value
  const values = new Map<string, string[]>()
  const valueOf = (text: string, hit: Hit): { kind: string; value: string; lead: string } | null => {
    const match = BARE.exec(hit.text)
    const lead = match?.[1] ?? ''
    const kind = match?.[2]
    const value = text.slice(hit.start + lead.length, hit.end)
    return kind === undefined || value === hit.text.slice(lead.length) ? null : { kind, value: value.toLowerCase(), lead }
  }
  questions.forEach(question => maskQuestion(question, text => {
    for (const hit of spans(text)) {
      const found = valueOf(text, hit)
      const list = found === null ? null : values.get(found.kind) ?? []
      if (found !== null && list !== null && !list.includes(found.value)) values.set(found.kind, [...list, found.value])
    }
    return text
  }))
  const masked = questions.map(question => maskQuestion(question, text => {
    const hits = spans(text)
    if (hits.length === 0) return text
    let out = ''
    let at = 0
    for (const hit of hits) {
      const found = valueOf(text, hit)
      const list = found === null ? [] : values.get(found.kind) ?? []
      out += text.slice(at, hit.start) + (found !== null && list.length > 1 ? `${found.lead}‹${found.kind} ${list.indexOf(found.value) + 1}›` : hit.text)
      at = hit.end
    }
    return out + text.slice(at)
  }))
  if (masked.every((question, i) => question === questions[i])) return questions
  return masked.map((question, i) => {
    const before = questions[i]
    if (!isRecord(question) || !isRecord(before) || typeof question.header !== 'string') return question
    if (question.header === before.header || question.header.length <= HEADER_MAX) return question
    return { ...question, header: cutMasked(question.header, HEADER_MAX) }
  })
}

// The dialog when its hook failed under REC: every string maskQuestion reaches reads `‹hidden›`, and the option labels
// stay as asked, as a changed label draws the original dialog. Two or more questions are numbered, `‹hidden 1›`, so
// no two read the same should the tool's schema hold them distinct: a rewrite outside it draws the original too.
export function neutralDialog(questions: unknown[]): unknown[] {
  return questions.map((question, i) => {
    const out = maskQuestion(question, () => '‹hidden›')
    return questions.length > 1 && isRecord(out) && typeof out.question === 'string' ? { ...out, question: `‹hidden ${i + 1}›` } : out
  })
}

// One question through `fn`, every string but its options' labels
function maskQuestion(question: unknown, fn: (text: string) => string): unknown {
  if (!isRecord(question) || !Array.isArray(question.options)) return maskDeep(question, fn)
  const { options, ...rest } = question
  const outRest = maskDeep(rest, fn) as Record<string, unknown>
  const outOptions = options.map((option: unknown) => {
    if (!isRecord(option) || !('label' in option)) return maskDeep(option, fn)
    const { label, ...others } = option
    const out = maskDeep(others, fn)
    return out === others ? option : { label, ...(out as Record<string, unknown>) }
  })
  const isSame = outRest === rest && outOptions.every((option, i) => option === options[i])
  return isSame ? question : { ...outRest, options: outOptions }
}
