// Each /inspect tab, from the session's values to lines of styled segments.
import { LOOPS_NOTE, agentTime, agentTree, isLive, laneFit, lanesOf, loopsLine, reportLine, statusGlyph, toolSummary } from '../agents/agents'
import { barSegs, pctSeg, windowsInOrder } from '../band/gauges'
import { wrapRows } from '../band/wrap'
import { skillSegs } from '../band/detail'
import { cacheWarning, working } from '../band/working'
import { REC_MARK } from '../band/band'
import { IDLE_COMPACT_MS, billingOf, cacheLine, cacheView, selfCompacts, toastAt } from '../cache/cache'
import { clock, duration, fitLine, modelParts, modelText, printable, tokens, usd, when } from '../core/format'
import { pace, turnsLeft } from '../core/forecast'
import { handoffLines } from '../handoff/handoff'
import { numberOf } from '../tools/outcome'
import { PARTS_LABEL, listedText, loadedTexts, partsLines } from '../context/parts'
import { planSection } from '../plan/planlines'
import { recStatus } from '../rec/rec'
import { storedMark } from '../session/windows'
import { stackLines } from '../stack/stack'
import type { AgentRow, Loop } from '../agents/types'
import type { BandInput } from '../band/types'
import type { Parts } from '../context/types'
import type { Line, Seg, Tone } from '../core/types'
import type { HandoffView } from '../handoff/types'
import type { Tab, TabInput, View } from './types'
import type { Totals, Turn } from '../session/types'
import type { Runway, Stack } from '../stack/types'
import type { Failure, ToolStat } from '../tools/types'



const TABS: [Tab, string, string, Tone?][] = [
  ['now', 'Now', 'n'], ['usage', 'Usage', 'u', 'usage'], ['agents', 'Agents', 'a', 'agents'], ['tools', 'Tools', 't'],
  ['cache', 'Cache', 'k', 'cache'], ['timeline', 'Timeline', 'l'], ['plan', 'Plan', 'p', 'plan'],
]

