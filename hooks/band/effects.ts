// The band folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { BandSetting } from './types'

// Calm until session start reads the setting, which turns it full when nothing is stored: a test that never starts
// a session draws the band it was written for
const INITIAL_BAND_SETTING: BandSetting = { mode: 'calm' }
const bandSettingAtom = atom({ plugin: 'alfred-mods', key: 'band' } as const, INITIAL_BAND_SETTING, { shape: 'band-1' })
export function readBandSetting($: EngineInterface) {
  return read($, bandSettingAtom)
}
export function updateBandSetting($: EngineInterface, change: (value: BandSetting) => BandSetting) {
  return update($, bandSettingAtom, change)
}

// The status line under the prompt, which Claude Code draws while the band is collapsed (spec D2): set only when its
// text changes, cleared once nothing needs the person. The context's percent is the band's, against the runway while
// it applies. `last` is null until the module's first call, which is always sent: a line an earlier copy of the mod
// pinned before a reload is cleared or replaced at once.
export const statusMem = { last: null as string | undefined | null }

// Whether the band is in view, as its last render found it (spec 2026-11-11, D6): it drew lines, `isCollapsed` is
// exactly false (a build before 2.1.321 hands none) and no survey covers it. One flag for the session, the last render
// deciding; the one-second tick carries a change to the pinned line.
// `isUnder` mirrors the setting for the hooks' `.catch`, which cannot read state (spec 2026-11-11 band-under U1).
// Under (U2): `columns`, the terminal site above's last `bodyColumns`; `hasFooter`, the terminal's footer hook has run
// this session, so the site above may pass; `hasStatusLine`, a `statusLine` is set, which the fullscreen budget leaves
// room for.
export const bandMem = { isShown: false, isUnder: false, columns: null as number | null, hasFooter: false, hasStatusLine: false }
