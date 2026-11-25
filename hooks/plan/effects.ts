// The plan folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { SliceClose, Credit, FolderEntries, Listed, Moved, Plan, PlanDrawing, PlanView, Plans, Scores, TaskItem, Watched } from './types'
import { ALFRED_PLANS_DIR, ALFRED_PLANS_READ, ALFRED_SCORING_FILE, ALFRED_STATUS_FILE, MAX_PLAN_BYTES } from './constants'
import type { Pending } from '../core/types'
import { FINISH_SHOWN_MS, creditedPlan, isPlanDone, newUserNotes, parsePlan, parseScores, candidatesByName, planView, plansDirs, isPlanRunning, scoresDirs, scoresView, shownPlan, stepStatusKey, taskStatusKey, taskView, tasksAfter, isSamePlan } from './plan'
import { closeTargetOf, closeSlices, closeWait, creditRunningTasks, liveSpans, sessionTimesOf, openWait, shownStepTimes, sliceMs, storedTimeOf, sumTimes, taskListMs } from './steptime'
import { parseAlfredScoring, parseAlfredStatus } from './alfredplan'
import { minutesText, oneLine } from '../core/format'
import { scoresLabel } from './planlines'
import { standInMtime } from './moved'
import { toast } from '../core/effects'
import { isLive, stepMarkOf } from '../agents/agents'
import { readStack } from '../stack/effects'
import { readView } from '../inspect/effects'
import { readAgents } from '../agents/effects'
import { plansFolderInForce } from '../settings/effects'

const INITIAL_PLANS: Plans = { planFiles: [], scoreFiles: [], stepTimes: {}, overheadMs: {}, finishedAt: {}, toastedKeys: [], watchedSince: null, alfredFolder: null }
const plansAtom = atom({ plugin: 'alfred-mods', key: 'plans' } as const, INITIAL_PLANS, { shape: 'plans-3' })
export function readPlans($: EngineInterface) {
  return read($, plansAtom)
}
function updatePlans($: EngineInterface, change: (value: Plans) => Plans) {
  return update($, plansAtom, change)
}
export function resetPlans($: EngineInterface) {
  return update($, plansAtom, () => INITIAL_PLANS)
}

const INITIAL_CREDIT: Credit = { slices: {}, sessionTimes: {} }
const creditAtom = atom({ plugin: 'alfred-mods', key: 'credit' } as const, INITIAL_CREDIT, { shape: 'credit-2' })
function readCredit($: EngineInterface) {
  return read($, creditAtom)
}
function updateCredit($: EngineInterface, change: (value: Credit) => Credit) {
  return update($, creditAtom, change)
}
export function resetCredit($: EngineInterface) {
  return update($, creditAtom, () => INITIAL_CREDIT)
}

const INITIAL_TASKS: TaskItem[] = []
const tasksAtom = atom({ plugin: 'alfred-mods', key: 'tasks' } as const, INITIAL_TASKS, { shape: 'tasks-2' })
export function readTasks($: EngineInterface) {
  return read($, tasksAtom)
}
function updateTasks($: EngineInterface, change: (value: TaskItem[]) => TaskItem[]) {
  return update($, tasksAtom, change)
}
export function resetTasks($: EngineInterface) {
  return update($, tasksAtom, () => INITIAL_TASKS)
}

// Every session's step and overhead time in the store; this session's own totals are the credit atom's
export async function readStoredTimes($: EngineInterface): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('step:') || key.startsWith('overhead:')) entries[key] = await $.store.get(key)
  }
  return entries
}

// Each plan's time: every other session's from the store, this session's from its own totals
async function planTimesOf($: EngineInterface, files: Watched<Plan>[]): Promise<Pick<Plans, 'stepTimes' | 'overheadMs'>> {
  const entries = { ...(await readStoredTimes($)), ...(await readCredit($)).sessionTimes }
  const times: Plans['stepTimes'] = {}
  const overhead: Plans['overheadMs'] = {}
  for (const file of files) {
    const sum = sumTimes(entries, file.name)
    times[file.name] = sum.times
    overhead[file.name] = sum.overhead
  }
  return { stepTimes: times, overheadMs: overhead }
}

