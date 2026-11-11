// The band's detail rows (spec: docs/superpowers/specs/2026-11-11-band-detail-rows-design.md): `tools:`, `skills:`,
// `agents:` and `rules:` under the info line, open by default, items joined by ' │ '; the toggle counts all four
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { newRow } from '../hooks/agents.ts'
import { agentSegs, toolRows } from '../hooks/band.ts'
import type { BandInput, Line } from '../hooks/band.ts'
import { SPAWN, START, engine, stubAll, watchState } from './kit.ts'

import type { AgentRow, AgentStatus, Cache, Meta, ToolStat, Turn } from '../types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const P = NOW - 73 * 60_000
const R = NOW - 2 * 60_000

const stat = (calls: number): ToolStat => ({ calls, ok: calls, failed: 0, stopped: 0 })
const turn = (n: number, contextPercent: number | null = null): Turn => ({
  n, turnId: `t${n}`, promptAt: P, replyAt: R, durationMs: 3000, tokensIn: 0, tokensOut: 0, tools: 19, failures: 0, contextPercent, end: 'answer',
})
const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: NOW - 6 * 60_000, last: { read: 1000, write: 0, input: 10 },
  session: { read: 1000, write: 0, input: 10 }, toastedFor: null,
}
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' },
  { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' },
]

// The full band's mockup session, idle and healthy, at 200 columns (as tests/fullband.test.ts draws it)
function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full',
    live: { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null },
    usage: { tokens: 60_000, window: 200_000, percent: 30, startedAt: NOW - 59 * 60_000, windows: WINDOWS, costUsd: 1.29, todayUsd: 10.46, at: NOW },
    meta: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: P, lastReplyAt: R, turnCount: 1,
      waiting: [], mainCalls: 19,
    },
    turns: [turn(1)], newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, planInvalid: false, score: null,
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 13_300, stepMs: 100_000 },
    stats: { AskUserQuestion: stat(13), Bash: stat(5), Grep: stat(1) },
    ...o,
  }
}

