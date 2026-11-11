// What the band shows from the session's first second (the user, 2026-11-11): the 5h and 7d windows the last reading
// on this machine stored, until this session's own, and the project and branch read from git's own files, with no git
// process.
import type { Usage, Window } from '../types'

// The stored windows still ahead of their reset, with the time they were read; null for a value of any other shape, or
// with none left
export function storedWindows(value: unknown, now: number): { at: number; windows: Window[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { at?: unknown; windows?: unknown }
  if (typeof v.at !== 'number' || !Array.isArray(v.windows)) return null
  const windows: Window[] = []
  for (const w of v.windows as unknown[]) {
    if (typeof w !== 'object' || w === null) return null
    const x = w as Record<string, unknown>
    const resetsAt = x.resetsAt
    if (typeof x.kind !== 'string' || typeof x.percentUsed !== 'number' || typeof resetsAt !== 'string') return null
    const reset = Date.parse(resetsAt)
    if (!Number.isNaN(reset) && reset > now) windows.push({ kind: x.kind, percentUsed: x.percentUsed, resetsAt })
  }
  return windows.length === 0 ? null : { at: v.at, windows }
}

// The 5h and 7d windows a reading leaves: its own when it has some or a request has been made (`isRead`: off a
// subscription a reading never has any), else the ones an earlier session stored (the user, 2026-11-11: the band from
// the first second), else none
export function nextWindows(u: Usage, fresh: Window[], isRead: boolean): Pick<Usage, 'windows' | 'windowsAt'> {
  if (fresh.length > 0 || isRead || u.windowsAt === undefined) return { windows: fresh }
  return { windows: u.windows, windowsAt: u.windowsAt }
}

// The figures with each stored window whose reset has passed taken out, and the mark with the last of them; null when
// none has passed. No reading runs while idle, so the tick asks this.
export function dropPassed(u: Usage, now: number): Usage | null {
  if (u.windowsAt === undefined) return null
  const left = u.windows.filter(w => w.resetsAt === null || !(Date.parse(w.resetsAt) <= now))
  if (left.length === u.windows.length) return null
  const { windowsAt, ...rest } = u
  return left.length === 0 ? { ...rest, windows: [] } : { ...rest, windows: left, windowsAt }
}

// The branch a HEAD file names, or a detached commit's first 7 characters; null for anything else
export function headBranch(text: string): string | null {
  const t = text.trim()
  const ref = /^ref: refs\/heads\/(.+)$/.exec(t)
  if (ref !== null) return ref[1] ?? null
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(t) ? t.slice(0, 7) : null
}

// A worktree's `.git` file names its git folder, absolute or relative to the folder the file sits in
export function gitDirOf(text: string, dir: string): string | null {
  const m = /^gitdir:\s*(.+)$/m.exec(text)
  const to = m?.[1]?.trim()
  if (to === undefined || to === '') return null
  return /^([A-Za-z]:)?[\\/]/.test(to) ? to : `${dir}/${to}`
}

export const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

// The folder above, or null at a root
export function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0 || trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return null
  return cut === 0 ? '/' : trimmed.slice(0, cut)
}

// '≈' before a window's percent while it is a stored one
export const storedMark = (windowsAt: number | null | undefined): string => (windowsAt === undefined || windowsAt === null ? '' : '≈')
