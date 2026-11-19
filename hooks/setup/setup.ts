// The setup command's pure parts: its arguments, the choice lines and the confirm lines. setup/effects.ts reads and
// writes the files.
import { PLANS_FOLDERS, PLANS_ROOTS } from '../plan/constants'
import type { PlansFolder } from '../plan/types'
import type { Line } from '../core/types'
import { BUTTON_KEY_PREFIX, CHOICE_NOTES, CHOICE_ORDER, NOW_MARK, PANE_HEADING, PANE_HELP, SETUP_COMMAND, SETUP_VERBS, WRITER_NOTE } from './constants'
import type { SetupArgs } from './types'

// null means the words are not a verb with its folder: the usage line is the answer. `update` takes no folder.
export function parseSetupArgs(args: string): SetupArgs | null {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const verb = SETUP_VERBS.find(known => known === words[0])
  if (verb === undefined || words.length > 2) return null
  const word = words[1]
  if (word === undefined) return { verb, folder: null }
  const folder = PLANS_FOLDERS.find(known => known === word)
  return folder === undefined || verb === 'update' ? null : { verb, folder }
}

// The three choices as the line to type, the recommended one first, the current one marked
export function choiceLines(now: PlansFolder | null): string[] {
  return CHOICE_ORDER.map(folder => `/${SETUP_COMMAND} init ${folder} (${CHOICE_NOTES[folder]})${folder === now ? NOW_MARK : ''}`)
}

// A choice other than .alfred-mods lands only where a writer follows the field
export function writerNote(folder: PlansFolder): string | null {
  return folder === '.alfred-mods' ? null : WRITER_NOTE
}

// Where plans live, and the file that says so; `isHint` adds how to change it
export function livesLine(folder: PlansFolder, file: string, isHint: boolean): string {
  return `Plans live in ${PLANS_ROOTS[folder]}/ (plansFolder "${folder}" in ${file})${isHint ? ` - /${SETUP_COMMAND} configure changes it` : ''}`
}

// A higher file gives the field a value that wins over the one written
export function shadowLine(inForce: PlansFolder, file: string): string {
  return `plansFolder is "${inForce}" in ${file}, which wins over the value written`
}

export function configuredLine(folder: PlansFolder): string {
  return `plansFolder is "${folder}" - /${SETUP_COMMAND} update moves the files`
}

// The pane: a heading, one button per choice with its note, then the last update's report
export function setupPaneLines(now: PlansFolder | null, report: readonly string[]): Line[] {
  const choices = CHOICE_ORDER.map((folder): Line => [
    { button: { key: `${BUTTON_KEY_PREFIX}${folder}`, label: `${folder}${folder === now ? NOW_MARK : ''}` } },
    { text: `  ${CHOICE_NOTES[folder]}`, tone: 'dim' },
  ])
  const out: Line[] = [[{ text: PANE_HEADING, bold: true }], ...choices, [{ text: PANE_HELP, tone: 'dim' }]]
  if (report.length > 0) out.push([{ text: '' }], ...report.map((line): Line => [{ text: line }]))
  return out
}

// $.ui.open answered that the pane is open but no surface drew it, as /inspect says it
export const unplacedLine = (reason: string): string => `The pane is open but not drawn: ${reason}.`
