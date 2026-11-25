// The update's effects: '/alfred-mods:update' lists, copies and deletes the files its pure parts decide on, and reports
import type { EngineInterface } from 'claude-code'
import { oneLine } from '../core/format'
import { FILE_PLANS_FOLDER, PLANS_ROOTS, PLANS_SUBFOLDER, SCORES_SUBFOLDER } from '../plan/constants'
import { noteMovedFiles, originalMtime } from '../planfiles/effects'
import { parsePlan, plansRoots } from '../plan/plan'
import type { PlansFolder } from '../plan/types'
import { resolvedSettings, userSettingsPath, writeUserFieldResult } from '../settings/effects'
import { DEFAULTS, FIELDS, sourceFileName } from '../settings/settings'
import type { Source } from '../settings/types'
import {
  ENABLED_PLUGINS_KEY, GITIGNORE_FILE, JSON_SUFFIX, LOCKED_SOURCES, MORE_LINE, MOVE_CAP, NEW_STATUS_DIR, OLD_STATUS_DIR, PROBE_NAME_TRIES, PROBE_TEXT, REASON_MAX, RM_ARGV,
  RM_TIMEOUT_MS, WRITABLE_SOURCES,
} from './constants'
import { switchOffPlugin } from './enabled'
import type { Copy, CopyResult, ListedFile, LiveReason } from './types'
import {
  changedLine, closeReport, copiedLine, copyFailureLine, copyPath, coversRoot, earlierChoicesLine, failureLine, folderPathOf, folderRelation, gitignoreAppend,
  gitignoreByHandLine, gitignoreLine, isSeparateCopy, isUtf8Text, keptBothLine, leftLine, liveReason, movedLine, moveQueue, notUtf8Line, oldInstallKeys,
  oldInstallLine, probeLeftLine, probeName, sameFolderLine, statusHeldLines, statusLines, statusPlan, statusResultLines, turnedOffLine, unknownFolderLine,
} from './update'

const isJsonFile = (entry: { kind: string; name: string }): boolean => entry.kind === 'file' && entry.name.endsWith(JSON_SUFFIX)

// A missing folder is empty. A file an earlier update copied lists with its source's time, so a second move reads an
// abandoned plan as the abandoned plan it is; `diskMtimeMs` stays the file's own, for the check before the rm.
async function listKind($: EngineInterface, root: string, kind: string): Promise<ListedFile[]> {
  const dir = `${root}/${kind}`
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.filter(isJsonFile).map(entry => {
    const path = `${dir}/${entry.name}`
    return { name: entry.name.slice(0, -JSON_SUFFIX.length), kind, root, path, mtimeMs: originalMtime(path, entry.mtimeMs, entry.size), diskMtimeMs: entry.mtimeMs, size: entry.size }
  })
}

// Where a folder lands, once every link is followed: not there, or with no real path when a hook withholds it
async function realFolder($: EngineInterface, path: string): Promise<{ isThere: boolean; real: string | undefined }> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => null)
  return stat === null ? { isThere: false, real: undefined } : { isThere: true, real: stat.realPath }
}

// The files of one kind in the other roots, and the lines for a folder that is skipped whole: one that is the chosen
// folder under another name (a link to it), or whose real path cannot be told, is never a source, as its files would be
// removed as copies of themselves. Its files are listed apart, for the plans a skipped folder holds still say whether
// the scores beside them stay.
async function queueOf($: EngineInterface, kind: string, chosenRoot: string, others: readonly string[]) {
  const chosenFolder = `${chosenRoot}/${kind}`
  const chosenReal = await realFolder($, chosenFolder)
  const chosen = new Set((await listKind($, chosenRoot, kind)).map(file => file.name))
  const byFolder: ListedFile[][] = []
  const skipped: ListedFile[] = []
  const lines: string[] = []
  for (const root of others) {
    const folder = `${root}/${kind}`
    const source = chosenReal.isThere ? await realFolder($, folder) : null
    const relation = source === null || !source.isThere ? 'distinct' : folderRelation(source.real, chosenReal.real)
    if (relation === 'distinct') {
      byFolder.push(await listKind($, root, kind))
      continue
    }
    skipped.push(...(await listKind($, root, kind)))
    lines.push(relation === 'same' ? sameFolderLine(folder, chosenFolder) : unknownFolderLine(folder, chosenFolder))
  }
  return { queue: moveQueue(chosen, byFolder), skipped, lines }
}

