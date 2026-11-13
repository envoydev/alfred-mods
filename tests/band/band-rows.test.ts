// The band's detail rows (spec: docs/superpowers/specs/2026-11-11-band-detail-rows-design.md): `tools:`, `skills:`,
// `agents:` and `rules:` under the info line, open by default, items joined by ' │ '; usage: counts all four
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { newRow } from '../../hooks/agents/agents'
import { cellsOf } from '../../hooks/band/wrap'
import { agentSegs, ruleSegs, toggleForms, toolRows } from '../../hooks/band/detail'
import { bandLines } from '../../hooks/band/band'
import { drawLines } from '../../hooks/core/draw'
import { widthOf } from '../../hooks/core/format'
import { SPAWN, START, engine, rows, stubAll, watchState } from '../kit'
import { FIVE, FIVE_OVERHEAD, FIVE_TIMES, NOW as PLAN_NOW, SCORING_JSON, STATUS_JSON, planOf } from '../plans'
import { planView, scoresView } from '../../hooks/plan/plan'
import { parseAlfredScoring, parseAlfredStatus } from '../../hooks/plan/alfredplan'
import type { AgentRow, AgentStatus } from '../../hooks/agents/types'
import type { BandInput } from '../../hooks/band/types'
import type { Cache } from '../../hooks/cache/types'
import type { Line } from '../../hooks/core/types'
import type { Session, Turn } from '../../hooks/session/types'
import type { ToolStat } from '../../hooks/tools/types'


const NOW = Date.parse('2026-10-28T14:00:00Z')
const P = NOW - 73 * 60_000
const R = NOW - 2 * 60_000

const stat = (calls: number): ToolStat => ({ calls, ok: calls, failed: 0, stopped: 0 })
const turn = (n: number, contextPercent: number | null = null): Turn => ({
  turnNumber: n, turnId: `t${n}`, promptAt: P, replyAt: R, durationMs: 3000, tokensIn: 0, tokensOut: 0, toolCalls: 19, toolFailures: 0, contextPercent, endReason: 'answer',
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
    live: { turnId: null, startedAt: null, toolCalls: 0, toolFailures: 0, runningCalls: [], promptAt: null },
    usage: { contextTokens: 60_000, contextWindow: 200_000, contextPercent: 30, startedAt: NOW - 59 * 60_000, rateWindows: WINDOWS, costUsd: 1.29, todayUsd: 10.46, readingAt: NOW },
    session: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: P, lastReplyAt: R, turnCount: 1,
      waitingPrompts: [], mainToolCalls: 19,
    },
    turns: [turn(1)], newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, isPlanInvalid: false, score: null,
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
    isToolsOpen: true, stats: TARGET_STATS, skillListing: { listed: 57, total: 60, tokens: 3200 },
    session: { ...input().session, loadedSkills: { 'superpowers:brainstorming': 1, 'solve-task': 2 } },
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
  const b = input({ isToolsOpen: true, agents: TARGET_AGENTS, session: { ...input().session, agentTypes: TARGET_TYPES } })
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

// Each detail row waits for its category's first item (the user, 2026-11-12: 'leave empty until at least one of
// category is appeared, for example if skill is appeared this show skills, if rules then rules')
test('an empty session draws no detail row; each row comes with its first item', () => {
  const rowsOf = (o: Partial<BandInput>) => texts(bandLines(input({ isToolsOpen: true, ...o }))).filter(l => /^(tools|skills|agents|rules):/.test(l))
  expect(rowsOf({ stats: {}, skillListing: { listed: 60, total: 60, tokens: 3200 }, session: { ...input().session, isResumed: true } })).toEqual([])
  expect(rowsOf({ stats: {}, session: { ...input().session, loadedSkills: { 'solve-task': 1 } } })).toEqual(['skills:  solve-task ×1'])
  expect(rowsOf({ stats: {}, rules: { always: ['a.md'], byPath: [], isTracked: true } })).toEqual(['rules:   a.md │ 1 always-on · 0 by path'])
  expect(rowsOf({ stats: {}, session: { ...input().session, agentTypes: { Explore: 1 } } })).toEqual(['agents:  ✓ Explore ×1 │ 0 running'])
  expect(rowsOf({ stats: { Bash: { calls: 2, failures: 0 } as never } })).toEqual(['tools:   Bash ×2'])
  // Untracked by path, with no always-on rule: nothing appeared
  expect(rowsOf({ stats: {}, rules: { always: [], byPath: [], isTracked: false } })).toEqual([])
})

test('no dispatch reads none, with no running count; after a resume, none seen since resume, or the types since', () => {
  expect(agentsRow(input({ isToolsOpen: true }))).toBeUndefined()
  expect(texts(agentSegs([], undefined, false))).toEqual(['none'])
  expect(texts(agentSegs([], undefined, true))).toEqual(['none seen since resume'])
  expect(texts(agentSegs([agent('a1', 'Explore', 'running')], { Explore: 1 }, true))).toEqual(['◐ Explore ×1', 'since resume', '1 running'])
})

// Each spawn gets a new id, as Claude Code's does; a resume keeps the one it names
function spawns(on: On): void {
  let n = 0
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: e.resume?.agentId ?? `a${++n}` }))
}
const metaOf = (state: { get(key: string): unknown }): Session => state.get('session') as Session
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

