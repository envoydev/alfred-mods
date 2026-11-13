// The place folder's effects: what it reads and writes through $
import { readTextFile } from '../core/effects'
import { baseName, folderOf, gitDirOf, headBranch, joinPath, parentOf } from './place'
import { aheadBehind, numstatTotals, textLines, untrackedNames } from './changes'
import { readSession, showPlace, showPlaceCounts } from '../session/effects'
import type { EngineInterface } from 'claude-code'

// The HEAD file the place was read from, so the 30-second poll reads that one file for a checkout; the working folder
// it was read with, as a move to another (a `cd`, a worktree, /cd) reads the place again; and the folder it shows, the
// working folder or the folder of the file the main thread last edited or wrote
const placeMemory = { head: null as string | null, cwd: null as string | null, at: null as string | null, repo: null as string | null }

// The working folder the quiet rows read paths from, kept even when the place read is refused past it
const workingFolderMemory = { cwd: null as string | null }

// The repository's uncommitted changes for the project row (the user, 2026-11-12): `git diff --numstat HEAD` from the
// repository's folder, and each new untracked file's lines as added, the newest 200 files of 1 MiB or less, a file read
// again only when its size or time moved. Off the hooks, one count at a time; one asked for while another runs follows
// it. A refusal, a repository with no commit or a timeout leaves no counts. Nothing of a file is kept but its count.
const changesMemory = { isRunning: false, again: false, lines: new Map<string, { size: number; mtimeMs: number; lines: number }>() }

// The folder holding `.git` at or above `cwd`, and its HEAD file and branch: a worktree's `.git` is a file naming its
// git folder. No git process runs for the branch (spec: the user, 2026-11-11); the change counts run their own two.
export async function findGitHead($: EngineInterface, cwd: string): Promise<{ dir: string; head: string; branch: string | null } | null> {
  let dir: string | null = cwd
  for (let depth = 0; dir !== null && depth < 40; depth += 1, dir = parentOf(dir)) {
    const file = await readTextFile($, joinPath(dir, '.git'))
    const gitDir = file === null ? joinPath(dir, '.git') : gitDirOf(file, dir)
    if (gitDir === null) continue
    const head = joinPath(gitDir, 'HEAD')
    const text = await readTextFile($, head)
    if (text !== null) return { dir, head, branch: headBranch(text) }
  }
  return null
}

// The session's project, the folder Claude works in when it is not the project's root, and the branch of the repository
// holding that folder (the user, 2026-11-11): a Bash `cd` moves `$.session.cwd()` and leaves `$.session.root()`. With no
// root read, the project is the repository's folder or the working folder, as before. A refused read leaves no place.
export async function readPlace($: EngineInterface, edited?: string): Promise<void> {
  const cwd = await $.session.cwd()
  workingFolderMemory.cwd = cwd
  const repo = await $.session.repo()
  const root = await $.session.root().catch(() => null)
  const at = edited ?? cwd
  placeMemory.head = null
  placeMemory.cwd = cwd
  placeMemory.at = at
  const folder = root === null ? null : folderOf(at, root)
  const shown = folder === null ? {} : { folder }
  if (repo === null && folder === null) {
    placeMemory.repo = null
    await showPlace($, { project: baseName(root ?? cwd), branch: null })
    return
  }
  const found = await findGitHead($, at)
  placeMemory.head = found?.head ?? null
  placeMemory.repo = found?.dir ?? null
  countChangesSoon($)
  const project = root === null ? baseName(found?.dir ?? repo?.root ?? cwd) : baseName(root)
  await showPlace($, { project, ...shown, branch: found?.branch ?? null })
}

// A side agent's note the user passed on (2026-11-11): Claude edits by full path without a `cd`, so the folder of the
// file the main thread edited or wrote is where it works, until a `cd` moves the working folder again
export async function followEditedFile($: EngineInterface, file: string): Promise<void> {
  const path = /^([\\/]|[A-Za-z]:)/.test(file) ? file : joinPath(await $.session.cwd(), file)
  const dir = parentOf(path)
  if (dir !== null && dir !== placeMemory.at) await readPlace($, dir)
  else countChangesSoon($)
}

export function countChangesSoon($: EngineInterface): void {
  $.clock.after(0, () => {
    countChanges($).catch(() => undefined)
  })
}

export async function countChanges($: EngineInterface): Promise<void> {
  if (changesMemory.isRunning) {
    changesMemory.again = true
    return
  }
  changesMemory.isRunning = true
  try {
    do {
      changesMemory.again = false
      const changes = await readUncommittedLines($).catch(() => null)
      const sync = await readUpstreamSync($).catch(() => null)
      await showPlaceCounts($, changes, sync)
    } while (changesMemory.again)
  } finally {
    changesMemory.isRunning = false
  }
}

export async function readUncommittedLines($: EngineInterface): Promise<{ added: number; removed: number } | null> {
  const dir = placeMemory.repo
  if (dir === null) return null
  const diff = await $.process.run(['git', '--no-optional-locks', 'diff', '--numstat', 'HEAD'], { cwd: dir, timeoutMs: 2000 })
  if (diff.exitCode !== 0) return null
  const totals = numstatTotals(diff.stdout)
  const others = await $.process.run(['git', '--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: dir, timeoutMs: 2000 }).catch(() => null)
  if (others === null || others.exitCode !== 0) return totals
  const seen = new Map<string, { size: number; mtimeMs: number; lines: number }>()
  for (const name of untrackedNames(others.stdout).slice(0, 200)) {
    const path = joinPath(dir, name)
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat === null || stat.kind !== 'file' || stat.size > 1024 * 1024) continue
    const known = changesMemory.lines.get(path)
    if (known !== undefined && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
      seen.set(path, known)
      continue
    }
    const text = await $.fs.read(path).catch(() => null)
    const lines = text === null ? null : textLines(text)
    if (lines !== null) seen.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, lines })
  }
  changesMemory.lines = seen
  return { added: totals.added + [...seen.values()].reduce((sum, f) => sum + f.lines, 0), removed: totals.removed }
}

// Commits ahead of and behind the branch's upstream (the user, 2026-11-12: 'git:(band-order) arrow-up-symbol 1
// arrow-down-symbol 2'), as of the last fetch: the mod never fetches. No upstream, a detached HEAD, a refusal or a
// timeout leaves them out
export async function readUpstreamSync($: EngineInterface): Promise<{ ahead: number; behind: number } | null> {
  const dir = placeMemory.repo
  if (dir === null) return null
  const r = await $.process.run(['git', '--no-optional-locks', 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: dir, timeoutMs: 2000 })
  return r.exitCode === 0 ? aheadBehind(r.stdout) : null
}

// A checkout since: the poll reads the HEAD file the place came from, and counts the changes again
export async function pollPlace($: EngineInterface): Promise<void> {
  if (placeMemory.cwd !== null && (await $.session.cwd()) !== placeMemory.cwd) return readPlace($)
  countChangesSoon($)
  const head = placeMemory.head
  if (head === null) return
  const text = await readTextFile($, head)
  const place = (await readSession($)).place
  if (text !== null && place !== undefined) await showPlace($, { ...place, branch: headBranch(text) })
}

// The working folder the quiet rows read paths from
export function workingFolder(): string | null {
  return workingFolderMemory.cwd
}