// What stops a write: a file there already, or a check that cannot answer
async function destinationBlock($: EngineInterface, destination: string): Promise<'exists' | 'unchecked' | null> {
  const exists = await $.fs.exists(destination).then(found => found, () => null)
  if (exists === null) return 'unchecked'
  return exists ? 'exists' : null
}

// One file into the chosen root, read back. A name that has a file in the chosen root by now is never written over, and
// neither is one whose check fails. A copy that read back equal is noted at once, so a listing before the rm sees its
// source's time; one that cannot be stat-ed is not noted and its source stays. A destination that does not read back
// equal is left as found: someone else wrote it.
async function copyFile($: EngineInterface, copy: Copy, text: string): Promise<CopyResult> {
  const blocked = await destinationBlock($, copy.destination)
  if (blocked !== null) return blocked
  try {
    await $.fs.write(copy.destination, text)
    if ((await $.fs.read(copy.destination)) !== text) return 'differs'
  } catch {
    return 'differs'
  }
  const stat = await $.fs.stat(copy.destination).catch(() => null)
  if (stat === null) return 'unstatted'
  noteMovedFiles([{ path: copy.destination, mtimeMs: copy.file.mtimeMs, copyMtimeMs: stat.mtimeMs, copySize: stat.size }])
  return 'copied'
}

// Each file to remove is stat-ed again: one whose size or own mtimeMs moved was written after the check and stays
async function unchangedSince($: EngineInterface, checked: readonly ListedFile[]): Promise<ListedFile[]> {
  const kept: ListedFile[] = []
  for (const file of checked) {
    const stat = await $.fs.stat(file.path).catch(() => null)
    if (stat !== null && stat.size === file.size && stat.mtimeMs === file.diskMtimeMs) kept.push(file)
  }
  return kept
}

// The one rm of a run, of every source that is whole in the chosen root and did not change, with the probe files and
// the old status files (`extras`, named by the status step after the run); never of a destination. Where it rejects or
// exits non-zero it may have removed some: what is still there is named, the sources to remove by hand and the probes to
// delete.
async function removeSources(
  $: EngineInterface, chosenRoot: string, sources: readonly ListedFile[], probes: readonly string[], extras: readonly string[],
): Promise<string[]> {
  if (sources.length === 0 && probes.length === 0 && extras.length === 0) return []
  const paths = [...sources.map(file => file.path), ...probes, ...extras]
  const ran = await $.process.run([...RM_ARGV, ...paths], { timeoutMs: RM_TIMEOUT_MS }).catch(() => null)
  if (ran !== null && ran.exitCode === 0) return sources.length === 0 ? [] : [movedLine(sources.length, chosenRoot)]
  const staying = new Set<string>()
  for (const path of paths) if (await $.fs.exists(path).then(found => found, () => true)) staying.add(path)
  const kept = sources.filter(file => staying.has(file.path))
  const keptProbes = probes.filter(path => staying.has(path))
  return [
    ...(kept.length < sources.length ? [movedLine(sources.length - kept.length, chosenRoot)] : []),
    ...(kept.length > 0 ? [copiedLine(kept.length, chosenRoot, [...new Set(kept.map(file => folderPathOf(file.path)))])] : []),
    ...(keptProbes.length > 0 ? [probeLeftLine(keptProbes)] : []),
  ]
}

// A probe name no file has, tried again once when taken; a check that cannot answer counts as taken
async function freeProbeName($: EngineInterface, folder: string, makeName: () => string): Promise<string | null> {
  for (let tries = 0; tries < PROBE_NAME_TRIES; tries++) {
    const name = makeName()
    if (!(await $.fs.exists(`${folder}/${name}`).then(found => found, () => true))) return name
  }
  return null
}