// The loops named (every open one when null) close at `now`: each span goes to its keys (Decision 9) in one update,
// so a span two closers race for counts once. This session's totals are then stored whole, in order.
export async function closeLoopSlices($: EngineInterface, pending: Pending, loops: string[] | null, now: number, reopen: boolean, given?: Plans): Promise<void> {
  const credit = await readCredit($)
  const open = Object.keys(credit.slices).filter(loop => loops === null || loops.includes(loop))
  if (open.length === 0) return
  const plans = given ?? await readPlans($)
  const rows = await readAgents($)
  const shown = creditedPlan(plans, (await readView($)).pinnedPlan, (await readTasks($)).length > 0)
  const closes = await closeTargetsOf($, credit, open, plans, shown)
  let spans: Record<string, number> = {}
  const after = await updateCredit($, cur => {
    const closed = closeSlices(cur, closes, now, reopen)
    spans = closed.spans
    return closed.credit
  })
  // With the task list shown, the main loop's span and those of agents whose spawn was seen go to its running items
  const taskMs = shown === 'tasks' ? taskListMs(spans, rows.map(row => row.id)) : 0
  if (taskMs > 0 && (await readTasks($)).some(task => task.status === 'in_progress')) await updateTasks($, list => [...creditRunningTasks(list, taskMs)])
  const keys = [...new Set(closes.flatMap(close => close.keys))]
  for (const key of keys) {
    const step = after.sessionTimes[key]
    if (step === undefined) continue
    const stored = storedTimeOf(key, step, now)
    pending.timeWrites = pending.timeWrites.then(() => $.store.set(key, stored)).catch(() => undefined)
  }
  await pending.timeWrites
  if (keys.length === 0) return
  const files = (await readPlans($)).planFiles
  const sums = await planTimesOf($, files)
  await updatePlans($, plans => ({ ...plans, ...sums }))
}

// Where each named open loop's span goes (Decision 9)
async function closeTargetsOf($: EngineInterface, credit: Credit, loops: string[], plans: Plans, shown: Watched<Plan> | 'tasks' | null): Promise<SliceClose[]> {
  const rows = await readAgents($)
  const session = await $.session.id()
  return loops.map(loop => {
    const row = rows.find(agent => agent.id === loop)
    const lines = loop === 'main' ? null : row === undefined ? undefined : { plan: row.plan, task: row.task }
    const slice = credit.slices[loop] ?? { openedAt: 0, waitMs: 0, namedSteps: [] }
    return closeTargetOf(loop, slice, lines, plans.planFiles, plans.watchedSince, shown === 'tasks' ? null : shown, session)
  })
}

// The open slices' time so far, by step id (or task id) and as overhead, for the shown plan or task list to draw
async function liveStepTimes($: EngineInterface, plans: Plans, shown: Watched<Plan> | 'tasks' | null, now: number): Promise<{ steps: Record<string, number>; overhead: number }> {
  const credit = await readCredit($)
  const loops = Object.keys(credit.slices)
  if (loops.length === 0 || shown === null) return { steps: {}, overhead: 0 }
  if (shown === 'tasks') {
    const rows = await readAgents($)
    const ms = taskListMs(Object.fromEntries(loops.map(loop => [loop, sliceMs(credit.slices[loop] ?? { openedAt: now, waitMs: 0, namedSteps: [] }, now)])), rows.map(row => row.id))
    const running = (await readTasks($)).filter(task => task.status === 'in_progress')
    return { steps: Object.fromEntries(running.map(task => [task.id, ms / running.length])), overhead: 0 }
  }
  const spans = liveSpans(credit, await closeTargetsOf($, credit, loops, plans, shown), now)
  return shownStepTimes(shown, spans, await $.session.id())
}

