// The plan folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Close, Credit, Plan, PlanDraw, PlanView, Plans, Scores, TaskItem, Watched } from './types'
import type { Held } from '../core/types'
import { FINISH_SHOWN_MS, PLANS_DIR, SCORES_DIR, creditedPlan, isPlanDone, newNotes, parsePlan, parseScores, planView, runs, scoresView, shownPlan, statusesOf, taskView } from './plan'
import { closeOf, closeSlices, liveSpans, mineOf, overheadKey, sliceMs, stepKey, sumTimes } from './steptime'
import { parseAlfredScoring, parseAlfredStatus } from './alfredplan'
import { mins, oneLine } from '../core/format'
import { scoresLabel } from './planlines'
import { toast } from '../core/effects'
import { isLive, markOf } from '../agents/agents'
import { readStack } from '../stack/effects'
import { readView } from '../inspect/effects'
import { readAgents } from '../agents/effects'

const INITIAL_PLANS: Plans = { plans: [], scores: [], times: {}, overhead: {}, finished: {}, toasted: [], since: null, alfred: null }
const plansAtom = atom({ plugin: 'alfred-mods', key: 'plans' } as const, INITIAL_PLANS, { shape: 'plans-2' })
export function readPlans($: EngineInterface) {
  return read($, plansAtom)
}
export function updatePlans($: EngineInterface, change: (value: Plans) => Plans) {
  return update($, plansAtom, change)
}
export function resetPlans($: EngineInterface) {
  return update($, plansAtom, () => INITIAL_PLANS)
}

const INITIAL_CREDIT: Credit = { slices: {}, mine: {} }
const creditAtom = atom({ plugin: 'alfred-mods', key: 'credit' } as const, INITIAL_CREDIT, { shape: 'credit-1' })
export function readCredit($: EngineInterface) {
  return read($, creditAtom)
}
export function updateCredit($: EngineInterface, change: (value: Credit) => Credit) {
  return update($, creditAtom, change)
}
export function resetCredit($: EngineInterface) {
  return update($, creditAtom, () => INITIAL_CREDIT)
}

const INITIAL_TASKS: TaskItem[] = []
const tasksAtom = atom({ plugin: 'alfred-mods', key: 'tasks' } as const, INITIAL_TASKS, { shape: 'tasks-1' })
export function readTasks($: EngineInterface) {
  return read($, tasksAtom)
}
export function updateTasks($: EngineInterface, change: (value: TaskItem[]) => TaskItem[]) {
  return update($, tasksAtom, change)
}
export function resetTasks($: EngineInterface) {
  return update($, tasksAtom, () => INITIAL_TASKS)
}

// Every session's step and overhead time in the store; this session's own totals are the credit atom's
export async function storedTimes($: EngineInterface): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith('step:') || key.startsWith('overhead:')) entries[key] = await $.store.get(key)
  }
  return entries
}

// Each plan's time: every other session's from the store, this session's from its own totals
export async function timesOf($: EngineInterface, files: Watched<Plan>[]): Promise<Pick<Plans, 'times' | 'overhead'>> {
  const entries = { ...(await storedTimes($)), ...(await readCredit($)).mine }
  const times: Plans['times'] = {}
  const overhead: Plans['overhead'] = {}
  for (const w of files) {
    const sum = sumTimes(entries, w.name)
    times[w.name] = sum.times
    overhead[w.name] = sum.overhead
  }
  return { times, overhead }
}

