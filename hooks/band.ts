// The band above the prompt, from the session's values to lines of styled segments. Calm by default: colour
// appears only when a threshold is crossed, something failed or a turn runs.
import { actionOf, isLive } from './agents.ts'
import { billingOf, cacheView, minutes } from './cache.ts'
import { bar, clock, duration, elapsed, fitLine, mins, modelParts, modelText, toneOf, tokens, usd, when, widthOf } from './format.ts'
import { pace, turnsLeft } from './forecast.ts'
import { listedText, loadedTexts } from './parts.ts'
import { narrowPlan, planLine, planRowParts, scoreSeg } from './planlines.ts'
import { storedMark } from './startup.ts'
import type { PlanView, ScoresView } from './plan.ts'
import type { Runway } from './stack.ts'

import type { AgentRow, AgentStatus, BandMode, Cache, Level, Live, Meta, Pace, SkillListing, ToolStat, Totals, Turn, Usage, Window } from '../types'

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'agents' | 'cache' | 'plan' | 'handoff' | 'opus' | 'sonnet' | 'haiku' | 'fable'
export type Seg =
  // With a `width`, a table cell: that many cells wide, its text cut with '…' when longer, at its end with `align: 'end'`
  // `key` names a text that stands in for a button: the toggle's counts under the input, drawn as text (band-under U3)
  | { text: string; tone?: Tone; bold?: boolean; width?: number; align?: 'start' | 'end'; key?: string }
  // A toned button draws its label bold in the colour of the feature it acts on; a plain one draws `<hotkey>: <label>`
  | { button: { key: string; label: string; hotkey?: string; tone?: Tone; plain?: boolean } }
  | { code: string }
  | { chart: number[] }
  // Agents on one time axis (spec C2), alone on its line: text lanes on the terminal and mobile, one Svg elsewhere
  | { lanes: Lane[]; now: number }
export type Line = Seg[]
// One agent on the axis: its label (`task <id>` or its type), when it started, when it ended (null while it runs), its
// status and its time as the tree shows it
export type Lane = { label: string; startAt: number; endAt: number | null; status: AgentStatus; time: string }
// `plan`: the shown plan or task list while it runs, or for 10 minutes after it finished; `planInvalid`: the shown
// plan's file failed its last read; `score`: the shown plan's scores, else the newest scores file's; `rec`: REC's level
// and how many private words it hides
export type BandInput = {
  now: number; columns: number; isWorking: boolean; live: Live; usage: Usage; meta: Meta; turns: Turn[]
  newFailures: number; pace: Pace; agents: AgentRow[]; cache: Cache
  plan: PlanView | null; planInvalid: boolean; score: ScoresView | null; rec?: { level: Level; words: number }
  // What the forecast counts turns to: `at` over the window, and `label` as the Usage tab names it, F8's threshold
  // (`80%`) or the stack's resume trigger (`150k`)
  forecast?: { at: number; label: string }
  // The step F8's ask is up for, or null
  handoffAsk?: number | null
  // Alfred Code's runway, which the ctx item measures against while it applies, and the mode banner that leads line 1
  runway?: Runway | null
  banner?: Seg[]
  // The /band setting: `full` adds the info line, the turn's tool count and today's cost; absent or `calm`, today's two
  // lines. `totals` and `stats` feed the info line's output speed and tool calls.
  mode?: BandMode
  // The rows the band may take (the AbovePrompt site's `maxRows`); absent, as many as it draws
  maxRows?: number
  totals?: Totals
  stats?: Record<string, ToolStat>
  // The full band's rows of every tool and the skills are open (spec: the user, 2026-11-11); the skill listing from
  // the context's last breakdown, or null before one
  isToolsOpen?: boolean
  listing?: SkillListing | null
  // The rules row (spec 2026-11-11, D4): the always-on rules from the breakdown, the ones loaded by path, and whether
  // by-path loads are tracked (false with leave_out_skipped_hooks on); absent, none known and tracked
  rules?: RulesInput
  // The band drawn under the input (spec 2026-11-11 band-under, U2 and U3): its action row after the gauges, and its
  // buttons pressed by a click (fullscreen) or drawn as the commands that do their jobs (the main screen)
  under?: { buttons: 'click' | 'text' }
}
export type RulesInput = { always: string[]; byPath: string[]; isTracked: boolean }

const ORDER = ['five_hour', 'seven_day']
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const pct = (n: number): string => `${Math.round(n)}%`

// ' 45%' in its bar's threshold colour; ' ≈45%' with `mark` for a window an earlier session read
export const pctSeg = (n: number, mark = ''): Seg => ({ text: ` ${mark}${pct(n)}`, tone: toneOf(n) })

