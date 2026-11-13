// Each /inspect tab, from the session's values to lines of styled segments.
import { LOOPS_NOTE, agentTime, agentTree, isLive, laneFit, lanesOf, loopsLine, reportLine, statusGlyph, toolSummary } from '../agents/agents'
import { barSegs, percentSeg, windowsInOrder } from '../band/gauges'
import { wrapRows } from '../band/wrap'
import { skillSegs } from '../band/detail'
import { cacheWarning, workingLine } from '../band/working'
import { REC_MARK } from '../band/band'
import { IDLE_COMPACT_MS, billingOf, cacheLine, cacheView, selfCompacts, toastAt } from '../cache/cache'
import { clockText, durationText, fitLine, modelParts, modelText, printable, tokensText, usdText, whenText } from '../core/format'
import { paceForecast, turnsLeft } from '../core/forecast'
import { handoffLines } from '../handoff/handoff'
import { failureNumberOf } from '../tools/outcome'
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
  const items: [Line, number][] = TABS.map(([tabName, label, hotkey, tone]) => {
    const current: Seg = tone === undefined ? { text: ` ${label} `, bold: true } : { text: ` ${label} `, bold: true, tone }
    const button: Seg = { button: tone === undefined ? { key: `tab-${tabName}`, label, hotkey } : { key: `tab-${tabName}`, label, hotkey, tone } }
    return [[tabName === tab ? current : button, { text: ' ' }], label.length + (tabName === tab ? 3 : 5)]
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
  skills.forEach(([key, stat], i) => {
    if (i > 0) line.push({ text: ' · ', tone: 'dim' })
    line.push({ text: `${key.slice(7)} ×${stat.calls}`, tone: 'skill' })
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
export function agentsLines(input: TabInput): Line[] {
  const counts = new Map<string, number>()
  for (const agent of input.agents) {
    const name = modelParts(agent.model)?.family ?? modelText(agent.model)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const order = [...FAMILIES.filter(family => counts.has(family)), ...[...counts.keys()].filter(name => !(FAMILIES as readonly string[]).includes(name))]
  const head: Line = [{ text: `Agents (${input.agents.length})`, bold: true, tone: 'agents' }]
  if (order.length > 0) head.push({ text: `   ${order.map(name => `${name} ${counts.get(name)}`).join(' · ')}`, tone: 'dim' })
  const root: Line = [input.isWorking ? { text: '⟳ main chat', bold: true } : { text: '✓', tone: 'ok' }]
  if (!input.isWorking) root.push({ text: ' main chat' })
  if (input.session.model !== null) {
    const parts = modelParts(input.session.model)
    root.push({ text: ' · ' }, parts === null ? { text: input.session.model } : { text: modelText(input.session.model), tone: parts.family })
  }
  root.push({ text: ` · ${input.session.mainToolCalls} ${input.session.mainToolCalls === 1 ? 'tool' : 'tools'}` })
  const out: Line[] = [head]
  // Two or more agents on one time axis, where the pane has room for a 10-cell bar (spec C2)
  const lanes = lanesOf(input.agents, input.now)
  if (lanes.length >= 2 && laneFit(lanes, input.columns) !== null) out.push([{ lanes, now: input.now }])
  out.push(root)
  // Report n as '/inspect report <n>' counts it: the finished agents with one, in this order
  let reportN = 0
  for (const node of agentTree(input.agents)) {
    const row = node.row
    const line: Line = [{ text: node.prefix, tone: 'dim' }, statusGlyph(row.status), { text: ` ${row.type} · ` }, familySeg(row.model)]
    if (row.effort !== null) line.push({ text: ` ◑ ${row.effort}`, tone: 'dim' })
    line.push({ text: `   ${agentTime(row, input.now)}`, tone: 'dim' })
    // Its report ends mid-way: the last step stopped at the output limit (spec C4)
    const isCut = row.lastStop === 'max_tokens'
    if (isCut) line.push({ text: '   ⚠ max_tokens', tone: 'warn' })
    out.push(line)
    const indent = `${node.prefix.slice(0, -2)}${node.isLast ? '  ' : '│ '}    `
    const doing: Line = [{ text: indent, tone: 'dim' }, { text: 'doing: ', tone: 'dim' }, { text: `"${row.description}"` }]
    if (row.task !== null) doing.push({ text: ` · task ${row.task}` })
    out.push(doing)
    if (isLive(row.status) && row.action !== null) out.push([{ text: indent, tone: 'dim' }, { text: `▸ ${row.action}` }])
    if (!isLive(row.status) && row.report !== null) {
      reportN++
      const isShown = input.view.expandedIds.includes(`report:${row.id}`)
      out.push([
        { text: indent, tone: 'dim' }, { text: `result${isCut ? ' (cut off)' : ''}: ${fitLine(reportLine(printable(row.report)), Math.max(40, input.columns - [...indent].length - 30))}` }, { text: ' ' },
        { button: { key: `report-${row.id}`, label: `${isShown ? 'Hide' : 'Show'} report ${reportN}` } },
      ])
      if (isShown) out.push([{ code: row.report }])
    }
    const used = toolSummary(row.tools)
    const parts: Line[] = []
    if (row.contextTokens !== null) parts.push([{ text: `ctx ${tokensText(row.contextTokens)}` }])
    if (used.tools.length > 0) parts.push([{ text: `tools ${used.tools.join(' · ')}` }])
    if (used.skills.length > 0) parts.push([{ text: 'skills ' }, { text: used.skills.join(' · '), tone: 'skill' }])
    if (parts.length > 0) out.push([{ text: indent, tone: 'dim' }, ...parts.flatMap((part, i) => (i === 0 ? part : [{ text: '   ' }, ...part]))])
  }
  if (input.agents.length === 0) out.push([{ text: 'No agents yet.', tone: 'dim' }])
  out.push(...loopsLine(input.loops ?? [], input.now, LOOPS_NOTE))
  const skills = skillsLine(input.stats)
  if (skills !== null) out.push(skills)
  return out
}

const BILLED: Record<string, string> = { plan: 'within plan usage', credits: 'on usage credits', other: 'off a subscription' }

// The F4 line with [Compact], the reuse of the last request and the session, the tier and where it comes from, and
// when Claude Code compacts the idle conversation itself
export function cacheLines(input: TabInput): Line[] {
  const cache = input.cache
  const billing = billingOf(input.usage.rateWindows)
  const cacheState = cacheView(cache, billing, input.now)
  const counts = cache.sessionCounts
  const head: Line = counts.read + counts.write + counts.input === 0
    ? [{ text: 'Cache', tone: 'dim', width: LABEL }, { text: 'no main-loop request yet', tone: 'dim' }]
    : [{ text: 'Cache', width: LABEL }, ...cacheLine(cacheState)]
  if (!input.isWorking && cacheState.cached > 0) head.push({ text: '   ' }, { button: { key: 'compact', label: 'Compact', tone: 'cache' } })
  const out: Line[] = [head]
  const reused = [
    cacheState.reuseLast === null ? null : `last request ${Math.round(cacheState.reuseLast)}%`,
    cacheState.reuseSession === null ? null : `session ${Math.round(cacheState.reuseSession)}%`,
  ].filter((part): part is string => part !== null)
  if (reused.length > 0) out.push([{ text: 'Reused', width: LABEL }, { text: reused.join(' · ') }])
  const tier = cacheState.tier
  const source = tier.from === 'pin' ? `${tier.tier}, set by ${cache.config.pin?.from ?? ''}`
    : tier.from === 'switch' ? `${tier.tier}, from the model switch at ${clockText(cache.tierAt ?? 0)}`
    : `≈${tier.tier}, Claude Code's default ${BILLED[billing] ?? ''}`
  const priced = cache.ratePerToken !== null && cache.rateModel !== null ? ` · rewrite priced on ${modelText(cache.rateModel, true)}` : ''
  out.push([{ text: 'Tier', width: LABEL }, { text: `${source}${priced}` }])
  const warnAt = toastAt(cache, billing, input.usage.contextTokens)
  if (cache.lastRequestAt !== null && selfCompacts(cache, billing, input.usage.contextTokens)) {
    const warn = warnAt === null ? '' : `, else a warning at ≈${clockText(warnAt)}`
    out.push([{ text: 'Idle', width: LABEL }, 
      { text: `Claude Code should compact it itself at ≈${clockText(cache.lastRequestAt + IDLE_COMPACT_MS)}${warn}` }])
  }
  return out
}

// The Now tab's AGENTS section: each running agent with its action and context, then the skills fired
function agentsSection(input: TabInput): Line[] {
  const skills = skillsLine(input.stats)
  if (input.agents.length === 0 && skills === null) return []
  const running = input.agents.filter(agent => isLive(agent.status))
  const head: Line = [{ text: 'AGENTS', bold: true, tone: 'agents' }]
  if (running.length > 0) head.push({ text: ` ${running.length} running` })
  else if (input.agents.length > 0) head.push({ text: ` none running · ${input.agents.length} done` })
  const out: Line[] = [head]
  for (const row of running) {
    const line: Line = [{ text: '⟳', bold: true }, { text: ` ${row.type} [` }, familySeg(row.model)]
    if (row.effort !== null) line.push({ text: ` ◑ ${row.effort}` })
    line.push({ text: ']' })
    if (row.action !== null) line.push({ text: ` ▸ ${row.action}` })
    if (row.contextTokens !== null) line.push({ text: `   ctx ${tokensText(row.contextTokens)}`, tone: 'dim' })
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
function numberedFailures(input: TabInput): Line[] {
  const listed = input.failures.map((failure, i) => ({ f: failure, n: failureNumberOf(failure, i) })).reverse()
  const width = Math.max(0, ...listed.map(entry => String(entry.n).length))
  return listed.flatMap(entry => failureRows(entry.f, input.view.expandedIds, entry.n, width))
}

// The finished agents with a report, in the Agents tab's order: report n is '/inspect report <n>'
export function reportRows(agents: AgentRow[]): AgentRow[] {
  return agentTree(agents).map(node => node.row).filter(row => !isLive(row.status) && row.report !== null)
}

// Each pane button's command, for the terminal's main screen, where nothing takes a click and the pane's keys may not
// reach the mod: the tabs keep their buttons, as their names are the command's word
export function paneCommands(failures: Failure[], agents: AgentRow[]): Record<string, string> {
  const out: Record<string, string> = {
    compact: '/compact', 'handoff-save': '/auto-handoff now', 'handoff-compact': '/auto-handoff compact',
    'handoff-dismiss': '/auto-handoff later', 'stack-fill': '/inspect fill',
  }
  failures.forEach((failure, i) => {
    out[`show-${failure.id}`] = `/inspect show ${failureNumberOf(failure, i)}`
    out[`copy-${failure.id}`] = `/inspect copy ${failureNumberOf(failure, i)}`
  })
  reportRows(agents).forEach((row, i) => {
    out[`report-${row.id}`] = `/inspect report ${i + 1}`
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
function failureRows(failure: Failure, shown: string[], number: number, width: number): Line[] {
  const isError = failure.outcome === 'error'
  const line: Line = [
    { text: `${String(number).padStart(width)} ` },
    { text: isError ? '✗ ' : '⊘ ', tone: isError ? 'fail' : 'warn' },
    { text: `${clockText(failure.at)} `, tone: 'dim' },
    { text: failure.tool },
  ]
  if (failure.target !== '') line.push({ text: `  ${failure.target}`, tone: 'dim' })
  line.push({ text: `   ${failure.reason}` })
  if (failure.count > 1) line.push({ text: ` ×${failure.count}`, tone: 'dim' })
  const isShown = shown.includes(failure.id)
  if (isError || failure.outcome === 'blocked') line.push({ text: ' ' }, { button: { key: `show-${failure.id}`, label: isShown ? 'Hide' : 'Show' } })
  if (isError) line.push({ text: ' ' }, { button: { key: `copy-${failure.id}`, label: 'Copy' } })
  return isShown ? [line, [{ code: failure.detail }]] : [line]
}

export function nowLines(input: TabInput): Line[] {
  const out: Line[] = []
  // REC's status first while it is on
  if (input.rec !== undefined && input.rec.level !== 'off') out.push([REC_MARK, { text: recStatus(input.rec.level, input.rec.words).slice('● REC'.length) }])
  // The turn's line here; the plan has its own section
  if (input.isWorking) out.push(workingLine({ ...input, plan: null }, false))
  if (input.plan !== null) out.push(...planSection(input.plan, input.columns))
  if (input.handoff !== undefined) out.push(...handoffLines(input.handoff, input.columns))
  if (input.stack !== undefined) out.push(...stackLines(input.stack.view, { ...input.stack, columns: input.columns }))
  out.push(...agentsSection(input))
  const fresh = input.failures.filter(failure => failure.isNew).length
  out.push([{ text: 'NEEDS A LOOK', bold: true }, ...(fresh > 0 ? [{ text: `  ${fresh} new`, tone: 'fail' as const }] : [])])
  const warning = cacheWarning(input, false)
  if (warning !== null) out.push(warning)
  if (input.failures.length === 0 && warning === null) out.push([{ text: 'Nothing needs a look.', tone: 'dim' }])
  out.push(...numberedFailures(input))
  return out
}

function badge(model: string | null): Seg {
  if (model === null) return { text: 'model —', tone: 'dim' }
  const parts = modelParts(model)
  return parts === null ? { text: model } : { text: modelText(model, true), tone: parts.family }
}

// The Usage tab's Skills row after the context's parts: each skill the main chat loaded, then the listing and its
// tokens, wrapped whole under the label; none with neither
function skillsRow(skills: Record<string, number> | undefined, isResumed: boolean, parts: Parts, columns: number): Line[] {
  if (loadedTexts(skills).length === 0 && parts.skills === undefined) return []
  const items = skillSegs(skills, isResumed)
  if (parts.skills !== undefined) items.push({ text: `${listedText(parts.skills)} · ${tokensText(parts.skills.tokens)}` })
  return wrapRows({ text: 'Skills', width: PARTS_LABEL }, { text: '', width: PARTS_LABEL }, items.map(seg => [seg]), columns, ' · ')
}

export function usageLines(input: TabInput): Line[] {
  const usage = input.usage
  const head: Line = [{ text: 'Usage  ', bold: true }, badge(input.session.model)]
  if (input.session.effort !== null) head.push({ text: ` ◑ ${input.session.effort}`, tone: 'dim' })
  if (usage.startedAt !== null) head.push({ text: `   session ${durationText(input.now - usage.startedAt)}`, tone: 'dim' })
  const out: Line[] = [head]

  const ctx: Line = [{ text: 'Context', width: LABEL }]
  if (usage.contextPercent === null) ctx.push({ text: '—', tone: 'dim' })
  else {
    ctx.push(...barSegs(usage.contextPercent), percentSeg(usage.contextPercent))
    if (usage.contextTokens !== null && usage.contextWindow !== null) ctx.push({ text: `   ${tokensText(usage.contextTokens)} / ${tokensText(usage.contextWindow)}`, tone: 'dim' })
    const series = input.turns.flatMap(turn => (turn.contextPercent === null ? [] : [turn.contextPercent]))
    const left = turnsLeft(series, input.forecast?.at)
    if (left !== null) ctx.push({ text: `   ≈${left} turns to ${input.forecast?.label ?? '80%'}`, tone: 'dim' })
  }
  out.push(ctx)
  const series = input.turns.flatMap(turn => (turn.contextPercent === null ? [] : [turn.contextPercent]))
  if (series.length > 0) out.push([{ text: 'per turn', tone: 'dim', width: LABEL }, { chart: series.slice(-20) }])

  for (const rateWindow of windowsInOrder(usage.rateWindows)) {
    const name = rateWindow.kind === 'five_hour' ? '5h' : rateWindow.kind === 'seven_day' ? '7d' : rateWindow.kind
    const line: Line = [{ text: name, width: LABEL }, ...barSegs(rateWindow.percentUsed), percentSeg(rateWindow.percentUsed, storedMark(usage.rateWindowsAt))]
    const reset = parse(rateWindow.resetsAt)
    if (reset !== null) line.push({ text: `   resets ${whenText(reset)}`, tone: 'dim' })
    const pace = paceForecast(rateWindow.kind, input.pace[rateWindow.kind]?.points ?? [], reset, input.now)
    if (pace === 'on-pace') line.push({ text: '   on pace', tone: 'ok' })
    else if (pace !== null) line.push({ text: `   full ≈${clockText(pace.limitAt)}`, tone: 'warn' })
    out.push(line)
  }

  const cost = [usage.costUsd === null ? null : `${usdText(usage.costUsd)} session`, usage.todayUsd === null ? null : `${usdText(usage.todayUsd)} today`]
    .filter((part): part is string => part !== null)
  if (cost.length > 0) out.push([{ text: 'Cost', width: LABEL }, { text: `${cost.join(' · ')}${usage.rateWindows.length > 0 ? ', est.' : ''}` }])

  const totals = input.totals
  // Output over the main loop's request time, first token and the hooks beneath included: a throughput, not a decode speed
  const rate = totals.stepMs > 0 ? ` · ≈${Math.round(totals.stepOutput / (totals.stepMs / 1000))} tok/s avg` : ''
  out.push([{ text: 'Tokens', width: LABEL }, { text: `in ${tokensText(totals.input)} · out ${tokensText(totals.output)} · cache read ${tokensText(totals.cacheRead)} · cache write ${tokensText(totals.cacheWrite)}${rate}` }])
  if (input.parts !== undefined) out.push(...partsLines(input.parts), ...skillsRow(input.session.loadedSkills, input.session.isResumed === true, input.parts, input.columns))
  const compactAt = input.session.lastCompactAt === null ? '' : `, at ${clockText(input.session.lastCompactAt)}`
  out.push([{ text: `Compactions ${input.session.compactions}${compactAt}` }])
  return out
}

// The Tools table's columns: the tool, then its counts at their end. The tool's column is 24 cells, or as wide as the
// longest name and a space where the counts' 21 cells leave room, so two long names cut alike stay apart (the release
// 2 review: 'Skill: superpowers:writ…' twice). Under 45 columns it gives way, down to 7 cells, so the counts stay.
const COUNT_COLUMNS = [6, 5, 5, 5]
const toolRow = (cells: string[], first: number, style: { tone?: Tone; bold?: boolean }): Line =>
  cells.map((text, i) => ({ text, width: i === 0 ? first : COUNT_COLUMNS[i - 1] ?? 5, ...(i === 0 ? {} : { align: 'end' as const }), ...style }))

export function toolsLines(input: TabInput): Line[] {
  const rows = Object.entries(input.stats).sort((left, right) => right[1].calls - left[1].calls)
  const longest = Math.max(0, ...rows.map(([key]) => [...key].length))
  const first = Math.max(7, Math.min(Math.max(24, longest + 1), input.columns - COUNT_COLUMNS.reduce((total, width) => total + width, 0)))
  const out: Line[] = [toolRow(['Tools', 'calls', 'ok', '✗', '⊘'], first, { bold: true })]
  if (rows.length === 0) out.push([{ text: 'No tool calls yet.', tone: 'dim' }])
  for (const [key, stat] of rows) {
    const row = toolRow([key, ...[stat.calls, stat.ok, stat.failed, stat.stopped].map(String)], first, {})
    out.push(key.startsWith('Skill:') ? [{ text: key, width: first, tone: 'skill' }, ...row.slice(1)] : row)
  }
  // Which hook scripts blocked calls, most first, counted past the failure list's cap (spec C6)
  const named = Object.entries(input.blockers ?? {}).filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  if (named.length > 0) out.push([{ text: 'Blocked by hooks' }, { text: `  ${named.map(([name, count]) => `${name} ×${count}`).join(' · ')}` }])
  out.push([{ text: 'Last failures and blocks', bold: true }])
  if (input.failures.length === 0) out.push([{ text: 'None.', tone: 'dim' }])
  out.push(...numberedFailures(input))
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
  const isNarrow = columns < TIMELINE_COLUMNS.reduce((total, width) => total + width, 0) + spend + 1
  const widths = isNarrow ? NARROW_COLUMNS : TIMELINE_COLUMNS
  const pick = (cells: string[]): string[] => (isNarrow ? cells.filter((_, i) => i !== 1) : cells)
  const head = pick(['#', 'you', 'Claude', 'took', 'in / out', 'tools', isEstimate ? 'spend, est.' : 'spend'])
  const out: Line[] = [[...timelineRow(head, widths, { bold: true }, spend), { text: '✗', bold: true }]]
  if (turns.length === 0) out.push([{ text: 'No turns yet.', tone: 'dim' }])
  for (const turn of [...turns].reverse().slice(0, rows)) {
    const cells = pick([
      String(turn.turnNumber), turn.promptAt === null ? '—' : clockText(turn.promptAt), clockText(turn.replyAt), durationText(turn.durationMs), `${tokensText(turn.tokensIn)} / ${tokensText(turn.tokensOut)}`,
      String(turn.toolCalls), turn.spendUsd === undefined || turn.spendUsd === null ? '-' : usdText(turn.spendUsd),
    ])
    out.push([...timelineRow(cells, widths, {}, spend), turn.toolFailures > 0 ? { text: String(turn.toolFailures), tone: 'fail' } : { text: '0', tone: 'dim' }])
  }
  return out
}
