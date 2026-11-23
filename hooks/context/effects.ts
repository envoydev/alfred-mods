// The context folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'
import type { Parts } from './types'
import { NO_PARTS, partsOf } from './parts'
import { TRAILING_SLASHES } from './constants'
import { assumedRuleEntry, ruleEntry, ruleName, slashed } from './rules'
import { baseName } from '../place/place'
import type { HookInput, HookNext } from '../core/types'
import { addPathRules } from '../session/effects'

const INITIAL_PARTS: Parts = NO_PARTS
const partsAtom = atom({ plugin: 'alfred-mods', key: 'parts' } as const, INITIAL_PARTS, { shape: 'parts-3' })
export function readParts($: EngineInterface) {
  return read($, partsAtom)
}
function updateParts($: EngineInterface, change: (value: Parts) => Parts) {
  return update($, partsAtom, change)
}
export function resetParts($: EngineInterface) {
  return update($, partsAtom, () => INITIAL_PARTS)
}

// The time of the last breakdown read that gave one, for the Usage tab's 60-second rule (spec C1)
const breakdownMemory = { lastAt: null as number | null }

// The link ends the last breakdown read walked, slashed real paths: module memory, which no other plugin reads, so the
// absolute paths never reach `$.state`. Empty before a read.
const linkMemory = { ends: [] as readonly string[] }
export function linkEnds(): readonly string[] {
  return linkMemory.ends
}

// The project root, where nested rules are read from; the working folder where the root is not known
async function rootOf($: EngineInterface): Promise<string> {
  return $.session.root().catch(() => $.session.cwd())
}

// The memory files a link under the project's `.claude/rules/` reaches: the breakdown names such a rule by where the
// link lands (live, 2026-11-11), so an import there looks the same until both sides are resolved. Asked only of a file
// that is no CLAUDE.md, no rule by its folder and no auto memory, so a session with none lists no folder.
async function findLinkedRules($: EngineInterface, breakdown: SessionContextBreakdown, root: string): Promise<Set<string>> {
  const unplaced = (breakdown.memoryFiles ?? []).filter(memoryFile =>
    memoryFile.type !== 'AutoMem' && ruleName(memoryFile.path, memoryFile.type) === null && !/^CLAUDE(\.local)?\.md$/.test(baseName(memoryFile.path)))
  linkMemory.ends = []
  if (unplaced.length === 0) return new Set()
  const ends: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.isLink) {
        const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
        if (real !== undefined) ends.push(slashed(real).replace(TRAILING_SLASHES, ''))
      } else if (entry.kind === 'dir' && depth < 3) await walk(path, depth + 1)
    }
  }
  await walk(`${slashed(root).replace(TRAILING_SLASHES, '')}/.claude/rules`, 0)
  linkMemory.ends = ends
  const found = new Set<string>()
  if (ends.length === 0) return found
  for (const memoryFile of unplaced) {
    const real = (await $.fs.stat(memoryFile.path, { resolve: true }).catch(() => undefined))?.realPath
    const file = real === undefined ? null : slashed(real)
    if (file !== null && ends.some(end => file === end || file.startsWith(`${end}/`))) found.add(memoryFile.path)
  }
  return found
}

// One breakdown read serves the compaction point and the context's parts (spec C1): a read that gives one writes the
// parts atom; a read that fails or gives none is null, and the parts stay as they were
export async function readBreakdown($: EngineInterface): Promise<SessionContextBreakdown | null> {
  let breakdown: SessionContextBreakdown | undefined
  try {
    breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  } catch {
    return null
  }
  if (breakdown === undefined) return null
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const root = await rootOf($)
  const linked = await findLinkedRules($, breakdown, root)
  const next = partsOf(breakdown, cwd, now, linked, root, linkEnds())
  breakdownMemory.lastAt = now
  await updateParts($, () => next)
  return breakdown
}

// A read off the hook path, after a compaction or as the Usage tab opens stale (spec C1)
export function readBreakdownSoon($: EngineInterface): void {
  $.clock.after(0, () => {
    readBreakdown($).catch(() => undefined)
  })
}

export async function trackRuleLoad($: EngineInterface, e: HookInput<'classic.InstructionsLoaded'>, next: HookNext<'classic.InstructionsLoaded'>) {
  if (e.agent_id === undefined && (e.load_reason === 'path_glob_match' || e.load_reason === 'nested_traversal')) {
    const root = await rootOf($)
    const entry = ruleEntry(e.file_path, e.memory_type, root, linkEnds())
      ?? (e.load_reason === 'path_glob_match' ? assumedRuleEntry(e.file_path, e.memory_type, root) : null)
    if (entry !== null) await addPathRules($, [entry])
  }
  return next(e)
}

// Whether the context's parts were last read over a minute ago, or never
export async function isBreakdownStale($: EngineInterface): Promise<boolean> {
  return breakdownMemory.lastAt === null || (await $.clock.now()) - breakdownMemory.lastAt > 60_000
}

// The context's parts are read afresh on the next Usage tab
export function forgetBreakdown(): void {
  breakdownMemory.lastAt = null
}
