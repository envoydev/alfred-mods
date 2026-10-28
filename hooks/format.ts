// Plain values to the strings the band and the pane draw: bars, token counts, times, money, one-line cuts.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A bar of 15 cells in groups of three (19 characters) or 5 cells; a cell fills only when its share is reached.
// The two parts joined are the whole bar, so the filled part can take its own colour.
export function bar(percent: number, cells: 15 | 5): [filled: string, empty: string] {
  const filled = Math.max(0, Math.min(cells, Math.floor(percent * cells / 100)))
  let whole = ''
  for (let i = 0; i < cells; i++) {
    if (cells === 15 && i > 0 && i % 3 === 0) whole += ' '
    whole += i < filled ? '■' : '□'
  }
  const at = filled === 0 || cells === 5 ? filled : filled + Math.floor((filled - 1) / 3)
  return [whole.slice(0, at), whole.slice(at)]
}

export function tokens(n: number): string {
  if (n < 100) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`
  const m = Math.floor((s % 3600) / 60)
  return m === 0 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 3600)}h ${m}m`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function weekday(ms: number): string {
  return `${DAYS[new Date(ms).getDay()]} ${clock(ms)}`
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`
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

// The first non-blank line, trimmed, cut to `max` characters with an ellipsis as the last one.
export function oneLine(text: string, max: number): string {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l !== '') ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
