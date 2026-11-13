// Today's cost across sessions, in $.store: one key per session and day, `cost:<date>:<session id>`, in whole
// micro-dollars so sums are exact, and `cost-last:<session id>`, the session's last reading. Kept 7 days.
// The rules are pure functions over the store's entries; session/effects.ts reads and writes them.
import { localDate } from '../core/forecast'
import type { CostEntries } from './types'

type Last = { micros: number; at: number }

const DAY = 86_400_000

const lastOf = (entries: CostEntries, sessionId: string): Last | undefined => entries[`cost-last:${sessionId}`] as Last | undefined

// A session first seen after a /clear, a resume or a start takes its first reading as the baseline, so spend that
// carries over is not counted twice
export function baseWrites(entries: CostEntries, sessionId: string, usd: number, now: number): CostEntries {
  return lastOf(entries, sessionId) === undefined ? { [`cost-last:${sessionId}`]: { micros: Math.round(usd * 1e6), at: now } } : {}
}

// Adds what the session spent since its last reading to the day; a cost that started over adds its whole reading
export function recordWrites(entries: CostEntries, sessionId: string, usd: number, now: number): CostEntries {
  const micros = Math.round(usd * 1e6)
  const before = lastOf(entries, sessionId)?.micros ?? 0
  const day = `cost:${localDate(now)}:${sessionId}`
  return {
    [day]: Number(entries[day] ?? 0) + (micros >= before ? micros - before : micros),
    [`cost-last:${sessionId}`]: { micros, at: now },
  }
}

export function dayUsd(entries: CostEntries, now: number): number {
  const prefix = `cost:${localDate(now)}:`
  return Object.entries(entries).reduce((sum, [key, v]) => (key.startsWith(prefix) ? sum + Number(v ?? 0) : sum), 0) / 1e6
}

// Day keys dated more than 7 days back, and last readings taken more than 7 days back
export function staleKeys(entries: CostEntries, now: number): string[] {
  const oldest = localDate(now - 7 * DAY)
  return Object.entries(entries)
    .filter(([key, v]) => key.startsWith('cost:') ? (key.split(':')[1] ?? '') < oldest
      : key.startsWith('cost-last:') && ((v as Last | undefined)?.at ?? 0) < now - 7 * DAY)
    .map(([key]) => key)
}
