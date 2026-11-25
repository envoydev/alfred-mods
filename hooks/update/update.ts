// The update's pure parts: which plans are live, which files move, the .gitignore test and the report lines.
// update/effects.ts lists, copies and deletes.
import { candidatesByName, isPlanDone } from '../plan/plan'
import type { Plan } from '../plan/types'
import { FILE_PLANS_FOLDER } from '../plan/constants'
import {
  CHANGED_REASON, DONE_LINE, FILE_NOUN, JSON_SUFFIX, LIST_SEPARATOR, LIVE_PLAN_MS, NOT_UTF8_REASON, NOTHING_LINE, OLD_COPY_NOUN, OLD_INSTALL_PREFIX, OLD_STATUS_DIR, PROBE_PREFIX, STATUS_CAP, STATUS_LIVE_MS, UNCHECKED_COPY_REASON,
  MORE_STATUS_NOUN, PLAN_FILE_NOUN, STATUS_FILE_NOUN, UNCHECKED_DESTINATION_REASON, UNREAD_NOTE, UNREADABLE_PLAN_NOTE,
} from './constants'
import type { CopyFailure, FolderRelation, ListedFile, LiveReason, MoveQueue } from './types'
import { isRecord } from '../core/guards'
import { SLASH } from '../setup/constants'
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

// Real paths are compared as the disk may spell them: without case (a case alias, or a Windows drive letter, keeps its
// own spelling) and with either slash. On a disk that tells case apart this can only skip a folder or keep a file.
const spellingOf = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

// A source folder is another folder only where both real paths are known and differ: a link to the chosen folder, or a
// path whose real place a hook withholds, must never have its files read as sources
export function folderRelation(source: string | undefined, chosen: string | undefined): FolderRelation {
  if (source === undefined || chosen === undefined) return 'unknown'
  return spellingOf(source) === spellingOf(chosen) ? 'same' : 'distinct'
}

// A clash is a separate copy only where the two real paths are known and differ (a hard link keeps its own spelling,
// and removing one of two links leaves the data) and the chosen copy has the size the source had when it was listed
export const isSeparateCopy = (source: string | undefined, destination: string | undefined, destinationSize: number, sourceSize: number): boolean =>
  source !== undefined && destination !== undefined && spellingOf(source) !== spellingOf(destination) && destinationSize === sourceSize

// The probe's name: the time and a token make it new on every run
export const probeName = (now: number, token: string): string => `${PROBE_PREFIX}${now}-${token}`

// Where a copy lands: `<root>/<plans|scores>/<name>.json`
export const copyPath = (root: string, kind: string, name: string): string => `${root}/${kind}/${name}${JSON_SUFFIX}`

// The folder a file is in
export const folderPathOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

const folderOf = (root: string): string => `${root}/`

// '1 file', '2 files': a count with its noun
const countOf = (count: number, noun: { readonly one: string; readonly many: string }): string => `${count} ${count === 1 ? noun.one : noun.many}`

export const movedLine = (count: number, root: string): string => `moved ${countOf(count, PLAN_FILE_NOUN)} to ${folderOf(root)}`

// An old root's files a choice other than claude-kit's does not show, and how to bring them back into view
export const ignoredLine = (count: number, root: string, folder: string): string =>
  `${countOf(count, PLAN_FILE_NOUN)} in ${folderOf(root)} ${count === 1 ? 'is' : 'are'} not shown under plansFolder "${folder}" - ${SLASH.init} ${FILE_PLANS_FOLDER} moves ${count === 1 ? 'it' : 'them'}`

export const copiedLine = (count: number, root: string, from: readonly string[]): string =>
  `copied ${countOf(count, FILE_NOUN)} to ${folderOf(root)} - remove the ${count === 1 ? OLD_COPY_NOUN.one : OLD_COPY_NOUN.many} in ${from.map(folderOf).join(LIST_SEPARATOR)} by hand`

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

export const unreadPlanLine = (name: string): string => `left in place: ${name} - ${UNREAD_NOTE}`

export const probeLeftLine = (paths: readonly string[]): string => `could not remove ${paths.join(LIST_SEPARATOR)} - delete ${paths.length === 1 ? 'it' : 'them'} by hand`

// The line for a plan that stays, by why it stays
export function leftLine(reason: LiveReason, name: string): string {
  if (reason === 'writing') return leftInPlaceLine(name)
  return reason === 'unreadable' ? unreadablePlanLine(name) : unreadPlanLine(name)
}