export function barSegs(percent: number): Seg[] {
  const [filled, empty] = bar(percent)
  return [{ text: filled, tone: toneOf(percent) }, { text: empty, tone: 'dim' }]
}

export function windowsInOrder(windows: Window[]): Window[] {
  const rank = (w: Window): number => (ORDER.includes(w.kind) ? ORDER.indexOf(w.kind) : ORDER.length)
  return [...windows].sort((a, b) => rank(a) - rank(b))
}

// The 5h window's pace: null until there are 3 readings
export function fiveHourPace(b: Pick<BandInput, 'usage' | 'pace' | 'now'>): ReturnType<typeof pace> {
  const w = b.usage.windows.find(x => x.kind === 'five_hour')
  if (w === undefined) return null
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return pace('five_hour', b.pace.five_hour?.points ?? [], Number.isNaN(reset) ? null : reset, b.now)
}

// ' (02.11 16:15)': when the window resets, or nothing while it reports none
function resetSegs(w: Window): Line {
  const reset = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isNaN(reset) ? [] : [{ text: ` (${when(reset)})`, tone: 'dim' }]
}

function gauges(b: BandInput): Line {
  const u = b.usage
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' │ ', tone: 'dim' })
  }
  out.push(...ctxSegs(u, b.runway))
  if (u.percent !== null || (b.runway ?? null) !== null) {
    const left = turnsLeft(b.turns.flatMap(t => (t.contextPercent === null ? [] : [t.contextPercent])), b.forecast?.at)
    if (left !== null) out.push({ text: ` ≈${left} turns`, tone: 'dim' })
  }
  const mark = storedMark(u.windowsAt)
  for (const w of windowsInOrder(u.windows)) {
    sep()
    const label = LABEL[w.kind] ?? w.kind
    if (w.kind === 'five_hour') {
      out.push({ text: `${label} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed, mark), ...resetSegs(w))
      const p = fiveHourPace(b)
      if (p === 'on-pace') out.push({ text: ' on pace', tone: 'ok' })
      else if (p !== null) out.push({ text: ` full ≈${clock(p.limitAt)}`, tone: 'warn' })
    } else out.push({ text: `${label} `, tone: 'usage' }, { text: `${mark}${pct(w.percentUsed)}`, tone: toneOf(w.percentUsed) }, ...resetSegs(w))
  }
  if (u.costUsd !== null) {
    sep()
    out.push({ text: usd(u.costUsd) })
  }
  return out
}

// The ctx item: against the stack's resume trigger while the runway applies (`ctx ▰▰▰▱▱ 62% of 150k`), else the window
function ctxSegs(u: Usage, runway: Runway | null | undefined): Line {
  if (runway !== undefined && runway !== null) {
    return [{ text: 'ctx ', tone: 'usage' }, ...barSegs(runway.percent), pctSeg(runway.percent), { text: ` of ${tokens(runway.resumeAt)}`, tone: 'usage' }]
  }
  return u.percent === null ? [{ text: 'ctx —', tone: 'usage' }] : [{ text: 'ctx ', tone: 'usage' }, ...barSegs(u.percent), pctSeg(u.percent)]
}

function narrowGauges(u: Usage, runway: Runway | null | undefined): Line {
  const out: Line = []
  const sep = (): void => {
    if (out.length > 0) out.push({ text: ' · ', tone: 'dim' })
  }
  out.push(...ctxSegs(u, runway))
  for (const w of windowsInOrder(u.windows)) {
    sep()
    out.push({ text: `${LABEL[w.kind] ?? w.kind} `, tone: 'usage' }, ...barSegs(w.percentUsed), pctSeg(w.percentUsed, storedMark(u.windowsAt)), ...resetSegs(w))
  }
  return out
}

// 'you 14:02', 'Claude 14:05': the person's last prompt and Claude's last reply, the first `upTo` of them; with
// `isLive`, the prompt is a running turn's while one runs
function timeParts(b: BandInput, upTo = 2, isLive = false): string[] {
  const you = (isLive ? b.live.promptAt : null) ?? b.turns[b.turns.length - 1]?.promptAt ?? b.meta.lastPromptAt
  return [you === null ? null : `you ${clock(you)}`, b.meta.lastReplyAt === null ? null : `Claude ${clock(b.meta.lastReplyAt)}`]
    .filter((p): p is string => p !== null)
    .slice(0, upTo)
}

// ' │ you 14:02 · Claude 14:05'
function times(b: BandInput, upTo = 2): Line {
  const parts = timeParts(b, upTo)
  return parts.length === 0 ? [] : [{ text: ` │ ${parts.join(' · ')}`, tone: 'dim' }]
}

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

const isSkill = (key: string): boolean => key.startsWith('Skill: ')

// The session's tools by calls, most first (ties by name), Skill calls apart
function toolsByCalls(stats: Record<string, ToolStat> | undefined): [string, ToolStat][] {
  return Object.entries(stats ?? {})
    .filter(([key, s]) => s.calls > 0 && !isSkill(key))
    .sort(([ka, a], [kb, z]) => z.calls - a.calls || (ka < kb ? -1 : ka > kb ? 1 : 0))
}

// The info line's toggle of the rows under it (spec 2026-11-11, D5): the tool calls, the main chat's skills, the agents
// dispatched (and how many run) and the rules it opens, each only above 0; short of width its forms drop the rules,
// then the agents, then the skills, then all but the arrow. A letter, never a digit: a bare digit in an empty prompt
// presses a band button in place of typing. None while closed with nothing to open.
export function toggleForms(b: BandInput): Line[] {
  const isOpen = b.isToolsOpen === true
  const count = (n: number, one: string): string | null => (n === 0 ? null : `${n} ${one}${n === 1 ? '' : 's'}`)
  const calls = toolsByCalls(b.stats).reduce((n, [, s]) => n + s.calls, 0)
  const dispatched = Object.values(b.meta.agentTypes ?? {}).reduce((n, k) => n + k, 0)
  const running = b.agents.filter(r => isLive(r.status)).length
  const drawn = rulesDrawn(b.rules ?? NO_RULES)
  const tools = count(calls, 'tool')
  const skills = count(Object.keys(b.meta.skills ?? {}).length, 'skill')
  const agents = count(dispatched, 'agent')
  const rules = count(drawn.always.length + drawn.byPath.length, 'rule')
  if (tools === null && skills === null && agents === null && rules === null && !isOpen) return []
  const arrow = isOpen ? '▾' : '▸'
  const parts = (...of: (string | null)[]): string[] => of.filter((p): p is string => p !== null)
  const agentsPart = agents === null ? null : running > 0 ? `${agents} (${running} ◐)` : agents
  const all = parts(tools, skills, agentsPart, rules)
  const forms = [all, parts(tools, skills, agentsPart), parts(tools, skills), parts(tools)].filter(f => f.length > 0)
  const labels = [...new Set([...(all.length === 0 ? ['tools'] : forms.map(f => f.join(' · '))).map(l => `${l} ${arrow}`), arrow])]
  if (b.under?.buttons === 'text') {
    const texts = [...new Set(labels.map(l => l.replace(/ ?[▾▸]$/, '')).filter(l => l !== ''))]
    return texts.map(text => [{ text, tone: 'dim' as const, key: 'tools' }])
  }
  if (b.under?.buttons === 'click') return labels.map(label => [{ button: { key: 'tools', label } }])
  return labels.map(label => [{ button: { key: 'tools', label, hotkey: 't' } }])
}

type ButtonSeg = Extract<Seg, { button: unknown }>['button']

// A band button where it draws (spec 2026-11-11 band-under, U3): above, as it is; under in fullscreen, where a click
// presses it, labelled with the command that does its job and with no hotkey; under on the main screen, where nothing
// presses it, that command as dim text
function underButton(b: BandInput, button: ButtonSeg, command: string): Seg {
  if (b.under === undefined) return { button }
  if (b.under.buttons === 'text') return { text: command, tone: 'dim' }
  const { hotkey: _hotkey, plain: _plain, ...rest } = button
  return { button: { ...rest, label: command } }
}

// The open rows (spec 2026-11-11, D2): every tool by name with its calls, then the skills the main chat loaded and how
// many the listing carries, each under its label, as many to a row as the width holds, joined by ' │ '
export function toolRows(b: BandInput): Line[] {
  const used = toolsByCalls(b.stats)
  const tools: Seg[] = used.length === 0 ? [{ text: 'none', tone: 'dim' }] : used.map(([key, s]) => ({ text: `${key} ×${s.calls}` }))
  const skills = skillSegs(b.meta.skills, b.meta.isResumed === true)
  if (b.listing !== undefined && b.listing !== null) skills.push({ text: listedText(b.listing), tone: 'dim' })
  const label = (text: string): Seg => ({ text: text.padEnd(ROW_LABEL), tone: 'dim' })
  const under: Seg = { text: ' '.repeat(ROW_LABEL) }
  const row = (name: string, items: Line[]): Line[] => wrapRows(label(name), under, items, b.columns, ROW_JOIN)
  const one = (segs: Seg[]): Line[] => segs.map(s => [s])
  return [
    ...row('tools:', one(tools)), ...row('skills:', one(skills)),
    ...row('agents:', agentSegs(b.agents, b.meta.agentTypes, b.meta.isResumed === true)),
    ...row('rules:', ruleSegs(b.rules ?? NO_RULES, b.meta.isResumed === true)),
  ]
}

const NO_RULES: RulesInput = { always: [], byPath: [], isTracked: true }

// The rules drawn, each name once, an always-on name winning: the always-on ones, then the by-path ones not among them
export function rulesDrawn(r: RulesInput): { always: string[]; byPath: string[] } {
  const always = [...new Set(r.always)]
  return { always, byPath: [...new Set(r.byPath)].filter(n => !always.includes(n)) }
}

// The rules row's items (spec 2026-11-11, D4): the always-on rules plain, the by-path ones violet, then how many of
// each; untracked (the option on), by path is not known; after a resume, the by-path ones loaded before are unseen
export function ruleSegs(r: RulesInput, isResumed: boolean): Line[] {
  const { always, byPath } = rulesDrawn(r)
  if (r.isTracked && always.length + byPath.length === 0) return [[{ text: 'none loaded', tone: 'dim' }]]
  const summary = r.isTracked
    ? `${always.length} always-on · ${byPath.length} by path${isResumed ? ' since resume' : ''}`
    : `${always.length} always-on · by path not tracked`
  return [
    ...always.map((text): Line => [{ text }]), ...byPath.map((text): Line => [{ text, tone: 'handoff' }]),
    [{ text: summary, tone: 'dim' }],
  ]
}

// The agents row's items (spec 2026-11-11, D3): each type in the order of its first dispatch, its glyph and dispatches -
// ◐ while a kept row of it runs, ✗ once one failed or was killed, else ✓ - then how many run; after a resume, counted
// from it. A type whose rows were all dropped (at most 50 kept) reads ✓.
export function agentSegs(rows: AgentRow[], types: Record<string, number> | undefined, isResumed: boolean): Line[] {
  const names = Object.keys(types ?? {})
  if (names.length === 0) return [[{ text: isResumed ? 'none seen since resume' : 'none', tone: 'dim' }]]
  const items = names.map((type): Line => {
    const of = rows.filter(r => r.type === type)
    const glyph: Seg = of.some(r => isLive(r.status))
      ? { text: '◐ ', tone: 'warn' }
      : of.some(r => r.status === 'failed' || r.status === 'killed') ? { text: '✗ ', tone: 'fail' } : { text: '✓ ', tone: 'ok' }
    return [glyph, { text: `${type} ×${types?.[type] ?? 0}` }]
  })
  const running = rows.filter(r => isLive(r.status)).length
  const since: Line[] = isResumed ? [[{ text: 'since resume', tone: 'dim' }]] : []
  return [...items, ...since, [{ text: `${running} running`, tone: running > 0 ? 'warn' : 'dim' }]]
}

// The labels' width, so the items of every row line up, and the band rows' joiner, as the owner's target draws them
// A folder past `max` cells: its last parts that fit after '…/', or its last part cut
function fitFolder(folder: string, max: number): string {
  if (widthOf([{ text: folder }]) <= max) return folder
  const parts = folder.split('/')
  let kept = parts.slice(-1)
  for (let i = parts.length - 2; i >= 0; i--) {
    const more = [parts[i] ?? '', ...kept]
    if (widthOf([{ text: `…/${more.join('/')}` }]) > max) break
    kept = more
  }
  return `…/${fitLine(kept.join('/'), max - 2)}`
}

// '…/<last part>' for a folder of several parts, else the folder
const lastPart = (folder: string): string => (folder.includes('/') ? `…/${folder.split('/').pop() ?? ''}` : folder)

const ROW_LABEL = 9
export const ROW_JOIN = ' │ '

// The full band's plan row, above the info line (the owner's target, 2026-11-11): none in calm mode or with no plan
function planRow(b: BandInput): Line[] {
  if (b.mode !== 'full' || b.plan === null) return []
  return [[{ text: 'plan:'.padEnd(ROW_LABEL), tone: 'dim' }, ...planRowParts(b.plan, b.columns - ROW_LABEL)]]
}

// The skills loaded in the main chat; after a resume or a branch, counted from it, since the ones loaded before are in
// the context but never seen (a side agent's note, 2026-11-11)
export function skillSegs(skills: Record<string, number> | undefined, isResumed: boolean): Seg[] {
  const loaded = loadedTexts(skills)
  if (loaded.length === 0) return [{ text: isResumed ? 'none seen since resume' : 'none loaded', tone: 'dim' }]
  const since: Seg[] = isResumed ? [{ text: 'since resume', tone: 'dim' }] : []
  return [...loaded.map((text): Seg => ({ text, tone: 'skill' })), ...since]
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

// One item of the info line: its forms, fullest first, and its keep rank, 1 going first when the width runs out
type Item = { keep: number; forms: Line[] }

const dimText = (text: string): Line => [{ text, tone: 'dim' }]

// The info line's items in the approved mockup's order, each only when known: the model and effort, the session's
// time, the average output speed, the cache, the toggle of the tools and skills, the last prompt and reply
function infoItems(b: BandInput): Item[] {
  const items: Item[] = []
  const model = b.meta.model
  if (model !== null) {
    const family = modelParts(model)?.family
    const name: Seg = family === undefined ? { text: modelText(model, true) } : { text: modelText(model, true), tone: family }
    items.push({ keep: 6, forms: [b.meta.effort === null ? [name] : [name, { text: ` ◑ ${b.meta.effort}`, tone: 'dim' }]] })
  }
  if (b.usage.startedAt !== null) items.push({ keep: 5, forms: [dimText(mins(b.now - b.usage.startedAt))] })
  const t = b.totals
  if (t !== undefined && t.stepMs > 0) items.push({ keep: 3, forms: [dimText(`≈${Math.round(t.stepOutput / (t.stepMs / 1000))} tok/s avg`)] })
  if (b.cache.session.read + b.cache.session.write > 0) {
    const v = cacheView(b.cache, billingOf(b.usage.windows), b.now, b.usage.tokens)
    items.push({ keep: 4, forms: [dimText(v.leftMs === null ? 'cache cold' : `cache warm ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs)}`)] })
  }
  // While open it outlasts tok/s and the cache: the rows under it close only through it
  const toggle = toggleForms(b)
  if (toggle.length > 0) items.push({ keep: b.isToolsOpen === true ? 4.5 : 2, forms: toggle })
  // The running turn's prompt while one runs; the last turn's, as line 1 of the calm band shows it, otherwise
  const parts = timeParts(b, 2, true)
  if (parts.length > 0) items.push({ keep: 1, forms: parts.map((_, i) => dimText(parts.slice(0, parts.length - i).join(' · '))) })
  // Where the session runs and Claude Code's version, from the first second; the first to go when the width runs out
  // 'project ▸ folder git:(branch)': the session's project, then the folder Claude works in when it is not the project's
  // root (the user, 2026-11-11), past 40 cells its last parts after '…/', and narrower its last part alone
  const place = b.meta.place
  if (place !== undefined) {
    const branch: Line = place.branch === null ? [] : [{ text: ` git:(${place.branch})`, tone: 'dim' }]
    const at = (folder: string | null): Line => [{ text: folder === null ? place.project : `${place.project} ▸ ${folder}`, tone: 'dim' }, ...branch]
    const folder = place.folder
    const forms = folder === undefined ? [at(null)] : [...new Set([fitFolder(folder, 40), lastPart(folder)])].map(at)
    items.push({ keep: 0.8, forms })
  }
  if (b.meta.version !== undefined) items.push({ keep: 0.5, forms: [dimText(`CC ${b.meta.version}`)] })
  return items
}

// The info line fitted to one row of the width
export function infoLine(b: BandInput): Line {
  return infoRows(b, 1)[0] ?? []
}

// The info line in up to `upTo` rows of the width, a row breaking between two items (the user, 2026-11-11: every item,
// as claude-hud shows them): while they need more rows, the present item with the lowest keep takes its next form or
// goes; nothing fitting, or nothing known, draws no row
export function infoRows(b: BandInput, upTo: number): Line[] {
  const items = infoItems(b)
  const form = items.map(() => 0)
  const shown = items.map(() => true)
  for (;;) {
    const kept = items.flatMap((item, i) => (shown[i] ? [item.forms[form[i] ?? 0] ?? []] : []))
    const rows = packRows(kept, b.columns)
    if (rows !== null && rows.length <= upTo) return rows
    let lowest = -1
    items.forEach((item, i) => {
      if (shown[i] && (lowest === -1 || item.keep < (items[lowest]?.keep ?? Infinity))) lowest = i
    })
    const item = items[lowest]
    if (item === undefined) return []
    if ((form[lowest] ?? 0) < item.forms.length - 1) form[lowest] = (form[lowest] ?? 0) + 1
    else shown[lowest] = false
  }
}

// Items in rows of `columns`, joined by ' │ ' while the next fits, else on a row of its own; null when one is wider
function packRows(items: Line[], columns: number): Line[] | null {
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

// Line 2's cost with today's after it, `$1.29 · today $10.46`, in full mode while it fits beside what follows
function withToday(b: BandInput, line: Line, after: Line): Line {
  const u = b.usage
  if (b.mode !== 'full' || u.todayUsd === null || u.costUsd === null) return line
  const full = [...line, { text: ` · today ${usd(u.todayUsd)}` }]
  return widthOf([...full, ...after]) <= b.columns ? full : line
}

// The gauges and as many times as fit the width, each dropped whole: Claude's first, then yours
function withTimes(b: BandInput, line: Line): Line {
  for (const upTo of [2, 1]) {
    const full = [...line, ...times(b, upTo)]
    if (widthOf(full) <= b.columns) return full
  }
  return line
}

function lastTurn(b: BandInput, isNarrow: boolean): Line {
  const t = b.turns[b.turns.length - 1]
  if (t === undefined) return []
  const ok = t.end === 'answer'
  const line: Line = [{ text: ok ? '✓' : '✗', tone: ok ? 'ok' : 'fail' }, { text: ` Turn ${t.n} · ${duration(t.durationMs)}` }]
  if (isNarrow) return line
  line.push({ text: ` · ${t.tools} ${t.tools === 1 ? 'tool' : 'tools'}` })
  if (t.failures > 0) line.push({ text: ` · ${t.failures} ✗`, tone: 'fail' })
  // In full mode the times are the info line's
  return b.mode === 'full' ? line : [...line, ...times(b)]
}

const agentCount = (k: number): string => `${k} ${k === 1 ? 'agent' : 'agents'}`

// ' │ PLAN 3/5 · score 81 ▲13', each part only when known, for an idle line 1 that needs you; the full band's plan has
// its own row, so there only the score
function planTail(b: BandInput): Line {
  const parts: Line[] = []
  if (b.plan !== null && b.mode !== 'full') parts.push([{ text: 'PLAN', tone: 'plan' }, { text: ` ${b.plan.finished}/${b.plan.total}` }])
  if (b.score !== null) parts.push(scoreSeg(b.score))
  if (parts.length === 0) return []
  return [{ text: ' │ ', tone: 'dim' }, ...parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' · ' }, ...p]))]
}

// The turn, or the agents while only they run, or the plan line while a plan runs; then each live agent's action and
// the running Bash. Past the width the agent parts fold into ' +N agents', then the Bash part goes, then the plan's
// step, then its title is cut.
export function working(b: BandInput, isNarrow: boolean): Line {
  const running = b.agents.filter(r => isLive(r.status))
  // The full band's plan has its own row, so line 1 keeps the turn there
  const plan = b.mode === 'full' ? null : b.plan
  if (plan !== null && isNarrow) return narrowPlan(plan, running.length)
  const n = b.meta.turnCount + 1
  const took = elapsed(b.now - (b.live.startedAt ?? b.now))
  const count = b.mode === 'full' ? ` · ${b.live.tools} ${b.live.tools === 1 ? 'tool' : 'tools'}` : ''
  const head: Seg = b.isWorking
    ? { text: isNarrow ? `⟳ Turn ${n} ${took}` : `⟳ Turn ${n} · ${took}${count}`, bold: true }
    : { text: `⟳ ${agentCount(running.length)}`, bold: true }
  if (isNarrow) return b.isWorking && running.length > 0 ? [head, { text: ` · ${agentCount(running.length)}` }] : [head]
  const bash: Line = []
  const calls = b.live.running.filter(r => r.tool === 'Bash')
  const newest = calls[calls.length - 1]
  if (newest !== undefined) {
    bash.push({ text: ` │ Bash ▸ ${newest.label} ${elapsed(b.now - newest.startedAt)}` })
    if (calls.length > 1) bash.push({ text: ` +${calls.length - 1}`, tone: 'dim' })
  }
  const parts: Line = running.map(r => ({ text: r.action === null ? ` │ ${r.type}` : ` │ ${r.type} ▸ ${r.action}` }))
  const folded = (kept: number): Line => {
    const rest = parts.length - kept
    return [...parts.slice(0, kept), ...(rest > 0 ? [{ text: ` +${agentCount(rest)}`, tone: 'dim' as const }] : [])]
  }
  const lead: Line = plan === null ? [head] : planLine(plan, Infinity)
  for (let kept = parts.length; kept >= 0; kept--) {
    const line: Line = [...lead, ...folded(kept), ...bash]
    if (widthOf(line) <= b.columns) return line
  }
  if (plan === null) return [head, ...folded(0), ...bash]
  return [...planLine(plan, b.columns - widthOf(folded(0))), ...folded(0)]
}

// What the spinner adds after the engine's suffix: an agent's action and context on that agent's spinner; on the main
// loop's, its newest call in flight, its context percent and the agents running. Null with nothing to add.
export function spinnerSuffix(s: { requestId: string; live: Live; percent: number | null; agents: AgentRow[] }): string | null {
  const parts: string[] = []
  const row = s.agents.find(r => r.id === s.requestId)
  if (row !== undefined) {
    if (row.action !== null) parts.push(fitLine(row.action, 40))
    if (row.contextTokens !== null) parts.push(`ctx ${tokens(row.contextTokens)}`)
  } else {
    const newest = s.live.running[s.live.running.length - 1]
    if (newest !== undefined) parts.push(fitLine(actionOf(newest.tool, newest.label), 40))
    if (s.percent !== null) parts.push(pct(s.percent))
    const k = s.agents.filter(r => isLive(r.status)).length
    if (k > 0) parts.push(agentCount(k))
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

// The cache's warning while the main loop is idle: a 1h cache's last 5 minutes, or its last 3 where Claude Code should
// compact the conversation first, and a 5m cache's last minute. The band's button takes hotkey 3.
export function cacheWarning(b: BandInput, hasHotkey: boolean): Line | null {
  if (b.isWorking) return null
  const v = cacheView(b.cache, billingOf(b.usage.windows), b.now, b.usage.tokens)
  if (!v.isClosing) return null
  const button = hasHotkey
    ? { key: 'compact', label: 'Compact', hotkey: '3', tone: 'cache' as const }
    : { key: 'compact', label: 'Compact', tone: 'cache' as const }
  return [{ text: `⚠ cache cold in ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs ?? 0)} `, tone: 'warn' }, underButton(b, button, '/compact')]
}

// F8's ask on line 3: the step the context passed, its violet button on hotkey 4
function handoffAsk(b: BandInput): Line | null {
  if (b.handoffAsk === undefined || b.handoffAsk === null) return null
  return [{ text: `⚠ ctx past ${b.handoffAsk}% `, tone: 'warn' }, underButton(b, { key: 'handoff', label: 'Handoff', hotkey: '4', tone: 'handoff' }, '/auto-handoff now')]
}

// The idle line 1 with ' │ PLAN 3/5 · score 81 ▲13' while it fits
function withPlanTail(b: BandInput, line: Line): Line {
  const full = [...line, ...planTail(b)]
  return line.length > 0 && widthOf(full) <= b.columns ? full : line
}

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

// The status line under the prompt (spec D2), which stays while the band is collapsed: what needs the person, short
// and in the band's order - REC, the context once the band turns hot at 60, the new failures - or null for none. While
// the band is in view it shows REC and the context itself, so the line leaves them out (spec 2026-11-11, D6).
export function statusText(o: { percent: number | null; newFailures: number; recLevel: Level; isBandShown: boolean }): string | null {
  const parts = [
    o.recLevel === 'off' || o.isBandShown ? null : '● REC',
    !o.isBandShown && o.percent !== null && Math.round(o.percent) >= 60 ? `ctx ${pct(o.percent)}` : null,
    o.newFailures > 0 ? `✗ ${o.newFailures} new` : null,
  ].filter((p): p is string => p !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// The rows the band takes under the input (spec 2026-11-11 band-under, U2, F7): the main screen's whole height, as the
// site above reports there; in fullscreen, half the screen less the prompt and the engine's footer line, less a status
// line's two rows (claude-hud's default; the setting says nothing of the height) and the mod's pinned line
export function underRows(v: { rows: number; isFullscreen?: boolean }, o: { hasStatusLine: boolean; isPinned: boolean }): number {
  if (v.isFullscreen !== true) return v.rows
  return Math.max(2, Math.floor(v.rows / 2) - 6 - (o.hasStatusLine ? 2 : 0) - (o.isPinned ? 1 : 0))
}

// A red '● REC' while REC is on, then Alfred Code's mode banner, lead line 1 in every state, never dropped for width:
// the body's first line follows them while it fits what is left, else they take line 1 alone and the body keeps the
// full width, so no gauge, reset or the cost drops for them
export function bandLines(b: BandInput): Line[] {
  const max = b.maxRows
  if (max === undefined) return bandRows(b, 2, Infinity, true)
  // Short of rows, the info line's second row gives way first, then the open rows of tools, from the last, then the
  // plan row, then the info line: the line under them holds the buttons, and a digit arms only those in view
  for (const upTo of [2, 1]) {
    const lines = bandRows(b, upTo, Infinity, true)
    if (lines.length <= max) return lines
  }
  const core = bandRows(b, 1, 0, true)
  if (core.length <= max) return bandRows(b, 1, max - core.length, true)
  const bare = bandRows(b, 1, 0, false)
  return bare.length > max ? bandRows(b, 0, 0, false) : bare
}

// `infoUpTo`: the rows the info line may take, none for 0; `isPlanKept`: the full band's plan row stays
function bandRows(b: BandInput, infoUpTo: number, toolRowsKept: number, isPlanKept: boolean): Line[] {
  const isNarrow = b.columns < 100
  const marks: Line[] = [b.rec !== undefined && b.rec.level !== 'off' ? [REC_MARK] : [], b.banner ?? []].filter(m => m.length > 0)
  if (marks.length === 0) return bandBody(b, isNarrow, infoUpTo, toolRowsKept, isPlanKept)
  const sep: Seg = { text: ' │ ', tone: 'dim' }
  const alone: Line = marks.flatMap((m, i) => (i === 0 ? m : [sep, ...m]))
  const lead: Line = [...alone, sep]
  // Only line 1 shares its row with the marks: the lines under it are fitted to the band's whole width
  const [first] = bandBody({ ...b, columns: b.columns - widthOf(lead) }, isNarrow, infoUpTo, toolRowsKept, isPlanKept)
  if (first === undefined) return [alone]
  const body = bandBody(b, isNarrow, infoUpTo, toolRowsKept, isPlanKept)
  return widthOf(lead) + widthOf(first) <= b.columns ? [[...lead, ...first], ...body.slice(1)] : [alone, ...body]
}

function bandBody(b: BandInput, isNarrow: boolean, infoUpTo: number, toolRowsKept: number, isPlanKept: boolean): Line[] {
  const u = b.usage
  // Before the first reading the calm band waits; the full band draws once the model or a stored window is known
  const isFullKnown = b.mode === 'full' && (b.meta.model !== null || u.windows.length > 0)
  if (b.turns.length === 0 && u.percent === null && !isFullKnown) return []
  const invalid: Line = b.planInvalid ? [{ text: ' │ ', tone: 'dim' }, { text: 'plan file invalid', tone: 'warn' }] : []
  const gaugeLine = isNarrow ? narrowGauges(u, b.runway) : withToday(b, gauges(b), invalid)
  const line2 = [...gaugeLine, ...invalid]
  // The info line, then the open rows of tools under it, only while its toggle is in view to close them
  const head = infoUpTo > 0 && b.mode === 'full' ? infoRows(b, infoUpTo) : []
  const hasToggle = head.some(row => row.some(s => ('button' in s && s.button.key === 'tools') || ('text' in s && s.key === 'tools')))
  const plan: Line[] = head.length > 0 && isPlanKept ? planRow(b) : []
  const info: Line[] = head.length === 0 ? [] : [...plan, ...head, ...(b.isToolsOpen === true && hasToggle ? toolRows(b).slice(0, toolRowsKept) : [])]
  const p = fiveHourPace(b)
  const isHot = (b.runway?.percent ?? u.percent ?? 0) >= 60 || u.windows.some(w => w.percentUsed >= 60) || (p !== null && p !== 'on-pace')
  const agentsRun = b.agents.some(r => isLive(r.status))
  const warning = cacheWarning(b, true)
  const ask = handoffAsk(b)
  if (!isHot && b.newFailures === 0 && !b.isWorking && !agentsRun && warning === null && ask === null) {
    const calm = isNarrow || b.mode === 'full' ? gaugeLine : withTimes(b, gaugeLine)
    const dim = (l: Line): Line => l.map(s => ('text' in s ? { text: s.text, tone: 'dim' as const } : s))
    return [[...dim(calm), ...invalid], ...info.map(dim)]
  }
  if (b.isWorking) return [working(b, isNarrow), line2, ...info]
  const failed: Line = b.newFailures > 0
    ? [{ text: `✗ ${b.newFailures} new `, tone: 'fail' }, underButton(b, { key: 'inspect', label: 'Inspect', hotkey: '1' }, '/inspect')]
    : []
  const items = [warning, ask, failed].filter((l): l is Line => l !== null && l.length > 0)
  const joined: Line = items.flatMap((l, i) => (i === 0 ? l : [{ text: '    ' }, ...l]))
  // Under the input (band-under U2), the action row follows the gauges, so a cut at the screen's edge takes the detail
  // rows first; its commands are longer than the digits above, so the items take a row each when one row cannot hold them
  const action: Line[] = items.length === 0 ? [] : b.under !== undefined && cellsOf(joined) > b.columns ? items : [joined]
  const first = agentsRun ? working(b, isNarrow) : withPlanTail(b, lastTurn(b, isNarrow))
  const out = b.under === undefined ? [first, line2, ...info, ...action] : [first, line2, ...action, ...info]
  return out.filter(l => l.length > 0)
}