// The loops named (every open one when null) close at `now`: each span goes to its keys (Decision 9) in one update,
// so a span two closers race for counts once. This session's totals are then stored whole, in order.
export async function closeLoops($: EngineInterface, held: Held, loops: string[] | null, now: number, reopen: boolean, given?: Plans): Promise<void> {
  const c = await readCredit($)
  const open = Object.keys(c.slices).filter(loop => loops === null || loops.includes(loop))
  if (open.length === 0) return
  const p = given ?? await readPlans($)
  const rows = await readAgents($)
  const shown = creditedPlan(p, (await readView($)).planSlug, (await readTasks($)).length > 0)
  const closes = await closesOf($, c, open, p, shown)
  let spans: Record<string, number> = {}
  const after = await updateCredit($, cur => {
    const closed = closeSlices(cur, closes, now, reopen)
    spans = closed.spans
    return closed.credit
  })
  // With the task list shown, the main loop's span and those of agents whose spawn was seen go to its running items
  if (shown === 'tasks') {
    const ms = Object.entries(spans).filter(([loop]) => loop === 'main' || rows.some(r => r.id === loop)).reduce((n, [, x]) => n + x, 0)
    const running = (await readTasks($)).filter(t => t.status === 'in_progress').length
    if (ms > 0 && running > 0) {
      await updateTasks($, list => {
        const n = list.filter(t => t.status === 'in_progress').length
        return n === 0 ? list : list.map(t => (t.status === 'in_progress' ? { ...t, ms: t.ms + ms / n } : t))
      })
    }
  }
  const keys = [...new Set(closes.flatMap(x => x.keys))]
  for (const key of keys) {
    const t = after.mine[key]
    if (t === undefined) continue
    const value = key.startsWith('overhead:') ? { ms: t.ms, at: now } : { ms: t.ms, isShared: t.isShared, at: now }
    held.writes = held.writes.then(() => $.store.set(key, value)).catch(() => undefined)
  }
  await held.writes
  if (keys.length === 0) return
  const files = (await readPlans($)).plans
  const sums = await timesOf($, files)
  await updatePlans($, x => ({ ...x, ...sums }))
}

// Where each named open loop's span goes (Decision 9)
export async function closesOf($: EngineInterface, c: Credit, loops: string[], p: Plans, shown: Watched<Plan> | 'tasks' | null): Promise<Close[]> {
  const rows = await readAgents($)
  const session = await $.session.id()
  return loops.map(loop => {
    const row = rows.find(r => r.id === loop)
    const lines = loop === 'main' ? null : row === undefined ? undefined : { plan: row.plan, task: row.task }
    const slice = c.slices[loop] ?? { at: 0, waitMs: 0, named: [] }
    return closeOf(loop, slice, lines, p.plans, p.since, shown === 'tasks' ? null : shown, session)
  })
}

// The open slices' time so far, by step id (or task id) and as overhead, for the shown plan or task list to draw
export async function liveOf($: EngineInterface, p: Plans, shown: Watched<Plan> | 'tasks' | null, now: number): Promise<{ steps: Record<string, number>; overhead: number }> {
  const c = await readCredit($)
  const loops = Object.keys(c.slices)
  if (loops.length === 0 || shown === null) return { steps: {}, overhead: 0 }
  if (shown === 'tasks') {
    const rows = await readAgents($)
    const ms = loops.filter(loop => loop === 'main' || rows.some(r => r.id === loop))
      .reduce((n, loop) => n + sliceMs(c.slices[loop] ?? { at: now, waitMs: 0, named: [] }, now), 0)
    const running = (await readTasks($)).filter(t => t.status === 'in_progress')
    return { steps: Object.fromEntries(running.map(t => [t.id, ms / running.length])), overhead: 0 }
  }
  const spans = liveSpans(c, await closesOf($, c, loops, p, shown), now)
  const session = await $.session.id()
  const steps: Record<string, number> = {}
  for (const s of shown.value?.steps ?? []) {
    const ms = spans[stepKey(shown.name, s.id, session)]
    if (ms !== undefined) steps[s.id] = ms
  }
  return { steps, overhead: spans[overheadKey(shown.name, session)] ?? 0 }
}