export async function readPlanDrawing($: EngineInterface, now: number): Promise<PlanDrawing> {
  const plans = await readPlans($)
  const items = await readTasks($)
  const pinned = (await readView($)).pinnedPlan
  const shown = shownPlan(plans, pinned, items.length > 0)
  const credited = creditedPlan(plans, pinned, items.length > 0)
  const tab = await planViewOf($, plans, items, shown, now)
  const band = credited === shown ? tab : await planViewOf($, plans, items, credited, now)
  const nameOf = (choice: Watched<Plan> | 'tasks' | null): string | null => (choice === null || choice === 'tasks' ? null : choice.name)
  const name = nameOf(shown)
  const scored = plans.scoreFiles.filter((file): file is Watched<Scores> & { value: Scores } => file.value !== null)
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
  const ownOf = (ref: string | null) => (ref === null ? undefined : scored.find(file => file.value.subject.kind === 'plan' && file.value.subject.ref === ref))
  const full = name === null ? scored[0] : ownOf(name)
  const own = ownOf(nameOf(credited))
  const newest = own ?? scored[0]
  return {
    shown: tab.view, band: band.isRunning ? band.view : null, invalid: shown !== null && shown !== 'tasks' && shown.isInvalid,
    scores: full === undefined ? null : scoresView(full.value), score: newest === undefined ? null : scoresView(newest.value),
    isPlanScore: own !== undefined,
    others: plans.planFiles.filter(planFile => planFile.name !== name).map(file => (file.value === null ? `${file.name} (invalid)` : file.name)).sort(),
    otherScores: scored.filter(scoreFile => scoreFile !== full).slice(0, 3).map(scoreFile => scoresLabel(scoreFile.name, scoreFile.value)),
    updatedAt: shown === null || shown === 'tasks' ? null : shown.value?.updatedAt ?? null,
  }
}

// One plan's view with its live time, and whether the band draws it
export async function planViewOf(
  $: EngineInterface, plans: Plans, items: TaskItem[], choice: Watched<Plan> | 'tasks' | null, now: number,
): Promise<{ view: PlanView | null; isRunning: boolean }> {
  const live = await liveStepTimes($, plans, choice, now)
  if (choice === 'tasks') {
    return { view: taskView(items, live.steps), isRunning: items.some(item => item.status !== 'completed') && items.some(task => task.status !== 'pending') }
  }
  if (choice === null || choice.value === null) return { view: null, isRunning: false }
  const doneAt = plans.finishedAt[choice.name]
  const view = planView(choice.value, plans.stepTimes[choice.name] ?? {}, (plans.overheadMs[choice.name] ?? 0) + live.overhead, live.steps, now)
  // Alfred Code's named plan draws while open, begun or awaiting approval
  const isNamed = plans.alfredFolder !== null && plans.alfredFolder !== undefined && plans.alfredFolder.name === choice.name && !view.isFinished
  return { view, isRunning: isNamed || isPlanRunning(choice, plans.watchedSince) || (doneAt !== undefined && now - doneAt < FINISH_SHOWN_MS) }
}

// A loop's slice opens at its turn's start; the main slice marks each live agent that names a step
export async function openLoopSlice($: EngineInterface, loop: string, now: number): Promise<void> {
  const named = loop === 'main' ? (await readAgents($)).filter(row => isLive(row.status)).map(stepMarkOf).filter((mark): mark is string => mark !== null) : []
  await updateCredit($, credit => ({ ...credit, slices: { ...credit.slices, [loop]: { openedAt: now, waitMs: 0, namedSteps: named } } }))
}

// An agent naming a step, spawned or starting a turn while the main loop's turn runs, makes that turn overhead
export async function addStepMark($: EngineInterface, mark: string | null): Promise<void> {
  if (mark === null) return
  const main = (await readCredit($)).slices.main
  if (main === undefined || main.namedSteps.includes(mark)) return
  await updateCredit($, credit => {
    const slice = credit.slices.main
    return slice === undefined || slice.namedSteps.includes(mark) ? credit : { ...credit, slices: { ...credit.slices, main: { ...slice, namedSteps: [...slice.namedSteps, mark] } } }
  })
}