// Whether rm runs here: with no path it removes nothing and exits 0. It is missing on most Windows machines, and a probe
// the run cannot remove would stay in the chosen folder, one more each run (seen on Windows 11, 2026-11-19).
async function canRemove($: EngineInterface): Promise<boolean> {
  return (await $.process.run([...RM_ARGV], { timeoutMs: RM_TIMEOUT_MS }).catch(() => null))?.exitCode === 0
}

// What a real path cannot show - a case alias, a bind mount, a firmlink keep a path of their own - a file can: one
// written into each chosen folder is looked for in each source folder that holds equal copies. Found there, that folder
// is the chosen one under another name; a check that cannot answer, a name that stays taken or a write that fails keeps
// its copies. `proven` are the copies in a folder the probe is not in.
async function probeFolders($: EngineInterface, chosenRoot: string, makeName: () => string, equal: readonly ListedFile[], isBroken: boolean, canRm: () => Promise<boolean>) {
  const out = { proven: [] as ListedFile[], kept: [] as ListedFile[], lines: [] as string[], probes: [] as string[], isBroken }
  if (equal.length === 0) return out
  const kind = equal[0]?.kind ?? ''
  const name = isBroken || !(await canRm()) ? null : await freeProbeName($, `${chosenRoot}/${kind}`, makeName)
  const probe = `${chosenRoot}/${kind}/${name ?? ''}`
  if (name === null || !(await $.fs.write(probe, PROBE_TEXT).then(() => true, () => false))) {
    out.isBroken = true
    out.kept.push(...equal)
    return out
  }
  out.probes.push(probe)
  for (const folder of new Set(equal.map(file => folderPathOf(file.path)))) {
    const inFolder = equal.filter(file => folderPathOf(file.path) === folder)
    const isHere = await $.fs.exists(`${folder}/${name}`).then(found => found, () => null)
    if (isHere === false) out.proven.push(...inFolder)
    else out.kept.push(...(isHere === null ? inFolder : []))
    if (isHere === true) out.lines.push(sameFolderLine(folder, `${chosenRoot}/${kind}`))
  }
  return out
}

// Two files that are not one file under two names: both real paths known and different, and the chosen copy as large as
// the source was listed. A hard link keeps its own spelling and removing one link leaves the data.
async function isSeparate($: EngineInterface, source: ListedFile, destination: string): Promise<boolean> {
  const sourceStat = await $.fs.stat(source.path, { resolve: true }).catch(() => null)
  const destinationStat = await $.fs.stat(destination, { resolve: true }).catch(() => null)
  if (sourceStat === null || destinationStat === null) return false
  return isSeparateCopy(sourceStat.realPath, destinationStat.realPath, destinationStat.size, source.size)
}

