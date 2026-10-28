// Each /inspect tab, from the session's values to lines of styled segments.
import { agentTree, isLive, toolSummary } from './agents.ts'
import { barSegs, cacheWarning, pctSeg, windowsInOrder, working } from './band.ts'
import { IDLE_COMPACT_MS, billingOf, cacheLine, cacheView, selfCompacts, toastAt } from './cache.ts'
import type { BandInput, Line, Seg, Tone } from './band.ts'
import { clock, duration, modelParts, modelText, oneLine, printable, tokens, usd, when } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'
import { planSection } from './planlines.ts'

import type { AgentRow, Failure, Tab, ToolStat, Totals, Turn, View } from '../types'

export type TabInput = BandInput & { failures: Failure[]; stats: Record<string, ToolStat>; totals: Totals; view: View }

const TABS: [Tab, string, string, Tone?][] = [
  ['now', 'Now', 'n'], ['usage', 'Usage', 'u', 'usage'], ['agents', 'Agents', 'a', 'agents'], ['tools', 'Tools', 't'],
  ['cache', 'Cache', 'c', 'cache'], ['timeline', 'Timeline', 'l'], ['plan', 'Plan', 'p', 'plan'],
]

// The current tab is bold text in its feature's colour; the others are buttons. The bar wraps by width (a docked pane
// is about 46 columns): each tab joins the line while it fits, else starts the next, as on one line the buttons keep
// their width and the current tab's name is squeezed to '…'.
export function tabBar(tab: Tab, isLive: boolean, columns: number): Line[] {
  // A button draws as '[ label ]', the current tab as ' label ', each with a space after; '● live' is 6 wide
  const items: [Line, number][] = TABS.map(([t, label, hotkey, tone]) => {
    const current: Seg = tone === undefined ? { text: ` ${label} `, bold: true } : { text: ` ${label} `, bold: true, tone }
    const button: Seg = { button: tone === undefined ? { key: `tab-${t}`, label, hotkey } : { key: `tab-${t}`, label, hotkey, tone } }
    return [[t === tab ? current : button, { text: ' ' }], label.length + (t === tab ? 3 : 5)]
  })
  if (isLive) items.push([[{ text: '● live', tone: 'ok' }], 6])
  const out: Line[] = [[]]
  let used = 0
  for (const [segs, width] of items) {
    if (used > 0 && used + width > columns) {
      out.push([])
      used = 0
    }
    out[out.length - 1]?.push(...segs)
    used += width
  }
  return out
}

// 'skills fired: watch ×1 · plugin-authoring ×4', first fired first; null with no skill
export function skillsLine(stats: Record<string, ToolStat>): Line | null {
  const skills = Object.entries(stats).filter(([key]) => key.startsWith('Skill: '))
  if (skills.length === 0) return null
  const line: Line = [{ text: 'skills fired: ', tone: 'dim' }]
  skills.forEach(([key, t], i) => {
    if (i > 0) line.push({ text: ' · ', tone: 'dim' })
    line.push({ text: `${key.slice(7)} ×${t.calls}`, tone: 'skill' })
  })
  return line
}

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const

// An agent's model as its family, in the family's colour; the model text when it has none
function familySeg(model: string): Seg {
  const parts = modelParts(model)
  return parts === null ? { text: modelText(model) } : { text: parts.family, tone: parts.family }
}

// How long the agent has run, or how it ended and after how long
function agentTime(r: AgentRow, now: number): string {
  const took = duration((r.endedAt ?? now) - r.startedAt)
  switch (r.status) {
    case 'running': return took
    case 'waiting': return `waiting · ${took}`
    case 'pending': return 'pending'
    case 'completed': return `done in ${took}`
    case 'failed': return `failed after ${took}`
    case 'killed': return `stopped after ${took}`
    case 'idle': return 'idle'
  }
}

function agentGlyph(r: AgentRow): Seg {
  if (isLive(r.status)) return { text: '⟳', bold: true }
  if (r.status === 'completed') return { text: '✓', tone: 'ok' }
  return r.status === 'idle' ? { text: '·', tone: 'dim' } : { text: '✗', tone: 'fail' }
}

