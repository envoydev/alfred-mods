// The band's detail rows: tools, skills, rules and agents, each with its label
import { isLive } from '../agents/agents'
import { listedText, loadedTexts } from '../context/parts'
import type { AgentRow } from '../agents/types'
import type { BandInput, RulesInput } from './types'
import type { ToolStat } from '../tools/types'
import type { Line, Seg } from '../core/types'
import { wrapRows } from './wrap'

const isSkill = (key: string): boolean => key.startsWith('Skill: ')

// The session's tools by calls, most first (ties by name), Skill calls apart
function toolsByCalls(stats: Record<string, ToolStat> | undefined): [string, ToolStat][] {
  return Object.entries(stats ?? {})
    .filter(([key, s]) => s.calls > 0 && !isSkill(key))
    .sort(([ka, a], [kb, stat]) => stat.calls - a.calls || (ka < kb ? -1 : ka > kb ? 1 : 0))
}

// The counts of what the detail rows list (spec 2026-11-11, D5; settings-values S6, once a toggle): the tool calls, the
// main chat's skills, the agents dispatched (and how many run) and the rules, each only above 0; its forms drop the
// rules, then the agents, then the skills. None with nothing counted.
export function toggleForms(input: BandInput): Line[] {
  const count = (n: number, one: string): string | null => (n === 0 ? null : `${n} ${one}${n === 1 ? '' : 's'}`)
  const calls = toolsByCalls(input.stats).reduce((n, [, stat]) => n + stat.calls, 0)
  const dispatched = Object.values(input.session.agentTypes ?? {}).reduce((n, k) => n + k, 0)
  const running = input.agents.filter(row => isLive(row.status)).length
  const drawn = rulesDrawn(input.rules ?? NO_RULES)
  const tools = count(calls, 'tool')
  const skills = count(Object.keys(input.session.skills ?? {}).length, 'skill')
  const agents = count(dispatched, 'agent')
  const rules = count(drawn.always.length + drawn.byPath.length, 'rule')
  if (tools === null && skills === null && agents === null && rules === null) return []
  const parts = (...of: (string | null)[]): string[] => of.filter((p): p is string => p !== null)
  const agentsPart = agents === null ? null : running > 0 ? `${agents} (${running} ◐)` : agents
  const all = parts(tools, skills, agentsPart, rules)
  const forms = [all, parts(tools, skills, agentsPart), parts(tools, skills), parts(tools)].filter(f => f.length > 0)
  return [...new Set(forms.map(f => f.join(' · ')))].map(text => [{ text, tone: 'dim' as const }])
}

// The open rows (spec 2026-11-11, D2): every tool by name with its calls, then the skills the main chat loaded and how
// many the listing carries, each under its label, as many to a row as the width holds, joined by ' │ '. Each row waits
// for its category's first item (the user, 2026-11-12: 'leave empty until at least one of category is appeared'): a
// skills listing alone is no skill, and with by path untracked, no always-on rule is no rule
export function toolRows(input: BandInput): Line[] {
  const used = toolsByCalls(input.stats)
  const isResumed = input.session.isResumed === true
  const hasSkills = Object.keys(input.session.skills ?? {}).length > 0
  const hasAgents = Object.keys(input.session.agentTypes ?? {}).length > 0
  const drawn = rulesDrawn(input.rules ?? NO_RULES)
  const hasRules = drawn.always.length + drawn.byPath.length > 0
  const skills = skillSegs(input.session.skills, isResumed)
  if (input.skillListing !== undefined && input.skillListing !== null) skills.push({ text: listedText(input.skillListing), tone: 'dim' })
  const label = (text: string): Seg => ({ text: text.padEnd(ROW_LABEL), tone: 'dim' })
  const under: Seg = { text: ' '.repeat(ROW_LABEL) }
  const row = (name: string, items: Line[]): Line[] => wrapRows(label(name), under, items, input.columns, ROW_JOIN)
  const one = (segs: Seg[]): Line[] => segs.map(seg => [seg])
  return [
    ...(used.length === 0 ? [] : row('tools:', one(used.map(([key, stat]): Seg => ({ text: `${key} ×${stat.calls}` }))))),
    ...(hasSkills ? row('skills:', one(skills)) : []),
    ...(hasAgents ? row('agents:', agentSegs(input.agents, input.session.agentTypes, isResumed)) : []),
    ...(hasRules ? row('rules:', ruleSegs(input.rules ?? NO_RULES, isResumed)) : []),
  ]
}

