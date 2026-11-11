// The band's detail rows (spec: docs/superpowers/specs/2026-11-11-band-detail-rows-design.md): `tools:`, `skills:`,
// `agents:` and `rules:` under the info line, open by default, items joined by ' │ '; the toggle counts all four
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { newRow } from '../hooks/agents.ts'
import { agentSegs, bandLines, ruleSegs, toggleForms, toolRows } from '../hooks/band.ts'
import type { BandInput, Line } from '../hooks/band.ts'
import { widthOf } from '../hooks/format.ts'
import { SPAWN, START, engine, rows, stubAll, watchState } from './kit.ts'
import { FIVE, FIVE_OVERHEAD, FIVE_TIMES, NOW as PLAN_NOW, planOf } from './plans.ts'
import { planView } from '../hooks/plan.ts'

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

test('no rule known reads none loaded, also from a state kept before the rules row', () => {
  expect(rulesRow(input({ isToolsOpen: true }))).toBe('rules:   none loaded')
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
  expect((state.get('meta') as Meta | undefined)?.pathRules).toBeUndefined()
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

// Spec 2026-11-11, D5: the toggle counts the tools, skills, agents and rules it opens
const labels = (b: BandInput): string[] => toggleForms(b).map(l => (l[0] !== undefined && 'button' in l[0] ? l[0].button.label : ''))
const TARGET = input({
  isToolsOpen: true, stats: TARGET_STATS, agents: TARGET_AGENTS, rules: TARGET_RULES,
  meta: { ...input().meta, skills: { 'superpowers:brainstorming': 1, 'solve-task': 2 }, agentTypes: TARGET_TYPES },
})

test('the toggle counts all four, and its forms drop rules, then agents, then skills, then all but the arrow', () => {
  expect(labels(TARGET)).toEqual([
    '45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ▾', '45 tools · 2 skills · 4 agents (1 ◐) ▾', '45 tools · 2 skills ▾', '45 tools ▾', '▾',
  ])
  for (const form of toggleForms(TARGET)) expect(form).toEqual([{ button: { key: 'tools', label: expect.any(String), hotkey: 't' } }])
})

test('(k ◐) only while agents run; singular forms', () => {
  const one = input({
    isToolsOpen: true, stats: { Bash: stat(1) }, agents: [agent('a1', 'Explore', 'completed')],
    rules: { always: ['a.md'], byPath: [], isTracked: true }, meta: { ...input().meta, skills: { x: 1 }, agentTypes: { Explore: 1 } },
  })
  expect(labels(one)[0]).toBe('1 tool · 1 skill · 1 agent · 1 rule ▾')
})

test('a part at 0 is left out; with none, tools; closed and empty, no toggle', () => {
  const rulesOnly = input({ isToolsOpen: true, stats: {}, rules: { always: ['a.md', 'b.md'], byPath: [], isTracked: true } })
  expect(labels(rulesOnly)).toEqual(['2 rules ▾', '▾'])
  expect(labels(input({ isToolsOpen: true, stats: {} }))).toEqual(['tools ▾', '▾'])
  expect(labels(input({ stats: {} }))).toEqual([])
})

// Spec 2026-11-11, D7 and the owner's proof: short of rows, the second info row goes first, then the open rows from the
// last; the four rows draw at 24, 48 and 100 columns under a two-row info line that holds the toggle
const open = (o: Partial<BandInput> = {}) => input({
  isToolsOpen: true, agents: TARGET_AGENTS, rules: { always: ['a.md', 'b.md', 'c.md'], byPath: ['d.md', 'e.md'], isTracked: true },
  meta: { ...input().meta, agentTypes: TARGET_TYPES }, ...o,
})
const ROW = /^(tools|skills|agents|rules):/
const labelsOf = (lines: Line[]): string[] => texts(lines).filter(l => ROW.test(l)).map(l => l.slice(0, l.indexOf(':')))
const tools = (lines: Line[]) => lines.flat().find(s => 'button' in s && s.button.key === 'tools')

test('short of rows, the second info row goes first, then rules:, then agents:', () => {
  const all = bandLines(open({ columns: 100 }))
  // A live agent: line 1, the gauges, two info rows, four rows
  expect(all).toHaveLength(8)
  expect(labelsOf(bandLines(open({ columns: 100, maxRows: 7 })))).toEqual(['tools', 'skills', 'agents', 'rules'])
  expect(bandLines(open({ columns: 100, maxRows: 7 }))).toHaveLength(7)
  expect(labelsOf(bandLines(open({ columns: 100, maxRows: 6 })))).toEqual(['tools', 'skills', 'agents'])
  expect(labelsOf(bandLines(open({ columns: 100, maxRows: 5 })))).toEqual(['tools', 'skills'])
})

for (const columns of [24, 48, 100]) {
  test(`at ${columns} columns the four rows draw under a two-row info line that holds the toggle`, () => {
    const lines = bandLines(open({ columns }))
    expect(tools(lines)).toBeDefined()
    expect([...new Set(labelsOf(lines))]).toEqual(['tools', 'skills', 'agents', 'rules'])
  })
}

test('at 24 columns, a maxRows that forces the one-row info line drops the toggle and every row', () => {
  const lines = bandLines(open({ columns: 24, maxRows: 3 }))
  expect(tools(lines)).toBeUndefined()
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

// The owner's target, 2026-11-11 (the user's answer): in full mode the plan has a row of its own above the info line,
// 'plan:' and the rows' label width, its title, bar and count, then the first running step; line 1 no longer carries it
const planNamed = (changes: Parameters<typeof planOf>[0] = {}) => planView(planOf(changes), FIVE_TIMES, FIVE_OVERHEAD, {}, PLAN_NOW)
const planRowOf = (lines: Line[]): string | undefined => texts(lines).find(l => l.startsWith('plan:'))
const WORKING = { isWorking: true, live: { turnId: 't2', startedAt: NOW - 30_000, tools: 3, failures: 0, running: [], promptAt: NOW - 30_000 } }

test('the plan row is the target shape, above the info line, and line 1 keeps the turn', () => {
  const lines = texts(bandLines(input({ plan: planNamed(), isToolsOpen: true, ...WORKING })))
  const at = lines.findIndex(l => l.startsWith('plan:'))
  expect(lines[at]).toBe('plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor')
  expect(lines[at + 1]?.startsWith('Sonnet 5.5')).toBe(true)
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

test('the plan row shows with the rows closed, and dims with the band while calm', () => {
  const lines = bandLines(input({ plan: planNamed(), isToolsOpen: false }))
  const row = lines.find(l => text(l).startsWith('plan:')) ?? []
  expect(row.length).toBeGreaterThan(0)
  for (const seg of row) if ('text' in seg) expect(seg.tone).toBe('dim')
})

test('short of rows, the plan row goes after the tool rows and before the info line', () => {
  const b = (maxRows?: number) => bandLines(open({ columns: 100, plan: planNamed(), ...(maxRows === undefined ? {} : { maxRows }) }))
  expect(b()).toHaveLength(9)
  expect(planRowOf(b(4))).toBeDefined()
  expect(labelsOf(b(4))).toEqual([])
  expect(tools(b(4))).toBeDefined()
  expect(planRowOf(b(3))).toBeUndefined()
  expect(b(3)).toHaveLength(3)
})

for (const columns of [24, 48, 100]) {
  test(`at ${columns} columns the plan row fits: the step's title is cut, then the step goes, then the title`, () => {
    const row = bandLines(input({ columns, plan: planNamed() })).find(l => text(l).startsWith('plan:')) ?? []
    expect(row.length).toBeGreaterThan(0)
    expect(widthOf(row)).toBeLessThanOrEqual(columns)
  })
}

// The user, 2026-11-11: the place reads 'project ▸ folder git:(branch)'; a folder past 40 cells keeps its last parts
// after '…/', and a narrower form keeps only its last part
const placed = (place: NonNullable<BandInput['meta']['place']>, columns = 200) =>
  texts(bandLines(input({ columns, meta: { ...input().meta, place } }))).join('\n')

test('the place shows the session project, then the folder Claude works in, then the branch', () => {
  expect(placed({ project: 'Example', folder: 'Frontend', branch: 'develop' })).toContain('Example ▸ Frontend git:(develop)')
  expect(placed({ project: 'frontend', branch: 'develop' })).toContain('frontend git:(develop)')
  expect(placed({ project: 'frontend', branch: 'develop' })).not.toContain('frontend ▸')
  const deep = placed({ project: 'w', folder: 'packages/web-client/src/app/features/billing/invoices', branch: 'main' })
  expect(deep).toContain('w ▸ …/src/app/features/billing/invoices git:(main)')
})

test("narrow, the place keeps the folder's last part before it drops whole", () => {
  const place = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop' }
  expect(placed(place, 100)).toContain('Example ▸ Frontend/src/app git:(develop)')
  expect(placed(place, 74)).toContain('Example ▸ …/app git:(develop)')
})

