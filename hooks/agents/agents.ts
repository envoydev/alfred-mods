// Agents as rows: what a spawn says, how a run ends, which rows are kept, the tree they draw and their tool counts.
import type { AgentInfo } from 'claude-code'

import { durationText, oneLine, tokensText } from '../core/format'
import type { AgentRow, AgentStatus, LaneFit, Loop, TreeRow } from './types'
import type { Lane, Line, Seg } from '../core/types'
import type { TurnEnd } from '../session/types'
import type { ToolStat } from '../tools/types'

// The first word of a prompt's first `plan:` and `task:` lines; nothing else of the prompt is kept, the rest of either
// line included, as a model may write its brief on it
export function promptLines(prompt: string): { plan: string | null; task: string | null } {
  const value = (name: string): string | null => {
    const match = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\S+)`, 'm').exec(prompt.replace(/\r\n?/g, '\n'))
    return match?.[1] === undefined ? null : oneLine(match[1], 60)
  }
  return { plan: value('plan'), task: value('task') }
}

type Spawned = { id: string; parentId: string | null; type: string; description: string; prompt: string; isTeammate: boolean; model: string }

export function newRow(spawned: Spawned, now: number): AgentRow {
  return {
    id: spawned.id, parentId: spawned.parentId, type: spawned.type, description: oneLine(spawned.description, 60), ...promptLines(spawned.prompt),
    isTeammate: spawned.isTeammate, model: spawned.model, effort: null, status: 'running', isListed: false,
    startedAt: now, endedAt: null, action: null, report: null, contextTokens: null, tools: {}, lastStop: null,
  }
}

// A resume of a known agent runs its row again, unlisted until the list names it anew; any other spawn adds one
export function upsertSpawn(rows: AgentRow[], row: AgentRow, isResume: boolean): AgentRow[] {
  const known = isResume && rows.some(knownRow => knownRow.id === row.id)
  const out = known
    ? rows.map(knownRow => (knownRow.id === row.id
      ? { ...knownRow, status: 'running' as const, startedAt: row.startedAt, endedAt: null, isListed: false } : knownRow))
    : [...rows, row]
  return keepRows(out)
}

export function isLive(status: AgentStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'waiting'
}

// At most `limit` rows: the oldest ended ones go first, and a live one never goes
export function keepRows(rows: AgentRow[], limit = 50): AgentRow[] {
  const over = rows.length - limit
  if (over <= 0) return rows
  const drop = new Set(rows.filter(agentRow => !isLive(agentRow.status)).sort((left, right) => left.startedAt - right.startedAt).slice(0, over))
  return rows.filter(row => !drop.has(row))
}

// What the engine's list says of the live rows: its status and parent for a row it names, and the end of one it named
// before and names no longer. A row it never named, such as a workflow's agent, and an ended row stay as they are.
export function refreshAgents(rows: AgentRow[], listed: readonly AgentInfo[], now: number): AgentRow[] {
  return rows.map(row => {
    if (!isLive(row.status)) return row
    const listedRow = listed.find(candidate => candidate.id === row.id)
    if (listedRow === undefined) return row.isListed ? { ...row, status: 'completed' as const, endedAt: now } : row
    return {
      ...row, isListed: true, status: listedRow.status, endedAt: isLive(listedRow.status) ? null : now, parentId: row.parentId ?? listedRow.parentId ?? null,
    }
  })
}

// How long the agent has run, or how it ended and after how long
export function agentTime(row: AgentRow, now: number): string {
  const took = durationText((row.endedAt ?? now) - row.startedAt)
  switch (row.status) {
    case 'running': return took
    case 'waiting': return `waiting · ${took}`
    case 'pending': return 'pending'
    case 'completed': return `done in ${took}`
    case 'failed': return `failed after ${took}`
    case 'killed': return `stopped after ${took}`
    case 'idle': return 'idle'
  }
}

export function statusGlyph(status: AgentStatus): Extract<Seg, { text: string }> {
  if (isLive(status)) return { text: '⟳', bold: true }
  if (status === 'completed') return { text: '✓', tone: 'ok' }
  return status === 'idle' ? { text: '·', tone: 'dim' } : { text: '✗', tone: 'fail' }
}

// The time axis's lanes (spec C2): the 8 newest rows that have a start, oldest first; a live row has no end yet
export function lanesOf(rows: AgentRow[], now: number): Lane[] {
  return rows.filter(agentRow => agentRow.startedAt > 0).sort((left, right) => left.startedAt - right.startedAt).slice(-8).map(row => ({
    label: laneLabel(row), startAt: row.startedAt,
    endAt: isLive(row.status) ? null : row.endedAt ?? now, status: row.status, time: agentTime(row, now),
  }))
}

// A lane's label: what the agent was asked, its task id first, or its type when it was asked nothing (the user,
// 2026-11-12: 'I want to see what agents are doing or did'; the type alone left eight lanes all 'general-purpo…')
export function laneLabel(row: AgentRow): string {
  const asked = oneLine(row.description, 200)
  const what = asked === '' ? row.type : asked
  return row.task === null ? what : `task ${row.task} · ${what}`
}

const LANE_MAX = 40
export function laneFit(lanes: Lane[], columns: number): LaneFit | null {
  const time = Math.max(0, ...lanes.map(lane => [...lane.time].length))
  const room = columns - 4 - time
  const longest = Math.min(LANE_MAX, Math.max(6, ...lanes.map(lane => [...lane.label].length)))
  const label = Math.min(longest, room - 10)
  return label < 6 ? null : { label, bar: Math.min(LANE_MAX, room - label), time }
}

// A report's line in the tree: its first that is not a heading, a rule or a fence, else its first heading's words
export function reportLine(report: string): string {
  const lines = report.split('\n').map(line => line.trim()).filter(line => line !== '' && !/^([-*_=]\s*){3,}$/.test(line) && !line.startsWith('```'))
  const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line)
  return (lines.find(line => !isHeading(line)) ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '')
}

