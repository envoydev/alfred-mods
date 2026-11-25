// The setup commands' named values - /alfred-mods:init, /alfred-mods:configure and /alfred-mods:update: their words,
// the pane and the texts of the plans folder choice and of the update
import { ALFRED_PLANS_DIR, PLANS_ROOTS } from '../plan/constants'
import type { PlansFolder } from '../plan/types'
import type { SetupVerb } from './types'

// The three commands as typed; the plugin's commands/ folder names them and each has a command.run hook of its own
export const SLASH: Readonly<Record<SetupVerb, string>> = {
  init: '/alfred-mods:init',
  configure: '/alfred-mods:configure',
  update: '/alfred-mods:update',
}

// The order the choices are shown in, the recommended one first; the reader's fallback order is PLANS_FOLDERS
export const CHOICE_ORDER: readonly PlansFolder[] = ['.alfred-mods', '.alfred', 'default']

export const FOLDER_VALUES_HINT = `[${CHOICE_ORDER.join('|')}]`

export const SETUP_USAGE = `Usage: ${SLASH.init} ${FOLDER_VALUES_HINT} | ${SLASH.configure} ${FOLDER_VALUES_HINT} | ${SLASH.update}`

export const SETUP_PANE_ID = 'alfred-mods-setup'

export const SETUP_PANE_TITLE = 'Plans folder'

// Each choice reads one source's plans (the user, 2026-11-25): claude-kit's plan files, Alfred Code's plan folders, or
// none, leaving Claude Code's own task list
export const CHOICE_NOTES: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': "claude-kit's plan files - recommended",
  '.alfred': `Alfred Code's plans in ${ALFRED_PLANS_DIR}/`,
  default: "Claude Code's own task list - no plan files",
}

// Where the plans in force are read, as init and configure say it
export const LIVES: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': `claude-kit's plan files are read from ${PLANS_ROOTS['.alfred-mods']}/`,
  '.alfred': `Alfred Code's plans are read from ${ALFRED_PLANS_DIR}/`,
  default: "The plan row shows Claude Code's own task list, and no plan file is read",
}

// The closing words of a configure whose folder has files for /alfred-mods:update to move
export const MOVES_NOTE = ' - /alfred-mods:update moves the files'

export const NOW_MARK = ' (now)'

// The question a setup command with no value asks, in Claude Code's own dialog (the user, 2026-11-25)
export const ASK_QUESTION = 'Which plans should alfred-mods show?'
export const ASK_HEADER = 'Plans'
export const ASK_LABELS: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': 'claude-kit (.alfred-mods, recommended)',
  '.alfred': 'Alfred Code (.alfred)',
  default: "default (Claude Code's task list)",
}


export const BUTTON_KEY_PREFIX = 'choose-'

export const PANE_HEADING = 'Plans folder'

export const PANE_HELP = 'A press writes plansFolder in .claude/settings.json and runs the update.'

// On the terminal's main screen nothing takes a press: the choices draw as the lines to type
export const PANE_HELP_TYPED = 'Type a line to write plansFolder in .claude/settings.json and run the update.'