const text = (line: Line): string => line.map(s => ('text' in s ? s.text : 'button' in s ? `[ ${s.button.label} ]` : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

// The owner's target block, rows 4-7 (docs/superpowers/2026-11-11-band-detail-rows-prompt.md)
const TARGET_STATS = { Bash: stat(32), AskUserQuestion: stat(4), Read: stat(4), Write: stat(4), Grep: stat(1) }

test('the open rows read tools: and skills: with │ between items', () => {
  const b = input({
    isToolsOpen: true, stats: TARGET_STATS, listing: { listed: 57, total: 60, tokens: 3200 },
    meta: { ...input().meta, skills: { 'superpowers:brainstorming': 1, 'solve-task': 2 } },
  })
  expect(texts(toolRows(b)).slice(0, 2)).toEqual([
    'tools:   Bash ×32 │ AskUserQuestion ×4 │ Read ×4 │ Write ×4 │ Grep ×1',
    'skills:  superpowers:brainstorming ×1 │ solve-task ×2 │ 57 of 60 listed',
  ])
})

test('a row that wraps starts under its first item, at 48 columns', () => {
  const b = input({ isToolsOpen: true, columns: 48, stats: { AskUserQuestion: stat(13), Bash: stat(5), Read: stat(4), Write: stat(4), Grep: stat(1) } })
  expect(texts(toolRows(b)).slice(0, 2)).toEqual(['tools:   AskUserQuestion ×13 │ Bash ×5 │ Read ×4', '         Write ×4 │ Grep ×1'])
})

const agent = (id: string, type: string, status: AgentStatus): AgentRow =>
  ({ ...newRow({ id, parentId: null, type, description: 'd', prompt: 'p', isTeammate: false, model: 'claude-haiku-5-5' }, NOW), status })
const TARGET_AGENTS = [
  agent('a1', 'alfred-code:web-angular-verifier', 'running'), agent('a2', 'Explore', 'completed'),
  agent('a3', 'Explore', 'completed'), agent('a4', 'general-purpose', 'idle'),
]
const TARGET_TYPES = { 'alfred-code:web-angular-verifier': 1, Explore: 2, 'general-purpose': 1 }
const agentsRow = (b: BandInput): string | undefined => texts(toolRows(b)).find(l => l.startsWith('agents:'))

test('the agents row: each type in first-dispatch order with its glyph and count, then how many run', () => {
  const b = input({ isToolsOpen: true, agents: TARGET_AGENTS, meta: { ...input().meta, agentTypes: TARGET_TYPES } })
  expect(agentsRow(b)).toBe('agents:  ◐ alfred-code:web-angular-verifier ×1 │ ✓ Explore ×2 │ ✓ general-purpose ×1 │ 1 running')
  const items = agentSegs(TARGET_AGENTS, TARGET_TYPES, false)
  expect(items[0]?.[0]).toEqual({ text: '◐ ', tone: 'warn' })
  expect(items[0]?.[1]).toEqual({ text: 'alfred-code:web-angular-verifier ×1' })
  expect(items[1]?.[0]).toEqual({ text: '✓ ', tone: 'ok' })
  expect(items[3]).toEqual([{ text: '1 running', tone: 'warn' }])
})

test('✗ for a type with a failed or killed row once none of it runs; 0 running is dim', () => {
  const rows = [agent('a1', 'Explore', 'failed'), agent('a2', 'Explore', 'completed'), agent('a3', 'Plan', 'killed')]
  const items = agentSegs(rows, { Explore: 2, Plan: 1 }, false)
  expect(texts(items)).toEqual(['✗ Explore ×2', '✗ Plan ×1', '0 running'])
  expect(items[0]?.[0]).toEqual({ text: '✗ ', tone: 'fail' })
  expect(items[2]).toEqual([{ text: '0 running', tone: 'dim' }])
})

test('a type whose rows were all dropped reads ✓', () => {
  expect(texts(agentSegs([], { Explore: 3 }, false))).toEqual(['✓ Explore ×3', '0 running'])
})

test('no dispatch reads none, with no running count; after a resume, none seen since resume, or the types since', () => {
  expect(agentsRow(input({ isToolsOpen: true }))).toBe('agents:  none')
  expect(texts(agentSegs([], undefined, false))).toEqual(['none'])
  expect(texts(agentSegs([], undefined, true))).toEqual(['none seen since resume'])
  expect(texts(agentSegs([agent('a1', 'Explore', 'running')], { Explore: 1 }, true))).toEqual(['◐ Explore ×1', 'since resume', '1 running'])
})

// Each spawn gets a new id, as Claude Code's does; a resume keeps the one it names
function spawns(on: On): void {
  let n = 0
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: e.resume?.agentId ?? `a${++n}` }))
}
const metaOf = (state: { get(key: string): unknown }): Meta => state.get('meta') as Meta
const spawn = ($: Engine, subagentType: string) => $.agent.spawn({ ...SPAWN, subagentType })

test('each new agent adds one dispatch of its type; a resume of a known agent adds none', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on)
  await $.session.start(START)
  await spawn($, 'Explore')
  await spawn($, 'general-purpose')
  await spawn($, 'Explore')
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', resume: { agentId: 'a1' } })
  const types = metaOf(state).agentTypes
  expect(types).toEqual({ Explore: 2, 'general-purpose': 1 })
  expect(Object.keys(types ?? {})).toEqual(['Explore', 'general-purpose'])
})

test('a /clear empties the dispatches; a resume starts them over as unseen', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on)
  await $.session.start(START)
  await spawn($, 'Explore')
  expect(metaOf(state).agentTypes).toEqual({ Explore: 1 })
  await $.classic.SessionStart({ source: 'clear' })
  expect(metaOf(state).agentTypes).toBeUndefined()
  await spawn($, 'Explore')
  await $.classic.SessionStart({ source: 'resume' })
  expect(metaOf(state).agentTypes).toBeUndefined()
  expect(metaOf(state).isResumed).toBe(true)
})