// Loops no spawn announced (spec C3): a step adds to its loop, or starts one; the newest 60 are kept
export function addLoopStep(loops: Loop[], id: string, output: number, now: number): Loop[] {
  const known = loops.find(loop => loop.id === id)
  if (known !== undefined) return loops.map(loop => (loop === known ? { ...loop, steps: loop.steps + 1, outputTokens: loop.outputTokens + output, lastAt: now } : loop))
  return [...loops, { id, steps: 1, outputTokens: output, firstAt: now, lastAt: now, isDone: false }].slice(-60)
}

// D3 found workflow agents raise agent.spawn, so what is left is a compaction's or a fork's loop
export const LOOPS_NOTE = '(no spawn: compactions, forks)'

// The Agents tab's line after the tree while any loop was seen: how many, how many active (not done, a step in the
// last 15 seconds), their output, then the dim note
export function loopsLine(loops: Loop[], now: number, note: string): Line[] {
  if (loops.length === 0) return []
  const active = loops.filter(loop => !loop.isDone && now - loop.lastAt < 15_000).length
  const output = loops.reduce((sum, loop) => sum + loop.outputTokens, 0)
  return [[{ text: `Other loops ${loops.length} · ${active} active · out ${tokensText(output)}` }], [{ text: note, tone: 'dim' }]]
}

// A teammate waits for its next message; any other agent's run ends
export function statusAt(reason: TurnEnd, isTeammate: boolean): AgentStatus {
  if (isTeammate) return 'idle'
  return reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed'
}

export function actionOf(tool: string, target: string): string {
  return target === '' ? tool : `${tool} ${target}`
}


// Depth first, siblings oldest first, under the main loop as the root. A row sits under its parent only when that is
// a row and its parents never lead back to it; else under the root.
export function agentTree(rows: AgentRow[]): TreeRow[] {
  const byId = new Map(rows.map(agentRow => [agentRow.id, agentRow]))
  const parentOf = (agentRow: AgentRow): string | null => {
    if (agentRow.parentId === null || !byId.has(agentRow.parentId)) return null
    const seen = new Set<string>()
    for (let parentId: string | null = agentRow.parentId; parentId !== null && !seen.has(parentId); parentId = byId.get(parentId)?.parentId ?? null) {
      if (parentId === agentRow.id) return null
      seen.add(parentId)
    }
    return agentRow.parentId
  }
  const kids = new Map<string | null, AgentRow[]>()
  for (const agentRow of [...rows].sort((left, right) => left.startedAt - right.startedAt)) {
    const parent = parentOf(agentRow)
    kids.set(parent, [...(kids.get(parent) ?? []), agentRow])
  }
  const out: TreeRow[] = []
  const walk = (parent: string | null, depth: number, lead: string): void => {
    const list = kids.get(parent) ?? []
    list.forEach((agentRow, i) => {
      const isLast = i === list.length - 1
      out.push({ row: agentRow, depth, isLast, prefix: `${lead}${isLast ? '└ ' : '├ '}` })
      walk(agentRow.id, depth + 1, `${lead}${isLast ? '  ' : '│ '}`)
    })
  }
  walk(null, 1, '')
  return out
}

// Each tool as '<name> ×<calls>' with ✓ when all were ok, else ✗ and ⊘ with their counts unless all calls; skills apart
export function toolSummary(tools: Record<string, ToolStat>): { tools: string[]; skills: string[] } {
  const out = { tools: [] as string[], skills: [] as string[] }
  for (const [key, stat] of Object.entries(tools)) {
    const count = (glyph: string, markCount: number): string => (markCount === 0 ? '' : markCount === stat.calls ? ` ${glyph}` : ` ${glyph}${markCount}`)
    const marks = stat.failed === 0 && stat.stopped === 0 ? ' ✓' : `${count('✗', stat.failed)}${count('⊘', stat.stopped)}`
    if (key.startsWith('Skill: ')) out.skills.push(`${key.slice(7)} ×${stat.calls}`)
    else out.tools.push(`${key} ×${stat.calls}${marks}`)
  }
  return out
}

export const stepMarkOf = (row: AgentRow): string | null => (row.plan !== null && row.task !== null ? `${row.plan}:${row.task}` : null)