const TARGET_RULES = { always: ['alfred-interaction.md', 'alfred-git.md', 'alfred-preferences.md'], byPath: ['web-angular.md', 'typescript.md'], isTracked: true }
const rulesRow = (b: BandInput): string | undefined => texts(toolRows(b)).find(l => l.startsWith('rules:'))

test('the rules row: always-on, then by path in violet, then the counts', () => {
  expect(rulesRow(input({ isToolsOpen: true, rules: TARGET_RULES })))
    .toBe('rules:   alfred-interaction.md │ alfred-git.md │ alfred-preferences.md │ web-angular.md │ typescript.md │ 3 always-on · 2 by path')
  const items = ruleSegs(TARGET_RULES, false)
  expect(items[0]).toEqual([{ text: 'alfred-interaction.md' }])
  expect(items[3]).toEqual([{ text: 'web-angular.md', tone: 'handoff' }])
  expect(items[5]).toEqual([{ text: '3 always-on · 2 by path', tone: 'dim' }])
})

test('a name loaded both always-on and by path is drawn and counted once', () => {
  expect(texts(ruleSegs({ always: ['a.md'], byPath: ['a.md', 'b.md'], isTracked: true }, false))).toEqual(['a.md', 'b.md', '1 always-on · 1 by path'])
})

test('no rule known draws no rules row, also from a state kept before the rules row', () => {
  expect(rulesRow(input({ isToolsOpen: true }))).toBeUndefined()
  expect(texts(ruleSegs({ always: [], byPath: [], isTracked: true }, false))).toEqual(['none loaded'])
})

test('after a resume the by-path count reads since resume; untracked, by path not tracked', () => {
  expect(texts(ruleSegs({ always: ['a.md'], byPath: ['b.md'], isTracked: true }, true))).toEqual(['a.md', 'b.md', '1 always-on · 1 by path since resume'])
  expect(texts(ruleSegs({ always: ['a.md'], byPath: [], isTracked: false }, false))).toEqual(['a.md', '1 always-on · by path not tracked'])
  expect(texts(ruleSegs({ always: [], byPath: [], isTracked: false }, false))).toEqual(['0 always-on · by path not tracked'])
})

// What Claude Code hands the classic hook as a rule loads; `agent_id` only inside a subagent
const load = (file_path: string, load_reason: string, agent_id?: string) => ({
  file_path, memory_type: 'Project', load_reason, globs: ['src/**/*.ts'], trigger_file_path: '/w/src/app.ts',
  ...(agent_id === undefined ? {} : { agent_id }),
}) as never

test('a by-path load on the main thread is listed once, in load order', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  await $.classic.InstructionsLoaded(load('/w/sub/.claude/rules/nested.md', 'nested_traversal'))
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  expect(metaOf(state).pathRules).toEqual(['web.md', 'nested.md'])
})

// A rule reached through a link loads under the path the link lands on, outside any rules folder (live, 2026-11-11);
// only a rule's `paths:` frontmatter makes a path match, so any file it names is a rule
test("a by-path rule reached through a link is listed by its target's name", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.classic.InstructionsLoaded(load('/shared/rules/scoped.md', 'path_glob_match'))
  await $.classic.InstructionsLoaded(load('/shared/notes/CLAUDE.md', 'nested_traversal'))
  expect(metaOf(state).pathRules).toEqual(['scoped.md'])
})

test("a subagent's load, a start-up or compaction reload, an include and a non-rule file are not listed", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/a.md', 'path_glob_match', 'agent-1'))
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/b.md', 'session_start'))
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/c.md', 'compact'))
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/d.md', 'include'))
  await $.classic.InstructionsLoaded(load('/w/src/CLAUDE.md', 'nested_traversal'))
  expect((state.get('session') as Session | undefined)?.pathRules).toBeUndefined()
})

test('a compaction keeps the by-path rules; a /clear empties them; a resume starts them over', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'q', toolUses: [] }] as never })
  expect(metaOf(state).pathRules).toEqual(['web.md'])
  await $.classic.SessionStart({ source: 'clear' })
  expect(metaOf(state).pathRules).toBeUndefined()
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  await $.classic.SessionStart({ source: 'resume' })
  expect(metaOf(state).pathRules).toBeUndefined()
  expect(metaOf(state).isResumed).toBe(true)
})

const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const ALWAYS: SessionUsage = {
  startedAt: NOW - 5 * 60_000, rateLimits: [],
  context: {
    window: 200_000, tokens: 20_000, percent: 10,
    breakdown: {
      categories: [], totalTokens: 0, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 0, gridRows: [], model: 'claude-opus-5-5',
      memoryFiles: [{ path: '/w/.claude/rules/always.md', type: 'Project', tokens: 60 }], mcpTools: [], agents: [], isAutoCompactEnabled: true,
    } as never,
  },
}

test('the band draws the rules row from the parts and the loads', async ($, on) => {
  const { clock } = stubAll(on, { band: 'full', usage: ALWAYS, now: NOW })
  engine(on)
  await $.session.start(START)
  await clock.advance(1)
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await rows(ui)).toContain('rules:   always.md │ web.md │ 1 always-on · 1 by path')
  await ui.unmount()
})

