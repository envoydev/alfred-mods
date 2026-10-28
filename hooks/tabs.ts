// Each /inspect tab, from the session's values to lines of styled segments.
import { barSegs, pct, windowsInOrder, working } from './band.ts'
import type { BandInput, Line, Seg, Tone } from './band.ts'
import { clock, duration, tokens, usd, weekday } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'

import type { Failure, Tab, ToolStat, Totals, Turn, View } from '../types'

export type TabInput = BandInput & { failures: Failure[]; stats: Record<string, ToolStat>; totals: Totals; view: View }

const TABS: [Tab, string, string][] = [['now', 'Now', 'n'], ['usage', 'Usage', 'u'], ['tools', 'Tools', 't'], ['timeline', 'Timeline', 'l']]
const FAMILIES: Tone[] = ['opus', 'sonnet', 'haiku', 'fable']

// The current tab is bold text; the others are buttons
export function tabBar(tab: Tab, isLive: boolean): Line {
  const line: Line = []
  for (const [t, label, hotkey] of TABS) {
    line.push(t === tab ? { text: ` ${label} `, bold: true } : { button: { key: `tab-${t}`, label, hotkey } }, { text: ' ' })
  }
  if (isLive) line.push({ text: '● live', tone: 'ok' })
  return line
}

const when = (resetsAt: number, now: number): string => (resetsAt - now < 86_400_000 ? clock(resetsAt) : weekday(resetsAt))
const parse = (iso: string | null): number | null => {
  const ms = iso === null ? NaN : Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// '<glyph> <clock> <tool>  <target>   <reason>', ×N for repeats, then its detail as code while shown
function failureRows(f: Failure, shown: string[]): Line[] {
  const isError = f.outcome === 'error'
  const line: Line = [
    { text: isError ? '✗ ' : '⊘ ', tone: isError ? 'fail' : 'warn' },
    { text: `${clock(f.at)} `, tone: 'dim' },
    { text: f.tool },
  ]
  if (f.target !== '') line.push({ text: `  ${f.target}`, tone: 'dim' })
  line.push({ text: `   ${f.reason}` })
  if (f.count > 1) line.push({ text: ` ×${f.count}`, tone: 'dim' })
  const isShown = shown.includes(f.id)
  if (isError || f.outcome === 'blocked') line.push({ text: ' ' }, { button: { key: `show-${f.id}`, label: isShown ? 'Hide' : 'Show' } })
  if (isError) line.push({ text: ' ' }, { button: { key: `copy-${f.id}`, label: 'Copy' } })
  return isShown ? [line, [{ code: f.detail }]] : [line]
}

export function nowLines(b: TabInput): Line[] {
  const out: Line[] = []
  if (b.isWorking) out.push(working(b, false))
  const fresh = b.failures.filter(f => f.isNew).length
  out.push([{ text: 'NEEDS A LOOK', bold: true }, ...(fresh > 0 ? [{ text: `  ${fresh} new`, tone: 'fail' as const }] : [])])
  if (b.failures.length === 0) out.push([{ text: 'Nothing needs a look.', tone: 'dim' }])
  for (const f of [...b.failures].reverse()) out.push(...failureRows(f, b.view.shown))
  return out
}

function badge(model: string | null): Seg {
  if (model === null) return { text: 'model —', tone: 'dim' }
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(model)
  const family = m?.[1] as Tone | undefined
  if (m === null || family === undefined || !FAMILIES.includes(family)) return { text: model }
  return { text: `${family[0]?.toUpperCase()}${family.slice(1)} ${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}`, tone: family }
}

export function usageLines(b: TabInput): Line[] {
  const u = b.usage
  const head: Line = [{ text: 'Usage  ', bold: true }, badge(b.meta.model)]
  if (b.meta.effort !== null) head.push({ text: ` ◑ ${b.meta.effort}`, tone: 'dim' })
  if (u.startedAt !== null) head.push({ text: `   session ${duration(b.now - u.startedAt)}`, tone: 'dim' })
  const out: Line[] = [head]

  const ctx: Line = [{ text: 'Context   ' }]
  if (u.percent === null) ctx.push({ text: '—', tone: 'dim' })
  else {
    ctx.push(...barSegs(u.percent, 15), { text: ` ${pct(u.percent)}` })
    if (u.tokens !== null && u.window !== null) ctx.push({ text: `   ${tokens(u.tokens)} / ${tokens(u.window)}`, tone: 'dim' })
    const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
    const left = turnsLeft(series)
    if (left !== null) ctx.push({ text: `   ≈${left} turns to 80%`, tone: 'dim' })
  }
  out.push(ctx)
  const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
  if (series.length > 0) out.push([{ text: 'per turn  ', tone: 'dim' }, { chart: series.slice(-20) }])

  for (const w of windowsInOrder(u.windows)) {
    const name = w.kind === 'five_hour' ? '5h' : w.kind === 'seven_day' ? 'Weekly' : w.kind
    const line: Line = [{ text: `${name.padEnd(9)} ` }, ...barSegs(w.percentUsed, 15), { text: ` ${pct(w.percentUsed)}` }]
    const reset = parse(w.resetsAt)
    if (reset !== null) line.push({ text: `   resets ${when(reset, b.now)}`, tone: 'dim' })
    const p = pace(b.pace[w.kind]?.points ?? [], reset, b.now)
    if (p === 'on-pace') line.push({ text: '   on pace', tone: 'ok' })
    else if (p !== null) line.push({ text: `   limit ≈${clock(p.limitAt)}`, tone: 'warn' })
    out.push(line)
  }

  const cost = [u.costUsd === null ? null : `${usd(u.costUsd)} session`, u.todayUsd === null ? null : `${usd(u.todayUsd)} today`]
    .filter((part): part is string => part !== null)
  if (cost.length > 0) out.push([{ text: 'Cost      ' }, { text: `${cost.join(' · ')}${u.windows.length > 0 ? ', est.' : ''}` }])

  const t = b.totals
  const rate = t.stepMs > 0 ? ` · ${Math.round(t.stepOutput / (t.stepMs / 1000))} tok/s` : ''
  out.push([{ text: 'Tokens    ' }, { text: `in ${tokens(t.input)} · out ${tokens(t.output)} · cache read ${tokens(t.cacheRead)} · cache write ${tokens(t.cacheWrite)}${rate}` }])
  out.push([{ text: `Compactions ${b.meta.compactions}${b.meta.lastCompactAt === null ? '' : `, at ${clock(b.meta.lastCompactAt)}`}` }])
  return out
}

const cols = (s: ToolStat): string => `${String(s.calls).padStart(6)}${String(s.ok).padStart(5)}${String(s.failed).padStart(5)}${String(s.stopped).padStart(5)}`

export function toolsLines(b: TabInput): Line[] {
  const out: Line[] = [[{ text: `${'Tools'.padEnd(24)}${'calls'.padStart(6)}${'ok'.padStart(5)}${'✗'.padStart(5)}${'⊘'.padStart(5)}`, bold: true }]]
  const rows = Object.entries(b.stats).sort((x, y) => y[1].calls - x[1].calls)
  if (rows.length === 0) out.push([{ text: 'No tool calls yet.', tone: 'dim' }])
  for (const [key, s] of rows) {
    out.push([key.startsWith('Skill:') ? { text: `${key.padEnd(23)} `, tone: 'skill' } : { text: `${key.padEnd(23)} ` }, { text: cols(s) }])
  }
  out.push([{ text: 'Last failures and blocks', bold: true }])
  if (b.failures.length === 0) out.push([{ text: 'None.', tone: 'dim' }])
  for (const f of [...b.failures].reverse()) out.push(...failureRows(f, b.view.shown))
  out.push([{ text: "Counts Claude's tool calls; ! commands are not seen.", tone: 'dim' }])
  return out
}

export function timelineLines(turns: Turn[], rows: number): Line[] {
  const out: Line[] = [[{ text: '#   you     Claude   took     in / out      tools   ✗', bold: true }]]
  if (turns.length === 0) out.push([{ text: 'No turns yet.', tone: 'dim' }])
  for (const t of [...turns].reverse().slice(0, rows)) {
    const row = `${String(t.n).padEnd(4)}${(t.promptAt === null ? '—' : clock(t.promptAt)).padEnd(8)}${clock(t.replyAt).padEnd(9)}`
      + `${duration(t.durationMs).padEnd(9)}${`${tokens(t.tokensIn)} / ${tokens(t.tokensOut)}`.padEnd(14)}${String(t.tools).padEnd(8)}`
    out.push([{ text: row }, t.failures > 0 ? { text: String(t.failures), tone: 'fail' } : { text: '0', tone: 'dim' }])
  }
  return out
}
