// The band's named values
// The labels' width, so the items of every row line up
export const ROW_LABEL = 9

// The band's org mark: its label, the bar before the kind, the cap of a company name in cells and what shows for no known
// account
export const ORG_LABEL = 'org'

export const ORG_JOIN = ' | '

export const ORG_MAX_CELLS = 40

export const ORG_UNKNOWN = 'unknown'

// The joiner between the band's items on a row, drawn dim
export const ROW_JOIN = ' │ '

// A rate window's short name in the band and its toasts
export const WINDOW_LABEL: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d' }

// What names Claude Code's version on line 1
export const CC_LABEL = 'CC'

// The joiner between the person's last prompt and Claude's last reply on the info line
export const TIMES_JOIN = ' · '

// What ends the rules row's counts where the transcript reader cannot count by path
export const TRANSCRIPT_NOTE = { unread: 'transcript unread', 'not-found': 'transcript not found' } as const

// The modes line under the identity (the user, 2026-11-24: 'auto-run · auto-compact 400k · scoring 90 3'): each mode's
// word, and the join between them
export const MODE_WORDS = { autoRun: 'auto-run', autoCompact: 'auto-compact', scoring: 'scoring' } as const
export const MODES_JOIN = ' · '
// Each modes line's label, and the cells a line's values get less than the band's width
export const SOURCE_LABELS = { alfredCode: 'alfred-code:', kit: 'claude-kit:' } as const
export const SOURCE_LABEL_CELLS = Math.max(SOURCE_LABELS.alfredCode.length, SOURCE_LABELS.kit.length) + 1
// claude-kit's models, written as its status line writes them (the user, 2026-11-25)
export const MODELS_JOIN = ' | '

// The cells line 1 keeps for the turn when it merges the turn in, and the failures count line 1 reserves room for
export const TURN_ROOM_MIN = 24
export const FAILURES_RESERVE_COUNT = 99
