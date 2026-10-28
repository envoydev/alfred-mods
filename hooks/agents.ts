// Agents as rows: what a spawn says, how a run ends, which rows are kept, the tree they draw and their tool counts.
import type { AgentInfo } from 'claude-code'

import { oneLine } from './format.ts'
import type { AgentRow, AgentStatus, ToolStat, TurnEnd } from '../types'

// The first word of a prompt's first `plan:` and `task:` lines; nothing else of the prompt is kept, the rest of either
// line included, as a model may write its brief on it
export function promptLines(prompt: string): { plan: string | null; task: string | null } {
  const value = (name: string): string | null => {
    const m = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\S+)`, 'm').exec(prompt.replace(/\r\n?/g, '\n'))
    return m?.[1] === undefined ? null : oneLine(m[1], 60)
  }
  return { plan: value('plan'), task: value('task') }
}

type Spawned = { id: string; parentId: string | null; type: string; description: string; prompt: string; isTeammate: boolean; model: string }

export function newRow(s: Spawned, now: number): AgentRow {
  return {
    id: s.id, parentId: s.parentId, type: s.type, description: oneLine(s.description, 60), ...promptLines(s.prompt),
    isTeammate: s.isTeammate, model: s.model, effort: null, status: 'running', isListed: false,
    startedAt: now, endedAt: null, action: null, report: null, contextTokens: null, tools: {},
  }
}

// A resume of a known agent runs its row again, unlisted until the list names it anew; any other spawn adds one
export function upsertSpawn(rows: AgentRow[], row: AgentRow, isResume: boolean): AgentRow[] {
  const known = isResume && rows.some(r => r.id === row.id)
  const out = known
    ? rows.map(r => (r.id === row.id ? { ...r, status: 'running' as const, startedAt: row.startedAt, endedAt: null, isListed: false } : r))
    : [...rows, row]
  return keepRows(out)
}

export function isLive(s: AgentStatus): boolean {
  return s === 'pending' || s === 'running' || s === 'waiting'
}

// At most `limit` rows: the oldest ended ones go first, and a live one never goes
export function keepRows(rows: AgentRow[], limit = 50): AgentRow[] {
  const over = rows.length - limit
  if (over <= 0) return rows
  const drop = new Set(rows.filter(r => !isLive(r.status)).sort((a, b) => a.startedAt - b.startedAt).slice(0, over))
  return rows.filter(r => !drop.has(r))
}

// What the engine's list says of the live rows: its status and parent for a row it names, and the end of one it named
// before and names no longer. A row it never named, such as a workflow's agent, and an ended row stay as they are.
export function refreshAgents(rows: AgentRow[], listed: readonly AgentInfo[], now: number): AgentRow[] {
  return rows.map(r => {
    if (!isLive(r.status)) return r
    const l = listed.find(x => x.id === r.id)
    if (l === undefined) return r.isListed ? { ...r, status: 'completed' as const, endedAt: now } : r
    return { ...r, isListed: true, status: l.status, endedAt: isLive(l.status) ? null : now, parentId: r.parentId ?? l.parentId ?? null }
  })
}

// A teammate waits for its next message; any other agent's run ends
export function statusAt(reason: TurnEnd, isTeammate: boolean): AgentStatus {
  if (isTeammate) return 'idle'
  return reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed'
}

export function actionOf(tool: string, target: string): string {
  return target === '' ? tool : `${tool} ${target}`
}

export type TreeRow = { row: AgentRow; depth: number; isLast: boolean; prefix: string }

// Depth first, siblings oldest first, under the main loop as the root. A row sits under its parent only when that is
// a row and its parents never lead back to it; else under the root.
export function agentTree(rows: AgentRow[]): TreeRow[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const parentOf = (r: AgentRow): string | null => {
    if (r.parentId === null || !byId.has(r.parentId)) return null
    const seen = new Set<string>()
    for (let p: string | null = r.parentId; p !== null && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
      if (p === r.id) return null
      seen.add(p)
    }
    return r.parentId
  }
  const kids = new Map<string | null, AgentRow[]>()
  for (const r of [...rows].sort((a, b) => a.startedAt - b.startedAt)) {
    const p = parentOf(r)
    kids.set(p, [...(kids.get(p) ?? []), r])
  }
  const out: TreeRow[] = []
  const walk = (parent: string | null, depth: number, lead: string): void => {
    const list = kids.get(parent) ?? []
    list.forEach((r, i) => {
      const isLast = i === list.length - 1
      out.push({ row: r, depth, isLast, prefix: `${lead}${isLast ? '└ ' : '├ '}` })
      walk(r.id, depth + 1, `${lead}${isLast ? '  ' : '│ '}`)
    })
  }
  walk(null, 1, '')
  return out
}

// Each tool as '<name> ×<calls>' with ✓ when all were ok, else ✗ and ⊘ with their counts unless all calls; skills apart
export function toolSummary(tools: Record<string, ToolStat>): { tools: string[]; skills: string[] } {
  const out = { tools: [] as string[], skills: [] as string[] }
  for (const [key, t] of Object.entries(tools)) {
    const count = (glyph: string, n: number): string => (n === 0 ? '' : n === t.calls ? ` ${glyph}` : ` ${glyph}${n}`)
    const marks = t.failed === 0 && t.stopped === 0 ? ' ✓' : `${count('✗', t.failed)}${count('⊘', t.stopped)}`
    if (key.startsWith('Skill: ')) out.skills.push(`${key.slice(7)} ×${t.calls}`)
    else out.tools.push(`${key} ×${t.calls}${marks}`)
  }
  return out
}
