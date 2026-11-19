// What the kit's status line is made of: the marker that opens it, the notes the hook adds, and the settings the mod
// reads by name. The line is claude-kit's `.claude/kit/status-hook.mjs` output, measured 2026-11-19.
export const KIT_MARKER = 'kit status ('
export const KIT_HEAD_END = '):'
export const SAVED_PREFIX = 'saved:'
export const NOT_SAVED_PREFIX = 'not saved -'
export const KIT_HOOK_EVENT = 'UserPromptSubmit'
export const KIT_ON = 'on'
// Ends each item and the note, so the note's text stops at the last one
export const KIT_ITEM_END = ';'

// One item: the name, the value (no blank in it, a cut one may end `...`), then the source in parentheses up to the
// first `);`, so parentheses inside a source stay in it and no source runs past a `;`
export const KIT_ITEM = /^([a-z_]+)=(\S*) \(([^;]*?)\);/
export const WHOLE_NUMBER = /^\d+$/
export const PASS_SCORE_MIN = 1
export const PASS_SCORE_MAX = 100

// A line noted again inside this time, with nothing changed, writes nothing; after it the atom's `seenAt` moves on
export const KIT_SEEN_REFRESH_MS = 1000

export const KIT_NAMES = { autoRun: 'auto_run', scoring: 'scoring', passScore: 'pass_score', autoApprove: 'auto_approve' } as const

// Each model role with the setting that names its model
export const KIT_MODEL_ROLES = [
  ['plan', 'plan_model'], ['audit', 'audit_model'], ['review', 'review_model'], ['implement', 'implement_model'], ['search', 'search_model'],
] as const
