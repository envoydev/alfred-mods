// The update's pure parts: which plans are live, which files move, the .gitignore test and the report lines.
// setup/effects.ts lists, copies and deletes.
import { candidatesByName, isPlanDone } from '../plan/plan'
import type { Plan } from '../plan/types'
import { DONE_LINE, LIST_SEPARATOR, LIVE_PLAN_MS, NOTHING_LINE, OLD_INSTALL_PREFIX, OLD_STATUS_DIR, SETUP_COMMAND } from './constants'
import type { ListedFile, MoveQueue } from './types'
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

export function gitignoreAppend(gitignore: string, root: string): string {
  return `${gitignore}${gitignore === '' || gitignore.endsWith('\n') ? '' : '\n'}${root}/\n`
}

// The `enabledPlugins` keys of the old plugin name that are set true
export function oldInstallKeys(enabled: unknown): string[] {
  if (!isRecord(enabled)) return []
  return Object.entries(enabled).filter(([key, value]) => key.startsWith(OLD_INSTALL_PREFIX) && value === true).map(([key]) => key)
}

// The files of one kind in the other roots: the newest file of each name is queued, a tie going to the earlier root;
// a name the chosen root holds is a clash and stays
export function moveQueue(chosenNames: ReadonlySet<string>, byFolder: ListedFile[][]): MoveQueue {
  const queue: ListedFile[] = []
  const clashes: string[] = []
  for (const [newest] of candidatesByName(byFolder)) {
    if (newest === undefined) continue
    if (chosenNames.has(newest.name)) clashes.push(newest.name)
    else queue.push(newest)
  }
  return { queue, clashes }
}

const folderOf = (root: string): string => `${root}/`

export const movedLine = (count: number, root: string): string => `moved ${count} plan and scores files to ${folderOf(root)}`

export const copiedLine = (count: number, root: string, from: readonly string[]): string =>
  `copied ${count} files to ${folderOf(root)} - remove the old copies in ${from.map(folderOf).join(LIST_SEPARATOR)} by hand`

export const leftInPlaceLine = (name: string): string => `left in place: ${name} - its writer still uses it; run /${SETUP_COMMAND} update after it finishes`

export const keptBothLine = (name: string): string => `kept both: ${name} (the newer one shows)`

export const gitignoreLine = (root: string): string => `added ${folderOf(root)} to .gitignore`

export const earlierChoicesLine = (fields: readonly string[]): string => `wrote your earlier choices to ${sourceFileName('user')}: ${fields.join(LIST_SEPARATOR)}`

export const oldInstallLine = (key: string): string => `an old session-inspector install is still on - claude plugin uninstall ${key}`

export const statusFilesLine = (count: number): string => `${count} status files from Alfred Code 3.12.1 or older in ${folderOf(OLD_STATUS_DIR)} - safe to delete`

export const gitignoreByHandLine = (root: string): string => `could not update .gitignore - add ${folderOf(root)} by hand`

export const failureLine = (reason: string): string => `[could not update: ${reason}]`

// The run ends on `update done`, or on `nothing to update` when no step printed
export const closeReport = (lines: readonly string[]): string[] => (lines.length === 0 ? [NOTHING_LINE] : [...lines, DONE_LINE])
