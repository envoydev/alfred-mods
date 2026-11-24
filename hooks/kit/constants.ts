// What the mod reads of claude-kit: its settings file, the names in it with the values each takes, and the words the band
// and the Now tab use for them. The file is `.claude/kit/settings.json` at the project root (claude-kit 8af3151).
export const KIT_FILE = '.claude/kit/settings.json'

// A file longer than this is no kit file: the kit's own is under 1 KiB
export const KIT_FILE_MAX_CHARS = 16_384

// The hook event whose added context follows the kit hook's own write of the file
export const KIT_HOOK_EVENT = 'UserPromptSubmit'

export const WHOLE_NUMBER = /^\d+$/

export const KIT_ON = 'on'
export const KIT_OFF = 'off'
export const PASS_SCORE_MIN = 1
export const PASS_SCORE_MAX = 100

export const KIT_NAMES = { autoRun: 'auto_run', scoring: 'scoring', passScore: 'pass_score', autoApprove: 'auto_approve' } as const

// The switches take 'on' or 'off'; a model takes one of these names
export const KIT_SWITCH_NAMES: readonly string[] = [KIT_NAMES.autoRun, KIT_NAMES.scoring, KIT_NAMES.autoApprove]

export const KIT_MODEL_NAMES: readonly string[] = ['sonnet', 'opus', 'haiku', 'fable']

// Each model role with the setting that names its model
export const KIT_MODEL_ROLES = [
  ['plan', 'plan_model'], ['audit', 'audit_model'], ['review', 'review_model'], ['implement', 'implement_model'], ['search', 'search_model'],
] as const

// What the Now tab calls the kit, and how a setting reads there
export const KIT_SECTION_HEAD = 'CLAUDE-KIT'
export const KIT_SETTING_ROWS = [['auto-run', KIT_NAMES.autoRun], ['scoring', KIT_NAMES.scoring], ['auto-approve', KIT_NAMES.autoApprove]] as const

// The rounds claude-kit's grading loop runs, which its settings file does not carry: round 0 grades, rounds 1-3 revise
// (claude-kit's refining-plans skill, 'The loop')
export const KIT_SCORING_ROUNDS = 3
