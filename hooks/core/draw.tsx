// Lines of styled segments to the surface's elements. Every string passes through mask() here, the one place REC
// (Phase 4) hooks, and through printable(), as tool output can carry control characters.
import type { EngineInterface, RenderElement, ResolveInput } from 'claude-code'

import { mask } from '../rec/mask'
import { laneFit, statusGlyph } from '../agents/agents'
import { spark } from './forecast'
import { printable } from './format'
import type { AgentStatus, LaneFit } from '../agents/types'
import type { Lane, Line, Seg, Tone } from './types'

const show = (text: string): string => mask(printable(text))

// ok, warn and fail are the theme's own keys, so a light, dark or colour-blind theme draws them as it draws its state;
// every feature and model colour is the deck's (spec C5). An SVG keeps hex: it takes no theme key.
const COLOR: Record<Exclude<Tone, 'dim'>, string> = {
  ok: 'success', warn: 'warning', fail: 'error', usage: '#60a5fa', skill: '#65a30d', agents: '#f472b6', cache: '#22d3ee',
  opus: '#ff8c1a', sonnet: '#3d9bff', haiku: '#19c3a6', fable: '#d16bff', plan: '#ca8a04', handoff: '#a78bfa',
  // The project row's git:( ) and branch, and the usage row's counts (the user, 2026-11-11)
  git: '#c084fc', branch: '#eab308', counts: '#66d9e8',
}

// With NO_COLOR set, no colour at all: the glyphs carry the meaning
function style(seg: { tone?: Tone; bold?: boolean }, noColor: boolean): { color?: string; dimColor?: boolean; bold?: boolean } {
  const out: { color?: string; dimColor?: boolean; bold?: boolean } = {}
  if (seg.bold === true) out.bold = true
  if (noColor || seg.tone === undefined) return out
  if (seg.tone === 'dim') out.dimColor = true
  else out.color = COLOR[seg.tone]
  return out
}

// A polyline of percents, 120 by 24
function polyline(values: number[], noColor: boolean): string {
  const step = values.length > 1 ? 120 / (values.length - 1) : 0
  const points = values.map((v, i) => `${(values.length > 1 ? i * step : 60).toFixed(1)},${(24 - Math.max(0, Math.min(100, v)) * 0.24).toFixed(1)}`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24"><polyline fill="none" stroke="${noColor ? 'currentColor' : COLOR.usage}" stroke-width="1.5" points="${points.join(' ')}"/></svg>`
}

const drawsSvg = (e: ResolveInput): boolean => e.surface === 'desktop' || e.surface === 'vscode'

// Where each lane sits on `width` cells (spec C2, flightdeck's lanes): the axis runs from the earliest start to now,
// or to the last end when none runs; every lane keeps at least one cell of bar
type Span = { before: number; bar: number; after: number }
function spans(lanes: Lane[], now: number, width: number): Span[] {
  const start = Math.min(...lanes.map(l => l.startAt))
  const end = lanes.some(l => l.endAt === null) ? now : Math.max(...lanes.map(l => l.endAt ?? now))
  const span = Math.max(1, end - start)
  return lanes.map(l => {
    const from = Math.min(width - 1, Math.max(0, Math.floor(((l.startAt - start) / span) * width)))
    const to = Math.min(width, Math.max(from + 1, Math.ceil((((l.endAt ?? end) - start) / span) * width)))
    return { before: from, bar: to - from, after: width - to }
  })
}

// A lane's text line: its glyph, the label, the bar, and its time, in laneFit's widths; the time cell is as wide as the
// longest lane's, so 'stopped after 12m 30s' is never cut (the release 3 review) (spec C2)
function laneLine(l: Lane, s: Span, w: LaneFit): Line {
  const glyph = statusGlyph(l.status)
  return [
    { ...glyph, text: `${glyph.text} ` }, { text: l.label, width: w.label }, { text: ' ' },
    ...(s.before > 0 ? [{ text: '·'.repeat(s.before), tone: 'dim' as const }] : []),
    { text: '━'.repeat(s.bar), ...(glyph.tone === undefined ? { bold: true } : { tone: glyph.tone }) },
    ...(s.after > 0 ? [{ text: '·'.repeat(s.after), tone: 'dim' as const }] : []),
    { text: ' ' }, { text: l.time, tone: 'dim', width: w.time },
  ]
}

// SVG cannot name theme keys: flightdeck's mid-tones that read on light and dark backgrounds (SVG_COLORS)
const LANE_HEX = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }
const laneHex = (s: AgentStatus): string =>
  s === 'running' ? LANE_HEX.running : s === 'completed' ? LANE_HEX.done : s === 'failed' || s === 'killed' ? LANE_HEX.failed : LANE_HEX.other