// Spec 2026-11-11, D5, and settings-values S6: usage: counts the tools, skills, agents and rules the rows list, as text
const labels = (b: BandInput): string[] => toggleForms(b).map(text)
const TARGET = input({
  isToolsOpen: true, stats: TARGET_STATS, agents: TARGET_AGENTS, rules: TARGET_RULES,
  session: { ...input().session, loadedSkills: { 'superpowers:brainstorming': 1, 'solve-task': 2 }, agentTypes: TARGET_TYPES },
})

test('the counts take all four, and their forms drop rules, then agents, then skills', () => {
  expect(labels(TARGET)).toEqual(['45 tools · 2 skills · 4 agents (1 ◐) · 5 rules', '45 tools · 2 skills · 4 agents (1 ◐)', '45 tools · 2 skills', '45 tools'])
  for (const form of toggleForms(TARGET)) expect(form).toEqual([{ text: expect.any(String), tone: 'dim' }])
})

test('(k ◐) only while agents run; singular forms', () => {
  const one = input({
    isToolsOpen: true, stats: { Bash: stat(1) }, agents: [agent('a1', 'Explore', 'completed')],
    rules: { always: ['a.md'], byPath: [], isTracked: true }, session: { ...input().session, loadedSkills: { x: 1 }, agentTypes: { Explore: 1 } },
  })
  expect(labels(one)[0]).toBe('1 tool · 1 skill · 1 agent · 1 rule')
})

test('a part at 0 is left out; with none, no counts, open or closed', () => {
  const rulesOnly = input({ isToolsOpen: true, stats: {}, rules: { always: ['a.md', 'b.md'], byPath: [], isTracked: true } })
  expect(labels(rulesOnly)).toEqual(['2 rules'])
  expect(labels(input({ isToolsOpen: true, stats: {} }))).toEqual([])
  expect(labels(input({ stats: {} }))).toEqual([])
})

// Spec 2026-11-11, D7, and settings-values S6: short of rows, the second info row goes first, then the open rows from
// the last; the four rows draw at 24, 48 and 100 columns under usage:
const open = (o: Partial<BandInput> = {}) => input({
  isToolsOpen: true, agents: TARGET_AGENTS, rules: { always: ['a.md', 'b.md', 'c.md'], byPath: ['d.md', 'e.md'], isTracked: true },
  session: { ...input().session, agentTypes: TARGET_TYPES, loadedSkills: { 'superpowers:brainstorming': 1, 'solve-task': 2 } }, ...o,
})
const ROW = /^(tools|skills|agents|rules):/
const labelsOf = (lines: Line[]): string[] => texts(lines).filter(l => ROW.test(l)).map(l => l.slice(0, l.indexOf(':')))

test('short of rows, the second info row goes first, then rules:, then agents:', () => {
  // At 98 columns the version takes a second info row
  const at = (maxRows?: number) => bandLines(open({ columns: 98, session: { ...open().session, version: '2.1.322' }, ...(maxRows === undefined ? {} : { maxRows }) }))
  // A live agent: line 1, the gauges, two info rows, usage:, four rows
  expect(at()).toHaveLength(9)
  expect(texts(at())).toContain('CC 2.1.322')
  expect(texts(at(8))).not.toContain('CC 2.1.322')
  expect(labelsOf(at(8))).toEqual(['tools', 'skills', 'agents', 'rules'])
  expect(at(8)).toHaveLength(8)
  expect(labelsOf(at(7))).toEqual(['tools', 'skills', 'agents'])
  expect(labelsOf(at(6))).toEqual(['tools', 'skills'])
})

for (const columns of [24, 48, 100]) {
  test(`at ${columns} columns the four rows draw under usage:`, () => {
    const lines = bandLines(open({ columns }))
    expect(usageOf(lines)).toBeDefined()
    expect([...new Set(labelsOf(lines))]).toEqual(['tools', 'skills', 'agents', 'rules'])
  })
}

test('at 24 columns, 3 rows drop usage: and every row', () => {
  const lines = bandLines(open({ columns: 24, maxRows: 3 }))
  expect(usageOf(lines)).toBeUndefined()
  expect(labelsOf(lines)).toEqual([])
})

test('a name wider than the band at 24 columns is cut by the draw; no drawn row is wider', { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on, { band: 'full', usage: ALWAYS, now: NOW })
  engine(on, ['agent.spawn'])
  spawns(on)
  await $.session.start(START)
  await spawn($, 'alfred-code:web-angular-solution-designer')
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 24, maxRows: 20 } })
  const drawn = await rows(ui)
  for (const row of drawn) expect(widthOf([{ text: row }])).toBeLessThanOrEqual(24)
  expect(drawn.some(l => l.startsWith('agents:'))).toBe(true)
  await ui.unmount()
})

// The owner's target, 2026-11-11 (the user's answer): in full mode the plan has a row of its own, under the info line
// and the project row (settings-values S6),
// 'plan:' and the rows' label width, its title, bar and count, then the first running step; line 1 no longer carries it
const planNamed = (changes: Parameters<typeof planOf>[0] = {}) => planView(planOf(changes), FIVE_TIMES, FIVE_OVERHEAD, {}, PLAN_NOW)
const planRowOf = (lines: Line[]): string | undefined => texts(lines).find(l => l.startsWith('plan:'))
const WORKING = { isWorking: true, live: { turnId: 't2', startedAt: NOW - 30_000, toolCalls: 3, toolFailures: 0, runningCalls: [], promptAt: NOW - 30_000 } }

