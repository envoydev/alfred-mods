// The setup folder's effects: '/alfred-mods init|configure|update' and the pane that offers the choice. The plans
// folder is a project setting (.claude/settings.json), written only here.
import type { EngineInterface } from 'claude-code'
import type { MatchedInput } from '../core/types'
import { drawLines } from '../core/draw'
import { isNoColor } from '../core/effects'
import type { PlansFolder } from '../plan/types'
import { loadSettings, plansFolderInForce, writeProjectField } from '../settings/effects'
import { sourceFileName } from '../settings/settings'
import { BUTTON_KEY_PREFIX, CHOICE_ORDER, SETUP_PANE_ID, SETUP_PANE_TITLE, SETUP_USAGE } from './constants'
import { choiceLines, configuredLine, livesLine, noUpdateLine, parseSetupArgs, setupPaneLines, shadowLine, writerNote } from './setup'

// What the pane draws: the last update's report, and the folder a press just wrote (the settings in force are stale
// until Claude Code's ConfigChange). A new claude run starts them over.
const setupMemory = { report: [] as string[], chosen: null as PlansFolder | null }

// Task 4 gives this its body: the plan and score files moved into the folder's root, one report line each step. The
// stub names the folder it was given, so a test sees which one every caller passes.
async function runUpdate(_$: EngineInterface, folder: PlansFolder): Promise<string[]> {
  return [noUpdateLine(folder)]
}

type Written = { ok: true; folder: PlansFolder; first: string; isShadowed: boolean; note: string | null } | { ok: false; why: string }

// One write of the field into the project file. The settings are stale until ConfigChange, so `folder`, the one in
// force, is the value written, else the higher file's as the settings held it before the write; `first` says which.
async function chooseFolder($: EngineInterface, written: PlansFolder): Promise<Written> {
  const result = await writeProjectField($, 'plansFolder', written)
  if (!result.ok) return { ok: false, why: result.why }
  const note = writerNote(written)
  if (result.shadow === null) return { ok: true, folder: written, first: livesLine(written, sourceFileName('project'), false), isShadowed: false, note }
  const folder = plansFolderInForce().folder
  return { ok: true, folder, first: shadowLine(folder, sourceFileName(result.shadow)), isShadowed: true, note }
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
  await $.ui.open({ id: SETUP_PANE_ID, title: SETUP_PANE_TITLE, closeOnEscape: true }).catch(() => undefined)
  return text
}

export async function runSetupCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods' }>): Promise<{ text: string }> {
  const args = parseSetupArgs(e.args)
  if (args === null) return { text: SETUP_USAGE }
  // The files are read first, so a session that has not polled answers from what they hold now
  await loadSettings($)
  const inForce = plansFolderInForce()
  if (args.verb === 'update') return { text: (await runUpdate($, inForce.folder)).join('\n') }
  if (args.folder !== null) {
    const chosen = await chooseFolder($, args.folder)
    if (!chosen.ok) return { text: chosen.why }
    if (args.verb === 'init') return { text: [...confirmed(chosen), ...(await runUpdate($, chosen.folder))].join('\n') }
    return { text: [...(chosen.isShadowed ? [chosen.first] : []), ...(chosen.note === null ? [] : [chosen.note]), configuredLine(chosen.folder)].join('\n') }
  }
  if (args.verb === 'init' && inForce.from !== 'default') {
    return { text: [livesLine(inForce.folder, sourceFileName(inForce.from), true), ...(await runUpdate($, inForce.folder))].join('\n') }
  }
  return { text: await offerChoices($) }
}

export async function drawSetupPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'alfred-mods-setup' }>) {
  const press: Record<string, () => unknown> = {}
  for (const folder of CHOICE_ORDER) press[`${BUTTON_KEY_PREFIX}${folder}`] = () => pressChoice($, folder).catch(() => undefined)
  return drawLines($.ui.resolve(e), e, setupPaneLines(currentFolder(), setupMemory.report), { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
