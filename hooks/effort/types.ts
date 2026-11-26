// The effort folder's types
import type { SettingsSource } from 'claude-code'

import type { EffortLevel, EffortPickState } from '../../types'

export type { EffortLevel, EffortPickState }

// One model's effort support: its default, the levels it takes, and whether a top-level `effortLevel` in the user's
// own settings file counts for it
export type EffortModel = { fallback: EffortLevel; levels: readonly EffortLevel[]; readsUserTop: boolean }

// Each settings file as it was read, as a person wrote it
export type EffortLayers = Partial<Record<SettingsSource, Readonly<Record<string, unknown>>>>

// What a /effort's arguments say: a level Claude Code saves for the model, one it keeps for the session alone (max),
// back to the saved level, or nothing to read (the picker)
export type EffortPick = { kind: 'saved' | 'session'; level: EffortLevel } | { kind: 'clear' } | { kind: 'none' }