export async function planDraw($: EngineInterface, now: number): Promise<PlanDraw> {
  const p = await readPlans($)
  const items = await readTasks($)
  const pinned = (await readView($)).planSlug
  const shown = shownPlan(p, pinned, items.length > 0)
  const credited = creditedPlan(p, pinned, items.length > 0)
  const tab = await drawnPlan($, p, items, shown, now)
  const band = credited === shown ? tab : await drawnPlan($, p, items, credited, now)
  const nameOf = (w: Watched<Plan> | 'tasks' | null): string | null => (w === null || w === 'tasks' ? null : w.name)
  const name = nameOf(shown)
  const scored = p.scores.filter((w): w is Watched<Scores> & { value: Scores } => w.value !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const ownOf = (n: string | null) => (n === null ? undefined : scored.find(w => w.value.subject.kind === 'plan' && w.value.subject.ref === n))
  const full = name === null ? scored[0] : ownOf(name)
  const own = ownOf(nameOf(credited))
  const newest = own ?? scored[0]
  return {
    shown: tab.v, band: band.isRunning ? band.v : null, invalid: shown !== null && shown !== 'tasks' && shown.isInvalid,
    scores: full === undefined ? null : scoresView(full.value), score: newest === undefined ? null : scoresView(newest.value),
    isPlanScore: own !== undefined,
    others: p.plans.filter(w => w.name !== name).map(w => (w.value === null ? `${w.name} (invalid)` : w.name)).sort(),
    otherScores: scored.filter(w => w !== full).slice(0, 3).map(w => scoresLabel(w.name, w.value)),
    updatedAt: shown === null || shown === 'tasks' ? null : shown.value?.updatedAt ?? null,
  }
}

// One plan's view with its live time, and whether the band draws it
export async function drawnPlan($: EngineInterface, p: Plans, items: TaskItem[], w: Watched<Plan> | 'tasks' | null, now: number): Promise<{ v: PlanView | null; isRunning: boolean }> {
  const live = await liveOf($, p, w, now)
  if (w === 'tasks') {
    return { v: taskView(items, live.steps), isRunning: items.some(t => t.status !== 'completed') && items.some(t => t.status !== 'pending') }
  }
  if (w === null || w.value === null) return { v: null, isRunning: false }
  const doneAt = p.finished[w.name]
  const v = planView(w.value, p.times[w.name] ?? {}, (p.overhead[w.name] ?? 0) + live.overhead, live.steps, now)
  // Alfred Code's named plan draws while open, begun or awaiting approval
  const isNamed = p.alfred !== null && p.alfred !== undefined && p.alfred.name === w.name && !v.isFinished
  return { v, isRunning: isNamed || runs(w, p.since) || (doneAt !== undefined && now - doneAt < FINISH_SHOWN_MS) }
}

// A loop's slice opens at its turn's start; the main slice marks each live agent that names a step
export async function openSlice($: EngineInterface, loop: string, now: number): Promise<void> {
  const named = loop === 'main' ? (await readAgents($)).filter(r => isLive(r.status)).map(markOf).filter((m): m is string => m !== null) : []
  await updateCredit($, c => ({ ...c, slices: { ...c.slices, [loop]: { at: now, waitMs: 0, named } } }))
}

// An agent naming a step, spawned or starting a turn while the main loop's turn runs, makes that turn overhead
export async function addMark($: EngineInterface, mark: string | null): Promise<void> {
  if (mark === null) return
  const main = (await readCredit($)).slices.main
  if (main === undefined || main.named.includes(mark)) return
  await updateCredit($, c => {
    const m = c.slices.main
    return m === undefined || m.named.includes(mark) ? c : { ...c, slices: { ...c.slices, main: { ...m, named: [...m.named, mark] } } }
  })
}

// A wait known only once its call settles goes to the slice open now, at most that slice's age, so a slice reopened
// during the call never loses the work after the reopen
export async function addWait($: EngineInterface, loop: string, ms: number, now: number): Promise<void> {
  if (ms <= 0 || (await readCredit($)).slices[loop] === undefined) return
  await updateCredit($, c => {
    const s = c.slices[loop]
    return s === undefined ? c : { ...c, slices: { ...c.slices, [loop]: { ...s, waitMs: s.waitMs + Math.min(ms, Math.max(0, now - s.at)) } } }
  })
}

// A session resumed under its own id starts from its stored totals, so its first close adds to them
export async function seedMine($: EngineInterface): Promise<void> {
  if (Object.keys((await readCredit($)).mine).length > 0) return
  const mine = mineOf(await storedTimes($), await $.session.id())
  if (Object.keys(mine).length > 0) await updateCredit($, c => ({ ...c, mine: { ...mine, ...c.mine } }))
}

// The plan and scores folders read again. A step whose status changed closes and reopens the open slices first, so
// the time before the change goes to the steps that were running then. A note the file's previous good parse this
// session lacks, and a plan that finishes this session (its previous good parse unfinished), raise their toasts once.
export async function reloadPlans($: EngineInterface, held: Held): Promise<void> {
  const before = await readPlans($)
  const now = await $.clock.now()
  const ownPlans = await readFolder($, PLANS_DIR, before.plans, parsePlan)
  const ownScores = await readFolder($, SCORES_DIR, before.scores, parseScores)
  // Alfred Code's plan folder: the one its status file names, else the one it let go, read once more to see it
  // finished, then kept 10 minutes after it finished
  // A status file that will not read, or whose `plan` will not, says nothing: the plan it named stays named
  const s = await readStack($)
  const isSaid = s.state === 'used' && !s.ignored.includes('plan')
  const named = isSaid ? s.plan : before.alfred?.folder ?? null
  const lingering = named === null ? before.alfred : null
  const folder = named ?? lingering?.folder ?? null
  // The last read is this folder's only when the folder is the same, so a new folder never shows the old plan
  const isSame = before.alfred !== null && before.alfred !== undefined && before.alfred.folder === folder
  const alfredRead = folder === null ? null : await readPlanFolder($, folder, {
    plan: isSame ? before.plans.find(w => w.name === before.alfred?.name) : undefined,
    scores: isSame ? before.scores.find(w => w.name === before.alfred?.name) : undefined,
  }, parseAlfredStatus, parseAlfredScoring)
  // The folder's files stand in for a same-named plan or scores file of the project's own folder while they exist
  const alfredPlan = alfredRead?.plan ? { ...alfredRead.plan, isNamed: named !== null } : null
  const alfredScores = alfredRead?.scores ?? null
  const without = <T>(list: Watched<T>[], over: Watched<unknown> | null): Watched<T>[] => (over === null ? list : list.filter(w => w.name !== over.name))
  const planFiles = [...without(ownPlans, alfredPlan), ...(alfredPlan === null ? [] : [alfredPlan])]
  const scoreFiles = [...without(ownScores, alfredScores), ...(alfredScores === null ? [] : [alfredScores])]
  if (statusesOf(before.plans) !== statusesOf(planFiles)) await closeLoops($, held, null, now, true, before)
  const { times, overhead } = await timesOf($, planFiles)
  const seen = new Set(before.toasted)
  const finished: Record<string, number> = {}
  const due: string[] = []
  for (const w of planFiles) {
    const plan = w.value
    if (plan === null || w.isInvalid) continue
    // A folder read for the first time has no last state, whatever plan shared its name before
    const had = w === alfredPlan && !isSame ? null : before.plans.find(b => b.name === w.name)?.value ?? null
    if (had !== null) {
      for (const c of newNotes(had.changes, plan.changes)) due.push(`✎ Note folded into ${c.step ?? 'the plan'}: '${oneLine(c.note ?? '', 60)}'`)
    }
    const key = `done:${w.name}`
    if (!isPlanDone(plan) || seen.has(key)) continue
    seen.add(key)
    if (had !== null && !isPlanDone(had)) {
      finished[w.name] = now
      due.push(`Plan done: ${plan.title} in ${mins(planView(plan, times[w.name] ?? {}, overhead[w.name] ?? 0, {}, now).workedMs)}`)
    }
  }
  const toasted = [...seen].slice(-100)
  const doneAt = alfredRead === null ? undefined : finished[alfredRead.name] ?? before.finished[alfredRead.name]
  const keep = alfredRead !== null && alfredPlan !== null && (named !== null || (doneAt !== undefined && now - doneAt < FINISH_SHOWN_MS))
  const alfred = keep && folder !== null ? { name: alfredRead.name, folder } : null
  // A folder let go leaves the project's own files as they were read
  await updatePlans($, p => ({
    ...p, plans: keep ? planFiles : ownPlans, scores: keep ? scoreFiles : ownScores, times, overhead,
    finished: { ...p.finished, ...finished }, toasted, alfred,
  }))
  for (const text of due) toast($, text)
}

// Reads run one at a time, so two never raise the same toast
export function queueReload($: EngineInterface, held: Held): void {
  held.reading = held.reading.then(() => reloadPlans($, held)).catch(() => undefined)
}

// The folders are read 300 ms after a file edit settles and after each main turn, never inside the hook
export function scheduleReload($: EngineInterface, held: Held): void {
  held.reload?.cancel()
  held.reload = $.clock.after(300, () => {
    held.reload = null
    queueReload($, held)
  })
}

// The plan and scores folders: listed, and each new or changed `*.json` file read, never written. A file that does not
// parse keeps its last good parse, marked invalid; one over 4 MiB is invalid unread, as `$.fs.read` refuses it.
const MAX_BYTES = 4 * 1024 * 1024

// Never rejects: a missing folder is empty, a file that will not read is invalid
export async function readFolder<T>($: EngineInterface, dir: string, known: Watched<T>[], parse: (text: string) => T | null): Promise<Watched<T>[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const out: Watched<T>[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const name = entry.name.slice(0, -'.json'.length)
    const had = known.find(w => w.name === name)
    const { mtimeMs, size } = entry
    if (had !== undefined && !had.isInvalid && had.mtimeMs === mtimeMs && had.size === size) {
      out.push(had)
      continue
    }
    let value: T | null = null
    if (size <= MAX_BYTES) {
      try {
        value = parse(await $.fs.read(`${dir}/${entry.name}`))
      } catch {
        value = null
      }
    }
    out.push(value === null ? { name, mtimeMs, size, value: had?.value ?? null, isInvalid: true } : { name, mtimeMs, size, value, isInvalid: false })
  }
  return out
}

// Alfred Code's plan folder, the one the status file names (alfred-code's plan folder contract): its `status.json`
// and `scoring.json`, each named by the folder, as the plans folder's files are by theirs. A missing file is null; one
// unchanged since its last good read keeps it; one that will not parse keeps its last good parse, marked invalid.
export async function readPlanFolder<P, S>(
  $: EngineInterface, folder: string, known: { plan?: Watched<P>; scores?: Watched<S> },
  parsePlan: (text: string) => P | null, parseScores: (text: string, name: string) => S | null,
): Promise<{ name: string; plan: Watched<P> | null; scores: Watched<S> | null }> {
  const name = folder.slice(folder.lastIndexOf('/') + 1)
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(folder)
  } catch {
    return { name, plan: null, scores: null }
  }
  async function one<T>(file: string, had: Watched<T> | undefined, parse: (text: string) => T | null): Promise<Watched<T> | null> {
    const entry = entries.find(e => e.kind === 'file' && e.name === file)
    if (entry === undefined) return null
    const { mtimeMs, size } = entry
    if (had !== undefined && !had.isInvalid && had.mtimeMs === mtimeMs && had.size === size) return had
    let value: T | null = null
    if (size <= MAX_BYTES) {
      try {
        value = parse(await $.fs.read(`${folder}/${file}`))
      } catch {
        value = null
      }
    }
    return value === null ? { name, mtimeMs, size, value: had?.value ?? null, isInvalid: true } : { name, mtimeMs, size, value, isInvalid: false }
  }
  return {
    name,
    plan: await one('status.json', known.plan, parsePlan),
    scores: await one('scoring.json', known.scores, text => parseScores(text, name)),
  }
}


