// The setup folder's effects: '/alfred-mods init|configure|update' and the pane that offers the choice. The plans
// folder is a project setting (.claude/settings.json), written only here.
import type { EngineInterface } from 'claude-code'
import type { MatchedInput } from '../core/types'
import { drawLines } from '../core/draw'
import { oneLine } from '../core/format'
import { isNoColor } from '../core/effects'
import { PLANS_ROOTS, PLANS_SUBFOLDER, SCORES_SUBFOLDER } from '../plan/constants'
import { noteMovedFiles } from '../plan/effects'
import { parsePlan, plansRoots } from '../plan/plan'
import type { PlansFolder } from '../plan/types'
import { loadSettings, plansFolderInForce, resolvedSettings, writeProjectField, writeUserFieldResult } from '../settings/effects'
import { DEFAULTS, FIELDS, sourceFileName } from '../settings/settings'
import {
  BUTTON_KEY_PREFIX, CHOICE_ORDER, GITIGNORE_FILE, JSON_SUFFIX, MORE_LINE, MOVE_CAP, NEW_STATUS_DIR, OLD_STATUS_DIR, REASON_MAX, RM_ARGV, RM_TIMEOUT_MS,
  SETUP_PANE_ID, SETUP_PANE_TITLE, SETUP_USAGE,
} from './constants'
import { choiceLines, configuredLine, livesLine, parseSetupArgs, setupPaneLines, shadowLine, unplacedLine, writerNote } from './setup'
import type { Copy, CopyResult, ListedFile } from './types'
import {
  closeReport, copiedLine, copyPath, coversRoot, earlierChoicesLine, failureLine, gitignoreAppend, gitignoreByHandLine, gitignoreLine, folderPathOf, isLivePlan, keptBothLine,
  leftInPlaceLine, movedLine, moveQueue, notMovedLine, oldInstallKeys, oldInstallLine, statusFilesLine,
} from './update'

// What the pane draws: the last update's report, and the folder a press just wrote (the settings in force are stale
// until Claude Code's ConfigChange). A new claude run starts them over.
const setupMemory = { report: [] as string[], chosen: null as PlansFolder | null }

const isJsonFile = (entry: { kind: string; name: string }): boolean => entry.kind === 'file' && entry.name.endsWith(JSON_SUFFIX)

// A missing folder is empty
async function listKind($: EngineInterface, root: string, kind: string): Promise<ListedFile[]> {
  const dir = `${root}/${kind}`
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.filter(isJsonFile).map(entry => ({
    name: entry.name.slice(0, -JSON_SUFFIX.length), root, path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs, size: entry.size,
  }))
}

async function queueOf($: EngineInterface, kind: string, chosenRoot: string, others: readonly string[]) {
  const chosen = new Set((await listKind($, chosenRoot, kind)).map(file => file.name))
  const byFolder: ListedFile[][] = []
  for (const root of others) byFolder.push(await listKind($, root, kind))
  return moveQueue(chosen, byFolder)
}

// One file into the chosen root, read back. A name that has a file in the chosen root by now is never written over.
async function copyFile($: EngineInterface, copy: Copy, text: string): Promise<CopyResult> {
  if (await $.fs.exists(copy.destination)) return 'exists'
  try {
    await $.fs.write(copy.destination, text)
    return (await $.fs.read(copy.destination)) === text ? 'copied' : 'differs'
  } catch {
    return 'differs'
  }
}

// Each copied source is stat-ed again: one whose size or mtimeMs moved was written after the copy and stays
async function unchangedSince($: EngineInterface, copied: readonly ListedFile[]): Promise<ListedFile[]> {
  const kept: ListedFile[] = []
  for (const file of copied) {
    const stat = await $.fs.stat(file.path).catch(() => null)
    if (stat !== null && stat.size === file.size && stat.mtimeMs === file.mtimeMs) kept.push(file)
  }
  return kept
}

// One rm of every source that read back equal and did not change, and of every copy that did not read back equal (the
// run's own fresh write); where it rejects or exits non-zero the files stay
async function removeFiles($: EngineInterface, chosenRoot: string, sources: readonly ListedFile[], badCopies: readonly string[]): Promise<string[]> {
  if (sources.length === 0 && badCopies.length === 0) return []
  const ran = await $.process.run([...RM_ARGV, ...sources.map(file => file.path), ...badCopies], { timeoutMs: RM_TIMEOUT_MS }).catch(() => null)
  if (sources.length === 0) return []
  if (ran !== null && ran.exitCode === 0) return [movedLine(sources.length, chosenRoot)]
  return [copiedLine(sources.length, chosenRoot, [...new Set(sources.map(file => folderPathOf(file.path)))])]
}