test('the plan row is the target shape, under the info line, and line 1 keeps the turn', () => {
  const lines = texts(bandLines(input({ plan: planNamed(), isToolsOpen: true, ...WORKING })))
  const at = lines.findIndex(l => l.startsWith('plan:'))
  expect(lines[at]).toBe('plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor')
  expect(lines[at - 1]?.startsWith('Sonnet 5.5')).toBe(true)
  expect(lines[0]).toBe('⟳ Turn 2 · 0:30 · 3 tools')
})

test('two steps running add a dim +1; a finished plan reads done ✓; with none running, the count alone', () => {
  const two = bandLines(input({ plan: planNamed({ S5: 'in_progress' }) }))
  expect(planRowOf(two)).toBe('plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor +1')
  const plus = two.find(l => text(l).startsWith('plan:'))?.at(-1)
  expect(plus).toEqual({ text: ' +1', tone: 'dim' })
  expect(planRowOf(bandLines(input({ plan: planNamed({ S4: 'done', S5: 'done' }) })))).toBe('plan:    Token refresh ▰▰▰▰▰ 5/5 · done ✓')
  expect(planRowOf(bandLines(input({ plan: planNamed({ S4: 'pending' }) })))).toBe('plan:    Token refresh ▰▰▰▱▱ 3/5')
})

test('idle with a failure, line 1 carries no PLAN in full mode; the calm band keeps it there and draws no row', () => {
  const full = bandLines(input({ plan: planNamed(), newFailures: 1 }))
  expect(text(full[0] ?? [])).not.toContain('PLAN')
  expect(planRowOf(full)).toBeDefined()
  const calm = bandLines(input({ mode: 'calm', plan: planNamed(), newFailures: 1 }))
  expect(text(calm[0] ?? [])).toContain('PLAN 3/5')
  expect(planRowOf(calm)).toBeUndefined()
})

test('the plan row shows with the rows closed, and keeps its colours while the band is idle', () => {
  const lines = bandLines(input({ plan: planNamed(), isToolsOpen: false }))
  const row = lines.find(l => text(l).startsWith('plan:')) ?? []
  expect(row.length).toBeGreaterThan(0)
  expect(row.some(seg => 'text' in seg && seg.tone !== 'dim')).toBe(true)
})

test('short of rows, the plan row goes after usage: and before the info line', () => {
  const b = (maxRows?: number) => bandLines(open({ columns: 100, plan: planNamed(), ...(maxRows === undefined ? {} : { maxRows }) }))
  expect(b()).toHaveLength(9)
  expect(usageOf(b(5))).toBeDefined()
  expect(labelsOf(b(5))).toEqual([])
  expect(planRowOf(b(4))).toBeDefined()
  expect(usageOf(b(4))).toBeUndefined()
  expect(planRowOf(b(3))).toBeUndefined()
  expect(b(3)).toHaveLength(3)
})

// The plan's score on its own row (the user, 2026-11-13: 'I want to show score for the plan if such provided'):
// alfred-code's score rule, the released round's total and its arrow, green at or above the scoring level and amber
// under it, no colour with no level; line 1 then carries no score in full mode
const scored = (over: Record<string, unknown> = {}) => {
  const s = parseAlfredScoring(JSON.stringify({ ...JSON.parse(SCORING_JSON), ...over }), 'waste-bin')
  return s === null ? null : scoresView(s)
}
const alfredPlan = (over: Record<string, unknown> = {}) => {
  const plan = parseAlfredStatus(JSON.stringify({ ...JSON.parse(STATUS_JSON), ...over }))
  if (plan === null) throw new Error('fixture')
  return planView(plan, {}, 0, {}, Date.parse('2026-11-13T11:45Z'))
}
const toneOf = (row: Line, prefix: string) => row.find(seg => 'text' in seg && seg.text.startsWith(prefix))

test('the plan row ends with the plan\'s score and arrow, coloured against the scoring level', () => {
  const row = (o: Partial<BandInput>) => bandLines(input({ columns: 160, plan: alfredPlan(), score: scored(), ...o })).find(l => text(l).startsWith('plan:')) ?? []
  expect(text(row({ scoreLevel: 80 }))).toBe('plan:    Waste bin (plannings) ▰▱▱▱▱ 1/4 · ▸ 3 Restore deleted plan books · score 85 ▲13')
  expect(toneOf(row({ scoreLevel: 80 }), 'score')).toMatchObject({ tone: 'ok' })
  expect(toneOf(row({ scoreLevel: 90 }), 'score')).toMatchObject({ tone: 'warn' })
  expect(toneOf(row({ scoreLevel: null }), 'score')).not.toHaveProperty('tone')
  // In full mode the score is the plan row's alone
  const lines = bandLines(input({ columns: 160, plan: alfredPlan(), score: scored(), scoreLevel: 80, newFailures: 1 }))
  expect(text(lines[0] ?? [])).not.toContain('score')
})

test('while grading runs the plan row shows the newest total, marked as grading', () => {
  const row = bandLines(input({ columns: 160, plan: alfredPlan(), score: scored({ released: null }), scoreLevel: 80 })).find(l => text(l).startsWith('plan:')) ?? []
  expect(text(row)).toBe('plan:    Waste bin (plannings) ▰▱▱▱▱ 1/4 · ▸ 3 Restore deleted plan books · score 82 grading ▼3')
})

