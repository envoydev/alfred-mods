// The setup folder's effects: '/alfred-mods:init', '/alfred-mods:configure' and '/alfred-mods:update', and the pane
// that offers the choice. The plans folder is a project setting (.claude/settings.json), written only here.
import type { EngineInterface } from 'claude-code'
import type { MatchedInput } from '../core/types'
import { drawLines } from '../core/draw'
import { oneLine } from '../core/format'
import { isNoColor } from '../core/effects'
import { PLANS_ROOTS, PLANS_SUBFOLDER, SCORES_SUBFOLDER } from '../plan/constants'
import { noteMovedFiles, originalMtime } from '../plan/effects'
import { parsePlan, plansRoots } from '../plan/plan'
import type { PlansFolder } from '../plan/types'
import { loadSettings, plansFolderInForce, resolvedSettings, writeProjectField, writeUserFieldResult } from '../settings/effects'
import { DEFAULTS, FIELDS, sourceFileName } from '../settings/settings'
import {
  BUTTON_KEY_PREFIX, CHOICE_ORDER, GITIGNORE_FILE, JSON_SUFFIX, MORE_LINE, MOVE_CAP, NEW_STATUS_DIR, OLD_STATUS_DIR, PROBE_NAME_TRIES, PROBE_TEXT, REASON_MAX, RM_ARGV, RM_TIMEOUT_MS,
  SETUP_PANE_ID, SETUP_PANE_TITLE, SETUP_USAGE,
} from './constants'
import { choiceLines, configuredLine, livesLine, hasNoValue, parseFolderValue, setupPaneLines, shadowLine, unplacedLine, writerNote } from './setup'
import type { Copy, CopyResult, ListedFile, LiveReason } from './types'
import {
  changedLine, closeReport, copiedLine, copyFailureLine, copyPath, coversRoot, earlierChoicesLine, failureLine, folderPathOf, folderRelation, gitignoreAppend,
  gitignoreByHandLine, gitignoreLine, isSeparateCopy, isUtf8Text, keptBothLine, leftLine, liveReason, movedLine, moveQueue, notUtf8Line, oldInstallKeys,
  oldInstallLine, probeLeftLine, probeName, sameFolderLine, statusFilesLine, unknownFolderLine,
} from './update'

// What the pane draws: the last update's report, and the folder a press just wrote (the settings in force are stale
// until Claude Code's ConfigChange). A new claude run starts them over.
const setupMemory = { report: [] as string[], chosen: null as PlansFolder | null }

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