const NO_RULES: RulesInput = { always: [], byPath: [], isTracked: true }

// The rules drawn, each name once, an always-on name winning: the always-on ones, then the by-path ones not among them
export function rulesDrawn(r: RulesInput): { always: string[]; byPath: string[] } {
  const always = [...new Set(r.always)]
  return { always, byPath: [...new Set(r.byPath)].filter(n => !always.includes(n)) }
}

// The rules row's items (spec 2026-11-11, D4): the always-on rules plain, the by-path ones violet, then how many of
// each; untracked (the option on), by path is not known; after a resume, the by-path ones loaded before are unseen
export function ruleSegs(r: RulesInput, isResumed: boolean): Line[] {
  const { always, byPath } = rulesDrawn(r)
  if (r.isTracked && always.length + byPath.length === 0) return [[{ text: 'none loaded', tone: 'dim' }]]
  const summary = r.isTracked
    ? `${always.length} always-on · ${byPath.length} by path${isResumed ? ' since resume' : ''}`
    : `${always.length} always-on · by path not tracked`
  return [
    ...always.map((text): Line => [{ text }]), ...byPath.map((text): Line => [{ text, tone: 'handoff' }]),
    [{ text: summary, tone: 'dim' }],
  ]
}

// The agents row's items (spec 2026-11-11, D3): each type in the order of its first dispatch, its glyph and dispatches -
// ◐ while a kept row of it runs, ✗ once one failed or was killed, else ✓ - then how many run; after a resume, counted
// from it. A type whose rows were all dropped (at most 50 kept) reads ✓.
export function agentSegs(rows: AgentRow[], types: Record<string, number> | undefined, isResumed: boolean): Line[] {
  const names = Object.keys(types ?? {})
  if (names.length === 0) return [[{ text: isResumed ? 'none seen since resume' : 'none', tone: 'dim' }]]
  const items = names.map((type): Line => {
    const of = rows.filter(r => r.type === type)
    const glyph: Seg = of.some(r => isLive(r.status))
      ? { text: '◐ ', tone: 'warn' }
      : of.some(r => r.status === 'failed' || r.status === 'killed') ? { text: '✗ ', tone: 'fail' } : { text: '✓ ', tone: 'ok' }
    return [glyph, { text: `${type} ×${types?.[type] ?? 0}` }]
  })
  const running = rows.filter(row => isLive(row.status)).length
  const since: Line[] = isResumed ? [[{ text: 'since resume', tone: 'dim' }]] : []
  return [...items, ...since, [{ text: `${running} running`, tone: running > 0 ? 'warn' : 'dim' }]]
}

export const ROW_LABEL = 9

export const ROW_JOIN = ' │ '

export const rowLabel = (text: string): Seg => ({ text: text.padEnd(ROW_LABEL), tone: 'dim' })

// The skills loaded in the main chat; after a resume or a branch, counted from it, since the ones loaded before are in
// the context but never seen (a side agent's note, 2026-11-11)
export function skillSegs(skills: Record<string, number> | undefined, isResumed: boolean): Seg[] {
  const loaded = loadedTexts(skills)
  if (loaded.length === 0) return [{ text: isResumed ? 'none seen since resume' : 'none loaded', tone: 'dim' }]
  const since: Seg[] = isResumed ? [{ text: 'since resume', tone: 'dim' }] : []
  return [...loaded.map((text): Seg => ({ text, tone: 'skill' })), ...since]
}
