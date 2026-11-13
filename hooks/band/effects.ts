// The band folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface } from 'claude-code'
import type { BandInput, BandMode, BandSetting } from './types'
import { readLive, readMeta, readPace, readTick, readTotals, readTurns, readUsage } from '../session/effects'
import { readStack, scoreLevel } from '../stack/effects'
import { bandLines, statusText, underRows } from './band'
import { mask } from '../rec/mask'
import { settingsNow } from '../settings/effects'
import { readRec } from '../rec/effects'
import { readFailures, readStats } from '../tools/effects'
import { bannerSegs, runwayOf } from '../stack/stack'
import { readHandoff, saveNow } from '../handoff/effects'
import { recOf } from '../rec/rec'
import { inspectFromBand } from '../inspect/effects'
import { readParts } from '../context/effects'
import { compactNow, readCache } from '../cache/effects'
import { readAgents } from '../agents/effects'
import { planDraw } from '../plan/effects'
import { forecastOf } from '../handoff/handoff'
import type { Held, MatchedInput, MatchedNext } from '../core/types'
import { drawLines, drawNote, drawUnder, drawUnderNote } from '../core/draw'
import { bandFailed } from '../core/failsafe'
import { isNoColor } from '../core/effects'
import { spinnerSuffix } from './working'
import { printable } from '../core/format'

// Calm until session start reads the setting, which turns it full when nothing is stored: a test that never starts
// a session draws the band it was written for
const INITIAL_BAND_SETTING: BandSetting = { mode: 'calm' }
const bandSettingAtom = atom({ plugin: 'alfred-mods', key: 'band' } as const, INITIAL_BAND_SETTING, { shape: 'band-1' })
export function readBandSetting($: EngineInterface) {
  return read($, bandSettingAtom)
}
function updateBandSetting($: EngineInterface, change: (value: BandSetting) => BandSetting) {
  return update($, bandSettingAtom, change)
}

// The status line under the prompt, which Claude Code draws while the band is collapsed (spec D2): set only when its
// text changes, cleared once nothing needs the person. The context's percent is the band's, against the runway while
// it applies. `last` is null until the module's first call, which is always sent: a line an earlier copy of the mod
// pinned before a reload is cleared or replaced at once.
const statusMem = { last: null as string | undefined | null }

// Whether the band is in view, as its last render found it (spec 2026-11-11, D6): it drew lines, `isCollapsed` is
// exactly false (a build before 2.1.321 hands none) and no survey covers it. One flag for the session, the last render
// deciding; the one-second tick carries a change to the pinned line.
// `isUnder` mirrors the setting for the hooks' `.catch`, which cannot read state (spec 2026-11-11 band-under U1).
// Under (U2): `columns`, the terminal site above's last `bodyColumns`; `hasFooter`, the terminal's footer hook has run
// this session, so the site above may pass; `hasStatusLine`, a `statusLine` is set, which the fullscreen budget leaves
// room for.
const bandMem = { isShown: false, isUnder: false, columns: null as number | null, hasFooter: false, hasStatusLine: false }

export async function syncStatus($: EngineInterface): Promise<void> {
  const u = await readUsage($)
  const runway = runwayOf(await readStack($), u, (await readMeta($)).model)
  const raw = statusText({
    percent: runway?.percent ?? u.percent, newFailures: (await readFailures($)).filter(f => f.isNew).length,
    recLevel: (await readRec($)).level, isBandShown: bandMem.isShown,
  })
  const text = raw === null ? undefined : mask(raw)
  if (text === statusMem.last) return
  statusMem.last = text
  $.ui.status(text)
}

// "band", "bandRows" and "bandPlace" into the band's setting
export async function loadBand($: EngineInterface): Promise<BandMode> {
  const v = settingsNow()
  const mode: BandMode = v.band
  const isOpen = v.bandRows
  const isUnder = v.bandPlace === 'under'
  bandMem.isUnder = isUnder
  const next: BandSetting = { mode, ...(isOpen ? { isToolsOpen: true } : {}), ...(isUnder ? { isUnder: true } : {}) }
  await updateBandSetting($, b =>
    (b.mode === mode && (b.isToolsOpen === true) === isOpen && (b.isUnder === true) === isUnder ? b : next))
  return mode
}

// Under the input on the terminal, once its footer has drawn, the site above is Claude Code's (spec band-under U2)
export const isPassingAbove = (surface: string): boolean => bandMem.isUnder && surface === 'terminal' && bandMem.hasFooter

// The band's lines from the session's state, for the site above or the footer (spec band-under U2): the same reads, the
// place's own width, rows and turn
export async function bandInputOf(
  $: EngineInterface, at: { columns: number; maxRows: number | undefined; isWorking: boolean; under?: BandInput['under']; isLeftOut: boolean },
): Promise<BandInput> {
  // Read so the running times redraw each second while a turn runs
  await readTick($)
  const now = await $.clock.now()
  const d = await planDraw($, now)
  const u = await readUsage($)
  const h = await readHandoff($)
  const st = await readStack($)
  const m = await readMeta($)
  const runway = runwayOf(st, u, m.model)
  const setting = await readBandSetting($)
  const p = await readParts($)
  return {
    now, columns: at.columns, ...(at.maxRows === undefined ? {} : { maxRows: at.maxRows }), isWorking: at.isWorking,
    live: await readLive($), usage: u, meta: m, turns: await readTurns($),
    newFailures: (await readFailures($)).filter(f => f.isNew).length, pace: await readPace($), agents: await readAgents($),
    cache: await readCache($), plan: d.band, planInvalid: d.invalid, score: d.score, isPlanScore: d.isPlanScore, scoreLevel: await scoreLevel($), rec: recOf(await readRec($)),
    forecast: forecastOf(h, u, runway), handoffAsk: h.isAskUp ? h.handled : null, runway, banner: bannerSegs(st),
    mode: setting.mode, totals: await readTotals($), stats: await readStats($),
    isToolsOpen: setting.isToolsOpen === true, listing: p.skills ?? null,
    rules: { always: p.rules ?? [], byPath: m.pathRules ?? [], isTracked: !at.isLeftOut },
    ...(at.under === undefined ? {} : { under: at.under }),
  }
}

