// The cache folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Cache } from './types'

const INITIAL_CACHE: Cache = {
  tier: null, tierAt: null, tierBilling: null,
  config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 }, toastedFor: null,
}
const cacheAtom = atom({ plugin: 'alfred-mods', key: 'cache' } as const, INITIAL_CACHE, { shape: 'cache-1' })
export function readCache($: EngineInterface) {
  return read($, cacheAtom)
}
export function updateCache($: EngineInterface, change: (value: Cache) => Cache) {
  return update($, cacheAtom, change)
}
export function resetCache($: EngineInterface) {
  return update($, cacheAtom, () => INITIAL_CACHE)
}
