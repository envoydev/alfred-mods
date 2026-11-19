// The setup commands' pure parts: their values, the choice lines and the confirm lines. setup/effects.ts reads and
// writes the files.
import { PLANS_FOLDERS, PLANS_ROOTS } from '../plan/constants'
import type { PlansFolder } from '../plan/types'
import type { Line } from '../core/types'
import { BUTTON_KEY_PREFIX, CHOICE_NOTES, CHOICE_ORDER, NOW_MARK, PANE_HEADING, PANE_HELP, PANE_HELP_TYPED, SLASH, WRITER_NOTE } from './constants'
import type { FolderValue } from './types'

// The words typed after /alfred-mods:init or /alfred-mods:configure: none, or one folder. Anything else is not ok, and
// the usage line is the answer.
export function parseFolderValue(args: string): FolderValue {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const word = words[0]
  if (word === undefined) return { ok: true, folder: null }
  const folder = PLANS_FOLDERS.find(known => known === word)
  return folder === undefined || words.length > 1 ? { ok: false } : { ok: true, folder }
}

// /alfred-mods:update takes no value
export const hasNoValue = (args: string): boolean => args.trim() === ''

// The three choices as the line to type, the recommended one first, the current one marked
export function choiceLines(now: PlansFolder | null): string[] {
  return CHOICE_ORDER.map(folder => `${SLASH.init} ${folder} (${CHOICE_NOTES[folder]})${folder === now ? NOW_MARK : ''}`)
}

// A choice other than .alfred-mods lands only where a writer follows the field
export function writerNote(folder: PlansFolder): string | null {
  return folder === '.alfred-mods' ? null : WRITER_NOTE
}

// Where plans live, and the file that says so; `isHint` adds how to change it
export function livesLine(folder: PlansFolder, file: string, isHint: boolean): string {
  return `Plans live in ${PLANS_ROOTS[folder]}/ (plansFolder "${folder}" in ${file})${isHint ? ` - ${SLASH.configure} changes it` : ''}`
}

// A higher file gives the field a value that wins over the one written
export function shadowLine(inForce: PlansFolder, file: string): string {
  return `plansFolder is "${inForce}" in ${file}, which wins over the value written`
}

export function configuredLine(folder: PlansFolder): string {
  return `plansFolder is "${folder}" - ${SLASH.update} moves the files`
}

// The pane: a heading, one button per choice with its note, then the last update's report. Where nothing takes a press
// (`isTyped`, the terminal's main screen) each choice is the line to type instead, as choiceLines gives it.
export function setupPaneLines(now: PlansFolder | null, report: readonly string[], isTyped: boolean): Line[] {
  const choices = isTyped
    ? choiceLines(now).map((line): Line => [{ text: line }])
    : CHOICE_ORDER.map((folder): Line => [
      { button: { key: `${BUTTON_KEY_PREFIX}${folder}`, label: `${folder}${folder === now ? NOW_MARK : ''}` } },
      { text: `  ${CHOICE_NOTES[folder]}`, tone: 'dim' },
    ])
  const help = isTyped ? PANE_HELP_TYPED : PANE_HELP
  const out: Line[] = [[{ text: PANE_HEADING, bold: true }], ...choices, [{ text: help, tone: 'dim' }]]
  if (report.length > 0) out.push([{ text: '' }], ...report.map((line): Line => [{ text: line }]))
  return out
}

// $.ui.open answered that the pane is open but no surface drew it, as /inspect says it
export const unplacedLine = (reason: string): string => `The pane is open but not drawn: ${reason}.`
