// Today's cost across sessions, in $.store: one key per session and day, `cost:<date>:<session id>`, in whole
// micro-dollars so sums are exact, and `cost-last:<session id>`, the session's last reading. Kept 7 days.
// The rules are pure functions over the store's entries; the functions taking `$` only read and write them.
import type { EngineInterface } from 'claude-code'

import { localDate } from './forecast.ts'

export type Entries = Record<string, unknown>
type Last = { micros: number; at: number }

const DAY = 86_400_000

const lastOf = (entries: Entries, sessionId: string): Last | undefined => entries[`cost-last:${sessionId}`] as Last | undefined

// A session first seen after a /clear, a resume or a start takes its first reading as the baseline, so spend that
// carries over is not counted twice
export function baseWrites(entries: Entries, sessionId: string, usd: number, now: number): Entries {
  return lastOf(entries, sessionId) === undefined ? { [`cost-last:${sessionId}`]: { micros: Math.round(usd * 1e6), at: now } } : {}
}

// Adds what the session spent since its last reading to the day; a cost that started over adds its whole reading
export function recordWrites(entries: Entries, sessionId: string, usd: number, now: number): Entries {
  const micros = Math.round(usd * 1e6)
  const before = lastOf(entries, sessionId)?.micros ?? 0
  const day = `cost:${localDate(now)}:${sessionId}`
  return {
    [day]: Number(entries[day] ?? 0) + (micros >= before ? micros - before : micros),
    [`cost-last:${sessionId}`]: { micros, at: now },
  }
}

export function dayUsd(entries: Entries, now: number): number {
  const prefix = `cost:${localDate(now)}:`
  return Object.entries(entries).reduce((sum, [key, v]) => (key.startsWith(prefix) ? sum + Number(v ?? 0) : sum), 0) / 1e6
}

// Day keys dated more than 7 days back, and last readings taken more than 7 days back
export function staleKeys(entries: Entries, now: number): string[] {
  const oldest = localDate(now - 7 * DAY)
  return Object.entries(entries)
    .filter(([key, v]) => key.startsWith('cost:') ? (key.split(':')[1] ?? '') < oldest
      : key.startsWith('cost-last:') && ((v as Last | undefined)?.at ?? 0) < now - 7 * DAY)
    .map(([key]) => key)
}

// The cost keys `keep` names, with their values; no other value is read, as the store holds 7 days of sessions
async function readEntries($: EngineInterface, keep: (key: string) => boolean): Promise<Entries> {
  const entries: Entries = {}
  for (const key of await $.store.keys()) {
    if (keep(key)) entries[key] = await $.store.get(key)
  }
  return entries
}

async function writeEntries($: EngineInterface, writes: Entries): Promise<void> {
  for (const [key, value] of Object.entries(writes)) await $.store.set(key, value)
}

export async function baseCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  await writeEntries($, baseWrites(await readEntries($, key => key === last), sessionId, usd, now))
}

export async function recordCost($: EngineInterface, sessionId: string, usd: number, now: number): Promise<void> {
  const last = `cost-last:${sessionId}`
  const day = `cost:${localDate(now)}:${sessionId}`
  await writeEntries($, recordWrites(await readEntries($, key => key === last || key === day), sessionId, usd, now))
}

export async function todayUsd($: EngineInterface, now: number): Promise<number> {
  const prefix = `cost:${localDate(now)}:`
  return dayUsd(await readEntries($, key => key.startsWith(prefix)), now)
}

// A day key is judged by its date alone; a last reading by when it was taken
export async function pruneCost($: EngineInterface, now: number): Promise<void> {
  const entries: Entries = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('cost:')) entries[key] = null
    else if (key.startsWith('cost-last:')) entries[key] = await $.store.get(key)
  }
  for (const key of staleKeys(entries, now)) await $.store.delete(key)
}
