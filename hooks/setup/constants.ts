// The setup commands' named values - /alfred-mods:init, /alfred-mods:configure and /alfred-mods:update: their words,
// the pane and the texts of the plans folder choice and of the update
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

export const CHOICE_NOTES: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': 'recommended - no permission asks',
  '.alfred': "reads Alfred Code's plans too",
  default: '.claude/session-inspector - Claude Code asks before each write',
}

export const NOW_MARK = ' (now)'

// The question a setup command with no value asks, in Claude Code's own dialog (the user, 2026-11-25)
export const ASK_QUESTION = 'Where should plan and score files live?'
export const ASK_HEADER = 'Plans folder'
export const ASK_LABELS: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': '.alfred-mods (recommended)',
  '.alfred': ".alfred (Alfred Code's folder)",
  default: 'default (.claude)',
}

export const WRITER_NOTE = 'new plans land there once each writer reads plansFolder - claude-kit does from its 0b09406 sync'

export const BUTTON_KEY_PREFIX = 'choose-'

export const PANE_HEADING = 'Plans folder'

export const PANE_HELP = 'A press writes plansFolder in .claude/settings.json and moves the files.'

// On the terminal's main screen nothing takes a press: the choices draw as the lines to type
export const PANE_HELP_TYPED = 'Type a line to write plansFolder in .claude/settings.json and move the files.'