// Spec D4 step 1: the plans and scores of the other roots copied into the chosen one, oldest first, then one rm of the
// sources. A plan whose writer still uses it stays, and so do the scores beside it in its own root; scores also stay
// with a plan that did not move; a name the chosen root holds stays unless its copy there is a separate, byte-equal
// file; only a file that would be copied counts toward the cap, past which the rest wait.
async function moveFiles($: EngineInterface, folder: PlansFolder, extras: readonly string[], canRm: () => Promise<boolean>): Promise<string[]> {
  const chosenRoot = PLANS_ROOTS[folder]
  // Only claude-kit's choice reads plan files (the user, 2026-11-25): `.alfred` and `default` make no folder and move
  // nothing, and the one rm takes the old status files alone
  if (folder !== FILE_PLANS_FOLDER) return removeSources($, chosenRoot, [], [], extras)
  const others = plansRoots(folder).slice(1)
  const now = await $.clock.now()
  const { queue: plans, skipped: skippedPlans, lines: planFolderLines } = await queueOf($, PLANS_SUBFOLDER, chosenRoot, others)
  const { queue: scores, lines: scoresFolderLines } = await queueOf($, SCORES_SUBFOLDER, chosenRoot, others)
  const copies: Copy[] = []
  const equal: ListedFile[] = []
  const live = new Map<string, LiveReason>()
  // A scores file that cannot be read stays and is named, apart from its plan, so the plan's own line still shows
  const unreadScores = new Set<string>()
  const held = new Set<string>()
  const clashes = new Set<string>()
  const notMoved: string[] = [...planFolderLines, ...scoresFolderLines]
  const texts = new Map<string, string | null>()
  const probes: string[] = []
  const makeProbeName = (): string => probeName(now, Math.random().toString(36).slice(2))
  let isProbeBroken = false
  let hasMore = false
  const isFull = (): boolean => copies.length + equal.length >= MOVE_CAP
  const textOf = async (file: ListedFile): Promise<string | null> => {
    if (!texts.has(file.path)) texts.set(file.path, await $.fs.read(file.path).catch(() => null))
    return texts.get(file.path) ?? null
  }
  const liveOf = async (file: ListedFile): Promise<LiveReason | null> => {
    const text = await textOf(file)
    return text === null ? 'unread' : liveReason(parsePlan(text), file.mtimeMs, now)
  }
  // The plan beside a scores file, in their own root, whichever plan of that name is newer elsewhere
  const ownPlanLiveOf = async (file: ListedFile): Promise<LiveReason | null> => {
    const own = [...plans.listed, ...skippedPlans].find(plan => plan.root === file.root && plan.name === file.name)
    return own === undefined ? null : liveOf(own)
  }
  // Why a text that is not the listed size is refused: the file changed since the listing, or it is not UTF-8 text
  const refusalOf = async (file: ListedFile): Promise<string> => {
    const stat = await $.fs.stat(file.path).catch(() => null)
    return stat !== null && stat.size === file.size && stat.mtimeMs === file.diskMtimeMs ? notUtf8Line(file.name) : changedLine(file.name)
  }
  const attempt = async (kind: string, file: ListedFile, text: string): Promise<boolean> => {
    if (!isUtf8Text(text, file.size)) {
      notMoved.push(await refusalOf(file))
      return false
    }
    const copy = { file, destination: copyPath(chosenRoot, kind, file.name) }
    // Past the cap a file is only checked: it makes the run say 'more' only when the next run would copy it
    const result = isFull() ? (await destinationBlock($, copy.destination)) ?? 'waiting' : await copyFile($, copy, text)
    if (result === 'copied') copies.push(copy)
    else if (result === 'waiting') hasMore = true
    else if (result === 'exists') clashes.add(file.name)
    else notMoved.push(copyFailureLine(result, file.name, chosenRoot, kind))
    return result === 'copied'
  }
  // A clash whose chosen copy is a separate file of byte-equal text and the listed size is a candidate: once the probe
  // proves its folder, the source is removed like a moved one. A source that stays (live, or beside a plan that stays)
  // is never removed, and one that cannot be read stays as it is.
  const settleClashes = async (kind: string, clashed: readonly ListedFile[], isStaying: (file: ListedFile) => Promise<boolean>) => {
    const candidates: ListedFile[] = []
    for (const file of clashed) {
      const text = await textOf(file)
      if (text === null) {
        if (kind === SCORES_SUBFOLDER) unreadScores.add(file.name)
        else if (!live.has(file.name)) live.set(file.name, 'unread')
        continue
      }
      const destination = copyPath(chosenRoot, kind, file.name)
      const isEqual = isUtf8Text(text, file.size) && !(await isStaying(file)) &&
        (await $.fs.read(destination).catch(() => null)) === text && (await isSeparate($, file, destination))
      if (isEqual) candidates.push(file)
      else clashes.add(file.name)
    }
    return candidates
  }
  // The candidates of one kind that the probe shows are in another folder join `equal`, up to the cap; the rest are
  // kept
  const proveEqual = async (candidates: readonly ListedFile[]) => {
    const proved = await probeFolders($, chosenRoot, makeProbeName, candidates, isProbeBroken, canRm)
    for (const file of proved.proven) {
      if (isFull()) hasMore = true
      else equal.push(file)
    }
    for (const file of proved.kept) clashes.add(file.name)
    notMoved.push(...proved.lines)
    probes.push(...proved.probes)
    isProbeBroken = proved.isBroken
  }
  for (const file of plans.queue) {
    const text = await textOf(file)
    const reason = await liveOf(file)
    if (reason !== null) live.set(file.name, reason)
    else if (text !== null && !(await attempt(PLANS_SUBFOLDER, file, text))) held.add(file.name)
  }
  await proveEqual(await settleClashes(PLANS_SUBFOLDER, plans.clashed, async file => (await liveOf(file)) !== null))
  // A plan that stays with another plan of its name beside it keeps its scores, as one whose copy failed does
  for (const file of plans.clashed) if (!equal.includes(file)) held.add(file.name)
  for (const file of scores.queue) {
    const reason = await ownPlanLiveOf(file)
    if (reason !== null) live.set(file.name, reason)
    if (live.has(file.name) || held.has(file.name)) continue
    const text = await textOf(file)
    if (text !== null) await attempt(SCORES_SUBFOLDER, file, text)
  }
  await proveEqual(await settleClashes(SCORES_SUBFOLDER, scores.clashed, async file => held.has(file.name) || (await ownPlanLiveOf(file)) !== null))
  const removed = await removeSources($, chosenRoot, await unchangedSince($, [...copies.map(copy => copy.file), ...equal]), probes, extras)
  const shown = [...clashes].filter(name => !live.has(name))
  const unreadNames = [...unreadScores].filter(name => live.get(name) !== 'unread')
  const left = [...[...live].map(([name, reason]) => leftLine(reason, name)), ...unreadNames.map(name => leftLine('unread', name))]
  return [...left, ...shown.map(keptBothLine), ...notMoved, ...removed, ...(hasMore ? [MORE_LINE] : [])]
}

