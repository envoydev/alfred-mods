// What the band shows from the session's first second (the user, 2026-11-11): the 5h and 7d windows the last reading
import type { Usage, RateWindow } from './types'
import type { SessionRateLimit } from 'claude-code'
// on this machine stored, until this session's own, and the project and branch read from git's own files, with no git
// process.

// The stored windows still ahead of their reset, with the time they were read; null for a value of any other shape, or
// with none left
export function storedWindows(value: unknown, now: number): { at: number; windows: RateWindow[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as { at?: unknown; windows?: unknown }
  if (typeof stored.at !== 'number' || !Array.isArray(stored.windows)) return null
  const windows: RateWindow[] = []
  for (const rawWindow of stored.windows as unknown[]) {
    if (typeof rawWindow !== 'object' || rawWindow === null) return null
    const windowFields = rawWindow as Record<string, unknown>
    const resetsAt = windowFields.resetsAt
    if (typeof windowFields.kind !== 'string' || typeof windowFields.percentUsed !== 'number' || typeof resetsAt !== 'string') return null
    const reset = Date.parse(resetsAt)
    if (!Number.isNaN(reset) && reset > now) windows.push({ kind: windowFields.kind, percentUsed: windowFields.percentUsed, resetsAt })
  }
  return windows.length === 0 ? null : { at: stored.at, windows }
}

// The 5h and 7d windows a reading leaves: its own when it has some or a request has been made (`isRead`: off a
// subscription a reading never has any), else the ones an earlier session stored (the user, 2026-11-11: the band from
// the first second), else none
export function nextWindows(usage: Usage, fresh: RateWindow[], isRead: boolean): Pick<Usage, 'rateWindows' | 'rateWindowsAt'> {
  if (fresh.length > 0 || isRead || usage.rateWindowsAt === undefined) return { rateWindows: fresh }
  return { rateWindows: usage.rateWindows, rateWindowsAt: usage.rateWindowsAt }
}

// The figures with each stored window whose reset has passed taken out, and the mark with the last of them; null when
// none has passed. No reading runs while idle, so the tick asks this.
export function dropPassed(usage: Usage, now: number): Usage | null {
  if (usage.rateWindowsAt === undefined) return null
  const left = usage.rateWindows.filter(rateWindow => rateWindow.resetsAt === null || !(Date.parse(rateWindow.resetsAt) <= now))
  if (left.length === usage.rateWindows.length) return null
  const { rateWindowsAt, ...rest } = usage
  return left.length === 0 ? { ...rest, rateWindows: [] } : { ...rest, rateWindows: left, rateWindowsAt }
}

// '≈' before a window's percent while it is a stored one
export const storedMark = (windowsAt: number | null | undefined): string => (windowsAt === undefined || windowsAt === null ? '' : '≈')

export const rateWindowsOf = (limits: readonly SessionRateLimit[]): RateWindow[] =>
  limits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null }))