test('a plan not yet approved reads awaiting approval in place of its running step', () => {
  const row = bandLines(input({ columns: 160, plan: alfredPlan({ approvedAt: null }), score: scored(), scoreLevel: 80 })).find(l => text(l).startsWith('plan:')) ?? []
  expect(text(row)).toBe('plan:    Waste bin (plannings) ▰▱▱▱▱ 1/4 · awaiting approval · score 85 ▲13')
})

test('a finished plan with its score never overflows the row', () => {
  for (let columns = 20; columns <= 80; columns++) {
    const row = bandLines(input({ columns, plan: alfredPlan({ completedAt: '2026-11-13T12:00Z' }), score: scored({ released: null }), scoreLevel: 80 })).find(l => text(l).startsWith('plan:')) ?? []
    expect(widthOf(row)).toBeLessThanOrEqual(columns)
  }
})

test('a score that is not the plan\'s own stays off the plan row and on line 1', () => {
  const lines = bandLines(input({ columns: 160, plan: alfredPlan(), score: scored(), scoreLevel: 80, isPlanScore: false, newFailures: 1 }))
  expect(text(lines.find(l => text(l).startsWith('plan:')) ?? [])).not.toContain('score')
  expect(text(lines[0] ?? [])).toContain('score 85')
})

test('short of rows, a dropped plan row hands its count and score to line 1', () => {
  const b = (maxRows: number) => bandLines(input({ columns: 160, plan: alfredPlan(), score: scored(), scoreLevel: 80, newFailures: 1, maxRows }))
  // The fewest rows that still draw the plan row, then one fewer
  const least = [2, 3, 4, 5, 6].find(n => planRowOf(b(n)) !== undefined) ?? 0
  expect(least).toBeGreaterThan(2)
  expect(text(b(least)[0] ?? [])).not.toContain('score')
  expect(planRowOf(b(least - 1))).toBeUndefined()
  expect(text(b(least - 1)[0] ?? [])).toContain('PLAN 1/4 · score 85 ▲13')
})

for (const columns of [40, 60, 100]) {
  test(`at ${columns} columns the score stays: the step goes first, then the plan's title is cut`, () => {
    const row = bandLines(input({ columns, plan: alfredPlan(), score: scored(), scoreLevel: 80 })).find(l => text(l).startsWith('plan:')) ?? []
    expect(widthOf(row)).toBeLessThanOrEqual(columns)
    expect(text(row).endsWith('score 85 ▲13')).toBe(true)
  })
}

for (const columns of [24, 48, 100]) {
  test(`at ${columns} columns the plan row fits: the step's title is cut, then the step goes, then the title`, () => {
    const row = bandLines(input({ columns, plan: planNamed() })).find(l => text(l).startsWith('plan:')) ?? []
    expect(row.length).toBeGreaterThan(0)
    expect(widthOf(row)).toBeLessThanOrEqual(columns)
  })
}

// The user, 2026-11-11 (settings-values S6): the place is a row, 'project: <project> │ git:(<branch>) │ folder: <folder>';
// a folder past 40 cells keeps its last parts after '…/', a narrower form only its last part, then none
const placed = (place: NonNullable<BandInput['session']['place']>, columns = 200) =>
  texts(bandLines(input({ columns, session: { ...input().session, place } }))).join('\n')

test('the project row shows the session project, the branch, then the folder Claude works in', () => {
  expect(placed({ project: 'Example', folder: 'Frontend', branch: 'develop' })).toContain('project: Example │ git:(develop) │ folder: Frontend')
  expect(placed({ project: 'frontend', branch: 'develop' })).toContain('project: frontend │ git:(develop)')
  expect(placed({ project: 'frontend', branch: 'develop' })).not.toContain('folder:')
  const deep = placed({ project: 'w', folder: 'packages/web-client/src/app/features/billing/invoices', branch: 'main' })
  expect(deep).toContain('project: w │ git:(main) │ folder: …/src/app/features/billing/invoices')
})

// The changes after the branch (the user, 2026-11-12), tests/changes.test.ts for how they are read
test('the project row shows the changes after the branch, and none when the tree is clean', () => {
  expect(placed({ project: 'alfred-mods', folder: 'hooks', branch: 'web-steps', changes: { added: 5323, removed: 123 } }))
    .toContain('project: alfred-mods │ git:(web-steps) +5323 −123 │ folder: hooks')
  expect(placed({ project: 'w', branch: 'main', changes: { added: 0, removed: 0 } })).toContain('project: w │ git:(main)\n')
  expect(placed({ project: 'w', branch: 'main' })).toContain('project: w │ git:(main)\n')
})

test('narrow, the folder goes first, then the changes', () => {
  const place = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop', changes: { added: 12, removed: 3 } }
  expect(placed(place, 50)).toContain('project: Example │ git:(develop) +12 −3\n')
  expect(placed(place, 36)).toContain('project: Example │ git:(develop)\n')
})