// Spec D4 step 1: the plans and scores of the other roots copied into the chosen one, oldest first, then one rm. A plan
// whose writer still uses it stays with its scores, a clashing plan's scores too; a name the chosen root holds stays;
// past the cap the rest wait.
async function moveFiles($: EngineInterface, folder: PlansFolder): Promise<string[]> {
  const chosenRoot = PLANS_ROOTS[folder]
  const others = plansRoots(folder).slice(1)
  const now = await $.clock.now()
  const plans = await queueOf($, PLANS_SUBFOLDER, chosenRoot, others)
  const scores = await queueOf($, SCORES_SUBFOLDER, chosenRoot, others)
  const copies: Copy[] = []
  const live = new Set<string>()
  const waiting = new Set<string>()
  const clashes = new Set([...plans.clashed, ...scores.clashed].map(file => file.name))
  const notMoved: string[] = []
  const badCopies: string[] = []
  let hasMore = false
  const attempt = async (kind: string, file: ListedFile, text: string): Promise<void> => {
    const copy = { file, destination: copyPath(chosenRoot, kind, file.name) }
    const result = await copyFile($, copy, text)
    if (result === 'copied') copies.push(copy)
    else if (result === 'exists') clashes.add(file.name)
    else {
      notMoved.push(notMovedLine(file.name, chosenRoot, kind))
      badCopies.push(copy.destination)
    }
  }
  // A plan the chosen root holds too still has scores beside it in an old root: its writer may be using them
  const scoreNames = new Set(scores.queue.map(file => file.name))
  for (const file of plans.clashed.filter(clashing => scoreNames.has(clashing.name))) {
    const text = await $.fs.read(file.path).catch(() => null)
    if (text === null || isLivePlan(parsePlan(text), file.mtimeMs, now)) live.add(file.name)
  }
  for (const file of plans.queue) {
    if (copies.length >= MOVE_CAP) {
      hasMore = true
      waiting.add(file.name)
      continue
    }
    const text = await $.fs.read(file.path).catch(() => null)
    if (text === null || isLivePlan(parsePlan(text), file.mtimeMs, now)) live.add(file.name)
    else await attempt(PLANS_SUBFOLDER, file, text)
  }
  for (const file of scores.queue) {
    if (live.has(file.name)) continue
    if (copies.length >= MOVE_CAP || waiting.has(file.name)) {
      hasMore = true
      continue
    }
    const text = await $.fs.read(file.path).catch(() => null)
    if (text !== null) await attempt(SCORES_SUBFOLDER, file, text)
  }
  const removed = await removeFiles($, chosenRoot, await unchangedSince($, copies.map(copy => copy.file)), badCopies)
  noteMovedFiles(copies.map(copy => ({ path: copy.destination, mtimeMs: copy.file.mtimeMs })))
  return [...[...live].map(leftInPlaceLine), ...[...clashes].map(keptBothLine), ...notMoved, ...removed, ...(hasMore ? [MORE_LINE] : [])]
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

// Spec D4 step 3: a choice of before 0.8 that no settings file holds goes into the user file, so the store's copy retires
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

// Spec D4 step 5: the old stack's status files, counted only while the new folder exists; an old stack still writes there
async function oldStatusFiles($: EngineInterface): Promise<string[]> {
  if (!(await $.fs.list(NEW_STATUS_DIR).then(() => true, () => false))) return []
  const count = (await $.fs.list(OLD_STATUS_DIR).catch(() => [])).filter(isJsonFile).length
  return count === 0 ? [] : [statusFilesLine(count)]
}

const reasonOf = (error: unknown): string => oneLine(error instanceof Error ? error.message : 'unknown error', REASON_MAX)

// The report of /alfred-mods update on `folder`, a line for each step with work and a closing line. Every root and
// line comes from `folder`, never from the settings in force: a press has just written it and they are stale. A step that
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

export async function runSetupCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods' }>): Promise<{ text: string }> {
  const args = parseSetupArgs(e.args)
  if (args === null) return { text: SETUP_USAGE }
  // The files are read first, so a session that has not polled answers from what they hold now
  await loadSettings($)
  const inForce = plansFolderInForce()
  if (args.verb === 'update') return { text: (await runUpdate($, inForce.folder)).join('\n') }
  if (args.folder !== null) {
    const chosen = await chooseFolder($, args.folder)
    if (!chosen.ok) return { text: chosen.why }
    if (args.verb === 'init') return { text: [...confirmed(chosen), ...(await runUpdate($, chosen.folder))].join('\n') }
    // The shadow line already says which folder is in force, so it is not said again as the closing line
    const noted = chosen.note === null ? [] : [chosen.note]
    return { text: (chosen.isShadowed ? [chosen.first, ...noted] : [...noted, configuredLine(chosen.folder)]).join('\n') }
  }
  if (args.verb === 'init' && inForce.from !== 'default') {
    return { text: [livesLine(inForce.folder, sourceFileName(inForce.from), true), ...(await runUpdate($, inForce.folder))].join('\n') }
  }
  return { text: await offerChoices($) }
}

export async function drawSetupPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'alfred-mods-setup' }>) {
  const press: Record<string, () => unknown> = {}
  for (const folder of CHOICE_ORDER) press[`${BUTTON_KEY_PREFIX}${folder}`] = () => pressChoice($, folder).catch(() => undefined)
  return drawLines($.ui.resolve(e), e, setupPaneLines(currentFolder(), setupMemory.report), { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