// A wait known only once its call settles goes to the slice open now, at most that slice's age, so a slice reopened
// during the call never loses the work after the reopen
export async function addWaitTime($: EngineInterface, loop: string, ms: number, now: number): Promise<void> {
  if (ms <= 0 || (await readCredit($)).slices[loop] === undefined) return
  await updateCredit($, credit => {
    const slice = credit.slices[loop]
    return slice === undefined ? credit : { ...credit, slices: { ...credit.slices, [loop]: { ...slice, waitMs: slice.waitMs + Math.min(ms, Math.max(0, now - slice.openedAt)) } } }
  })
}

// A session resumed under its own id starts from its stored totals, so its first close adds to them
export async function seedSessionTimes($: EngineInterface): Promise<void> {
  if (Object.keys((await readCredit($)).sessionTimes).length > 0) return
  const mine = sessionTimesOf(await readStoredTimes($), await $.session.id())
  if (Object.keys(mine).length > 0) await updateCredit($, credit => ({ ...credit, sessionTimes: { ...mine, ...credit.sessionTimes } }))
}

// The plan and scores folders read again. A step whose status changed closes and reopens the open slices first, so
// the time before the change goes to the steps that were running then. A note the file's previous good parse this
// session lacks, and a plan that finishes this session (its previous good parse unfinished), raise their toasts once.
async function reloadPlanFiles($: EngineInterface, pending: Pending): Promise<void> {
  const before = await readPlans($)
  const now = await $.clock.now()
  const { folder: plansFolder } = plansFolderInForce()
  const folderPlans = await readJsonFolders($, plansDirs(plansFolder), before.planFiles, parsePlan)
  const folderScores = await readJsonFolders($, scoresDirs(plansFolder), before.scoreFiles, parseScores)
  // With `.alfred`, Alfred Code's plan folders too: each stands in for a same-named file of the mod's own folders
  const everyAlfred = plansFolder === '.alfred' ? await readEveryAlfredPlan($, before) : { plans: [], scores: [] }
  const ownPlans = [...without(folderPlans, everyAlfred.plans), ...everyAlfred.plans]
  const ownScores = [...without(folderScores, everyAlfred.scores), ...everyAlfred.scores]
  // Alfred Code's plan folder: the one its status file names, else the one it let go, read once more to see it
  // finished, then kept 10 minutes after it finished
  // A status file that will not read, or whose `plan` will not, says nothing: the plan it named stays named
  const stack = await readStack($)
  const isPlanNamed = stack.state === 'used' && !stack.ignoredFields.includes('plan')
  const named = isPlanNamed ? stack.plan : before.alfredFolder?.folder ?? null
  const lingering = named === null ? before.alfredFolder : null
  const folder = named ?? lingering?.folder ?? null
  // The last read is this folder's only when the folder is the same, so a new folder never shows the old plan
  const isSame = before.alfredFolder !== null && before.alfredFolder !== undefined && before.alfredFolder.folder === folder
  const alfredRead = folder === null ? null : await readAlfredFolder($, folder, {
    plan: isSame ? before.planFiles.find(file => file.name === before.alfredFolder?.name) : undefined,
    scores: isSame ? before.scoreFiles.find(file => file.name === before.alfredFolder?.name) : undefined,
  }, parseAlfredStatus, parseAlfredScoring)
  // The folder's files stand in for a same-named plan or scores file of the project's own folder while they exist
  const alfredPlan = alfredRead?.plan ? { ...alfredRead.plan, isNamed: named !== null } : null
  const alfredScores = alfredRead?.scores ?? null
  const namedPlans = alfredPlan === null ? [] : [alfredPlan]
  const namedScores = alfredScores === null ? [] : [alfredScores]
  const planFiles = [...without(ownPlans, namedPlans), ...namedPlans]
  const scoreFiles = [...without(ownScores, namedScores), ...namedScores]
  if (stepStatusKey(before.planFiles) !== stepStatusKey(planFiles)) await closeLoopSlices($, pending, null, now, true, before)
  const { stepTimes, overheadMs } = await planTimesOf($, planFiles)
  const seen = new Set(before.toastedKeys)
  const finished: Record<string, number> = {}
  const due: string[] = []
  for (const planFile of planFiles) {
    const plan = planFile.value
    if (plan === null || planFile.isInvalid) continue
    // A plan read for the first time has no last state, whatever plan shared its name before
    const had = before.planFiles.find(beforeFile => beforeFile.name === planFile.name && isSamePlan(beforeFile, planFile))?.value ?? null
    if (had !== null) {
      for (const change of newUserNotes(had.changes, plan.changes)) due.push(`✎ Note folded into ${change.step ?? 'the plan'}: '${oneLine(change.note ?? '', 60)}'`)
    }
    const key = `done:${planFile.name}`
    if (!isPlanDone(plan) || seen.has(key)) continue
    seen.add(key)
    if (had !== null && !isPlanDone(had)) {
      finished[planFile.name] = now
      due.push(`Plan done: ${plan.title} in ${minutesText(planView(plan, stepTimes[planFile.name] ?? {}, overheadMs[planFile.name] ?? 0, {}, now).workedMs)}`)
    }
  }
  const toasted = [...seen].slice(-100)
  const doneAt = alfredRead === null ? undefined : finished[alfredRead.name] ?? before.finishedAt[alfredRead.name]
  const keep = alfredRead !== null && alfredPlan !== null && (named !== null || (doneAt !== undefined && now - doneAt < FINISH_SHOWN_MS))
  const alfred = keep && folder !== null ? { name: alfredRead.name, folder } : null
  // A folder let go leaves the project's own files as they were read
  await updatePlans($, current => ({
    ...current, planFiles: keep ? planFiles : ownPlans, scoreFiles: keep ? scoreFiles : ownScores, stepTimes, overheadMs,
    finishedAt: { ...current.finishedAt, ...finished }, toastedKeys: toasted, alfredFolder: alfred,
  }))
  for (const text of due) toast($, text)
}

