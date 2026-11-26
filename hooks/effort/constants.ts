// The effort folder's named values: Claude Code's effort rules (code.claude.com/docs/en/model-config, 'Adjust effort
// level', and the settings reference's `effortLevel`, `modelSettings` and `maxEffortLevel`; read 2026-11-25)
import type { EffortLevel, EffortModel } from './types'

// Lowest first
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

// What a settings file takes as a level; `max` is the variable's or the session's alone
export const SAVED_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh']

// CLAUDE_CODE_EFFORT_LEVEL's words for sending no level
export const NO_LEVEL_WORDS: readonly string[] = ['auto', 'unset']

// `/effort auto`: the model's saved level, else its default, in place of a level picked for the session
export const CLEAR_PICK_WORD = 'auto'

// How long after a /effort the tick reads the settings again each second: the picker saves after the command answers
export const REREAD_WINDOW_MS = 30_000

const NO_XHIGH: readonly EffortLevel[] = ['low', 'medium', 'high', 'max']
const newer = (fallback: EffortLevel): EffortModel => ({ fallback, levels: EFFORT_LEVELS, readsUserTop: false })
const older = (fallback: EffortLevel, levels = EFFORT_LEVELS): EffortModel => ({ fallback, levels, readsUserTop: true })

// By family and version; a model not here takes no effort, or is newer than this table and gets no guess
export const EFFORT_MODELS: Readonly<Record<string, EffortModel>> = {
  'fable 5.2': newer('medium'), 'opus 5.5': newer('medium'), 'sonnet 5.5': newer('medium'), 'haiku 5.5': newer('medium'),
  'fable 5.1': older('high'), 'fable 5': older('high'), 'opus 5': older('high'), 'sonnet 5': older('high'), 'opus 4.8': older('high'),
  'opus 4.7': older('xhigh'), 'opus 4.6': older('high', NO_XHIGH), 'sonnet 4.6': older('high', NO_XHIGH),
}

// A model id's release date, which is no part of its version
export const MODEL_DATE = /-\d{8}/
