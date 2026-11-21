// The kit's reading of a drawn tree: each node as text, and one string per drawn line
import type { RenderElement } from 'claude-code'

// A node of a drawn tree as a test reads it, and the guard that tells one from a string or a hole
export type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
export const isDrawn = (node: unknown): node is Drawn => typeof node === 'object' && node !== null && typeof (node as Drawn).type === 'string'

function textOf(n: unknown): string {
  if (typeof n === 'string') return n
  if (typeof n !== 'object' || n === null) return ''
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (el.type === 'Button') return String(el.props?.label ?? '')
  if (el.type === 'Code') return String(el.props?.source ?? '')
  if (el.type === 'Svg') return String(el.props?.alt ?? '')
  return (el.children ?? []).map(textOf).join('')
}

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isLine = (n: unknown): boolean => {
  const el = n as El | null
  return el?.type === 'Box' && typeof el.props?.['key'] === 'string' && (el.props['key'] as string).startsWith('line-')
}
const spaces = (v: unknown): string => ' '.repeat(typeof v === 'number' ? v : 0)

// A piece of a fitted line as the terminal draws it: its margins as spaces, an empty Box of width n as n spaces, a
// cell padded to its width on its align side (cut with '…' when longer, as truncate-end draws it)
function pieceOf(n: unknown): string {
  if (typeof n !== 'object' || n === null) return textOf(n)
  const el = n as El
  if (el.type !== 'Box') return textOf(el)
  const p = el.props ?? {}
  const kids = el.children ?? []
  const inner = kids.map(pieceOf).join('')
  let body = inner
  if (typeof p['width'] === 'number') {
    const width = p['width']
    const cells = [...inner]
    body = kids.length === 0 ? ' '.repeat(width)
      : cells.length > width ? `${cells.slice(0, Math.max(0, width - 1)).join('')}…`
      : p['justifyContent'] === 'flex-end' ? inner.padStart(width) : inner.padEnd(width)
  }
  return spaces(p['marginLeft']) + body + spaces(p['marginRight'])
}

// The band's org mark where no account was read, which every session a test starts draws: 'org unknown', alone on a line
// or leading one. `rows` leaves it out so the tests of other parts read the band they were written for; the org mark's
// own tests (tests/band/band-org.test.ts) ask for it with `keepOrg`.
const UNKNOWN_ORG = /^org unknown(?: │ |$)/

// One string per drawn line. A tree of fitted lines (Boxes keyed `line-*`) gives one row per such Box, its pieces
// joined; any other tree, one row per innermost Box (one holding no Box), its texts and button labels in order.
export async function rows(ui: { drawn: () => Promise<RenderElement> }, o: { keepOrg?: boolean } = {}): Promise<string[]> {
  const all = await allRows(ui)
  return o.keepOrg === true ? all : all.map(row => row.replace(UNKNOWN_ORG, '')).filter((row, i) => row !== '' || all[i] === '')
}

async function allRows(ui: { drawn: () => Promise<RenderElement> }): Promise<string[]> {
  const tree = await ui.drawn()
  const lines: El[] = []
  const find = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    if (isLine(n)) lines.push(n as El)
    else ((n as El).children ?? []).forEach(find)
  }
  find(tree)
  if (lines.length > 0) return lines.map(l => (l.children ?? []).map(pieceOf).join(''))
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const el = n as El
    const kids = el.children ?? []
    if (el.type === 'Box' && kids.some(k => (k as El | null)?.type === 'Box')) kids.forEach(walk)
    else out.push(textOf(el))
  }
  walk(tree)
  return out
}
