// The inspect folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, UiOpenResult } from 'claude-code'
import type { Tab, View } from './types'
import { BAND_HELP, COPY_WHY, INSPECT_HELP, TAB_NAMES, ordinalOf, outOfRange } from './commands'
import { oneLine, printable } from '../core/format'
import { failureNumberOf } from '../tools/outcome'
import { loadSettings, resolvedSettings, writeUserField } from '../settings/effects'
import { closePane, isNoColor, toast } from '../core/effects'
import { isBreakdownStale, readBreakdownSoon, readParts } from '../context/effects'
import { readAgents, readLoops } from '../agents/effects'
import { markFailuresSeen, readBlockers, readFailures, readStats } from '../tools/effects'
import { BAND_MODES, DEFAULTS, sourceLabel } from '../settings/settings'
import { agentsLines, asCommands, cacheLines, nowLines, paneCommands, reportRows, tabBar, timelineLines, toolsLines, usageLines } from './tabs'
import type { Pending, MatchedInput } from '../core/types'
import { readLive, readMeta, readPace, readTick, readTotals, readTurns, readUsage } from '../session/effects'
import { recSummary } from '../rec/rec'
import { readRec } from '../rec/effects'
import { dismissAsk, readHandoff, saveNow, saveThenCompact } from '../handoff/effects'
import { readPlanDrawing, readPlans } from '../plan/effects'
import { fillStackPrompt, readStack, readScoreLevel, stackPrompt } from '../stack/effects'
import { forecastTargetOf, handoffViewOf } from '../handoff/handoff'
import { compactNow, readCache } from '../cache/effects'
import { PLANS_DIR } from '../plan/plan'
import { drawLines } from '../core/draw'
import { planLines } from '../plan/planlines'
import { mask } from '../rec/mask'
import { runwayOf } from '../stack/stack'

const INITIAL_VIEW: View = { tab: 'now', shown: [], planSlug: null }
const viewAtom = atom({ plugin: 'alfred-mods', key: 'view' } as const, INITIAL_VIEW, { shape: 'view-3' })
export function readView($: EngineInterface) {
  return read($, viewAtom)
}
function updateView($: EngineInterface, change: (value: View) => View) {
  return update($, viewAtom, change)
}
export function resetView($: EngineInterface) {
  return update($, viewAtom, () => INITIAL_VIEW)
}

// Whether the person sees the pane now, from the engine's record: it outlives a /clear and a reload, and knows a
// pane placed after it waited undrawn
export async function isInspectDrawn($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === 'inspect' && p.isShown && p.isPlaced)
}

// Opens the pane on a tab. The failures it shows are seen once a surface draws it, never while it waits undrawn.
// The open starts before the first await: a Button's press counts as the person's only while its closure runs.
export async function openInspect($: EngineInterface, tab: Tab): Promise<UiOpenResult> {
  // Esc at an idle, empty prompt closes it: on the terminal's main screen nothing takes a click (the user, 2026-11-12)
  const opening = $.ui.open({ id: 'inspect', title: 'Inspect', closeOnEscape: true })
  await updateView($, view => ({ ...view, tab }))
  // The Usage tab reads the context's parts again when the last read is over a minute old
  if (tab === 'usage' && (await isBreakdownStale($))) readBreakdownSoon($)
  const opened = await opening
  if (!opened.isPlaced) return opened
  if (tab === 'now' || tab === 'tools') {
    await markFailuresSeen($)
  }
  return opened
}

// The pane on `tab`, unless it is open on one of `tabs` already: '' when drawn, else why not
export async function showPaneOn($: EngineInterface, tab: Tab, tabs: Tab[]): Promise<string> {
  const isOpen = (await $.ui.panes().catch(() => [])).some(p => p.id === 'inspect')
  if (isOpen && tabs.includes((await readView($)).tab)) return ''
  const opened = await openInspect($, tab)
  return opened.isPlaced ? '' : ` The pane is open but not drawn: ${opened.reason}.`
}

