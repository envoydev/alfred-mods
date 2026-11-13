// Fitting a band row to the width: cells, wrapped rows and rows packed to the band's height
import { widthOf } from '../core/format'
import type { Line, Seg } from '../core/types'

// A line's cells as the terminal draws it: its text, and each button `[ label ]`, or `1: label` when plain
export function cellsOf(line: Line): number {
  return line.reduce((n, s) => {
    if ('text' in s && s.width !== undefined) return n + s.width
    if (!('button' in s)) return n + widthOf([s])
    const b = s.button
    const label = widthOf([{ text: b.label }])
    return n + (b.plain === true || /^\d$/.test(b.hotkey ?? '') ? (b.hotkey === undefined ? 0 : b.hotkey.length + 2) + label : label + 4)
  }, 0)
}

// Items after a label, joined by `joiner` (dim) while they fit; a row that wraps starts with `under`, as wide as the
// label, so its items line up under the first. An item is a line of its own segments, so a glyph can carry a tone its
// name does not; one wider than a row has the row to itself, and the draw cuts it.
export function wrapRows(label: Seg, under: Seg, items: Line[], columns: number, joiner: string): Line[] {
  const lead = cellsOf([label])
  const gap = widthOf([{ text: joiner }])
  const rows: Line[] = []
  let row: Line = [label]
  let used = lead
  let count = 0
  for (const item of items) {
    const w = widthOf(item)
    if (count > 0 && used + gap + w > columns) {
      rows.push(row)
      row = [under]
      used = lead
      count = 0
    }
    if (count > 0) {
      row.push({ text: joiner, tone: 'dim' })
      used += gap
    }
    row.push(...item)
    used += w
    count++
  }
  rows.push(row)
  return rows
}

// Items in rows of `columns`, joined by ' │ ' while the next fits, else on a row of its own; null when one is wider
export function packRows(items: Line[], columns: number): Line[] | null {
  const rows: Line[] = []
  let row: Line = []
  for (const item of items) {
    if (cellsOf(item) > columns) return null
    const joined: Line = row.length === 0 ? item : [...row, { text: ' │ ', tone: 'dim' }, ...item]
    if (cellsOf(joined) <= columns) row = joined
    else {
      rows.push(row)
      row = item
    }
  }
  return row.length === 0 ? rows : [...rows, row]
}