// The Usage and Cache tabs' label column
const LABEL = 10

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
  const out: Line[] = [head]
  // Two or more agents on one time axis, where the pane has room for a 10-cell bar (spec C2)
  const lanes = lanesOf(b.agents, b.now)
  if (lanes.length >= 2 && laneFit(lanes, b.columns) !== null) out.push([{ lanes, now: b.now }])
  out.push(root)
  // Report n as '/inspect report <n>' counts it: the finished agents with one, in this order
  let reportN = 0
  for (const t of agentTree(b.agents)) {
    const r = t.row
    const line: Line = [{ text: t.prefix, tone: 'dim' }, statusGlyph(r.status), { text: ` ${r.type} · ` }, familySeg(r.model)]
    if (r.effort !== null) line.push({ text: ` ◑ ${r.effort}`, tone: 'dim' })
    line.push({ text: `   ${agentTime(r, b.now)}`, tone: 'dim' })
    // Its report ends mid-way: the last step stopped at the output limit (spec C4)
    const isCut = r.lastStop === 'max_tokens'
    if (isCut) line.push({ text: '   ⚠ max_tokens', tone: 'warn' })
    out.push(line)
    const indent = `${t.prefix.slice(0, -2)}${t.isLast ? '  ' : '│ '}    `
    const doing: Line = [{ text: indent, tone: 'dim' }, { text: 'doing: ', tone: 'dim' }, { text: `"${r.description}"` }]
    if (r.task !== null) doing.push({ text: ` · task ${r.task}` })
    out.push(doing)
    if (isLive(r.status) && r.action !== null) out.push([{ text: indent, tone: 'dim' }, { text: `▸ ${r.action}` }])
    if (!isLive(r.status) && r.report !== null) {
      reportN++
      const isShown = b.view.shown.includes(`report:${r.id}`)
      out.push([
        { text: indent, tone: 'dim' }, { text: `result${isCut ? ' (cut off)' : ''}: ${fitLine(reportLine(printable(r.report)), Math.max(40, b.columns - [...indent].length - 30))}` }, { text: ' ' },
        { button: { key: `report-${r.id}`, label: `${isShown ? 'Hide' : 'Show'} report ${reportN}` } },
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
  out.push(...loopsLine(b.loops ?? [], b.now, LOOPS_NOTE))
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
    ? [{ text: 'Cache', tone: 'dim', width: LABEL }, { text: 'no main-loop request yet', tone: 'dim' }]
    : [{ text: 'Cache', width: LABEL }, ...cacheLine(v)]
  if (!b.isWorking && v.cached > 0) head.push({ text: '   ' }, { button: { key: 'compact', label: 'Compact', tone: 'cache' } })
  const out: Line[] = [head]
  const reused = [
    v.reuseLast === null ? null : `last request ${Math.round(v.reuseLast)}%`,
    v.reuseSession === null ? null : `session ${Math.round(v.reuseSession)}%`,
  ].filter((p): p is string => p !== null)
  if (reused.length > 0) out.push([{ text: 'Reused', width: LABEL }, { text: reused.join(' · ') }])
  const t = v.tier
  const source = t.from === 'pin' ? `${t.tier}, set by ${c.config.pin?.from ?? ''}`
    : t.from === 'switch' ? `${t.tier}, from the model switch at ${clock(c.tierAt ?? 0)}`
    : `≈${t.tier}, Claude Code's default ${BILLED[billing] ?? ''}`
  const priced = c.ratePerToken !== null && c.rateModel !== null ? ` · rewrite priced on ${modelText(c.rateModel, true)}` : ''
  out.push([{ text: 'Tier', width: LABEL }, { text: `${source}${priced}` }])
  const warnAt = toastAt(c, billing, b.usage.tokens)
  if (c.lastAt !== null && selfCompacts(c, billing, b.usage.tokens)) {
    const warn = warnAt === null ? '' : `, else a warning at ≈${clock(warnAt)}`
    out.push([{ text: 'Idle', width: LABEL }, { text: `Claude Code should compact it itself at ≈${clock(c.lastAt + IDLE_COMPACT_MS)}${warn}` }])
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

// The failures the newest first, each with the number '/inspect show <n>' and 'copy <n>' take (the user, 2026-11-12:
// 'right now I need to count and order'), right-aligned to the widest
function numberedFailures(b: TabInput): Line[] {
  const listed = b.failures.map((f, i) => ({ f, n: numberOf(f, i) })).reverse()
  const width = Math.max(0, ...listed.map(x => String(x.n).length))
  return listed.flatMap(x => failureRows(x.f, b.view.shown, x.n, width))
}

// The finished agents with a report, in the Agents tab's order: report n is '/inspect report <n>'
export function reportRows(agents: AgentRow[]): AgentRow[] {
  return agentTree(agents).map(t => t.row).filter(r => !isLive(r.status) && r.report !== null)
}

// Each pane button's command, for the terminal's main screen, where nothing takes a click and the pane's keys may not
// reach the mod: the tabs keep their buttons, as their names are the command's word
export function paneCommands(failures: Failure[], agents: AgentRow[]): Record<string, string> {
  const out: Record<string, string> = {
    compact: '/compact', 'handoff-save': '/auto-handoff now', 'handoff-compact': '/auto-handoff compact',
    'handoff-dismiss': '/auto-handoff later', 'stack-fill': '/inspect fill',
  }
  failures.forEach((f, i) => {
    out[`show-${f.id}`] = `/inspect show ${numberOf(f, i)}`
    out[`copy-${f.id}`] = `/inspect copy ${numberOf(f, i)}`
  })
  reportRows(agents).forEach((r, i) => {
    out[`report-${r.id}`] = `/inspect report ${i + 1}`
  })
  return out
}

// Each button with a command drawn as that command's text, and the space between two such as ' · '
export function asCommands(lines: Line[], commands: Record<string, string>): Line[] {
  const isCommand = (seg: Seg | undefined): boolean => seg !== undefined && 'button' in seg && commands[seg.button.key] !== undefined
  return lines.map(line => line.map((seg, i): Seg => {
    if ('button' in seg) {
      const command = commands[seg.button.key]
      return command === undefined ? seg : { button: { key: seg.button.key, label: command, isText: true } }
    }
    if ('text' in seg && seg.text === ' ' && isCommand(line[i - 1]) && isCommand(line[i + 1])) return { text: ' · ' }
    return seg
  }))
}

// '<glyph> <clock> <tool>  <target>   <reason>', ×N for repeats, then its detail as code while shown
function failureRows(f: Failure, shown: string[], n: number, width: number): Line[] {
  const isError = f.outcome === 'error'
  const line: Line = [
    { text: `${String(n).padStart(width)} ` },
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
  // REC's status first while it is on
  if (b.rec !== undefined && b.rec.level !== 'off') out.push([REC_MARK, { text: recStatus(b.rec.level, b.rec.words).slice('● REC'.length) }])
  // The turn's line here; the plan has its own section
  if (b.isWorking) out.push(working({ ...b, plan: null }, false))
  if (b.plan !== null) out.push(...planSection(b.plan, b.columns))
  if (b.handoff !== undefined) out.push(...handoffLines(b.handoff, b.columns))
  if (b.stack !== undefined) out.push(...stackLines(b.stack.view, { ...b.stack, columns: b.columns }))
  out.push(...agentsSection(b))
  const fresh = b.failures.filter(f => f.isNew).length
  out.push([{ text: 'NEEDS A LOOK', bold: true }, ...(fresh > 0 ? [{ text: `  ${fresh} new`, tone: 'fail' as const }] : [])])
  const warning = cacheWarning(b, false)
  if (warning !== null) out.push(warning)
  if (b.failures.length === 0 && warning === null) out.push([{ text: 'Nothing needs a look.', tone: 'dim' }])
  out.push(...numberedFailures(b))
  return out
}

function badge(model: string | null): Seg {
  if (model === null) return { text: 'model —', tone: 'dim' }
  const parts = modelParts(model)
  return parts === null ? { text: model } : { text: modelText(model, true), tone: parts.family }
}

// The Usage tab's Skills row after the context's parts: each skill the main chat loaded, then the listing and its
// tokens, wrapped whole under the label; none with neither
function skillsRow(skills: Record<string, number> | undefined, isResumed: boolean, p: Parts, columns: number): Line[] {
  if (loadedTexts(skills).length === 0 && p.skills === undefined) return []
  const items = skillSegs(skills, isResumed)
  if (p.skills !== undefined) items.push({ text: `${listedText(p.skills)} · ${tokens(p.skills.tokens)}` })
  return wrapRows({ text: 'Skills', width: PARTS_LABEL }, { text: '', width: PARTS_LABEL }, items.map(s => [s]), columns, ' · ')
}

export function usageLines(b: TabInput): Line[] {
  const u = b.usage
  const head: Line = [{ text: 'Usage  ', bold: true }, badge(b.meta.model)]
  if (b.meta.effort !== null) head.push({ text: ` ◑ ${b.meta.effort}`, tone: 'dim' })
  if (u.startedAt !== null) head.push({ text: `   session ${duration(b.now - u.startedAt)}`, tone: 'dim' })
  const out: Line[] = [head]

  const ctx: Line = [{ text: 'Context', width: LABEL }]
  if (u.percent === null) ctx.push({ text: '—', tone: 'dim' })
  else {
    ctx.push(...barSegs(u.percent), pctSeg(u.percent))
    if (u.tokens !== null && u.window !== null) ctx.push({ text: `   ${tokens(u.tokens)} / ${tokens(u.window)}`, tone: 'dim' })
    const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
    const left = turnsLeft(series, b.forecast?.at)
    if (left !== null) ctx.push({ text: `   ≈${left} turns to ${b.forecast?.label ?? '80%'}`, tone: 'dim' })
  }
  out.push(ctx)
  const series = b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent]))
  if (series.length > 0) out.push([{ text: 'per turn', tone: 'dim', width: LABEL }, { chart: series.slice(-20) }])

  for (const w of windowsInOrder(u.windows)) {
    const name = w.kind === 'five_hour' ? '5h' : w.kind === 'seven_day' ? '7d' : w.kind
    const line: Line = [{ text: name, width: LABEL }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed, storedMark(u.windowsAt))]
    const reset = parse(w.resetsAt)
    if (reset !== null) line.push({ text: `   resets ${when(reset)}`, tone: 'dim' })
    const p = pace(w.kind, b.pace[w.kind]?.points ?? [], reset, b.now)
    if (p === 'on-pace') line.push({ text: '   on pace', tone: 'ok' })
    else if (p !== null) line.push({ text: `   full ≈${clock(p.limitAt)}`, tone: 'warn' })
    out.push(line)
  }

  const cost = [u.costUsd === null ? null : `${usd(u.costUsd)} session`, u.todayUsd === null ? null : `${usd(u.todayUsd)} today`]
    .filter((part): part is string => part !== null)
  if (cost.length > 0) out.push([{ text: 'Cost', width: LABEL }, { text: `${cost.join(' · ')}${u.windows.length > 0 ? ', est.' : ''}` }])

  const t = b.totals
  // Output over the main loop's request time, first token and the hooks beneath included: a throughput, not a decode speed
  const rate = t.stepMs > 0 ? ` · ≈${Math.round(t.stepOutput / (t.stepMs / 1000))} tok/s avg` : ''
  out.push([{ text: 'Tokens', width: LABEL }, { text: `in ${tokens(t.input)} · out ${tokens(t.output)} · cache read ${tokens(t.cacheRead)} · cache write ${tokens(t.cacheWrite)}${rate}` }])
  if (b.parts !== undefined) out.push(...partsLines(b.parts), ...skillsRow(b.meta.skills, b.meta.isResumed === true, b.parts, b.columns))
  out.push([{ text: `Compactions ${b.meta.compactions}${b.meta.lastCompactAt === null ? '' : `, at ${clock(b.meta.lastCompactAt)}`}` }])
  return out
}

// The Tools table's columns: the tool, then its counts at their end. The tool's column is 24 cells, or as wide as the
// longest name and a space where the counts' 21 cells leave room, so two long names cut alike stay apart (the release
// 2 review: 'Skill: superpowers:writ…' twice). Under 45 columns it gives way, down to 7 cells, so the counts stay.
const COUNT_COLUMNS = [6, 5, 5, 5]
const toolRow = (cells: string[], first: number, style: { tone?: Tone; bold?: boolean }): Line =>
  cells.map((text, i) => ({ text, width: i === 0 ? first : COUNT_COLUMNS[i - 1] ?? 5, ...(i === 0 ? {} : { align: 'end' as const }), ...style }))

export function toolsLines(b: TabInput): Line[] {
  const rows = Object.entries(b.stats).sort((x, y) => y[1].calls - x[1].calls)
  const longest = Math.max(0, ...rows.map(([key]) => [...key].length))
  const first = Math.max(7, Math.min(Math.max(24, longest + 1), b.columns - COUNT_COLUMNS.reduce((a, c) => a + c, 0)))
  const out: Line[] = [toolRow(['Tools', 'calls', 'ok', '✗', '⊘'], first, { bold: true })]
  if (rows.length === 0) out.push([{ text: 'No tool calls yet.', tone: 'dim' }])
  for (const [key, s] of rows) {
    const row = toolRow([key, ...[s.calls, s.ok, s.failed, s.stopped].map(String)], first, {})
    out.push(key.startsWith('Skill:') ? [{ text: key, width: first, tone: 'skill' }, ...row.slice(1)] : row)
  }
  // Which hook scripts blocked calls, most first, counted past the failure list's cap (spec C6)
  const named = Object.entries(b.blockers ?? {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
  if (named.length > 0) out.push([{ text: 'Blocked by hooks' }, { text: `  ${named.map(([name, n]) => `${name} ×${n}`).join(' · ')}` }])
  out.push([{ text: 'Last failures and blocks', bold: true }])
  if (b.failures.length === 0) out.push([{ text: 'None.', tone: 'dim' }])
  out.push(...numberedFailures(b))
  out.push([{ text: "Counts Claude's tool calls; ! commands are not seen.", tone: 'dim' }])
  return out
}

// The Timeline's columns before its last, the failures: turn, prompt and reply times, how long, tokens, tools, and the
// session's spend while the turn ran (spec C4), 12 cells when its header says the cost is an estimate. A pane narrower
// than the table (61 cells, 65 with the estimate) leaves out the prompt's time and draws the rest tighter, so how long
// each turn took and its tokens stay in a docked pane (24-39 columns, spec Optional).
const TIMELINE_COLUMNS = [4, 8, 9, 9, 14, 8]
const NARROW_COLUMNS = [4, 7, 8, 12, 6]
const timelineRow = (cells: string[], widths: number[], style: { bold?: boolean }, spend: number): Line =>
  cells.map((text, i) => ({ text, width: widths[i] ?? spend, ...style }))

export function timelineLines(turns: Turn[], rows: number, isEstimate: boolean, columns: number): Line[] {
  const spend = isEstimate ? 12 : 8
  const isNarrow = columns < TIMELINE_COLUMNS.reduce((a, c) => a + c, 0) + spend + 1
  const widths = isNarrow ? NARROW_COLUMNS : TIMELINE_COLUMNS
  const pick = (cells: string[]): string[] => (isNarrow ? cells.filter((_, i) => i !== 1) : cells)
  const head = pick(['#', 'you', 'Claude', 'took', 'in / out', 'tools', isEstimate ? 'spend, est.' : 'spend'])
  const out: Line[] = [[...timelineRow(head, widths, { bold: true }, spend), { text: '✗', bold: true }]]
  if (turns.length === 0) out.push([{ text: 'No turns yet.', tone: 'dim' }])
  for (const t of [...turns].reverse().slice(0, rows)) {
    const cells = pick([
      String(t.n), t.promptAt === null ? '—' : clock(t.promptAt), clock(t.replyAt), duration(t.durationMs), `${tokens(t.tokensIn)} / ${tokens(t.tokensOut)}`,
      String(t.tools), t.spendUsd === undefined || t.spendUsd === null ? '-' : usd(t.spendUsd),
    ])
    out.push([...timelineRow(cells, widths, {}, spend), t.failures > 0 ? { text: String(t.failures), tone: 'fail' } : { text: '0', tone: 'dim' }])
  }
  return out
}