// Commits ahead of and behind the branch's upstream, as of the last fetch (the user, 2026-11-12: 'git:(band-order)
// arrow-up-symbol 1 arrow-down-symbol 2 +41 −30'), between the branch and the changes; a side at 0 is left out
test('the project row shows commits ahead and behind after the branch, a side at 0 left out', () => {
  const place = { project: 'alfred-mods', branch: 'band-order', sync: { ahead: 1, behind: 2 }, changes: { added: 41, removed: 30 } }
  expect(placed(place)).toContain('project: alfred-mods │ git:(band-order) ↑1 ↓2 +41 −30\n')
  expect(placed({ ...place, sync: { ahead: 0, behind: 3 } })).toContain('git:(band-order) ↓3 +41 −30\n')
  expect(placed({ ...place, sync: { ahead: 4, behind: 0 } })).toContain('git:(band-order) ↑4 +41 −30\n')
  expect(placed({ ...place, sync: { ahead: 0, behind: 0 } })).toContain('git:(band-order) +41 −30\n')
  const row = bandLines(input({ session: { ...input().session, place } })).find(l => text(l).startsWith('project:')) ?? []
  expect(row.find(s => 'text' in s && s.text === '↑1')).toEqual({ text: '↑1', tone: 'git' })
  expect(row.find(s => 'text' in s && s.text === '↓2')).toEqual({ text: '↓2', tone: 'git' })
})

test('narrow, the folder goes first, then the changes, then the commits ahead and behind', () => {
  const place = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop', sync: { ahead: 1, behind: 2 }, changes: { added: 12, removed: 3 } }
  expect(placed(place, 50)).toContain('project: Example │ git:(develop) ↑1 ↓2 +12 −3\n')
  expect(placed(place, 40)).toContain('project: Example │ git:(develop) ↑1 ↓2\n')
  expect(placed(place, 36)).toContain('project: Example │ git:(develop)\n')
})

test("narrow, the project row keeps the folder's last part, then drops the folder", () => {
  const place = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop' }
  expect(placed(place, 100)).toContain('project: Example │ git:(develop) │ folder: Frontend/src/app')
  expect(placed(place, 58)).toContain('project: Example │ git:(develop) │ folder: …/app')
  expect(placed(place, 47)).toContain('project: Example │ git:(develop)')
  expect(placed(place, 47)).not.toContain('folder:')
})


// Spec 2026-11-11 band-under, U2 'Order under' and U3: under the input the action row follows the gauges, so a cut at
// the screen's edge takes the detail rows first; fullscreen's buttons name their commands and take no hotkey, and the
// main screen draws the commands as text
const textOf = (l: Line): string => l.map(s => ('text' in s ? s.text : 'button' in s ? `[${s.button.label}]` : '')).join('')
const buttonsOf = (lines: Line[]) => lines.flat().flatMap(s => ('button' in s ? [s.button] : []))

// The user, 2026-11-12: under the input the action row comes first, over the turn line ('✗ 3 new /inspect' then
// '✓ Turn 18 · 41s · 4 tools' then the gauges), the line nearest the input as above it is the last
test('under, the action row comes first, over the turn line and the gauges; above it stays last', () => {
  const under = bandLines(input({ newFailures: 1, under: { buttons: 'click' } }))
  expect(under.findIndex(l => textOf(l).startsWith('✗ 1 new'))).toBe(0)
  expect(textOf(under[1]!)).toMatch(/^✓ /)
  const above = bandLines(input({ newFailures: 1 }))
  expect(above.findIndex(l => textOf(l).startsWith('✗ 1 new'))).toBe(above.length - 1)
})

test('fullscreen under, the buttons name their commands and take no hotkey', () => {
  const lines = bandLines(input({ newFailures: 1, handoffAskStep: 80, under: { buttons: 'click' } }))
  const buttons = buttonsOf(lines)
  expect(buttons.every(b => b.hotkey === undefined)).toBe(true)
  expect(buttons.find(b => b.key === 'inspect')?.label).toBe('/inspect')
  expect(buttons.find(b => b.key === 'handoff')?.label).toBe('/auto-handoff now')
  expect(buttons.some(b => b.key === 'tools')).toBe(false)
})

test('main screen under, the buttons are commands', () => {
  const lines = bandLines(input({ newFailures: 1, handoffAskStep: 80, under: { buttons: 'text' } }))
  expect(buttonsOf(lines)).toEqual([])
  const texts = lines.map(textOf)
  expect(texts.some(t => t.includes('✗ 1 new /inspect'))).toBe(true)
  expect(texts.some(t => t.includes('/auto-handoff now'))).toBe(true)
  expect(texts.find(t => t.startsWith('usage:'))).toBe('usage:   [ 19 tools ]')
})

test('main screen under, the open rows still draw under usage:', () => {
  const open = bandLines(input({ isToolsOpen: true, under: { buttons: 'text' } }))
  expect(open.some(l => textOf(l).startsWith('tools:'))).toBe(true)
  const closed = bandLines(input({ under: { buttons: 'text' } }))
  expect(closed.some(l => textOf(l).startsWith('tools:'))).toBe(false)
})

// The gauges line is as wide under as above (its narrow form keeps the resets at 48, today's behaviour), so the check
// is on the rows the place changes: the action items, a row each when one cannot hold them, and the info line
test('main screen under at 48 columns, every row the place changes fits', () => {
  const lines = bandLines(input({ columns: 48, newFailures: 1, handoffAskStep: 80, isToolsOpen: true, under: { buttons: 'text' } }))
  const above = bandLines(input({ columns: 48, newFailures: 1, handoffAskStep: 80, isToolsOpen: true }))
  const gauges = textOf(above[1] ?? [])
  for (const l of lines.filter(l => textOf(l) !== gauges)) expect(widthOf(l)).toBeLessThanOrEqual(48)
  expect(lines.map(textOf).join('\n')).toContain('/inspect')
})