// The main loop as the root, then each agent under the one that started it, its task, action or result, and tools
export function agentsLines(b: TabInput): Line[] {
  const counts = new Map<string, number>()
  for (const r of b.agents) {
    const name = modelParts(r.model)?.family ?? modelText(r.model)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const order = [...FAMILIES.filter(f => counts.has(f)), ...[...counts.keys()].filter(k => !(FAMILIES as readonly string[]).includes(k))]
  const head: Line = [{ text: `Agents (${b.agents.length})`, bold: true, tone: 'agents' }]
  if (order.length > 0) head.push({ text: `   ${order.map(k => `${k} ${counts.get(k)}`).join(' · ')}`, tone: 'dim' })
  const root: Line = [b.isWorking ? { text: '⟳ main chat', bold: true } : { text: '✓', tone: 'ok' }]
  if (!b.isWorking) root.push({ text: ' main chat' })
  if (b.meta.model !== null) {
    const parts = modelParts(b.meta.model)
    root.push({ text: ' · ' }, parts === null ? { text: b.meta.model } : { text: modelText(b.meta.model), tone: parts.family })
  }
  root.push({ text: ` · ${b.meta.mainCalls} ${b.meta.mainCalls === 1 ? 'tool' : 'tools'}` })
  const out: Line[] = [head, root]
  for (const t of agentTree(b.agents)) {
    const r = t.row
    const line: Line = [{ text: t.prefix, tone: 'dim' }, agentGlyph(r), { text: ` ${r.type} · ` }, familySeg(r.model)]
    if (r.effort !== null) line.push({ text: ` ◑ ${r.effort}`, tone: 'dim' })
    line.push({ text: `   ${agentTime(r, b.now)}`, tone: 'dim' })
    out.push(line)
    const indent = `${t.prefix.slice(0, -2)}${t.isLast ? '  ' : '│ '}    `
    const doing: Line = [{ text: indent, tone: 'dim' }, { text: 'doing: ', tone: 'dim' }, { text: `"${r.description}"` }]
    if (r.task !== null) doing.push({ text: ` · task ${r.task}` })
    out.push(doing)
    if (isLive(r.status) && r.action !== null) out.push([{ text: indent, tone: 'dim' }, { text: `▸ ${r.action}` }])
    if (!isLive(r.status) && r.report !== null) {
      const isShown = b.view.shown.includes(`report:${r.id}`)
      out.push([
        { text: indent, tone: 'dim' }, { text: `result: ${oneLine(printable(r.report), 60)}` }, { text: ' ' },
        { button: { key: `report-${r.id}`, label: isShown ? 'Hide report' : 'Show report' } },
      ])
      if (isShown) out.push([{ code: r.report }])
    }
    const used = toolSummary(r.tools)
    const parts: Line[] = []
    if (r.contextTokens !== null) parts.push([{ text: `ctx ${tokens(r.contextTokens)}` }])
    if (used.tools.length > 0) parts.push([{ text: `tools ${used.tools.join(' · ')}` }])
    if (used.skills.length > 0) parts.push([{ text: 'skills ' }, { text: used.skills.join(' · '), tone: 'skill' }])
    if (parts.length > 0) out.push([{ text: indent, tone: 'dim' }, ...parts.flatMap((p, i) => (i === 0 ? p : [{ text: '   ' }, ...p]))])
  }
  if (b.agents.length === 0) out.push([{ text: 'No agents yet.', tone: 'dim' }])
  const skills = skillsLine(b.stats)
  if (skills !== null) out.push(skills)
  return out
}

const BILLED: Record<string, string> = { plan: 'within plan usage', credits: 'on usage credits', other: 'off a subscription' }

// The F4 line with [Compact], the reuse of the last request and the session, the tier and where it comes from, and
// when Claude Code compacts the idle conversation itself
export function cacheLines(b: TabInput): Line[] {
  const c = b.cache
  const billing = billingOf(b.usage.windows)
  const v = cacheView(c, billing, b.now)
  const s = c.session
  const head: Line = s.read + s.write + s.input === 0
    ? [{ text: 'Cache     no main-loop request yet', tone: 'dim' }]
    : [{ text: 'Cache     ' }, ...cacheLine(v)]
  if (!b.isWorking && v.cached > 0) head.push({ text: '   ' }, { button: { key: 'compact', label: 'Compact', tone: 'cache' } })
  const out: Line[] = [head]
  const reused = [
    v.reuseLast === null ? null : `last request ${Math.round(v.reuseLast)}%`,
    v.reuseSession === null ? null : `session ${Math.round(v.reuseSession)}%`,
  ].filter((p): p is string => p !== null)
  if (reused.length > 0) out.push([{ text: `Reused    ${reused.join(' · ')}` }])
  const t = v.tier
  const source = t.from === 'pin' ? `${t.tier}, set by ${c.config.pin?.from ?? ''}`
    : t.from === 'switch' ? `${t.tier}, from the model switch at ${clock(c.tierAt ?? 0)}`
    : `≈${t.tier}, Claude Code's default ${BILLED[billing] ?? ''}`
  const priced = c.ratePerToken !== null && c.rateModel !== null ? ` · rewrite priced on ${modelText(c.rateModel, true)}` : ''
  out.push([{ text: `Tier      ${source}${priced}` }])
  const warnAt = toastAt(c, billing, b.usage.tokens)
  if (c.lastAt !== null && selfCompacts(c, billing, b.usage.tokens)) {
    const warn = warnAt === null ? '' : `, else a warning at ≈${clock(warnAt)}`
    out.push([{ text: `Idle      Claude Code should compact it itself at ≈${clock(c.lastAt + IDLE_COMPACT_MS)}${warn}` }])
  }
  return out
}

// The Now tab's AGENTS section: each running agent with its action and context, then the skills fired
function agentsSection(b: TabInput): Line[] {
  const skills = skillsLine(b.stats)
  if (b.agents.length === 0 && skills === null) return []
  const running = b.agents.filter(r => isLive(r.status))
  const head: Line = [{ text: 'AGENTS', bold: true, tone: 'agents' }]
  if (running.length > 0) head.push({ text: ` ${running.length} running` })
  else if (b.agents.length > 0) head.push({ text: ` none running · ${b.agents.length} done` })
  const out: Line[] = [head]
  for (const r of running) {
    const line: Line = [{ text: '⟳', bold: true }, { text: ` ${r.type} [` }, familySeg(r.model)]
    if (r.effort !== null) line.push({ text: ` ◑ ${r.effort}` })
    line.push({ text: ']' })
    if (r.action !== null) line.push({ text: ` ▸ ${r.action}` })
    if (r.contextTokens !== null) line.push({ text: `   ctx ${tokens(r.contextTokens)}`, tone: 'dim' })
    out.push(line)
  }
  if (skills !== null) out.push(skills)
  return out
}

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
  // The turn's line here; the plan has its own section
  if (b.isWorking) out.push(working({ ...b, plan: null }, false))
  if (b.plan !== null) out.push(...planSection(b.plan, b.columns))
  out.push(...agentsSection(b))
  const fresh = b.failures.filter(f => f.isNew).length
  out.push([{ text: 'NEEDS A LOOK', bold: true }, ...(fresh > 0 ? [{ text: `  ${fresh} new`, tone: 'fail' as const }] : [])])
  const warning = cacheWarning(b, false)
  if (warning !== null) out.push(warning)
  if (b.failures.length === 0 && warning === null) out.push([{ text: 'Nothing needs a look.', tone: 'dim' }])
  for (const f of [...b.failures].reverse()) out.push(...failureRows(f, b.view.shown))
  return out
}

