// What fills the context (spec C1): the breakdown Claude Code gives, as categories, plugins and memory files, and the
// Usage tab's three rows. No path is kept but one inside the project: a memory file elsewhere is named by its type and
// base name, so no home folder or user name reaches the atom.
import type { SessionContextBreakdown } from 'claude-code'

import { clock, tokens } from './format.ts'
import type { Line } from './band.ts'
import type { Parts } from '../types'

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

// The breakdown as the atom keeps it: `used` categories in Claude Code's order; agents by the plugin before the `:` of
// their type and skills by their plugin, most tokens first; the memory files' count, tokens and three largest. A host
// may leave a list out, so each is read as empty when absent.
export function partsOf(b: SessionContextBreakdown, cwd: string, at: number): Parts {
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
  return {
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

// The section's label column: 'In context' fills the tab's 10 cells, so its three rows take 12, as spec C1 draws them
const LABEL = 12

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
