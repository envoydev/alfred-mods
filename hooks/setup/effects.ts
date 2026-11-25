// The setup folder's effects: '/alfred-mods:init', '/alfred-mods:configure' and '/alfred-mods:update', and the pane
// that offers the choice. The plans folder is a project setting (.claude/settings.json), written only here.
import type { EngineInterface } from 'claude-code'
import type { MatchedInput } from '../core/types'
import { drawLines } from '../core/draw'
import { isNoColor } from '../core/effects'
import type { PlansFolder } from '../plan/types'
import { loadSettings, plansFolderInForce, writeProjectField } from '../settings/effects'
import { sourceFileName } from '../settings/settings'
import { runUpdate } from '../update/effects'
import { ASK_HEADER, ASK_QUESTION, BUTTON_KEY_PREFIX, CHOICE_ORDER, SETUP_PANE_ID, SETUP_PANE_TITLE, SETUP_USAGE } from './constants'
import { answeredFolder, askLabels, choiceLines, configuredLine, livesLine, hasNoValue, parseFolderValue, setupPaneLines, shadowLine, unplacedLine, writerNote } from './setup'

// What the pane draws: the last update's report, and the folder a press just wrote (the settings in force are stale
// until Claude Code's ConfigChange). A new claude run starts them over.
const setupMemory = { report: [] as string[], chosen: null as PlansFolder | null }

type Written = { ok: true; folder: PlansFolder; first: string; isShadowed: boolean; note: string | null } | { ok: false; why: string }

// One write of the field into the project file. The settings are stale until ConfigChange, so `folder`, the one in
// force, is the value written, else the higher file's as the settings held it before the write; `first` says which.
async function chooseFolder($: EngineInterface, written: PlansFolder): Promise<Written> {
  const result = await writeProjectField($, 'plansFolder', written)
  if (!result.ok) return { ok: false, why: result.why }
  if (result.shadow === null) {
    return { ok: true, folder: written, first: livesLine(written, sourceFileName('project'), false), isShadowed: false, note: writerNote(written) }
  }
  // Under a shadow the folder in force is the one new files land in, so its writer note is the one that holds
  const folder = plansFolderInForce().folder
  return { ok: true, folder, first: shadowLine(folder, sourceFileName(result.shadow)), isShadowed: true, note: writerNote(folder) }
}

const confirmed = (chosen: Extract<Written, { ok: true }>): string[] => [chosen.first, ...(chosen.note === null ? [] : [chosen.note])]

// A press: write, update, and keep what happened for the pane; it never closes the pane
async function pressChoice($: EngineInterface, written: PlansFolder): Promise<void> {
  const chosen = await chooseFolder($, written)
  if (!chosen.ok) setupMemory.report = [chosen.why]
  else {
    setupMemory.chosen = chosen.folder
    setupMemory.report = [...confirmed(chosen), ...(await runUpdate($, chosen.folder))]
  }
  $.ui.invalidate('ui.render')
}

// The folder marked (now): the one a press just wrote, else the one a file sets; null while the field is unset
function currentFolder(): PlansFolder | null {
  const inForce = plansFolderInForce()
  return setupMemory.chosen ?? (inForce.from === 'default' ? null : inForce.folder)
}

async function offerChoices($: EngineInterface): Promise<string> {
  setupMemory.report = []
  setupMemory.chosen = null
  const text = choiceLines(currentFolder()).join('\n')
  const opened = await $.ui.open({ id: SETUP_PANE_ID, title: SETUP_PANE_TITLE, closeOnEscape: true }).catch(() => undefined)
  return opened === undefined || opened.isPlaced ? text : `${text}\n${unplacedLine(opened.reason)}`
}

// The two commands that take a folder differ in what they do with it: init also runs update, configure only writes
async function writeFolder($: EngineInterface, verb: 'init' | 'configure', folder: PlansFolder): Promise<string> {
  const chosen = await chooseFolder($, folder)
  if (!chosen.ok) return chosen.why
  if (verb === 'init') return [...confirmed(chosen), ...(await runUpdate($, chosen.folder))].join('\n')
  // The shadow line already says which folder is in force, so it is not said again as the closing line
  const noted = chosen.note === null ? [] : [chosen.note]
  return (chosen.isShadowed ? [chosen.first, ...noted] : [...noted, configuredLine(chosen.folder)]).join('\n')
}

// The folder in force as a file sets it: init says it and runs update on it, configure only says it
async function keepFolder($: EngineInterface, verb: 'init' | 'configure'): Promise<string | null> {
  const inForce = plansFolderInForce()
  if (inForce.from === 'default') return null
  const line = livesLine(inForce.folder, sourceFileName(inForce.from), verb === 'init')
  return verb === 'init' ? [line, ...(await runUpdate($, inForce.folder))].join('\n') : line
}

// No value given: Claude Code's question dialog asks it (the user, 2026-11-25). Dismissed, or with nobody to ask as in
// a `-p` run, init keeps a set folder and everything else offers the choices as lines and a pane.
async function askFolder($: EngineInterface, verb: 'init' | 'configure'): Promise<string> {
  setupMemory.chosen = null
  const now = currentFolder()
  const answer = await $.ui.ask(ASK_QUESTION, { header: ASK_HEADER, options: askLabels(now) }).catch(() => null)
  if (answer === null) return (verb === 'init' ? await keepFolder($, verb) : null) ?? offerChoices($)
  const folder = answeredFolder(answer, now)
  if (folder === null) return SETUP_USAGE
  return (folder === now ? await keepFolder($, verb) : null) ?? writeFolder($, verb, folder)
}

async function runFolderCommand($: EngineInterface, verb: 'init' | 'configure', args: string): Promise<{ text: string }> {
  const value = parseFolderValue(args)
  if (!value.ok) return { text: SETUP_USAGE }
  // The files are read first, so a session that has not polled answers from what they hold now
  await loadSettings($)
  return { text: value.folder === null ? await askFolder($, verb) : await writeFolder($, verb, value.folder) }
}

export function runInitCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:init' }>): Promise<{ text: string }> {
  return runFolderCommand($, 'init', e.args)
}

export function runConfigureCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:configure' }>): Promise<{ text: string }> {
  return runFolderCommand($, 'configure', e.args)
}

export async function runUpdateCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:update' }>): Promise<{ text: string }> {
  if (!hasNoValue(e.args)) return { text: SETUP_USAGE }
  await loadSettings($)
  return { text: (await runUpdate($, plansFolderInForce().folder)).join('\n') }
}

export async function drawSetupPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'alfred-mods-setup' }>) {
  const press: Record<string, () => unknown> = {}
  for (const folder of CHOICE_ORDER) press[`${BUTTON_KEY_PREFIX}${folder}`] = () => pressChoice($, folder).catch(() => undefined)
  // On the terminal's main screen nothing takes a press, as /inspect's pane finds: each choice draws as its command
  const isMain = e.surface === 'terminal' && e.viewport?.isFullscreen === false
  return drawLines($.ui.resolve(e), e, setupPaneLines(currentFolder(), setupMemory.report, isMain), { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
