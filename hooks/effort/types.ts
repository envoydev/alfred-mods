// The effort folder's types
import type { SettingsSource } from 'claude-code'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// One model's effort support: its default, the levels it takes, and whether a top-level `effortLevel` in the user's
// own settings file counts for it
export type EffortModel = { fallback: EffortLevel; levels: readonly EffortLevel[]; readsUserTop: boolean }

// Each settings file as it was read, as a person wrote it
export type EffortLayers = Partial<Record<SettingsSource, Readonly<Record<string, unknown>>>>
