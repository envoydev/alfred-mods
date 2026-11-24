// The skip ask's named values: the store key of its answer, the option it writes and the band's texts

export const SKIP_ASK_KEY = 'skip-ask'

// The option's `/config` key, `<plugin>.<field>`, and the row's title in `.claude-plugin/plugin.json`
export const OPTION_KEY = 'alfred-mods.leave_out_skipped_hooks'
export const OPTION_TITLE = 'Leave out hooks a managed plugin skips'

export const INITIAL_SKIP_ASK = { isSkipped: false, isAskUp: false }

export const ASK_TEXT = '⚠ hooks skipped by a managed plugin · leave them out? '
export const ASK_BUTTONS = {
  leave: { key: 'skip-leave', label: 'Leave out', hotkey: '5', command: '/inspect skip leave' },
  never: { key: 'skip-never', label: "Don't ask again", hotkey: '6', command: '/inspect skip never' },
} as const

// The words `/inspect skip <word>` takes
export const SKIP_WORDS = { leave: 'leave', never: 'never' } as const
export const SKIP_USAGE = '/inspect skip leave leaves out the hooks a managed plugin skips, /inspect skip never stops the question.'

export const LEFT_OUT_TEXT = 'Left out the hooks a managed plugin skips: the mod reloads without them.'
export const NEVER_TEXT = "Will not ask again about hooks a managed plugin skips. Change '" + OPTION_TITLE + "' in /config any time."
export const NEVER_UNSAVED_TEXT = "The answer was not saved, so the question may return next session. Change '" + OPTION_TITLE + "' in /config any time."
