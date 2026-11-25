// The plan files' reads: the mod's plan and scores folders, and Alfred Code's plan folders. Read, never written; the
// plan folder's effects keep what these return.
import type { EngineInterface } from 'claude-code'
import { ALFRED_PLANS_DIR, ALFRED_PLANS_READ, ALFRED_SCORING_FILE, ALFRED_STATUS_FILE, MAX_PLAN_BYTES } from '../plan/constants'
import { parseAlfredScoring, parseAlfredStatus } from '../plan/alfredplan'
import { standInMtime } from '../plan/moved'
import { candidatesByName } from '../plan/plan'
import type { FolderEntries, Listed, Moved, Plan, Plans, Scores, Watched } from '../plan/types'

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
export async function readJsonFolders<T>($: EngineInterface, dirs: string[], known: Watched<T>[], parse: (text: string) => T | null): Promise<Watched<T>[]> {
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
export async function readAlfredFolder<P, S>(
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

// Every plan folder of Alfred Code's that holds a status file, the ALFRED_PLANS_READ written last: only those are read
export async function readEveryAlfredPlan($: EngineInterface, before: Plans): Promise<{ plans: Watched<Plan>[]; scores: Watched<Scores>[] }> {
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