const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The lanes as one SVG, 520 by 18 a lane, a label then a rect each; no size on the element, so it takes the markup's
// width up to its slot and scales down in a narrow one
function lanesSvg(lanes: Lane[], now: number, noColor: boolean): string {
  const ROW = 18
  const W = 520
  const at = spans(lanes, now, 100)
  const body = lanes.map((l, i) => {
    const s = at[i] ?? { before: 0, bar: 1, after: 99 }
    const x = 150 + (s.before / 100) * (W - 160)
    const w = Math.max(3, (s.bar / 100) * (W - 160))
    const chars = [...show(l.label)]
    const label = xml(chars.length > 22 ? `${chars.slice(0, 21).join('')}…` : chars.join(''))
    const fill = noColor ? 'currentColor' : laneHex(l.status)
    return `<text x="4" y="${i * ROW + 13}" font-size="11" fill="${noColor ? 'currentColor' : LANE_HEX.label}">${label}</text><rect x="${x.toFixed(1)}" y="${i * ROW + 4}" width="${w.toFixed(1)}" height="10" rx="3" fill="${fill}"/>`
  }).join('')
  const h = lanes.length * ROW + 4
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${body}</svg>`
}

// A chart where the surface draws Svg, its sparkline as text elsewhere. The Svg is drawn at the markup's 120 by 24,
// whatever the turns, in a Box of CHART_MAX cells (the release 2 review: sized by the turns, two turns drew it 2 cells
// wide)
function chart($: EngineInterface, e: ResolveInput, values: number[], noColor: boolean): RenderElement {
  const alt = show(spark(values))
  if (e.surface === 'desktop' || e.surface === 'vscode') {
    const { Svg } = $.ui.resolve(e)
    return <Svg source={polyline(values, noColor)} alt={alt} width={120} height={24} />
  }
  const { Text } = $.ui.resolve(e)
  return <Text {...style({ tone: 'usage' }, noColor)}>{alt}</Text>
}

type TextSeg = Extract<Seg, { text: string }>
type ButtonSeg = Extract<Seg, { button: unknown }>['button']

// What a line is cut into (spec A1): a text piece with its spaces as margins, a run of spaces alone, a cell, a button,
// a chart, a code block
type Piece =
  | { kind: 'text'; text: string; ml: number; mr: number; seg: TextSeg }
  | { kind: 'gap'; width: number }
  | { kind: 'cell'; text: string; width: number; seg: TextSeg }
  | { kind: 'button'; button: ButtonSeg; label: string; isPlain: boolean }
  | { kind: 'chart'; values: number[]; cells: number }
  | { kind: 'code'; source: string }

const cellsOf = (text: string): number => [...text].length
const CHART_MAX = 20

// Rule 2: leading and trailing spaces become margins, an inner run of two or more splits the segment, spaces alone are
// a gap; a single space between words stays in the text. One pass over the text: tool output can hold a long run of
// spaces, and a render hook must not stall on it
function textPieces(seg: TextSeg, text: string): Piece[] {
  let start = 0
  while (text[start] === ' ') start++
  if (text.length > 0 && start === text.length) return [{ kind: 'gap', width: text.length }]
  let end = text.length
  while (end > start && text[end - 1] === ' ') end--
  const out: Piece[] = []
  let ml = start
  let from = start
  let i = start
  while (i < end) {
    if (text[i] !== ' ' || text[i + 1] !== ' ') {
      i++
      continue
    }
    let j = i
    while (text[j] === ' ') j++
    out.push({ kind: 'text', text: text.slice(from, i), ml, mr: j - i, seg })
    ml = 0
    from = j
    i = j
  }
  out.push({ kind: 'text', text: text.slice(from, end), ml, mr: text.length - end, seg })
  return out
}

function piecesOf(line: Line, isSvg: boolean): Piece[] {
  return line.flatMap((seg): Piece[] => {
    if ('text' in seg) return seg.width === undefined ? textPieces(seg, show(seg.text)) : [{ kind: 'cell', text: show(seg.text), width: seg.width, seg }]
    if ('code' in seg) return [{ kind: 'code', source: show(seg.code) }]
    // A lanes segment is alone on its line and drawn by its own rows (laneRows), never as a piece
    if ('lanes' in seg) return []
    if ('chart' in seg) {
      const values = seg.chart.slice(-CHART_MAX)
      return [{ kind: 'chart', values, cells: isSvg ? CHART_MAX : values.length }]
    }
    // A digit also answers from the empty prompt, so the terminal shows it plain, '3: Compact', where '[ Compact ]'
    // hides it; a letter answers only in the focused pane, and its button keeps the brackets
    const isPlain = seg.button.plain === true || seg.button.isText === true || /^\d$/.test(seg.button.hotkey ?? '')
    return [{ kind: 'button', button: seg.button, label: show(seg.button.label), isPlain }]
  })
}

// How many cells a piece takes (Decision 12): a button as the tab bar counts it, a chart its sparkline; a code block
// is alone on its line and kept whole, outside the fit
function widthOf(p: Piece): number {
  switch (p.kind) {
    case 'text': return p.ml + cellsOf(p.text) + p.mr
    case 'gap': case 'cell': return p.width
    case 'button': return p.isPlain ? (p.button.hotkey === undefined ? 0 : p.button.hotkey.length + 2) + cellsOf(p.label) : cellsOf(p.label) + 4
    case 'chart': return p.cells
    case 'code': return 0
  }
}

// Rule 5: pieces are kept from the start while they fit. A text piece crossing the edge is cut to the room left when 4
// or more cells remain; any other piece crossing it is left out, and so is everything after. A line keeps at least its
// first piece, cut to the width.
type Fitted = { piece: Piece; cut?: number }
function fitFromStart(pieces: Piece[], columns: number): Fitted[] {
  const out: Fitted[] = []
  let used = 0
  let isFirst = true
  for (const p of pieces) {
    if (p.kind === 'code') {
      out.push({ piece: p })
      continue
    }
    const width = widthOf(p)
    if (used + width <= columns) {
      out.push({ piece: p })
      used += width
      isFirst = false
      continue
    }
    const room = columns - used
    if (p.kind === 'text' && (room - p.ml >= 4 || isFirst)) out.push({ piece: p, cut: Math.max(1, room - p.ml) })
    else if (isFirst && (p.kind === 'cell' || p.kind === 'gap')) out.push({ piece: { ...p, width: Math.max(1, columns) } })
    else if (isFirst) out.push({ piece: p })
    break
  }
  return out
}

// The buttons at a line's end, with the gaps between them, keep their place: the line before them is fitted into the
// room they leave and its last text cut, so a failure row in a docked pane keeps Show and Copy (the release 2 review).
// When that leaves under 4 cells of the text, or no text piece to cut, the line falls back to rule 5 alone.
function fit(pieces: Piece[], columns: number): Fitted[] {
  const whole = fitFromStart(pieces, columns)
  let k = pieces.length
  while (k > 0 && (pieces[k - 1]?.kind === 'button' || pieces[k - 1]?.kind === 'gap')) k--
  const tail = pieces.slice(k)
  if (k === 0 || !tail.some(p => p.kind === 'button') || (whole.length === pieces.length && whole.every(f => f.cut === undefined))) return whole
  const room = columns - tail.reduce((sum, p) => sum + widthOf(p), 0)
  const head = fitFromStart(pieces.slice(0, k), room)
  const last = head[head.length - 1]
  if (room <= 0 || last?.piece.kind !== 'text' || last.cut === undefined || last.cut < 4) return whole
  return [...head, ...tail.map(piece => ({ piece }))]
}

// Each line is one row Box of the width it is drawn in, keyed `line-<n>`; each text piece one Text alone in a Box,
// spaces as margins, columns as cells (spec A1). No Text holds a Text: the Desktop app wraps nested pieces, or lays
// them out as blocks, and collapses runs of spaces.
// `fill` is for a tool row: its slot can be narrower than the viewport it is measured against (a pane docked beside the
// transcript), so its Box takes the slot's width and clips there. Each row is at least one row tall: a Box with nothing
// in it is none, and a blank line in a result would vanish.
export function drawLines(
  $: EngineInterface, e: ResolveInput, lines: Line[], o: { noColor: boolean; press: Record<string, () => unknown>; columns: number; fill?: boolean },
): RenderElement {
  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const draw = (face: { mono?: true }) => ({ piece: p, cut }: Fitted): RenderElement => {
    switch (p.kind) {
      case 'gap': return <Box width={p.width} flexShrink={0} />
      case 'cell': {
        const end = p.seg.align === 'end' ? { justifyContent: 'flex-end' as const } : {}
        return <Box width={p.width} flexShrink={0} {...end}><Text {...style(p.seg, o.noColor)} {...face} wrap="truncate-end">{p.text}</Text></Box>
      }
      case 'text': {
        const margins = { ...(p.ml > 0 ? { marginLeft: p.ml } : {}), ...(cut === undefined && p.mr > 0 ? { marginRight: p.mr } : {}) }
        if (cut !== undefined) return <Box width={cut} flexShrink={0} {...margins}><Text {...style(p.seg, o.noColor)} {...face} wrap="truncate-end">{p.text}</Text></Box>
        return <Box flexShrink={0} {...margins}><Text {...style(p.seg, o.noColor)} {...face}>{p.text}</Text></Box>
      }
      case 'chart': return <Box width={p.cells} flexShrink={0}>{chart($, e, p.values, o.noColor)}</Box>
      case 'code': return <Code source={p.source} />
      case 'button': {
        if (p.button.isText === true) return <Box flexShrink={0}><Text {...style({ tone: 'dim' }, o.noColor)} {...face}>{p.label}</Text></Box>
        const { key, hotkey, tone } = p.button
        const press = () => {
          void o.press[key]?.()
        }
        const props = { key, label: p.label, onPress: press, ...(hotkey === undefined ? {} : { hotkey }), ...(p.isPlain ? { plain: true as const } : {}) }
        if (tone === undefined) return <Button {...props} />
        return <Button {...props}><Text {...style({ tone, bold: true }, o.noColor)}>{p.label}</Text></Button>
      }
    }
  }
  const width = o.fill === true ? {} : { width: o.columns }
  const isSvg = drawsSvg(e)
  const plain = draw({})
  const row = (line: Line, key: string, face = plain) => (
    <Box key={key} flexDirection="row" {...width} minHeight={1} overflow="hidden">{fit(piecesOf(line, isSvg), o.columns).map(face)}</Box>
  )
  // Agents on a time axis (spec C2): one SVG where the surface draws one beside text, else a text line per lane, in
  // the monospaced face on mobile so the bars line up
  const laneRows = (seg: Extract<Seg, { lanes: Lane[] }>, n: number): RenderElement[] => {
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Svg } = $.ui.resolve(e)
      const alt = show(`${seg.lanes.length} agents on a time axis`)
      // Straight in a Box as wide as the pane, the slot an unsized Svg scales down to (a Box that cannot shrink gave it
      // none, the release 3 review)
      return [<Box key={`line-${n}`} flexDirection="column" {...width} overflow="hidden"><Svg source={lanesSvg(seg.lanes, seg.now, o.noColor)} alt={alt} /></Box>]
    }
    // The Agents tab draws a lanes line only where they fit; a narrower width keeps the smallest label and a 1-cell bar
    const w = laneFit(seg.lanes, o.columns) ?? { label: 6, time: Math.max(0, ...seg.lanes.map(l => [...l.time].length)), bar: 1 }
    const at = spans(seg.lanes, seg.now, w.bar)
    const face = e.surface === 'mobile' ? draw({ mono: true }) : plain
    return seg.lanes.map((l, k) => row(laneLine(l, at[k] ?? { before: 0, bar: w.bar, after: 0 }, w), `line-${n}-${k}`, face))
  }
  const rows = (line: Line, n: number): RenderElement[] => {
    const only = line.length === 1 ? line[0] : undefined
    if (only !== undefined && 'lanes' in only) return laneRows(only, n)
    return [row(line, `line-${n}`)]
  }
  return <Box flexDirection="column">{lines.flatMap(rows)}</Box>
}

// The band under the input (spec 2026-11-11 band-under, U2): Claude Code's own footer line first, kept live, then the
// band's lines
export function drawUnder(
  $: EngineInterface, e: ResolveInput, beneath: RenderElement, lines: Line[], o: { noColor: boolean; press: Record<string, () => unknown>; columns: number },
): RenderElement {
  const { Box } = $.ui.resolve(e)
  return <Box flexDirection="column">{beneath}{drawLines($, e, lines, o)}</Box>
}

// The footer's .catch while under: Claude Code's line, then the band's failure note, as `drawNote` draws it above
export function drawUnderNote($: EngineInterface, e: ResolveInput, beneath: RenderElement, text: string): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return <Box flexDirection="column">{beneath}<Text dimColor wrap="truncate-end">{text}</Text></Box>
}

// One dim line a draw hook's .catch draws in place of its tree. Not masked: the text is the mod's own, and the masker
// may be what failed.
export function drawNote($: EngineInterface, e: ResolveInput, text: string): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return <Box flexDirection="column"><Text dimColor wrap="truncate-end">{text}</Text></Box>
}

// Lines above an Input and lines below it, as the rec pane draws them: the field takes the keys as the pane opens. A
// surface with no Input (mobile) draws the lines alone.
export function drawWithInput(
  $: EngineInterface, e: ResolveInput, top: Line[], input: { key: string; label: string; submitLabel: string; onSubmit: (value: string) => void }, bottom: Line[],
  o: { noColor: boolean; press: Record<string, () => unknown>; columns: number; fill?: boolean },
): RenderElement {
  const els = $.ui.resolve(e)
  if (!('Input' in els)) return drawLines($, e, [...top, ...bottom], o)
  const { Box, Input } = els
  return (
    <Box flexDirection="column">
      {drawLines($, e, top, o)}
      <Input key={input.key} label={show(input.label)} submitLabel={show(input.submitLabel)} autoFocus onSubmit={(value: string) => input.onSubmit(value)} />
      {drawLines($, e, bottom, o)}
    </Box>
  )
}
