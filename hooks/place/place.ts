// The project and branch read from git's own files, with no git process, and the folder Claude works in (the user,
// 2026-11-11)
import type { Meta } from '../session/types'

// The branch a HEAD file names, or a detached commit's first 7 characters; null for anything else
export function headBranch(text: string): string | null {
  const t = text.trim()
  const ref = /^ref: refs\/heads\/(.+)$/.exec(t)
  if (ref !== null) return ref[1] ?? null
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(t) ? t.slice(0, 7) : null
}

// A worktree's `.git` file names its git folder, absolute or relative to the folder the file sits in
export function gitDirOf(text: string, dir: string): string | null {
  const match = /^gitdir:\s*(.+)$/m.exec(text)
  const to = match?.[1]?.trim()
  if (to === undefined || to === '') return null
  return /^([A-Za-z]:)?[\\/]/.test(to) ? to : `${dir}/${to}`
}

export const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

// The folder Claude works in against the session's project root (the user, 2026-11-11): inside it the path from the
// root, the root itself none, elsewhere '…/<its name>', so no path above the project (a home folder, a user name) is
// kept. A Windows path compares without case.
export function folderOf(cwd: string, root: string): string | null {
  const trim = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const c = trim(cwd)
  const r = trim(root)
  const fold = (p: string): string => (/^[A-Za-z]:/.test(c) ? p.toLowerCase() : p)
  if (fold(c) === fold(r)) return null
  if (fold(c).startsWith(`${fold(r)}/`)) return c.slice(r.length + 1)
  return `…/${baseName(cwd)}`
}

// The folder above, or null at a root
export function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0 || trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return null
  return cut === 0 ? '/' : trimmed.slice(0, cut)
}

export const joinPath = (dir: string, name: string): string => (/[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}/${name}`)

// The counts stay until the next count replaces them
export const withPlace = (place: NonNullable<Meta['place']>) => (session: Meta): Meta =>
  session.place?.project === place.project && session.place.folder === place.folder && session.place.branch === place.branch ? session
    : { ...session, place: { ...place, ...(session.place?.changes === undefined ? {} : { changes: session.place.changes }), ...(session.place?.sync === undefined ? {} : { sync: session.place.sync }) } }