// The files of `list` that none of `over` shares a name with
function without<T>(list: Watched<T>[], over: readonly Watched<unknown>[]): Watched<T>[] {
  return list.filter(file => !over.some(other => other.name === file.name))
}

// Every plan folder of Alfred Code's that holds a status file, the ALFRED_PLANS_READ written last: only those are read
async function readEveryAlfredPlan($: EngineInterface, before: Plans): Promise<{ plans: Watched<Plan>[]; scores: Watched<Scores>[] }> {
  let folders: string[]
  try {
    folders = (await $.fs.list(ALFRED_PLANS_DIR)).filter(entry => entry.kind === 'dir').map(entry => `${ALFRED_PLANS_DIR}/${entry.name}`)
  } catch {
    return { plans: [], scores: [] }
  }
  const listed: { folder: string; entries: FolderEntries; writtenMs: number }[] = []
  for (const folder of folders) {
    const entries = await $.fs.list(folder).catch((): FolderEntries => [])
    const status = entries.find(entry => entry.kind === 'file' && entry.name === ALFRED_STATUS_FILE)
    if (status !== undefined) listed.push({ folder, entries, writtenMs: status.mtimeMs })
  }
  const plans: Watched<Plan>[] = []
  const scores: Watched<Scores>[] = []
  for (const { folder, entries } of listed.sort((first, second) => second.writtenMs - first.writtenMs).slice(0, ALFRED_PLANS_READ)) {
    const read = await readAlfredFiles($, folder, entries, {
      plan: before.planFiles.find(file => file.path === `${folder}/${ALFRED_STATUS_FILE}`),
      scores: before.scoreFiles.find(file => file.path === `${folder}/${ALFRED_SCORING_FILE}`),
    }, parseAlfredStatus, parseAlfredScoring)
    // Only the status file names a plan: a copy kept from while it did says so no longer
    if (read.plan !== null) plans.push({ ...read.plan, isNamed: false })
    if (read.scores !== null) scores.push(read.scores)
  }
  return { plans, scores }
}