// What the band's buttons do, above or under
export function bandPress($: EngineInterface, held: Held): Record<string, () => unknown> {
  return { inspect: () => inspectFromBand($), compact: () => compactNow($, held), handoff: () => saveNow($) }
}

export async function drawBandAbove($: EngineInterface, e: MatchedInput<'ui.render', { component: 'AbovePrompt' }>, next: MatchedNext<'ui.render', { component: 'AbovePrompt' }>, held: Held, isLeftOut: boolean) {
  // Decided on module memory, so a person above meets no new read before the survey's check; the read keeps this
  // hook drawn again on a later "bandPlace": "above". The width it lends the footer redraws it only on a change.
  if (isPassingAbove(e.surface)) {
    await readBandSetting($)
    if (bandMem.columns !== e.props.bodyColumns) {
      bandMem.columns = e.props.bodyColumns
      $.ui.invalidate('ui.render')
    }
    return next(e)
  }
  if (e.props.hasSurvey) {
    bandMem.isShown = false
    return next(e)
  }
  const lines = bandLines(await bandInputOf($, { columns: e.props.bodyColumns, maxRows: e.props.maxRows, isWorking: e.props.isWorking, isLeftOut }))
  bandMem.isShown = lines.length > 0 && e.props.isCollapsed === false
  if (lines.length === 0) return next(e)
  return drawLines($, e, lines, { noColor: await isNoColor($), press: bandPress($, held), columns: e.props.bodyColumns })
}

export async function drawBandUnder($: EngineInterface, e: MatchedInput<'ui.render', { component: 'PromptHint' }>, next: MatchedNext<'ui.render', { component: 'PromptHint' }>, held: Held, isLeftOut: boolean) {
  const setting = await readBandSetting($)
  const v = e.viewport
  if (setting.isUnder !== true || e.surface !== 'terminal' || v === undefined) return next(e)
  if (!bandMem.hasFooter) {
    bandMem.hasFooter = true
    $.ui.invalidate('ui.render')
  }
  const columns = Math.min(v.columns - 5, bandMem.columns ?? Infinity)
  const isPinned = typeof statusMem.last === 'string' && statusMem.last !== ''
  const maxRows = underRows(v, { hasStatusLine: bandMem.hasStatusLine, isPinned })
  const under = { buttons: v.isFullscreen === true ? 'click' as const : 'text' as const }
  const lines = bandLines(await bandInputOf($, { columns, maxRows, isWorking: e.props.isWorking, under, isLeftOut }))
  bandMem.isShown = lines.length > 0
  const beneath = await next(e)
  if (lines.length === 0) return beneath
  return drawUnder($, e, beneath, lines, { noColor: await isNoColor($), press: bandPress($, held), columns })
}

export async function drawSpinner($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Spinner' }>, next: MatchedNext<'ui.render', { component: 'Spinner' }>) {
  const text = spinnerSuffix({
    requestId: e.requestId ?? '', live: await readLive($), percent: (await readUsage($)).percent, agents: await readAgents($),
  })
  // REC masks the engine's word and message as well as the mod's own suffix
  const word = mask(e.props.word)
  const message = e.props.message === null ? null : mask(e.props.message)
  const props = word === e.props.word && message === e.props.message ? e.props : { ...e.props, word, message }
  if (text === null) return props === e.props ? next(e) : next({ ...e, props })
  return next({ ...e, props: { ...props, suffix: `${e.props.suffix} ${mask(printable(text))}` } })
}

// The band above's .catch: what draws when its hook failed
export function drawBandAboveFailed($: EngineInterface, e: MatchedInput<'ui.render', { component: 'AbovePrompt' }>, next: MatchedNext<'ui.render', { component: 'AbovePrompt' }> & Caught) {
  if (isPassingAbove(e.surface)) return next(e)
  bandMem.isShown = false
  return drawNote($, e, bandFailed(next.error.kind))
}

// The band under's .catch: what draws when its hook failed
export async function drawBandUnderFailed($: EngineInterface, e: MatchedInput<'ui.render', { component: 'PromptHint' }>, next: MatchedNext<'ui.render', { component: 'PromptHint' }> & Caught) {
  if (!bandMem.isUnder || e.surface !== 'terminal') return next(e)
  bandMem.isShown = false
  return drawUnderNote($, e, await next(e), bandFailed(next.error.kind))
}

// Each session, and each start-over, proves its footer again before the site above passes (spec band-under U2)
export async function resetBandFooter($: EngineInterface): Promise<void> {
  bandMem.hasFooter = false
  bandMem.columns = null
  const statusLine = await $.settings.read({ key: 'statusLine' }).catch(() => null)
  bandMem.hasStatusLine = statusLine !== null && statusLine !== undefined
}