// Spec D4 step 2: claude-kit's root in the .gitignore, when there is one and no line covers it; `.alfred` and `default`
// read no plan file and get none. A refused check ends the run (runUpdate); a failed read or write is named.
async function ignoreRoot($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  if (folder !== FILE_PLANS_FOLDER || !(await $.fs.exists(GITIGNORE_FILE))) return []
  const root = PLANS_ROOTS[folder]
  const text = await $.fs.read(GITIGNORE_FILE).catch(() => null)
  if (text === null) return [gitignoreByHandLine(root)]
  if (coversRoot(text, root)) return []
  const isWritten = await $.fs.write(GITIGNORE_FILE, gitignoreAppend(text, root)).then(() => true, () => false)
  return [isWritten ? gitignoreLine(root) : gitignoreByHandLine(root)]
}

// Spec D4 step 3: a choice of before 0.8 that no settings file holds goes into the user file, so the store's copy
// retires
async function keepEarlierChoices($: EngineInterface): Promise<string[]> {
  const resolved = resolvedSettings()
  if (resolved === null) return []
  const lines: string[] = []
  const written: string[] = []
  for (const field of FIELDS) {
    if (resolved.from[field] !== 'legacy' || resolved.values[field] === DEFAULTS[field]) continue
    const answer = await writeUserFieldResult($, field, resolved.values[field])
    if (answer.ok) written.push(field)
    else lines.push(answer.text)
  }
  return [...(written.length === 0 ? [] : [earlierChoicesLine(written)]), ...lines]
}

// The file a switch-off writes: the user file Claude Code reads, or the project's or local one by its name, which is also
// its path from the working folder
async function settingsPathOf($: EngineInterface, source: (typeof WRITABLE_SOURCES)[number]): Promise<string | null> {
  return source === 'user' ? userSettingsPath($) : sourceFileName(source)
}