// Reads run one at a time, so two never raise the same toast
export function queuePlanReload($: EngineInterface, pending: Pending): void {
  pending.planRead = pending.planRead.then(() => reloadPlanFiles($, pending)).catch(() => undefined)
}

// The folders are read 300 ms after a file edit settles and after each main turn, never inside the hook
export function schedulePlanReload($: EngineInterface, pending: Pending): void {
  pending.planReload?.cancel()
  pending.planReload = $.clock.after(300, () => {
    pending.planReload = null
    queuePlanReload($, pending)
  })
}

// The plan and scores folders: listed, and each new or changed `*.json` file read, never written. A file that does not
// parse keeps its last good parse, marked invalid; one over 4 MiB is invalid unread, as `$.fs.read` refuses it.

// One listed file: its last read while unchanged since a good one, else read again; one that will not read or parse
// keeps its last good parse, marked invalid
async function readWatched<T>(
  $: EngineInterface, path: string, name: string, entry: { mtimeMs: number; size: number }, had: Watched<T> | undefined, parse: (text: string) => T | null,
): Promise<Watched<T>> {
  const { mtimeMs, size } = entry
  if (had !== undefined && !had.isInvalid && had.path === path && had.mtimeMs === mtimeMs && had.size === size) return had
  let value: T | null = null
  if (size <= MAX_PLAN_BYTES) {
    try {
      value = parse(await $.fs.read(path))
    } catch {
      value = null
    }
  }
  return value === null ? { name, mtimeMs, size, value: had?.value ?? null, isInvalid: true, path } : { name, mtimeMs, size, value, isInvalid: false, path }
}

// The files `/alfred-mods:update` copied, by path. A copy is written now, but it is as old as its source: a fresh
// mtimeMs would make an old plan look written this session. A write after the copy changes the listed mtimeMs or size,
// which ends the stand-in. A new claude run starts over.
const movedFiles = new Map<string, Moved>()

export function noteMovedFiles(moves: readonly Moved[]): void {
  for (const move of moves) movedFiles.set(move.path, move)
}

// The time a file counts as written: its source's while it is a copy the update left as it is, else the listed one.
// It changes nothing, so a second update lists the same time the plan view does.
export function originalMtime(path: string, listedMs: number, listedSize: number): number {
  return standInMtime(movedFiles.get(path), listedMs, listedSize) ?? listedMs
}

function effectiveMtime(path: string, listedMs: number, listedSize: number): number {
  const standIn = standInMtime(movedFiles.get(path), listedMs, listedSize)
  if (standIn !== null) return standIn
  movedFiles.delete(path)
  return listedMs
}

// A missing folder is empty; only `.json` files count
async function listJsonFolder($: EngineInterface, dir: string): Promise<Listed[]> {
  try {
    return (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json')).map(entry => {
      const path = `${dir}/${entry.name}`
      return { name: entry.name.slice(0, -'.json'.length), mtimeMs: effectiveMtime(path, entry.mtimeMs, entry.size), size: entry.size, path }
    })
  } catch {
    return []
  }
}

// Every folder listed, then per name only the newest file read (a tie goes to the earlier folder): the losers are never
// read. A newest file with no good parse of its own, one that will not parse or is too large, gives way to the next
// newest; a name with no good file keeps its newest, invalid. A last read counts for a file only when it came from the
// same path, so a name in two folders never takes the other's parse. Never rejects.
async function readJsonFolders<T>($: EngineInterface, dirs: string[], known: Watched<T>[], parse: (text: string) => T | null): Promise<Watched<T>[]> {
  const byFolder: Listed[][] = []
  for (const dir of dirs) byFolder.push(await listJsonFolder($, dir))
  const out: Watched<T>[] = []
  for (const candidates of candidatesByName(byFolder)) {
    let first: Watched<T> | null = null
    for (const candidate of candidates) {
      const read = await readWatched($, candidate.path, candidate.name, candidate, known.find(knownFile => knownFile.path === candidate.path), parse)
      first ??= read
      if (!read.isInvalid || read.value !== null) {
        first = read
        break
      }
    }
    if (first !== null) out.push(first)
  }
  return out
}

