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
