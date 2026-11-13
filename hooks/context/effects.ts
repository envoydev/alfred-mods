// The context folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'
import type { Parts } from './types'
import { NO_PARTS, partsOf, ruleName, slashed } from './parts'
import { baseName } from '../place/place'
import type { HookInput, HookNext } from '../core/types'
import { addPathRule } from '../session/effects'

const INITIAL_PARTS: Parts = NO_PARTS
const partsAtom = atom({ plugin: 'alfred-mods', key: 'parts' } as const, INITIAL_PARTS, { shape: 'parts-1' })
export function readParts($: EngineInterface) {
  return read($, partsAtom)
}
export function updateParts($: EngineInterface, change: (value: Parts) => Parts) {
  return update($, partsAtom, change)
}
export function resetParts($: EngineInterface) {
  return update($, partsAtom, () => INITIAL_PARTS)
}

// The time of the last breakdown read that gave one, for the Usage tab's 60-second rule (spec C1)
export const partsMem = { lastAt: null as number | null }

// The memory files a link under the project's `.claude/rules/` reaches: the breakdown names such a rule by where the
// link lands (live, 2026-11-11), so an import there looks the same until both sides are resolved. Asked only of a file
// that is no CLAUDE.md, no rule by its folder and no auto memory, so a session with none lists no folder.
export async function linkedRules($: EngineInterface, b: SessionContextBreakdown, cwd: string): Promise<Set<string>> {
  const unplaced = (b.memoryFiles ?? []).filter(f => f.type !== 'AutoMem' && ruleName(f.path, f.type) === null && !/^CLAUDE(\.local)?\.md$/.test(baseName(f.path)))
  if (unplaced.length === 0) return new Set()
  const ends: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.isLink) {
        const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
        if (real !== undefined) ends.push(slashed(real).replace(/\/+$/, ''))
      } else if (entry.kind === 'dir' && depth < 3) await walk(path, depth + 1)
    }
  }
  await walk(`${slashed(cwd).replace(/\/+$/, '')}/.claude/rules`, 0)
  const found = new Set<string>()
  if (ends.length === 0) return found
  for (const f of unplaced) {
    const real = (await $.fs.stat(f.path, { resolve: true }).catch(() => undefined))?.realPath
    const file = real === undefined ? null : slashed(real)
    if (file !== null && ends.some(end => file === end || file.startsWith(`${end}/`))) found.add(f.path)
  }
  return found
}

// One breakdown read serves the compaction point and the context's parts (spec C1): a read that gives one writes the
// parts atom; a read that fails or gives none is null, and the parts stay as they were
export async function readBreakdown($: EngineInterface): Promise<SessionContextBreakdown | null> {
  let b: SessionContextBreakdown | undefined
  try {
    b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  } catch {
    return null
  }
  if (b === undefined) return null
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const next = partsOf(b, cwd, now, await linkedRules($, b, cwd))
  partsMem.lastAt = now
  await updateParts($, () => next)
  return b
}

// A read off the hook path, after a compaction or as the Usage tab opens stale (spec C1)
export function readBreakdownSoon($: EngineInterface): void {
  $.clock.after(0, () => {
    readBreakdown($).catch(() => undefined)
  })
}

export async function noteLoadedRule($: EngineInterface, e: HookInput<'classic.InstructionsLoaded'>, next: HookNext<'classic.InstructionsLoaded'>) {
  const byPath = e.load_reason === 'path_glob_match' ? baseName(e.file_path) : e.load_reason === 'nested_traversal' ? ruleName(e.file_path, e.memory_type) : null
  const name = e.agent_id === undefined ? byPath : null
  if (name !== null) await addPathRule($, name)
  return next(e)
}


