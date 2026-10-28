// Lines of styled segments to the surface's elements. Every string passes through mask() here, the one place REC
// (Phase 4) hooks, and through printable(), as tool output can carry control characters.
import type { EngineInterface, RenderElement, ResolveInput } from 'claude-code'

import { mask } from './mask.ts'
import { spark } from './forecast.ts'
import { printable } from './format.ts'
import type { Line, Seg, Tone } from './band.ts'

const show = (text: string): string => mask(printable(text))

const COLOR: Record<Exclude<Tone, 'dim'>, string> = {
  ok: '#22c55e', warn: '#f59e0b', fail: '#ef4444', usage: '#60a5fa', skill: '#65a30d',
  opus: '#ff8c1a', sonnet: '#3d9bff', haiku: '#19c3a6', fable: '#d16bff',
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

// A chart where the surface draws Svg, its sparkline as text elsewhere
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

// Each run of text segments is one Text that truncates at the end: a Text per segment wraps inside itself once the
// line passes the width. Buttons, code and charts stand beside the runs.
export function drawLines($: EngineInterface, e: ResolveInput, lines: Line[], o: { noColor: boolean; press: Record<string, () => unknown> }): RenderElement {
  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const run = (texts: TextSeg[]) => (
    <Text wrap="truncate-end">{texts.map(seg => <Text {...style(seg, o.noColor)}>{show(seg.text)}</Text>)}</Text>
  )
  const segment = (seg: Exclude<Seg, TextSeg>) => {
    if ('code' in seg) return <Code source={show(seg.code)} />
    if ('chart' in seg) return chart($, e, seg.chart, o.noColor)
    const { key, label, hotkey } = seg.button
    const press = () => {
      void o.press[key]?.()
    }
    return hotkey === undefined
      ? <Button key={key} label={show(label)} onPress={press} />
      : <Button key={key} label={show(label)} hotkey={hotkey} onPress={press} />
  }
  const row = (line: Line) => {
    const out: RenderElement[] = []
    let texts: TextSeg[] = []
    for (const seg of line) {
      if ('text' in seg) {
        texts.push(seg)
        continue
      }
      if (texts.length > 0) out.push(run(texts))
      texts = []
      out.push(segment(seg))
    }
    if (texts.length > 0) out.push(run(texts))
    return <Box flexDirection="row">{out}</Box>
  }
  return <Box flexDirection="column">{lines.map(row)}</Box>
}