// Fullscreen, the commands are buttons: the action row is measured with them, so none is cut at the edge
test('fullscreen under at 48 columns, the action row splits with its buttons counted', () => {
  const lines = bandLines(input({ columns: 48, newFailures: 1, handoffAskStep: 80, isToolsOpen: true, under: { buttons: 'click' } }))
  const above = bandLines(input({ columns: 48, newFailures: 1, handoffAskStep: 80, isToolsOpen: true }))
  const gauges = textOf(above[1] ?? [])
  for (const l of lines.filter(l => textOf(l) !== gauges)) expect(cellsOf(l)).toBeLessThanOrEqual(48)
  const inspect = lines.find(l => l.some(s => 'button' in s && s.button.key === 'inspect'))
  expect(inspect === undefined ? '' : textOf(inspect)).toBe('✗ 1 new [/inspect]')
})

test('above, the buttons keep their hotkeys', () => {
  const buttons = buttonsOf(bandLines(input({ newFailures: 1 })))
  expect(buttons.find(b => b.key === 'inspect')?.hotkey).toBe('1')
  expect(buttons.some(b => b.key === 'tools')).toBe(false)
})

// Spec 2026-11-11 settings-values, S6: the user's sample, row for row - the info line ends with the version, then the
// project row, plan:, usage: as text, and the detail rows
const USER_ORDER = input({
  columns: 150, isToolsOpen: true, plan: planNamed(), stats: TARGET_STATS, agents: TARGET_AGENTS, rules: TARGET_RULES,
  skillListing: { listed: 57, total: 60, tokens: 3200 },
  session: {
    ...input().session, place: { project: 'my-app', folder: '.claude', branch: 'develop' }, version: '2.1.322',
    loadedSkills: { 'superpowers:brainstorming': 1, 'solve-task': 2 }, agentTypes: TARGET_TYPES,
  },
})
const usageOf = (lines: Line[]): Line | undefined => lines.find(l => text(l).startsWith('usage:'))
const labelOf = (l: string): string => l.slice(0, l.indexOf(':'))

test("the full band's rows in the user's order", () => {
  const lines = texts(bandLines(USER_ORDER))
  expect(lines.findIndex(l => l.startsWith('Sonnet 5.5'))).toBe(2)
  expect(lines.slice(3)).toEqual([
    'project: my-app │ git:(develop) │ folder: .claude',
    'plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor',
    'usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]',
    'tools:   Bash ×32 │ AskUserQuestion ×4 │ Read ×4 │ Write ×4 │ Grep ×1',
    'skills:  superpowers:brainstorming ×1 │ solve-task ×2 │ 57 of 60 listed',
    'agents:  ◐ alfred-code:web-angular-verifier ×1 │ ✓ Explore ×2 │ ✓ general-purpose ×1 │ 1 running',
    'rules:   alfred-interaction.md │ alfred-git.md │ alfred-preferences.md │ web-angular.md │ typescript.md │ 3 always-on · 2 by path',
  ])
})

test('the info line ends with the version, and the place and the toggle have left it', () => {
  const info = texts(bandLines(USER_ORDER))[2] ?? ''
  expect(info.endsWith(' │ CC 2.1.322')).toBe(true)
  expect(info).not.toContain('my-app')
  expect(info).not.toMatch(/tools|[▾▸]/)
})

const projectRow = (place: NonNullable<BandInput['session']['place']>, columns = 150): string | undefined =>
  texts(bandLines(input({ columns, session: { ...input().session, place } }))).find(l => l.startsWith('project:'))

test('project: without git: outside a repository', () => {
  expect(projectRow({ project: 'my-app', folder: '.claude', branch: null })).toBe('project: my-app │ folder: .claude')
})

test('project: without folder: at the root', () => {
  expect(projectRow({ project: 'my-app', branch: 'develop' })).toBe('project: my-app │ git:(develop)')
})

test('usage: is text in every place, with no button', () => {
  for (const under of [undefined, { buttons: 'click' as const }, { buttons: 'text' as const }]) {
    const lines = bandLines(under === undefined ? USER_ORDER : { ...USER_ORDER, under })
    const row = usageOf(lines) ?? []
    expect(text(row)).toBe('usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]')
    expect(row.some(s => 'button' in s)).toBe(false)
    expect(lines.flat().some(s => 'button' in s && s.button.key === 'tools')).toBe(false)
  }
})

test('short of width, usage: drops the rules, then the agents, then the skills', () => {
  const at = (columns: number): string => text(usageOf(bandLines({ ...USER_ORDER, columns })) ?? [])
  expect(at(100)).toBe('usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]')
  expect(at(55)).toBe('usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) ]')
  expect(at(48)).toBe('usage:   [ 45 tools · 2 skills ]')
  expect(at(24)).toBe('usage:   [ 45 tools ]')
})

