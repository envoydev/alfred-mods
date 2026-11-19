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
  '.alfred': "beside Alfred Code's state",
  default: '.claude/session-inspector - Claude Code asks before each write',
}

export const NOW_MARK = ' (now)'

export const WRITER_NOTE = 'new plans land there once each writer reads plansFolder - claude-kit from its next release'

export const BUTTON_KEY_PREFIX = 'choose-'

export const PANE_HEADING = 'Plans folder'

export const PANE_HELP = 'A press writes plansFolder in .claude/settings.json and moves the files.'

// On the terminal's main screen nothing takes a press: the choices draw as the lines to type
export const PANE_HELP_TYPED = 'Type a line to write plansFolder in .claude/settings.json and move the files.'

// Update: the cap of files moved in one run, how long a plan with an unfinished step counts as live, the one rm's
// timeout
export const MOVE_CAP = 50

export const LIVE_PLAN_MS = 24 * 3_600_000

export const RM_TIMEOUT_MS = 3000

export const RM_ARGV: readonly string[] = ['rm', '-f', '--']

export const GITIGNORE_FILE = '.gitignore'

export const OLD_INSTALL_PREFIX = 'session-inspector@'

// Where Alfred Code 3.12.1 and older wrote the session status files, and where later ones write them
export const OLD_STATUS_DIR = '.claude/session-inspector/status'

export const NEW_STATUS_DIR = '.alfred/state/sessions/status'

export const MORE_LINE = `more to move - run ${SLASH.update} again`

export const DONE_LINE = 'update done'

export const NOTHING_LINE = 'nothing to update'

// Why a file is named 'not moved': its copy was not whole text, or a check that would make the move safe failed
export const NOT_UTF8_REASON = 'not UTF-8 text'

export const UNCHECKED_DESTINATION_REASON = 'could not check the destination'

export const UNCHECKED_COPY_REASON = 'could not check the copy'

// The file written into a chosen folder to learn whether a source folder is the same folder under another name: not a
// `.json` file, so no reader takes it for a plan
export const PROBE_PREFIX = '.alfred-mods-probe-'

// A taken probe name is replaced this many times in all, then the equal copies are kept
export const PROBE_NAME_TRIES = 2

export const PROBE_TEXT = 'probe\n'

export const UNREAD_NOTE = 'could not read it'

export const CHANGED_REASON = 'it changed while the update ran; run /alfred-mods:update again'

// A plan that does not parse and is older than the live window: waiting for its writer would never end
export const UNREADABLE_PLAN_NOTE = 'it does not read as a plan; fix or remove it'

export const LIST_SEPARATOR = ', '

export const JSON_SUFFIX = '.json'

export const REASON_MAX = 60
