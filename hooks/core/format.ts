// Plain values to the strings the band and the pane draw: bars, token counts, times, money, one-line cuts.
import type { Family } from './types'

// The one bar, in the band and the pane: 5 cells of 20%, ▰ filled and ▱ empty; a cell fills only when its share is
// reached. The two parts joined are the whole bar, so the filled part can take its own colour.
export function barText(percent: number): [filled: string, empty: string] {
  const filled = Math.max(0, Math.min(5, Math.floor(percent / 20)))
  return ['▰'.repeat(filled), '▱'.repeat(5 - filled)]
}

// A percent's threshold: under 60 ok, to 85 a warning, past it a failure
export function toneOf(percent: number): 'ok' | 'warn' | 'fail' {
  return percent < 60 ? 'ok' : percent <= 85 ? 'warn' : 'fail'
}

export function tokensText(tokens: number): string {
  if (tokens < 100) return String(tokens)
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export function durationText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`
  const m = Math.floor((s % 3600) / 60)
  return m === 0 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 3600)}h ${m}m`
}

// A plan time in whole minutes: '<1m', '12m', '1h 37m', '2h'
export function minutesText(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (ms < 60_000 || m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function clockText(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// A reset as its day, month and clock: '31.10 11:00'
export function whenText(resetsAt: number): string {
  const d = new Date(resetsAt)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${clockText(resetsAt)}`
}

export function usdText(amount: number): string {
  return `$${amount.toFixed(2)}`
}

// Text a surface will draw: colour and cursor codes dropped, a CRLF or a lone CR as a newline, and no control
// character left but tab and newline, as a tree holding one is refused whole.
export function printable(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

// A short fingerprint of a text, to match it later without keeping it: FNV-1a over its UTF-16 units, and its length
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return `${h.toString(16)}:${text.length}`
}

// REC's masker, the identity until mask.ts sets it as it loads: this file imports nothing from mask.ts, so no import
// cycle forms
let masker: (text: string) => string = text => text

export function setMasker(fn: (text: string) => string): void {
  masker = fn
}

const firstLine = (text: string): string => text.split(/\r?\n/).map(l => l.trim()).find(l => l !== '') ?? ''

// The first non-blank line, trimmed, cut to `max` characters with an ellipsis as the last one. Raw: its results are
// stored and written to HANDOFF.md, which REC never touches.
export function oneLine(text: string, max: number): string {
  const line = firstLine(text)
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// A drawn line's cut: the first non-blank line masked whole, then cut to `max` with an ellipsis, never inside a token,
// so a secret that spans the cut shows no prefix
export function fitLine(text: string, max: number): string {
  return cutMasked(masker(firstLine(text)), max)
}

// A masked text cut to `max` with an ellipsis as the last character, backed up to a token's start where one spans the
// cut
export function cutMasked(line: string, max: number): string {
  if (line.length <= max) return line
  let at = max - 1
  for (const match of line.matchAll(/‹[^›\n]*›/g)) {
    if (match.index >= at) break
    if (match.index + match[0].length > at) at = match.index
  }
  return `${line.slice(0, at).trimEnd()}…`
}

// A line's width in columns: its texts' lengths as drawn, masked, as buttons, code and charts stand beside it
export function widthOf(line: readonly object[]): number {
  return line.reduce<number>((width, s) => width + ('text' in s && typeof s.text === 'string' ? masker(s.text).length : 0), 0)
}


// A model id's family and version: 'claude-opus-5-5' is opus 5.5; an id with no known family has none
export function modelParts(model: string): { family: Family; version: string | null } | null {
  const match = /(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?/.exec(model)
  if (match === null) return null
  const version = match[2] === undefined ? null : match[3] === undefined ? match[2] : `${match[2]}.${match[3]}`
  return { family: match[1] as Family, version }
}

// 'opus 5.5', or 'Opus 5.5' as a title; the id as given when no family matches
export function modelText(model: string, title = false): string {
  const parts = modelParts(model)
  if (parts === null) return model
  const name = title ? `${parts.family[0]?.toUpperCase()}${parts.family.slice(1)}` : parts.family
  return parts.version === null ? name : `${name} ${parts.version}`
}