function badge(model: string | null): Seg {
  if (model === null) return { text: 'model —', tone: 'dim' }
  const parts = modelParts(model)
  return parts === null ? { text: model } : { text: modelText(model, true), tone: parts.family }
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
    ctx.push(...barSegs(u.percent), pctSeg(u.percent))
    if (u.tokens !== null && u.window !== null) ctx.push({ text: `   ${tokens(u.tokens)} / ${tokens(u.window)}`, tone: 'dim' })
    const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
    const left = turnsLeft(series)
    if (left !== null) ctx.push({ text: `   ≈${left} turns to 80%`, tone: 'dim' })
  }
  out.push(ctx)
  const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
  if (series.length > 0) out.push([{ text: 'per turn  ', tone: 'dim' }, { chart: series.slice(-20) }])

  for (const w of windowsInOrder(u.windows)) {
    const name = w.kind === 'five_hour' ? '5h' : w.kind === 'seven_day' ? '7d' : w.kind
    const line: Line = [{ text: `${name.padEnd(9)} ` }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed)]
    const reset = parse(w.resetsAt)
    if (reset !== null) line.push({ text: `   resets ${when(reset)}`, tone: 'dim' })
    const p = pace(w.kind, b.pace[w.kind]?.points ?? [], reset, b.now)
    if (p === 'on-pace') line.push({ text: '   on pace', tone: 'ok' })
    else if (p !== null) line.push({ text: `   full ≈${clock(p.limitAt)}`, tone: 'warn' })
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
