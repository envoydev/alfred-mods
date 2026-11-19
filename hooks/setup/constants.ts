// The setup command's named values: its words, the pane and the texts of the plans folder choice
import type { PlansFolder } from '../plan/types'
import type { SetupVerb } from './types'

export const SETUP_COMMAND = 'alfred-mods'

export const SETUP_VERBS: readonly SetupVerb[] = ['init', 'configure', 'update']

export const SETUP_ARGUMENT_HINT = 'init | configure [default|.alfred|.alfred-mods] | update'

export const SETUP_USAGE = `Usage: /${SETUP_COMMAND} ${SETUP_ARGUMENT_HINT}`

export const SETUP_DESCRIPTION = 'Choose the folder plans and scores live in (plansFolder in .claude/settings.json), and move the files there'

export const SETUP_PANE_ID = 'alfred-mods-setup'

export const SETUP_PANE_TITLE = 'Plans folder'

// The order the choices are shown in, the recommended one first; the reader's fallback order is PLANS_FOLDERS
export const CHOICE_ORDER: readonly PlansFolder[] = ['.alfred-mods', '.alfred', 'default']

export const CHOICE_NOTES: Readonly<Record<PlansFolder, string>> = {
  '.alfred-mods': 'recommended - no permission asks',
  '.alfred': "beside Alfred Code's state",
  default: '.claude/session-inspector - Claude Code asks before each write',
}

export const NOW_MARK = ' (now)'

export const WRITER_NOTE = 'new plans land there once each writer reads plansFolder - claude-kit from its next release'

export const BUTTON_KEY_PREFIX = 'choose-'

export const PANE_HEADING = 'Plans folder'

export const PANE_HELP = 'A press writes plansFolder in .claude/settings.json and moves the files.'
