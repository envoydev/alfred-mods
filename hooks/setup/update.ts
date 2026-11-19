// The update's pure parts: which plans are live, which files move, the .gitignore test and the report lines.
// setup/effects.ts lists, copies and deletes.
import { candidatesByName, isPlanDone } from '../plan/plan'
import type { Plan } from '../plan/types'
import {
  CHANGED_REASON, DONE_LINE, JSON_SUFFIX, LIST_SEPARATOR, LIVE_PLAN_MS, NOT_UTF8_REASON, NOTHING_LINE, OLD_INSTALL_PREFIX, OLD_STATUS_DIR, SLASH, UNCHECKED_COPY_REASON,
  UNCHECKED_DESTINATION_REASON, UNREADABLE_PLAN_NOTE,
} from './constants'
import type { CopyFailure, FolderRelation, ListedFile, LiveReason, MoveQueue } from './types'
import { isRecord } from '../core/guards'
import { sourceFileName } from '../settings/settings'

// Why a plan stays, or null when it moves. A plan with a step not done stays while its file is under 24 hours old: its
// writer still edits it in place. A plan that does not parse stays for safety, as a writer may be mid-write: within the
// window it waits for its writer, and past it only the person can settle it.
export function liveReason(plan: Plan | null, mtimeMs: number, now: number): LiveReason | null {
  const isInWindow = now - mtimeMs < LIVE_PLAN_MS
  if (plan === null) return isInWindow ? 'writing' : 'unreadable'
  return !isPlanDone(plan) && isInWindow ? 'writing' : null
}

export const isLivePlan = (plan: Plan | null, mtimeMs: number, now: number): boolean => liveReason(plan, mtimeMs, now) !== null

const trimmedLine = (line: string): string => line.trim().replace(/^\//, '').replace(/\/$/, '')

// A line of the .gitignore covers the root when it names the root or a folder above it; a comment names nothing
export function coversRoot(gitignore: string, root: string): boolean {
  const parts = root.split('/')
  const covered = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
  return gitignore.split('\n').some(line => !line.trim().startsWith('#') && covered.includes(trimmedLine(line)))
}

// The line goes in with the file's own line ending
export function gitignoreAppend(gitignore: string, root: string): string {
  const ending = gitignore.includes('\r\n') ? '\r\n' : '\n'
  return `${gitignore}${gitignore === '' || gitignore.endsWith('\n') ? '' : ending}${root}/${ending}`
}

// `$.fs.read` decodes a file as UTF-8 text, and a byte that is not UTF-8 may come back changed; text of the listed size
// in bytes is the file as it was
export const isUtf8Text = (text: string, size: number): boolean => new TextEncoder().encode(text).length === size

// The `enabledPlugins` keys of the old plugin name that are set true
export function oldInstallKeys(enabled: unknown): string[] {
  if (!isRecord(enabled)) return []
  return Object.entries(enabled).filter(([key, value]) => key.startsWith(OLD_INSTALL_PREFIX) && value === true).map(([key]) => key)
}

// The files of one kind in the other roots: the newest file of each name is queued, oldest first so the moved files
// keep their order, a tie going to the earlier root. A name the chosen root holds is set aside, its newest file listed
// in `clashed`: it stays. `listed` is every file seen.
export function moveQueue(chosenNames: ReadonlySet<string>, byFolder: ListedFile[][]): MoveQueue {
  const queue: ListedFile[] = []
  const clashed: ListedFile[] = []
  for (const [newest] of candidatesByName(byFolder)) {
    if (newest === undefined) continue
    if (chosenNames.has(newest.name)) clashed.push(newest)
    else queue.push(newest)
  }
  return { queue: queue.sort((first, second) => first.mtimeMs - second.mtimeMs), clashed, listed: byFolder.flat() }
}

// A source folder is another folder only where both real paths are known and differ: a link to the chosen folder, or a
// path whose real place a hook withholds, must never have its files read as sources
export function folderRelation(source: string | undefined, chosen: string | undefined): FolderRelation {
  if (source === undefined || chosen === undefined) return 'unknown'
  return source === chosen ? 'same' : 'distinct'
}

// A clash is a separate copy only where the two real paths are known and differ (a hard link keeps its own spelling,
// and removing one of two links leaves the data) and the chosen copy has the size the source had when it was listed
export const isSeparateCopy = (source: string | undefined, destination: string | undefined, destinationSize: number, sourceSize: number): boolean =>
  source !== undefined && destination !== undefined && source !== destination && destinationSize === sourceSize

// Where a copy lands: `<root>/<plans|scores>/<name>.json`
export const copyPath = (root: string, kind: string, name: string): string => `${root}/${kind}/${name}${JSON_SUFFIX}`

// The folder a file is in
export const folderPathOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

const folderOf = (root: string): string => `${root}/`

export const movedLine = (count: number, root: string): string => `moved ${count} plan and scores files to ${folderOf(root)}`

export const copiedLine = (count: number, root: string, from: readonly string[]): string =>
  `copied ${count} files to ${folderOf(root)} - remove the old copies in ${from.map(folderOf).join(LIST_SEPARATOR)} by hand`

export const leftInPlaceLine = (name: string): string => `left in place: ${name} - its writer still uses it; run ${SLASH.update} after it finishes`

export const notMovedLine = (name: string, root: string, kind: string): string =>
  `not moved: ${name} - its copy did not read back equal; check ${folderOf(`${root}/${kind}`)}`

export const notMovedReasonLine = (name: string, reason: string): string => `not moved: ${name} - ${reason}`

export const notUtf8Line = (name: string): string => notMovedReasonLine(name, NOT_UTF8_REASON)

// The line for a copy that did not end whole: what to check depends on what failed
export const copyFailureLine = (result: CopyFailure, name: string, root: string, kind: string): string => {
  if (result === 'differs') return notMovedLine(name, root, kind)
  return notMovedReasonLine(name, result === 'unchecked' ? UNCHECKED_DESTINATION_REASON : UNCHECKED_COPY_REASON)
}

export const unreadablePlanLine = (name: string): string => `left in place: ${name} - ${UNREADABLE_PLAN_NOTE}`

export const changedLine = (name: string): string => notMovedReasonLine(name, CHANGED_REASON)

export const sameFolderLine = (folder: string, chosen: string): string => `not moved: ${folderOf(folder)} is the same folder as ${folderOf(chosen)}`

export const unknownFolderLine = (folder: string, chosen: string): string =>
  `not moved: ${folderOf(folder)} - could not tell if it is the same folder as ${folderOf(chosen)}`

export const keptBothLine = (name: string): string => `kept both: ${name} (the newer one shows)`

export const gitignoreLine = (root: string): string => `added ${folderOf(root)} to .gitignore`

export const earlierChoicesLine = (fields: readonly string[]): string => `wrote your earlier choices to ${sourceFileName('user')}: ${fields.join(LIST_SEPARATOR)}`

export const oldInstallLine = (key: string): string => `an old session-inspector install is still on - claude plugin uninstall ${key}`

export const statusFilesLine = (count: number): string => `${count} status files from Alfred Code 3.12.1 or older in ${folderOf(OLD_STATUS_DIR)} - safe to delete`

export const gitignoreByHandLine = (root: string): string => `could not update .gitignore - add ${folderOf(root)} by hand`

export const failureLine = (reason: string): string => `[could not update: ${reason}]`

// The run ends on `update done`, or on `nothing to update` when no step printed
export const closeReport = (lines: readonly string[]): string[] => (lines.length === 0 ? [NOTHING_LINE] : [...lines, DONE_LINE])
