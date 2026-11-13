// The settings folder's effects: what it reads and writes through $
import type { From, Resolved, Values } from './types'
import { DEFAULTS } from './settings'
import type { Level } from '../rec/types'

// The mod's switches, from the "alfred-mods" key of each settings file and the old commands' store keys (spec
// 2026-11-11 settings-values, S1-S4 and S7): read at the start, on the poll, after a /clear and after each change, one
// run at a time as the status file's reads are. `rec`, the level in force and the source that set it; `skippedKey`,
// the skipped values last told; `isHoldTold`, whether REC's hold was told. A new claude run starts them over.
export const settingsMem = {
  resolved: null as Resolved | null, rec: null as { level: Level; from: From } | null, skippedKey: '', isHoldTold: false,
  reading: Promise.resolve() as Promise<void>,
}

export const settingsNow = (): Values => settingsMem.resolved?.values ?? DEFAULTS

// REC's level in force and the source that set it, or null before the settings are read
export function recInForce(): { level: Level; from: From } | null {
  return settingsMem.rec
}
