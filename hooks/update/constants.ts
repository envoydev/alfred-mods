// The update's named values: the cap of files moved in a run, the live window, the one rm, the folders it reads, the
// probe and the texts of its report. '/alfred-mods:update' is typed as setup/constants' SLASH has it.
import { SLASH } from '../setup/constants'

// The cap of files moved in one run, how long a plan with an unfinished step counts as live, the one rm's timeout
export const MOVE_CAP = 50

export const LIVE_PLAN_MS = 24 * 3_600_000

// An old status file changed within this long is left in place, as another stack may still write it, and at most this many
// go in one run, so the one rm's command line stays short
export const STATUS_LIVE_MS = LIVE_PLAN_MS

export const STATUS_CAP = 100

export const RM_TIMEOUT_MS = 3000

export const RM_ARGV: readonly string[] = ['rm', '-f', '--']

export const GITIGNORE_FILE = '.gitignore'

export const OLD_INSTALL_PREFIX = 'session-inspector@'

// The settings key that holds each plugin's on or off, and the sources the old install is looked for in: the three files the
// update may write, then the two it may not
export const ENABLED_PLUGINS_KEY = 'enabledPlugins'

export const WRITABLE_SOURCES = ['user', 'project', 'local'] as const

export const LOCKED_SOURCES = ['policy', 'flag'] as const

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

// The characters a regular expression reads as syntax
export const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

export const JSON_SUFFIX = '.json'

export const REASON_MAX = 60

// The nouns of the update report's counts, one and many
export const FILE_NOUN = { one: 'file', many: 'files' } as const
export const PLAN_FILE_NOUN = { one: 'plan or scores file', many: 'plan and scores files' } as const
export const STATUS_FILE_NOUN = { one: 'status file', many: 'status files' } as const
export const MORE_STATUS_NOUN = { one: 'more old status file', many: 'more old status files' } as const
export const OLD_COPY_NOUN = { one: 'old copy', many: 'old copies' } as const