// '/inspect band [off|calm|full]': writes "band" into the user file, or names the mode in force and its source
export async function runBandCommand($: EngineInterface, word: string): Promise<string> {
  const mode = BAND_MODES.find(m => m === word)
  if (mode !== undefined) return writeUserField($, 'band', mode)
  await loadSettings($)
  const resolved = resolvedSettings()
  return `Band: ${resolved?.values.band ?? DEFAULTS.band} - from ${sourceLabel(resolved?.from.band ?? 'default', '/band')}. ${BAND_HELP}`
}

// '/inspect show [n]' and '/inspect copy [n]': the failure whose row starts with n, the newest when n is left out
export async function runFailureCommand($: EngineInterface, action: 'show' | 'copy', word: string | undefined): Promise<string> {
  const list = (await readFailures($)).map((f, i) => ({ f, n: failureNumberOf(f, i) }))
  const newest = list[list.length - 1]
  if (newest === undefined) return `No tool failure to ${action}.`
  const n = word === undefined ? newest.n : ordinalOf(word)
  const f = list.find(x => x.n === n)?.f
  const oldest = list[0]?.n ?? newest.n
  if (f === undefined) {
    const range = oldest === newest.n ? `the pane lists failure ${oldest}` : `the pane lists failures ${oldest} to ${newest.n}`
    return `No failure ${oneLine(printable(word ?? ''), 20)}: ${range}.`
  }
  const name = `failure ${n} (${f.tool}${f.target === '' ? '' : `  ${oneLine(printable(f.target), 40)}`})`
  if (action === 'copy') {
    if (f.outcome !== 'error') return `Nothing to copy: ${name} was ${f.outcome}, not an error.`
    const done = await $.ui.copy({ text: f.detail })
    return done.isCopied ? `Copied the error of ${name}.` : `Not copied: ${COPY_WHY[done.reason]}.`
  }
  if (f.outcome !== 'error' && f.outcome !== 'blocked') return `Nothing to show: ${name} was ${f.outcome}.`
  return runToggleCommand($, f.id, name, 'now', ['now', 'tools'])
}

// '/inspect report [n]': report n of the agents that finished with one, in the Agents tab's order, the top first
export async function runReportCommand($: EngineInterface, word: string | undefined): Promise<string> {
  const list = reportRows(await readAgents($))
  if (list.length === 0) return 'No agent report to show.'
  const n = ordinalOf(word)
  const row = list[n - 1]
  if (row === undefined) return outOfRange('report', word, list.length, 'top')
  return runToggleCommand($, `report:${row.id}`, `report ${n} (${row.type} · ${oneLine(printable(row.description), 40)})`, 'agents', ['agents'])
}

// Show and Hide as one toggle, as the button: shown, the pane comes up on a tab that lists it
export async function runToggleCommand($: EngineInterface, id: string, name: string, tab: Tab, tabs: Tab[]): Promise<string> {
  const isShown = (await readView($)).shown.includes(id)
  await toggleExpanded($, id)
  if (isShown) return `Hid ${name}.`
  return `Showing ${name} in the inspect pane.${await showPaneOn($, tab, tabs)}`
}

// The band's Inspect button: a pane the surface leaves undrawn says why
export async function openInspectFromBand($: EngineInterface): Promise<void> {
  const opened = await openInspect($, 'now')
  if (!opened.isPlaced) toast($, `Inspect pane not drawn: ${opened.reason}`)
}

export async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await updateView($, view => ({ ...view, shown: view.shown.includes(id) ? view.shown.filter(x => x !== id) : [...view.shown, id] }))
}

export async function runInspectCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'inspect' }>) {
  const words = e.args.trim().split(/\s+/)
  const word = (words[0] ?? '').toLowerCase()
  if (word === 'close') return { text: await closePane($, 'inspect', 'inspect pane') }
  if (word === 'band') return { text: mask(await runBandCommand($, (words[1] ?? '').toLowerCase())) }
  if (word === 'show' || word === 'copy') return { text: mask(await runFailureCommand($, word, words[1])) }
  if (word === 'report') return { text: mask(await runReportCommand($, words[1])) }
  if (word === 'fill') return { text: await fillStackPrompt($) }
  const tab = TAB_NAMES.find(t => t === (word === '' ? 'now' : word))
  if (tab === undefined) return { text: INSPECT_HELP }
  if (tab === 'plan') {
    const name = words[1] ?? null
    const good = (await readPlans($)).plans.filter(w => w.value !== null).map(w => w.name).sort()
    if (name !== null && !good.includes(name)) {
      const asked = oneLine(printable(name), 40)
      return { text: good.length === 0 ? `No plan named ${asked}. No plan file in ${PLANS_DIR}/.` : `No plan named ${asked}. Plans: ${good.join(', ')}.` }
    }
    await updateView($, view => (view.planSlug === name ? view : { ...view, planSlug: name }))
  }
  const opened = await openInspect($, tab)
  return { text: opened.isPlaced ? 'Opened the inspect pane.' : `The inspect pane is open but not drawn: ${opened.reason}.` }
}