// One rm of every source that is whole in the chosen root and did not change, with the probe files; never of a
// destination. Where it rejects or exits non-zero it may have removed some: what is still there is named, the sources
// to remove by hand and the probes to delete.
async function removeSources($: EngineInterface, chosenRoot: string, sources: readonly ListedFile[], probes: readonly string[]): Promise<string[]> {
  if (sources.length === 0 && probes.length === 0) return []
  const paths = [...sources.map(file => file.path), ...probes]
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

// What a real path cannot show - a case alias, a bind mount, a firmlink keep a path of their own - a file can: one
// written into each chosen folder is looked for in each source folder that holds equal copies. Found there, that folder
// is the chosen one under another name; a check that cannot answer, a name that stays taken or a write that fails keeps
// its copies. `proven` are the copies in a folder the probe is not in.
async function probeFolders($: EngineInterface, chosenRoot: string, makeName: () => string, equal: readonly ListedFile[], isBroken: boolean) {
  const out = { proven: [] as ListedFile[], kept: [] as ListedFile[], lines: [] as string[], probes: [] as string[], isBroken }
  if (equal.length === 0) return out
  const kind = equal[0]?.kind ?? ''
  const name = isBroken ? null : await freeProbeName($, `${chosenRoot}/${kind}`, makeName)
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
async function moveFiles($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  const chosenRoot = PLANS_ROOTS[folder]
  const others = plansRoots(folder).slice(1)
  const now = await $.clock.now()
  const { queue: plans, skipped: skippedPlans, lines: planFolderLines } = await queueOf($, PLANS_SUBFOLDER, chosenRoot, others)
  const { queue: scores, lines: scoresFolderLines } = await queueOf($, SCORES_SUBFOLDER, chosenRoot, others)
  const copies: Copy[] = []
  const equal: ListedFile[] = []
  const live = new Map<string, LiveReason>()
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
        if (!live.has(file.name)) live.set(file.name, 'unread')
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
    const proved = await probeFolders($, chosenRoot, makeProbeName, candidates, isProbeBroken)
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
  const removed = await removeSources($, chosenRoot, await unchangedSince($, [...copies.map(copy => copy.file), ...equal]), probes)
  const shown = [...clashes].filter(name => !live.has(name))
  const left = [...live].map(([name, reason]) => leftLine(reason, name))
  return [...left, ...shown.map(keptBothLine), ...notMoved, ...removed, ...(hasMore ? [MORE_LINE] : [])]
}

// Spec D4 step 2: the chosen root in the .gitignore, when there is one and no line covers it; `default` is the
// project's own .claude/ and gets none. A refused check ends the run (runUpdate); a failed read or write is named.
async function ignoreRoot($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  if (folder === 'default' || !(await $.fs.exists(GITIGNORE_FILE))) return []
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

// Spec D4 step 4: the old plugin name still switched on in the user or project settings
async function oldInstalls($: EngineInterface): Promise<string[]> {
  const keys = new Set<string>()
  for (const source of ['user', 'project'] as const) {
    const enabled = await $.settings.read({ key: 'enabledPlugins', source }).catch(() => undefined)
    for (const key of oldInstallKeys(enabled)) keys.add(key)
  }
  return [...keys].map(oldInstallLine)
}

// Spec D4 step 5: the old stack's status files, counted only while the new folder exists; an old stack still writes
// there
async function oldStatusFiles($: EngineInterface): Promise<string[]> {
  if (!(await $.fs.list(NEW_STATUS_DIR).then(() => true, () => false))) return []
  const count = (await $.fs.list(OLD_STATUS_DIR).catch(() => [])).filter(isJsonFile).length
  return count === 0 ? [] : [statusFilesLine(count)]
}

const reasonOf = (error: unknown): string => oneLine(error instanceof Error ? error.message : 'unknown error', REASON_MAX)

// The report of /alfred-mods:update on `folder`, a line for each step with work and a closing line. Every root and line
// comes from `folder`, never from the settings in force: a press has just written it and they are stale. A step that
// fails ends the run on a line naming the reason, with the lines before it kept.
async function runUpdate($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  const lines: string[] = []
  try {
    lines.push(...(await moveFiles($, folder)))
    lines.push(...(await ignoreRoot($, folder)))
    lines.push(...(await keepEarlierChoices($)))
    lines.push(...(await oldInstalls($)))
    lines.push(...(await oldStatusFiles($)))
  } catch (error) {
    return [...lines, failureLine(reasonOf(error))]
  }
  return closeReport(lines)
}
type Written = { ok: true; folder: PlansFolder; first: string; isShadowed: boolean; note: string | null } | { ok: false; why: string }

// One write of the field into the project file. The settings are stale until ConfigChange, so `folder`, the one in
// force, is the value written, else the higher file's as the settings held it before the write; `first` says which.
async function chooseFolder($: EngineInterface, written: PlansFolder): Promise<Written> {
  const result = await writeProjectField($, 'plansFolder', written)
  if (!result.ok) return { ok: false, why: result.why }
  if (result.shadow === null) {
    return { ok: true, folder: written, first: livesLine(written, sourceFileName('project'), false), isShadowed: false, note: writerNote(written) }
  }
  // Under a shadow the folder in force is the one new files land in, so its writer note is the one that holds
  const folder = plansFolderInForce().folder
  return { ok: true, folder, first: shadowLine(folder, sourceFileName(result.shadow)), isShadowed: true, note: writerNote(folder) }
}

const confirmed = (chosen: Extract<Written, { ok: true }>): string[] => [chosen.first, ...(chosen.note === null ? [] : [chosen.note])]

// A press: write, update, and keep what happened for the pane; it never closes the pane
async function pressChoice($: EngineInterface, written: PlansFolder): Promise<void> {
  const chosen = await chooseFolder($, written)
  if (!chosen.ok) setupMemory.report = [chosen.why]
  else {
    setupMemory.chosen = chosen.folder
    setupMemory.report = [...confirmed(chosen), ...(await runUpdate($, chosen.folder))]
  }
  $.ui.invalidate('ui.render')
}

// The folder marked (now): the one a press just wrote, else the one a file sets; null while the field is unset
function currentFolder(): PlansFolder | null {
  const inForce = plansFolderInForce()
  return setupMemory.chosen ?? (inForce.from === 'default' ? null : inForce.folder)
}

async function offerChoices($: EngineInterface): Promise<string> {
  setupMemory.report = []
  setupMemory.chosen = null
  const text = choiceLines(currentFolder()).join('\n')
  const opened = await $.ui.open({ id: SETUP_PANE_ID, title: SETUP_PANE_TITLE, closeOnEscape: true }).catch(() => undefined)
  return opened === undefined || opened.isPlaced ? text : `${text}\n${unplacedLine(opened.reason)}`
}

// The two commands that take a folder differ in what they do with it: init also runs update, configure only writes
async function writeFolder($: EngineInterface, verb: 'init' | 'configure', folder: PlansFolder): Promise<string> {
  const chosen = await chooseFolder($, folder)
  if (!chosen.ok) return chosen.why
  if (verb === 'init') return [...confirmed(chosen), ...(await runUpdate($, chosen.folder))].join('\n')
  // The shadow line already says which folder is in force, so it is not said again as the closing line
  const noted = chosen.note === null ? [] : [chosen.note]
  return (chosen.isShadowed ? [chosen.first, ...noted] : [...noted, configuredLine(chosen.folder)]).join('\n')
}

async function runFolderCommand($: EngineInterface, verb: 'init' | 'configure', args: string): Promise<{ text: string }> {
  const value = parseFolderValue(args)
  if (!value.ok) return { text: SETUP_USAGE }
  // The files are read first, so a session that has not polled answers from what they hold now
  await loadSettings($)
  if (value.folder !== null) return { text: await writeFolder($, verb, value.folder) }
  const inForce = plansFolderInForce()
  if (verb === 'init' && inForce.from !== 'default') {
    return { text: [livesLine(inForce.folder, sourceFileName(inForce.from), true), ...(await runUpdate($, inForce.folder))].join('\n') }
  }
  return { text: await offerChoices($) }
}

export function runInitCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:init' }>): Promise<{ text: string }> {
  return runFolderCommand($, 'init', e.args)
}

export function runConfigureCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:configure' }>): Promise<{ text: string }> {
  return runFolderCommand($, 'configure', e.args)
}

export async function runUpdateCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:update' }>): Promise<{ text: string }> {
  if (!hasNoValue(e.args)) return { text: SETUP_USAGE }
  await loadSettings($)
  return { text: (await runUpdate($, plansFolderInForce().folder)).join('\n') }
}

export async function drawSetupPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'alfred-mods-setup' }>) {
  const press: Record<string, () => unknown> = {}
  for (const folder of CHOICE_ORDER) press[`${BUTTON_KEY_PREFIX}${folder}`] = () => pressChoice($, folder).catch(() => undefined)
  // On the terminal's main screen nothing takes a press, as /inspect's pane finds: each choice draws as its command
  const isMain = e.surface === 'terminal' && e.viewport?.isFullscreen === false
  return drawLines($.ui.resolve(e), e, setupPaneLines(currentFolder(), setupMemory.report, isMain), { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