// The path of the file the old install's key was set false in, or null: its text is read right before the write, and a file
// that is missing or unreadable, does not parse, holds no such key set true exactly once or refuses the write is left as
// found
async function switchOff($: EngineInterface, source: (typeof WRITABLE_SOURCES)[number], key: string): Promise<string | null> {
  const path = await settingsPathOf($, source)
  if (path === null) return null
  const text = await $.fs.read(path).catch(() => null)
  const next = switchOffPlugin(text, key)
  if ('why' in next) return null
  return (await $.fs.write(path, next.text).then(() => true, () => false)) ? path : null
}

// Spec D4 step 4: the old plugin name still switched on. Each key set true in the user, project or local file is set false
// there; a key that policy or a flag sets true, or a write that did not happen, keeps the uninstall line.
async function oldInstalls($: EngineInterface): Promise<string[]> {
  const found = new Map<string, Source[]>()
  for (const source of [...WRITABLE_SOURCES, ...LOCKED_SOURCES]) {
    const enabled = await $.settings.read({ key: ENABLED_PLUGINS_KEY, source }).catch(() => undefined)
    for (const key of oldInstallKeys(enabled)) found.set(key, [...(found.get(key) ?? []), source])
  }
  const lines: string[] = []
  for (const [key, sources] of found) {
    let isOn = sources.some(source => LOCKED_SOURCES.some(locked => locked === source))
    for (const source of WRITABLE_SOURCES.filter(writable => sources.includes(writable))) {
      // The user file is named by the path the write used, as CLAUDE_CONFIG_DIR may move it
      const written = await switchOff($, source, key)
      if (written === null) isOn = true
      else lines.push(turnedOffLine(source === 'user' ? written : sourceFileName(source), key))
    }
    if (isOn) lines.push(oldInstallLine(key))
  }
  return lines
}

// Spec D4 step 5: the facts statusLines and statusRemovable decide on - the old folder's files, this session's file name
// and the new folder
async function oldStatusFacts($: EngineInterface) {
  const own = `${await $.session.id()}${JSON_SUFFIX}`
  const oldFiles = (await $.fs.list(OLD_STATUS_DIR).catch(() => [])).filter(isJsonFile).map(file => ({ name: file.name, mtimeMs: file.mtimeMs }))
  const now = await $.clock.now()
  const hasNewFolder = await $.fs.list(NEW_STATUS_DIR).then(() => true, () => false)
  const isOwnInNew = await $.fs.exists(`${NEW_STATUS_DIR}/${own}`).catch(() => false)
  return { oldFiles, now, own, hasNewFolder, isOwnInNew }
}

// What the update's one rm did to the old status files: a file still there, or one that cannot be checked, is named
async function oldStatusResult($: EngineInterface, paths: readonly string[]): Promise<string[]> {
  let left = 0
  for (const path of paths) if (await $.fs.exists(path).then(found => found, () => true)) left++
  return statusResultLines(paths.length - left, left)
}

const reasonOf = (error: unknown): string => oneLine(error instanceof Error ? error.message : 'unknown error', REASON_MAX)

// The report of /alfred-mods:update on `folder`, a line for each step with work and a closing line. Every root and line
// comes from `folder`, never from the settings in force: a press has just written it and they are stale. A step that
// fails ends the run on a line naming the reason, with the lines before it kept. The one rm of the run takes the old
// status files too, where rm runs.
export async function runUpdate($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  const lines: string[] = []
  let rmRuns: Promise<boolean> | null = null
  const canRm = (): Promise<boolean> => (rmRuns ??= canRemove($))
  try {
    const status = await oldStatusFacts($)
    const plan = statusPlan(status)
    const statusPaths = plan.removable.map(name => `${OLD_STATUS_DIR}/${name}`)
    lines.push(...(await moveFiles($, folder, statusPaths.length > 0 && (await canRm()) ? statusPaths : [], canRm)))
    lines.push(...(await ignoreRoot($, folder)))
    lines.push(...(await keepEarlierChoices($)))
    lines.push(...(await oldInstalls($)))
    lines.push(...statusLines(status), ...(await oldStatusResult($, statusPaths)), ...statusHeldLines(plan.recent, plan.waiting))
  } catch (error) {
    return [...lines, failureLine(reasonOf(error))]
  }
  return closeReport(lines)
}
