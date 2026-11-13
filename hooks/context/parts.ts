// What fills the context (spec C1): the breakdown Claude Code gives, as categories, plugins and memory files, and the
// Usage tab's three rows. No path is kept but one inside the project: a memory file elsewhere is named by its type and
// base name, so no home folder or user name reaches the atom.
import type { SessionContextBreakdown } from 'claude-code'

import { clockText, tokensText } from '../core/format'
import { baseName } from '../place/place'
import type { Parts, SkillListing } from './types'
import type { Line } from '../core/types'

export const NO_PARTS: Parts = { breakdownAt: null, categories: [], plugins: [], memory: { files: 0, tokens: 0, top: [] } }

export const slashed = (filePath: string): string => filePath.replace(/\\/g, '/')
const isDrive = (filePath: string): boolean => /^[A-Za-z]:\//.test(filePath)

// `.claude/CLAUDE.md` for a file under the project, else `User CLAUDE.md`; a Windows path compares without case. A
// session at a root or a drive root has no project to name from, and the auto memory's folder under
// `.claude/projects/` is named after a path: both would keep the user name (the release 3 review), so both take the
// type and base name.
export function memoryName(path: string, type: string, cwd: string): string {
  const file = slashed(path)
  const root = slashed(cwd).replace(/\/+$/, '')
  const fold = (filePath: string): string => (isDrive(file) ? filePath.toLowerCase() : filePath)
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

// The breakdown as the atom keeps it: `used` categories in Claude Code's order; agents by the plugin before the `:` of
// their type and skills by their plugin, most tokens first; the memory files' count, tokens and three largest. A host
// may leave a list out, so each is read as empty when absent.
export function partsOf(breakdown: SessionContextBreakdown, cwd: string, at: number, linked: ReadonlySet<string> = new Set()): Parts {
  const plugins = new Map<string, { name: string; agents: number; agentTokens: number; skills: number; skillTokens: number }>()
  const of = (name: string) => {
    const known = plugins.get(name)
    if (known !== undefined) return known
    const made = { name, agents: 0, agentTokens: 0, skills: 0, skillTokens: 0 }
    plugins.set(name, made)
    return made
  }
  for (const agent of breakdown.agents ?? []) {
    const cut = agent.agentType.indexOf(':')
    if (cut <= 0) continue
    const pluginPart = of(agent.agentType.slice(0, cut))
    pluginPart.agents += 1
    pluginPart.agentTokens += agent.tokens
  }
  for (const skill of breakdown.skills?.skillFrontmatter ?? []) {
    if (skill.pluginName === undefined || skill.pluginName === '') continue
    const pluginPart = of(skill.pluginName)
    pluginPart.skills += 1
    pluginPart.skillTokens += skill.tokens
  }
  const files = (breakdown.memoryFiles ?? []).map(memoryFile => ({ name: memoryName(memoryFile.path, memoryFile.type, cwd), tokens: memoryFile.tokens }))
  const rules = [...new Set((breakdown.memoryFiles ?? []).flatMap(memoryFile =>
    ruleName(memoryFile.path, memoryFile.type) ?? (linked.has(memoryFile.path) ? baseName(memoryFile.path) : [])))]
  const listing = breakdown.skills === undefined
    ? {}
    : { skills: { listed: breakdown.skills.includedSkills, total: breakdown.skills.totalSkills, tokens: breakdown.skills.tokens } }
  return {
    ...listing,
    ...(rules.length === 0 ? {} : { rules }),
    breakdownAt: at,
    categories: (breakdown.categories ?? []).filter(category => category.kind === 'used').map(category => ({ name: category.name, tokens: category.tokens })),
    plugins: [...plugins.values()].sort((left, right) =>
      right.agentTokens + right.skillTokens - (left.agentTokens + left.skillTokens) || left.name.localeCompare(right.name)),
    memory: {
      files: files.length,
      tokens: files.reduce((sum, memoryFile) => sum + memoryFile.tokens, 0),
      top: [...files].sort((left, right) => right.tokens - left.tokens).slice(0, 3),
    },
  }
}

// The section's label column: 'In context' fills the tab's 10 cells, so its rows take 12, as spec C1 draws them
export const PARTS_LABEL = 12
const LABEL = PARTS_LABEL

// The Usage tab's rows after Tokens; none before a breakdown
export function partsLines(parts: Parts): Line[] {
  if (parts.breakdownAt === null) return []
  const out: Line[] = []
  const used = parts.categories.map(category => `${category.name} ${tokensText(category.tokens)}`)
  out.push([{ text: 'In context', width: LABEL }, { text: [`est. ${clockText(parts.breakdownAt)}`, ...used].join(' · ') }])
  if (parts.plugins.length > 0) {
    const named = parts.plugins.map(plugin => {
      const what = [plugin.agents > 0 ? `${plugin.agents} agents` : null, plugin.skills > 0 ? `${plugin.skills} skills` : null]
        .filter((count): count is string => count !== null)
      return `${plugin.name} ${tokensText(plugin.agentTokens + plugin.skillTokens)}: ${what.join(', ')}`
    })
    out.push([{ text: 'Plugins', width: LABEL }, { text: named.join(' · ') }])
  }
  if (parts.memory.files > 0) {
    const memory = parts.memory
    const rest = memory.files - memory.top.length
    const shown = [`${memory.files} ${memory.files === 1 ? 'file' : 'files'} ${tokensText(memory.tokens)}`,
      ...memory.top.map(topFile => `${topFile.name} ${tokensText(topFile.tokens)}`), ...(rest > 0 ? [`+${rest}`] : [])]
    out.push([{ text: 'Memory', width: LABEL }, { text: shown.join(' · ') }])
  }
  return out
}

// '57 of 60 listed', or '60 listed' when the listing carries every skill
export const listedText = (listing: SkillListing): string =>
  (listing.listed === listing.total ? `${listing.total} listed` : `${listing.listed} of ${listing.total} listed`)

// The skills the main loop loaded, as 'solve-task ×2', first loaded first
export const loadedTexts = (skills: Record<string, number> | undefined): string[] =>
  Object.entries(skills ?? {}).map(([name, uses]) => `${name} ×${uses}`)
