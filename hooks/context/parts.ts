// What fills the context (spec C1): the breakdown Claude Code gives, as categories, plugins and memory files, and the
// Usage tab's three rows. No path is kept but one inside the project: a memory file elsewhere is named by its type and
// base name, so no home folder or user name reaches the atom.
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'

import { clock, tokens } from '../core/format'
import { baseName } from '../place/place'
import type { Line } from '../band/band'
import type { Parts, SkillListing } from '../../types'

export const NO_PARTS: Parts = { at: null, categories: [], plugins: [], memory: { files: 0, tokens: 0, top: [] } }

const slashed = (p: string): string => p.replace(/\\/g, '/')
const isDrive = (p: string): boolean => /^[A-Za-z]:\//.test(p)

// `.claude/CLAUDE.md` for a file under the project, else `User CLAUDE.md`; a Windows path compares without case. A
// session at a root or a drive root has no project to name from, and the auto memory's folder under
// `.claude/projects/` is named after a path: both would keep the user name (the release 3 review), so both take the
// type and base name.
export function memoryName(path: string, type: string, cwd: string): string {
  const file = slashed(path)
  const root = slashed(cwd).replace(/\/+$/, '')
  const fold = (p: string): string => (isDrive(file) ? p.toLowerCase() : p)
  const isRoot = root === '' || /^[A-Za-z]:$/.test(root)
  if (!isRoot && fold(file).startsWith(`${fold(root)}/`)) {
    const inside = file.slice(root.length + 1)
    if (!/(^|\/)\.claude\/projects\//.test(inside)) return inside
  }
  return `${type} ${file.split('/').pop() ?? ''}`
}

// A rule file's base name, else null: a `rules` folder directly inside a `.claude` folder, or a User file under any
// `rules` folder (a CLAUDE_CONFIG_DIR not named .claude); `\` read as `/`. Only the name is kept, never its folder.
export function ruleName(path: string, type: string): string | null {
  const file = slashed(path)
  const isRule = /\/\.claude\/rules\//.test(file) || (type === 'User' && /\/rules\//.test(file))
  return isRule ? baseName(file) : null
}

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

// The breakdown as the atom keeps it: `used` categories in Claude Code's order; agents by the plugin before the `:` of
// their type and skills by their plugin, most tokens first; the memory files' count, tokens and three largest. A host
// may leave a list out, so each is read as empty when absent.
export function partsOf(b: SessionContextBreakdown, cwd: string, at: number, linked: ReadonlySet<string> = new Set()): Parts {
  const plugins = new Map<string, { name: string; agents: number; agentTokens: number; skills: number; skillTokens: number }>()
  const of = (name: string) => {
    const known = plugins.get(name)
    if (known !== undefined) return known
    const made = { name, agents: 0, agentTokens: 0, skills: 0, skillTokens: 0 }
    plugins.set(name, made)
    return made
  }
  for (const a of b.agents ?? []) {
    const cut = a.agentType.indexOf(':')
    if (cut <= 0) continue
    const p = of(a.agentType.slice(0, cut))
    p.agents += 1
    p.agentTokens += a.tokens
  }
  for (const s of b.skills?.skillFrontmatter ?? []) {
    if (s.pluginName === undefined || s.pluginName === '') continue
    const p = of(s.pluginName)
    p.skills += 1
    p.skillTokens += s.tokens
  }
  const files = (b.memoryFiles ?? []).map(f => ({ name: memoryName(f.path, f.type, cwd), tokens: f.tokens }))
  const rules = [...new Set((b.memoryFiles ?? []).flatMap(f => ruleName(f.path, f.type) ?? (linked.has(f.path) ? baseName(f.path) : [])))]
  const listing = b.skills === undefined ? {} : { skills: { listed: b.skills.includedSkills, total: b.skills.totalSkills, tokens: b.skills.tokens } }
  return {
    ...listing,
    ...(rules.length === 0 ? {} : { rules }),
    at,
    categories: (b.categories ?? []).filter(c => c.kind === 'used').map(c => ({ name: c.name, tokens: c.tokens })),
    plugins: [...plugins.values()].sort((x, y) => y.agentTokens + y.skillTokens - (x.agentTokens + x.skillTokens) || x.name.localeCompare(y.name)),
    memory: {
      files: files.length,
      tokens: files.reduce((sum, f) => sum + f.tokens, 0),
      top: [...files].sort((x, y) => y.tokens - x.tokens).slice(0, 3),
    },
  }
}

// The section's label column: 'In context' fills the tab's 10 cells, so its rows take 12, as spec C1 draws them
export const PARTS_LABEL = 12
const LABEL = PARTS_LABEL

// The Usage tab's rows after Tokens; none before a breakdown
export function partsLines(p: Parts): Line[] {
  if (p.at === null) return []
  const out: Line[] = []
  const used = p.categories.map(c => `${c.name} ${tokens(c.tokens)}`)
  out.push([{ text: 'In context', width: LABEL }, { text: [`est. ${clock(p.at)}`, ...used].join(' · ') }])
  if (p.plugins.length > 0) {
    const named = p.plugins.map(x => {
      const what = [x.agents > 0 ? `${x.agents} agents` : null, x.skills > 0 ? `${x.skills} skills` : null].filter((s): s is string => s !== null)
      return `${x.name} ${tokens(x.agentTokens + x.skillTokens)}: ${what.join(', ')}`
    })
    out.push([{ text: 'Plugins', width: LABEL }, { text: named.join(' · ') }])
  }
  if (p.memory.files > 0) {
    const m = p.memory
    const rest = m.files - m.top.length
    const shown = [`${m.files} ${m.files === 1 ? 'file' : 'files'} ${tokens(m.tokens)}`, ...m.top.map(t => `${t.name} ${tokens(t.tokens)}`), ...(rest > 0 ? [`+${rest}`] : [])]
    out.push([{ text: 'Memory', width: LABEL }, { text: shown.join(' · ') }])
  }
  return out
}

// '57 of 60 listed', or '60 listed' when the listing carries every skill
export const listedText = (l: SkillListing): string => (l.listed === l.total ? `${l.total} listed` : `${l.listed} of ${l.total} listed`)

// The skills the main loop loaded, as 'solve-task ×2', first loaded first
export const loadedTexts = (skills: Record<string, number> | undefined): string[] =>
  Object.entries(skills ?? {}).map(([name, n]) => `${name} ×${n}`)