// Alfred Code's plan folder, the one the status file names (alfred-code's plan folder contract): its `status.json`
// and `scoring.json`, each named by the folder, as the plans folder's files are by theirs. A missing file is null; one
// unchanged since its last good read keeps it; one that will not parse keeps its last good parse, marked invalid.
async function readAlfredFolder<P, S>(
  $: EngineInterface, folder: string, known: { plan?: Watched<P>; scores?: Watched<S> },
  parsePlan: (text: string) => P | null, parseScores: (text: string, name: string) => S | null,
): Promise<{ name: string; plan: Watched<P> | null; scores: Watched<S> | null }> {
  let entries: FolderEntries
  try {
    entries = await $.fs.list(folder)
  } catch {
    return { name: folderName(folder), plan: null, scores: null }
  }
  return readAlfredFiles($, folder, entries, known, parsePlan, parseScores)
}

const folderName = (folder: string): string => folder.slice(folder.lastIndexOf('/') + 1)

// The two files of a listed plan folder
async function readAlfredFiles<P, S>(
  $: EngineInterface, folder: string, entries: FolderEntries, known: { plan?: Watched<P> | undefined; scores?: Watched<S> | undefined },
  parsePlan: (text: string) => P | null, parseScores: (text: string, name: string) => S | null,
): Promise<{ name: string; plan: Watched<P> | null; scores: Watched<S> | null }> {
  const name = folderName(folder)
  async function one<T>(file: string, had: Watched<T> | undefined, parse: (text: string) => T | null): Promise<Watched<T> | null> {
    const entry = entries.find(listed => listed.kind === 'file' && listed.name === file)
    return entry === undefined ? null : readWatched($, `${folder}/${file}`, name, entry, had, parse)
  }
  return {
    name,
    plan: await one(ALFRED_STATUS_FILE, known.plan, parsePlan),
    scores: await one(ALFRED_SCORING_FILE, known.scores, text => parseScores(text, name)),
  }
}

// A waiting call's time opened on its loop
export async function openCallWait($: EngineInterface, loop: string, callId: string, at: number): Promise<void> {
  await updateCredit($, credit => openWait(credit, loop, callId, at))
}

// The same call's wait closed; whether one was open
export async function closeCallWait($: EngineInterface, loop: string, callId: string, at: number): Promise<boolean> {
  let isClosed = false
  await updateCredit($, credit => {
    const closed = closeWait(credit, loop, callId, at)
    isClosed = closed !== null
    return closed ?? credit
  })
  return isClosed
}

// The task list a main-loop call changed, its open slices closed and reopened first
export async function followTaskTools($: EngineInterface, pending: Pending, tool: string, input: Record<string, unknown>, result: unknown): Promise<void> {
  const list = await readTasks($)
  const after = tasksAfter(list, tool, input, result)
  if (after !== null) {
    // As with a plan's steps, a status change closes and reopens the open slices first, so the time before it goes
    // to the items in progress then
    if (taskStatusKey(after) !== taskStatusKey(list)) await closeLoopSlices($, pending, null, await $.clock.now(), true)
    await updateTasks($, items => tasksAfter(items, tool, input, result) ?? items)
  }
}

// A plan's file must be written after this to run
export async function restartPlanWatch($: EngineInterface, now: number): Promise<void> {
  await updatePlans($, plans => ({ ...plans, watchedSince: now }))
}

// The same at a session's start; a reload keeps the first start's time
export async function startPlanWatch($: EngineInterface, now: number): Promise<void> {
  await updatePlans($, plans => (plans.watchedSince === null ? { ...plans, watchedSince: now } : plans))
}
