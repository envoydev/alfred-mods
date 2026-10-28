// REC on Claude Code's own rows (spec 'Where REC masks'): the strings inside a row's props masked with every key, type
// and non-string value kept, the AskUserQuestion dialog kept inside the tool's limits, and the result blocks a rewrite
// cannot carry drawn as the mod's own masked lines.
import type { Line } from './band.ts'
import { cutMasked, printable } from './format.ts'
import type { Hit } from './rec.ts'

// Tools whose masked result does not draw; the live check adds any it finds (spec Risks row 1)
export const REFUSED: readonly string[] = []

const isRecord = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// Keys whose strings are data no site draws as text (a Read image's or PDF's `base64`): never masked, as a private
// word inside them would only corrupt the data and a multi-MB string would be scanned again on each redraw
const OPAQUE = new Set(['base64'])

const PEM_BEGIN = /-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----/
const PEM_END = /-----END[A-Z ]{0,40}PRIVATE KEY-----/

// The indexes of a list of lines (an Edit diff's, one string per line) that a private key spans past its BEGIN line,
// through its END line or the list's end, where `fn` hides the BEGIN line: the key class needs both in one string
function keyLines(lines: unknown[], fn: (s: string) => string): Set<number> {
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
export function maskDeep(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) {
    const keyed = keyLines(value, fn)
    const out = value.map((v, i) => (keyed.has(i) ? `${/^[ +-]/.exec(v as string)?.[0] ?? ''}‹key›` : maskDeep(v, fn)))
    return out.some((v, i) => v !== value[i]) ? out : value
  }
  if (isRecord(value)) {
    const out = Object.entries(value).map(([k, v]) => [k, OPAQUE.has(k) ? v : maskDeep(v, fn)] as const)
    return out.some(([k, v]) => v !== value[k]) ? Object.fromEntries(out) : value
  }
  return value
}

// Every non-empty string inside a value, in order
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (isRecord(value)) return Object.entries(value).flatMap(([k, v]) => (OPAQUE.has(k) ? [] : stringsOf(v)))
  return []
}

export type ResultMask = { kind: 'same' } | { kind: 'output'; output: unknown } | { kind: 'tree'; text: string }

// The line an errored result draws under REC when the mod never saw its error text
export const HIDDEN_ERROR = 'Error · text hidden while REC is on'

// A result block's masked form: its output rewritten in place; for a tool on the refused list, the masked strings as
// text for the mod's own lines; 'same' when masking changes nothing. An errored call draws its error text and not
// `output` (types), which live is no string (2026-10-28): its masked form is that text, as the mod saw it at the call
// or on the row above (`error`), else a string `output`, else HIDDEN_ERROR in its place.
export function maskResult(p: { tool: string; output: unknown; isErrored: boolean; error?: string | null }, fn: (s: string) => string, refused: readonly string[] = REFUSED): ResultMask {
  if (p.isErrored) {
    const error = p.error ?? (typeof p.output === 'string' ? p.output : null)
    if (error === null) return { kind: 'tree', text: HIDDEN_ERROR }
    const masked = fn(error)
    return masked === error ? { kind: 'same' } : { kind: 'tree', text: masked }
  }
  const output = maskDeep(p.output, fn)
  if (output === p.output) return { kind: 'same' }
  if (refused.includes(p.tool)) return { kind: 'tree', text: stringsOf(output).join('\n') }
  return { kind: 'output', output }
}

// The mod's own result block: the first 5 lines, or 500 in an expanded view, then a count of the rest; red for an
// error; under the terminal's ⎿ gutter, two columns in as Claude Code draws its own, where `gutter` is set
export function resultLines(text: string, o: { isExpanded: boolean; isErrored: boolean; gutter: boolean }): Line[] {
  const all = printable(text).split('\n')
  const shown = all.slice(0, o.isExpanded ? 500 : 5)
  const lead = (i: number): string => (o.gutter ? (i === 0 ? '  ⎿  ' : '     ') : '')
  const lines: Line[] = shown.map((l, i) => [o.isErrored ? { text: lead(i) + l, tone: 'fail' } : { text: lead(i) + l }])
  if (all.length > shown.length) lines.push([{ text: `${lead(1)}… +${all.length - shown.length} lines`, tone: 'dim' }])
  return lines
}

const BARE = /^‹(key|email|phone|private|user)›$/
const HEADER_MAX = 12

// The dialog's strings masked inside the tool's limits: a kind hiding two or more distinct values numbers them across
// the dialog (`‹email 1›`, `‹email 2›`), and a masked header over 12 characters is cut to 11 and `…`. Option labels stay
// exactly as asked: Claude Code 2.1.312 draws the original dialog, unmasked, when a rewrite changes one (its debug log:
// 'a rewrite may relabel the questions but not change question 1's options', read live 2026-10-28). The same array
// comes back when nothing changes.
export function maskDialog(questions: unknown[], spans: (s: string) => Hit[]): unknown[] {
  // The distinct values each kind hides, in the order the dialog shows them; a token already in the text is no value
  const values = new Map<string, string[]>()
  const valueOf = (s: string, h: Hit): { kind: string; value: string } | null => {
    const kind = BARE.exec(h.text)?.[1]
    const value = s.slice(h.start, h.end)
    return kind === undefined || value === h.text ? null : { kind, value: value.toLowerCase() }
  }
  questions.forEach(q => maskQuestion(q, s => {
    for (const h of spans(s)) {
      const v = valueOf(s, h)
      const list = v === null ? null : values.get(v.kind) ?? []
      if (v !== null && list !== null && !list.includes(v.value)) values.set(v.kind, [...list, v.value])
    }
    return s
  }))
  const masked = questions.map(q => maskQuestion(q, s => {
    const hits = spans(s)
    if (hits.length === 0) return s
    let out = ''
    let at = 0
    for (const h of hits) {
      const v = valueOf(s, h)
      const list = v === null ? [] : values.get(v.kind) ?? []
      out += s.slice(at, h.start) + (v !== null && list.length > 1 ? `‹${v.kind} ${list.indexOf(v.value) + 1}›` : h.text)
      at = h.end
    }
    return out + s.slice(at)
  }))
  if (masked.every((q, i) => q === questions[i])) return questions
  return masked.map((q, i) => {
    const before = questions[i]
    if (!isRecord(q) || !isRecord(before) || typeof q.header !== 'string' || q.header === before.header || q.header.length <= HEADER_MAX) return q
    return { ...q, header: cutMasked(q.header, HEADER_MAX) }
  })
}

// One question through `fn`, every string but its options' labels
function maskQuestion(q: unknown, fn: (s: string) => string): unknown {
  if (!isRecord(q) || !Array.isArray(q.options)) return maskDeep(q, fn)
  const { options, ...rest } = q
  const outRest = maskDeep(rest, fn) as Record<string, unknown>
  const outOptions = options.map((o: unknown) => {
    if (!isRecord(o) || !('label' in o)) return maskDeep(o, fn)
    const { label, ...others } = o
    const out = maskDeep(others, fn)
    return out === others ? o : { label, ...(out as Record<string, unknown>) }
  })
  const isSame = outRest === rest && outOptions.every((o, i) => o === options[i])
  return isSame ? q : { ...outRest, options: outOptions }
}