export async function drawInspectPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'inspect' }>, pending: Pending) {
  await readTick($)
  const now = await $.clock.now()
  const counts = await readLive($)
  const shown = await readView($)
  const rows = await readFailures($)
  const drawing = await readPlanDrawing($, now)
  const u = await readUsage($)
  const h = await readHandoff($)
  const m = await readMeta($)
  const st = await readStack($)
  const runway = runwayOf(st, u, m.model)
  const input = {
    now, columns: e.props.bodyColumns, isWorking: counts.turnId !== null, live: counts, usage: u,
    session: m, turns: await readTurns($), newFailures: rows.filter(failure => failure.isNew).length,
    pace: await readPace($), failures: rows, stats: await readStats($), totals: await readTotals($), view: shown,
    agents: await readAgents($), cache: await readCache($), plan: drawing.band, isPlanInvalid: drawing.invalid, score: drawing.score, isPlanScore: drawing.isPlanScore, scoreLevel: await readScoreLevel($), blockers: await readBlockers($), parts: await readParts($),
    loops: await readLoops($),
    rec: recSummary(await readRec($)), forecast: forecastTargetOf(h, u, runway), handoff: handoffViewOf(h, u, counts.turnId !== null, runway),
    stack: { view: st, prompt: stackPrompt(), runway, sessionModel: m.model },
  }
  const bar = tabBar(shown.tab, counts.turnId !== null, e.props.bodyColumns)
  const body = shown.tab === 'usage' ? usageLines(input)
    : shown.tab === 'agents' ? agentsLines(input)
    : shown.tab === 'cache' ? cacheLines(input)
    : shown.tab === 'tools' ? toolsLines(input)
    : shown.tab === 'timeline' ? timelineLines(input.turns, Math.max(3, e.props.scroll.bodyRows - 1 - bar.length), u.windows.length > 0, e.props.bodyColumns)
    : shown.tab === 'plan' ? planLines(drawing.shown, drawing.scores, { invalid: drawing.invalid, others: drawing.others, otherScores: drawing.otherScores, updatedAt: drawing.updatedAt, now, columns: e.props.bodyColumns })
    : nowLines(input)
  const press: Record<string, () => unknown> = {
    'tab-now': () => openInspect($, 'now'),
    'tab-usage': () => openInspect($, 'usage'),
    'tab-agents': () => openInspect($, 'agents'),
    'tab-tools': () => openInspect($, 'tools'),
    'tab-cache': () => openInspect($, 'cache'),
    compact: () => compactNow($, pending),
    'handoff-save': () => saveNow($),
    'stack-fill': async () => toast($, await fillStackPrompt($)),
    'handoff-compact': () => saveThenCompact($, pending),
    'handoff-dismiss': () => dismissAsk($),
    'tab-timeline': () => openInspect($, 'timeline'),
    'tab-plan': () => openInspect($, 'plan'),
  }
  for (const row of rows) {
    press[`show-${row.id}`] = () => toggleExpanded($, row.id)
    press[`copy-${row.id}`] = () => $.ui.copy({ text: row.detail, surface: e.surface })
  }
  for (const agent of input.agents) {
    if (agent.report !== null) press[`report-${agent.id}`] = () => toggleExpanded($, `report:${agent.id}`)
  }
  // On the terminal's main screen nothing takes a click, and the pane's keys may not reach the mod (the user,
  // 2026-11-12): each button draws as its command
  const isMain = e.surface === 'terminal' && e.viewport?.isFullscreen === false
  const lines = isMain ? asCommands([...bar, ...body], paneCommands(rows, input.agents)) : [...bar, ...body]
  return drawLines($, e, lines, { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