test('the detail rows draw however short usage: gets', () => {
  const lines = bandLines({ ...USER_ORDER, columns: 48 })
  expect(text(usageOf(lines) ?? [])).toBe('usage:   [ 45 tools · 2 skills ]')
  expect([...new Set(labelsOf(lines))]).toEqual(['tools', 'skills', 'agents', 'rules'])
})

test('4 rows free with a plan keep line 1, the gauges, the info line and plan:', () => {
  const lines = texts(bandLines({ ...USER_ORDER, maxRows: 4 }))
  expect(lines).toHaveLength(4)
  expect(lines[2]?.endsWith(' │ CC 2.1.322')).toBe(true)
  expect(lines[3]).toBe('plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor')
})

test('short of rows, the project row goes first, then the detail rows from the last, then usage:, then plan:', () => {
  const at = (maxRows: number): string[] => texts(bandLines({ ...USER_ORDER, maxRows })).slice(3).map(labelOf)
  expect(at(10)).toEqual(['project', 'plan', 'usage', 'tools', 'skills', 'agents', 'rules'])
  expect(at(9)).toEqual(['plan', 'usage', 'tools', 'skills', 'agents', 'rules'])
  expect(at(6)).toEqual(['plan', 'usage', 'tools'])
  expect(at(5)).toEqual(['plan', 'usage'])
  expect(at(4)).toEqual(['plan'])
  expect(texts(bandLines({ ...USER_ORDER, maxRows: 3 }))).toHaveLength(3)
})

test('the calm band draws none of rows 2 to 6', () => {
  const lines = texts(bandLines({ ...USER_ORDER, mode: 'calm' }))
  expect(lines.length).toBeLessThanOrEqual(2)
  expect(lines.some(l => /^(project|plan|usage|tools|skills|agents|rules):/.test(l) || l.includes('CC 2.1.322'))).toBe(false)
})

test("the project and usage rows' tones", () => {
  const lines = bandLines(USER_ORDER)
  expect(lines.find(l => text(l).startsWith('project:'))).toEqual([
    { text: 'project: ', tone: 'dim' }, { text: 'my-app' },
    { text: ' │ ', tone: 'dim' }, { text: 'git:(', tone: 'git' }, { text: 'develop', tone: 'branch' }, { text: ')', tone: 'git' },
    { text: ' │ ', tone: 'dim' }, { text: 'folder: ', tone: 'dim' }, { text: '.claude' },
  ])
  expect(usageOf(lines)).toEqual([{ text: 'usage:   ', tone: 'dim' }, { text: '[ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]', tone: 'counts' }])
})

for (const noColor of [false, true]) {
  test(`the project and usage rows draw ${noColor ? 'no colour under NO_COLOR' : 'purple, yellow and aqua'}`, async ($, on) => {
    const lines = bandLines(USER_ORDER).filter(l => /^(project|usage):/.test(text(l)))
    on('ui.render', { component: 'Pane', requestId: 'rows' }, (h$, e) => drawLines(h$, e, lines, { noColor, press: {}, columns: 150 }))
    const ui = await $.ui.mount({
      plugin: 'alfred-mods', surface: 'desktop', component: 'Pane', requestId: 'rows',
      props: { title: 'rows', isFocused: false, bodyColumns: 150, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const colorOf = async (re: RegExp): Promise<unknown> =>
      (await ui.findAll({ type: 'Text', text: re })).reverse().find(el => el.props.color !== undefined)?.props.color
    expect(lines).toHaveLength(2)
    if (noColor) {
      expect(JSON.stringify(await ui.drawn())).not.toMatch(/"(color|dimColor)"/)
      return
    }
    expect(await colorOf(/^git:\($/)).toBe('#c084fc')
    expect(await colorOf(/^develop$/)).toBe('#eab308')
    expect(await colorOf(/^\[ 45 tools/)).toBe('#66d9e8')
    expect(await colorOf(/^\.claude$/)).toBeUndefined()
  })
}

// Idle and healthy, the full band keeps its colours, not only while it works (the user, 2026-11-12: 'these values have
// colors by default ... not only when active work'); the calm band stays the one dim line
test('idle and healthy, the full band keeps its colours on every row', () => {
  const lines = bandLines(input({ stats: TARGET_STATS, session: { ...input().session, place: { project: 'my-app', folder: '.claude', branch: 'develop' } } }))
  expect(texts(lines).slice(2)).toEqual(['project: my-app │ git:(develop) │ folder: .claude', 'usage:   [ 45 tools ]'])
  for (const l of lines.slice(0, 2)) expect(l.some(s => 'text' in s && s.tone !== undefined && s.tone !== 'dim')).toBe(true)
  expect(lines[0]?.find(s => 'text' in s && s.text.startsWith('ctx'))).toMatchObject({ tone: 'usage' })
  const calm = bandLines(input({ mode: 'calm' }))
  for (const l of calm) for (const s of l) if ('text' in s) expect(s.tone).toBe('dim')
  const project = lines[2] ?? []
  expect(project.find(s => 'text' in s && s.text === 'my-app')).toEqual({ text: 'my-app' })
  expect(project.find(s => 'text' in s && s.text === 'develop')).toEqual({ text: 'develop', tone: 'branch' })
  expect(project.find(s => 'text' in s && s.text === '.claude')).toEqual({ text: '.claude' })
  expect(usageOf(lines)?.[1]).toEqual({ text: '[ 45 tools ]', tone: 'counts' })
})
