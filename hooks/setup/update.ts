// The update's pure parts: which plans are live, which files move, the .gitignore test and the report lines.
// setup/effects.ts lists, copies and deletes.
import { candidatesByName, isPlanDone } from '../plan/plan'
import type { Plan } from '../plan/types'
import {
  DONE_LINE, JSON_SUFFIX, LIST_SEPARATOR, LIVE_PLAN_MS, NOT_UTF8_REASON, NOTHING_LINE, OLD_INSTALL_PREFIX, OLD_STATUS_DIR, SLASH, UNCHECKED_COPY_REASON,
  UNCHECKED_DESTINATION_REASON,
} from './constants'
import type { CopyFailure, ListedFile, MoveQueue } from './types'
import { isRecord } from '../core/guards'
import { sourceFileName } from '../settings/settings'

// A plan that does not parse is live; one with a step not done is live while its file is under 24 hours old: its
// writer still edits it in place
export function isLivePlan(plan: Plan | null, mtimeMs: number, now: number): boolean {
  return plan === null || (!isPlanDone(plan) && now - mtimeMs < LIVE_PLAN_MS)
}

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

export const keptBothLine = (name: string): string => `kept both: ${name} (the newer one shows)`

export const gitignoreLine = (root: string): string => `added ${folderOf(root)} to .gitignore`

export const earlierChoicesLine = (fields: readonly string[]): string => `wrote your earlier choices to ${sourceFileName('user')}: ${fields.join(LIST_SEPARATOR)}`

export const oldInstallLine = (key: string): string => `an old session-inspector install is still on - claude plugin uninstall ${key}`

export const statusFilesLine = (count: number): string => `${count} status files from Alfred Code 3.12.1 or older in ${folderOf(OLD_STATUS_DIR)} - safe to delete`

export const gitignoreByHandLine = (root: string): string => `could not update .gitignore - add ${folderOf(root)} by hand`

export const failureLine = (reason: string): string => `[could not update: ${reason}]`

// The run ends on `update done`, or on `nothing to update` when no step printed
export const closeReport = (lines: readonly string[]): string[] => (lines.length === 0 ? [NOTHING_LINE] : [...lines, DONE_LINE])
