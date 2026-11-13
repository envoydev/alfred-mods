// The session folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Live, Meta, Pace, Totals, Turn, Usage } from './types'

const INITIAL_TURNS: Turn[] = []
const turnsAtom = atom({ plugin: 'alfred-mods', key: 'turns' } as const, INITIAL_TURNS, { shape: 'turns-1' })
export function readTurns($: EngineInterface) {
  return read($, turnsAtom)
}
export function updateTurns($: EngineInterface, change: (value: Turn[]) => Turn[]) {
  return update($, turnsAtom, change)
}
export function resetTurns($: EngineInterface) {
  return update($, turnsAtom, () => INITIAL_TURNS)
}

const INITIAL_LIVE: Live = { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null }
const liveAtom = atom({ plugin: 'alfred-mods', key: 'live' } as const, INITIAL_LIVE, { shape: 'live-3' })
export function readLive($: EngineInterface) {
  return read($, liveAtom)
}
export function updateLive($: EngineInterface, change: (value: Live) => Live) {
  return update($, liveAtom, change)
}
export function resetLive($: EngineInterface) {
  return update($, liveAtom, () => INITIAL_LIVE)
}

const INITIAL_USAGE: Usage = {
  tokens: null, window: null, percent: null, startedAt: null, windows: [], costUsd: null, todayUsd: null, at: 0,
}
const usageAtom = atom({ plugin: 'alfred-mods', key: 'usage' } as const, INITIAL_USAGE, { shape: 'usage-1' })
export function readUsage($: EngineInterface) {
  return read($, usageAtom)
}
export function updateUsage($: EngineInterface, change: (value: Usage) => Usage) {
  return update($, usageAtom, change)
}
export function resetUsage($: EngineInterface) {
  return update($, usageAtom, () => INITIAL_USAGE)
}

const INITIAL_TOTALS: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 0, stepMs: 0 }
const totalsAtom = atom({ plugin: 'alfred-mods', key: 'totals' } as const, INITIAL_TOTALS, { shape: 'totals-1' })
export function readTotals($: EngineInterface) {
  return read($, totalsAtom)
}
export function updateTotals($: EngineInterface, change: (value: Totals) => Totals) {
  return update($, totalsAtom, change)
}
export function resetTotals($: EngineInterface) {
  return update($, totalsAtom, () => INITIAL_TOTALS)
}

const INITIAL_META: Meta = {
  model: null, effort: null, compactions: 0, lastCompactAt: null, lastPromptAt: null, lastReplyAt: null, turnCount: 0,
  waiting: [], mainCalls: 0,
}
const metaAtom = atom({ plugin: 'alfred-mods', key: 'meta' } as const, INITIAL_META, { shape: 'meta-3' })
export function readMeta($: EngineInterface) {
  return read($, metaAtom)
}
export function updateMeta($: EngineInterface, change: (value: Meta) => Meta) {
  return update($, metaAtom, change)
}
export function resetMeta($: EngineInterface) {
  return update($, metaAtom, () => INITIAL_META)
}

const INITIAL_PACE: Pace = {}
const paceAtom = atom({ plugin: 'alfred-mods', key: 'pace' } as const, INITIAL_PACE, { shape: 'pace-1' })
export function readPace($: EngineInterface) {
  return read($, paceAtom)
}
export function updatePace($: EngineInterface, change: (value: Pace) => Pace) {
  return update($, paceAtom, change)
}
export function resetPace($: EngineInterface) {
  return update($, paceAtom, () => INITIAL_PACE)
}

const tickAtom = atom({ plugin: 'alfred-mods', key: 'tick' } as const, 0)
export function readTick($: EngineInterface) {
  return read($, tickAtom)
}
export function updateTick($: EngineInterface, change: (value: number) => number) {
  return update($, tickAtom, change)
}
