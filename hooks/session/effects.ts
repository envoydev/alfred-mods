// The session folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Live, Meta, Pace, Running, Totals, Turn, Usage } from './types'
import type { Place } from '../place/types'
import { setPlace } from '../place/place'

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

// The windows this session last stored for the next one, as the band shows them: a turn's measure stores them only when
// that changed, since each store write rewrites the file every session on the machine shares (the review, 2026-11-11)
export const windowsMem = { stored: null as string | null }

// When the band's figures were last read mid-turn: the tick reads them at most this often while a turn runs or an
// agent is live, since a foreground agent holds the main loop and no main step fires until it ends
export const freshMem = { at: -Infinity }

export const FRESH_EVERY_MS = 5000

// The session's cost at the main loop's turn.start, by turn id (spec C4); the main loop runs one turn at a time, so it
// holds one. A /clear empties it: a turn across it has no start read in the new session.
export const spendMem = new Map<string, number>()

// One more agent of this type spawned this session
export async function countAgentType($: EngineInterface, type: string): Promise<void> {
  await updateMeta($, m => ({ ...m, agentTypes: { ...m.agentTypes, [type]: (m.agentTypes?.[type] ?? 0) + 1 } }))
}

// The project row's place, its counts kept until the next count replaces them
export async function showPlace($: EngineInterface, place: Place): Promise<void> {
  await updateMeta($, setPlace(place))
}

// The place's uncommitted lines and its distance from upstream, written only when they moved
export async function showPlaceCounts($: EngineInterface, changes: { added: number; removed: number } | null, sync: { ahead: number; behind: number } | null): Promise<void> {
  await updateMeta($, m => {
    if (m.place === undefined) return m
    const p = m.place
    const isSame = JSON.stringify(p.changes ?? null) === JSON.stringify(changes) && JSON.stringify(p.sync ?? null) === JSON.stringify(sync)
    if (isSame) return m
    return {
      ...m,
      place: {
        project: p.project, ...(p.folder === undefined ? {} : { folder: p.folder }), branch: p.branch,
        ...(changes === null ? {} : { changes }), ...(sync === null ? {} : { sync }),
      },
    }
  })
}

// A rule the main context loaded by path, listed once
export async function addPathRule($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, m => (m.pathRules?.includes(name) === true ? m : { ...m, pathRules: [...(m.pathRules ?? []), name] }))
}

// A main-loop compaction that stands, counted
export async function noteCompaction($: EngineInterface, at: number): Promise<void> {
  await updateMeta($, m => ({ ...m, compactions: m.compactions + 1, lastCompactAt: at }))
}

// The model a switch moved to, before its first step names it
export async function setModel($: EngineInterface, model: string): Promise<void> {
  await updateMeta($, m => ({ ...m, model }))
}

// A skill the main loop loaded: in its context from then on, until the conversation starts over
export async function addSkill($: EngineInterface, name: string): Promise<void> {
  await updateMeta($, m => ({ ...m, skills: { ...m.skills, [name]: (m.skills?.[name] ?? 0) + 1 } }))
}

// A settled call off the running list, and the turn's tool and failure counts moved by it
export async function settleRunningCall($: EngineInterface, callId: string, counts: { isMain: boolean; isFirstSettle: boolean; failuresDelta: number }): Promise<void> {
  await updateLive($, l => ({
    ...l,
    tools: counts.isMain && l.turnId !== null && counts.isFirstSettle ? l.tools + 1 : l.tools,
    failures: counts.isMain && l.turnId !== null ? l.failures + counts.failuresDelta : l.failures,
    running: l.running.filter(r => r.id !== callId),
  }))
}

// One more call of the main loop
export async function countMainCall($: EngineInterface): Promise<void> {
  await updateMeta($, m => ({ ...m, mainCalls: m.mainCalls + 1 }))
}

// A main-loop call on the running list until it settles
export async function addRunningCall($: EngineInterface, call: Running): Promise<void> {
  await updateLive($, l => ({ ...l, running: [...l.running, call] }))
}