export const changedLine = (name: string): string => notMovedReasonLine(name, CHANGED_REASON)

export const sameFolderLine = (folder: string, chosen: string): string => `not moved: ${folderOf(folder)} is the same folder as ${folderOf(chosen)}`

export const unknownFolderLine = (folder: string, chosen: string): string =>
  `not moved: ${folderOf(folder)} - could not tell if it is the same folder as ${folderOf(chosen)}`

export const keptBothLine = (name: string): string => `kept both: ${name} (the newer one shows)`

export const gitignoreLine = (root: string): string => `added ${folderOf(root)} to .gitignore`

export const earlierChoicesLine = (fields: readonly string[]): string => `wrote your earlier choices to ${sourceFileName('user')}: ${fields.join(LIST_SEPARATOR)}`

export const oldInstallLine = (key: string): string => `an old session-inspector install is still on - claude plugin uninstall ${key}`

export const turnedOffLine = (file: string, key: string): string =>
  `turned off the old session-inspector install in ${file} - claude plugin uninstall ${key} removes its files`

export const statusRemovedLine = (count: number): string => `removed ${countOf(count, STATUS_FILE_NOUN)} from Alfred Code 3.12.1 or older`

export const statusByHandLine = (count: number): string =>
  `${countOf(count, STATUS_FILE_NOUN)} from Alfred Code 3.12.1 or older in ${folderOf(OLD_STATUS_DIR)} - delete ${count === 1 ? 'it' : 'them'} by hand`

// The stack writes this session's status file to the old folder: it is 3.12.1 or older and writes there still
export const oldStackLine = (): string => `this session's Alfred Code still writes ${folderOf(OLD_STATUS_DIR)} - update Alfred Code to 3.13 or later`

type StatusFacts = { oldFiles: readonly { name: string; mtimeMs: number }[]; now: number; own: string; hasNewFolder: boolean; isOwnInNew: boolean }

// Spec D4 step 5. A project's sessions share one installed stack, so this session's own file says which one it is: in
// the old folder and not the new, the stack is 3.12.1 or older and every old file may be live, so it is told to update
// and none is removed
const isOldStack = (o: StatusFacts): boolean => o.oldFiles.some(file => file.name === o.own) && !o.isOwnInNew

export const statusLines = (o: StatusFacts): string[] => (isOldStack(o) ? [oldStackLine()] : [])

// Otherwise the old files go once the new folder exists, this session's old copy included - but not one changed in the
// last 24 hours (`recent`: another stack, with another config folder, may still write it), and no more than the cap a
// run (`waiting`: the rest are for the next run)
export function statusPlan(o: StatusFacts): { removable: string[]; recent: number; waiting: number } {
  if (isOldStack(o) || !o.hasNewFolder) return { removable: [], recent: 0, waiting: 0 }
  const isRecent = (file: { mtimeMs: number }): boolean => o.now - file.mtimeMs < STATUS_LIVE_MS
  const eligible = o.oldFiles.filter(file => !isRecent(file)).map(file => file.name)
  return { removable: eligible.slice(0, STATUS_CAP), recent: o.oldFiles.filter(isRecent).length, waiting: Math.max(0, eligible.length - STATUS_CAP) }
}

// The old status files the run did not take: the recent ones, then the ones that wait for another run
export const statusHeldLines = (recent: number, waiting: number): string[] => [
  ...(recent > 0 ? [`${countOf(recent, STATUS_FILE_NOUN)} from Alfred Code 3.12.1 or older changed in the last 24 hours - left in place`] : []),
  ...(waiting > 0 ? [`${countOf(waiting, MORE_STATUS_NOUN)} - run ${SLASH.update} again`] : []),
]

// What the one rm did to the files it was given: the count gone, then the count still there
export const statusResultLines = (removed: number, left: number): string[] => [
  ...(removed > 0 ? [statusRemovedLine(removed)] : []),
  ...(left > 0 ? [statusByHandLine(left)] : []),
]

export const gitignoreByHandLine = (root: string): string => `could not update .gitignore - add ${folderOf(root)} by hand`

export const failureLine = (reason: string): string => `[could not update: ${reason}]`

// The run ends on `update done`, or on `nothing to update` when no step printed
export const closeReport = (lines: readonly string[]): string[] => (lines.length === 0 ? [NOTHING_LINE] : [...lines, DONE_LINE])
