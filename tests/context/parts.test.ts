import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface, SessionContextBreakdown, SessionUsage } from 'claude-code'

import { PRESENTATION, START, engine, rows, stubAll, watchState } from '../kit'
import { clock } from '../../hooks/core/format'
import { memoryName, partsOf, ruleName } from '../../hooks/context/parts'
import type { Parts } from '../../hooks/context/types'
import type { Handoff } from '../../hooks/handoff/types'

// Spec C1: what fills the context, by category, plugin and memory file, from the breakdown A4 already reads
const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

const used = (name: string, tokens: number) => ({ name, tokens, kind: 'used' as const, color: 'promptBorder', isDeferred: false })
const many = <T>(n: number, of: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => of(i))

const CATEGORIES = [
  used('System prompt', 3100), used('System tools', 12_000), used('MCP tools', 4200), used('Custom agents', 9800), used('Messages', 61_000),
  { name: 'Free space', tokens: 90_000, kind: 'free' as const, color: 'inactive', isDeferred: false },
  { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' as const, color: 'inactive', isDeferred: false },
  { name: 'MCP tools (loaded on demand)', tokens: 5000, kind: 'deferred' as const, color: 'inactive', isDeferred: true },
]
// 45 of alfred-code's agents at 200 tokens and two of the person's own; 38 of its skills at 50, 14 of superpowers' at
// 100 and three of the person's own
const AGENTS = [
  ...many(45, i => ({ agentType: `alfred-code:agent-${i}`, source: 'plugin', tokens: 200 })),
  { agentType: 'reviewer', source: 'userSettings', tokens: 300 }, { agentType: 'writer', source: 'projectSettings', tokens: 300 },
]
const SKILLS = [
  ...many(38, i => ({ name: `skill-${i}`, source: 'plugin' as const, pluginName: 'alfred-code', tokens: 50 })),
  ...many(14, i => ({ name: `sp-${i}`, source: 'plugin' as const, pluginName: 'superpowers', tokens: 100 })),
  ...many(3, i => ({ name: `mine-${i}`, source: 'userSettings' as const, tokens: 80 })),
]
const MEMORY = [
  { path: '/w/.claude/CLAUDE.md', type: 'Project', tokens: 2100 },
  { path: '/w/.claude/rules/execution.md', type: 'Project', tokens: 900 },
  { path: '/w/.claude/rules/auto-run.md', type: 'Project', tokens: 800 },
  { path: '/Users/jane/.claude/CLAUDE.md', type: 'User', tokens: 1500 },
  { path: '/Users/jane/.claude/projects/-w/memory/MEMORY.md', type: 'AutoMem', tokens: 1200 },
]

function breakdown(more: Partial<SessionContextBreakdown> = {}): SessionContextBreakdown {
  return {
    categories: CATEGORIES, totalTokens: 90_100, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 45, gridRows: [], model: 'claude-opus-5-5',
    memoryFiles: MEMORY, mcpTools: [], agents: AGENTS, isAutoCompactEnabled: true, autoCompactThreshold: 160_000,
    skills: { totalSkills: 55, includedSkills: 55, tokens: 3600, skillFrontmatter: SKILLS },
    ...more,
  } as never
}
const reading = (b: SessionContextBreakdown | undefined): SessionUsage =>
  ({ startedAt: 0, context: { window: 200_000, ...(b === undefined ? {} : { breakdown: b }) }, rateLimits: [] })

const measure = ($: Engine, tokens = 90_000) =>
  $.session.measure({ context: { tokens, window: 200_000, percent: Math.round(tokens * 100 / 200_000) }, rateLimits: [], changed: ['context'] })
const inspect = ($: Engine, tab: string) =>
  $.command.run({ command: 'inspect', args: tab, origin: { kind: 'composer' }, presentation: PRESENTATION })
const usageTab = async ($: Engine, surface: RenderSurface): Promise<string[]> => {
  await inspect($, 'usage')
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
  const out = (await rows(ui)).map(l => l.trimEnd())
  await ui.unmount()
  return out
}

for (const surface of SURFACES) {
  test(`the Usage tab shows what fills the context (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const kit = stubAll(on, { usage: reading(breakdown()) })
    engine(on)
    await $.session.start(START)
    await measure($)
    const at = kit.clock.now()

    const lines = await usageTab($, surface)
    const i = lines.findIndex(l => l.startsWith('In context'))
    expect(lines.slice(i, i + 3)).toEqual([
      `In context  est. ${clock(at)} · System prompt 3.1k · System tools 12k · MCP tools 4.2k · Custom agents 9.8k · Messages 61k`,
      'Plugins     alfred-code 11k: 45 agents, 38 skills · superpowers 1.4k: 14 skills',
      'Memory      5 files 6.5k · .claude/CLAUDE.md 2.1k · User CLAUDE.md 1.5k · AutoMem MEMORY.md 1.2k · +2',
    ])
    // After the Tokens row
    expect(lines[i - 1]?.startsWith('Tokens')).toBe(true)
  })

  test(`no Plugins row with no plugin agents or skills (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const mine = breakdown({ agents: AGENTS.slice(45), skills: { totalSkills: 3, includedSkills: 3, tokens: 240, skillFrontmatter: SKILLS.slice(52) } })
    stubAll(on, { usage: reading(mine) })
    engine(on)
    await $.session.start(START)
    await measure($)

    const lines = await usageTab($, surface)
    expect(lines.some(l => l.startsWith('In context'))).toBe(true)
    expect(lines.some(l => l.startsWith('Plugins'))).toBe(false)
    expect(lines.some(l => l.startsWith('Memory'))).toBe(true)
  })

  test(`no section before a breakdown (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on, { usage: reading(undefined) })
    engine(on)
    await $.session.start(START)
    await measure($)

    const lines = await usageTab($, surface)
    expect(lines.some(l => /^(In context|Plugins|Memory)\b/.test(l))).toBe(false)
  })

  test(`a breakdown with no skills draws no skill counts (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { skills: _, ...rest } = breakdown()
    stubAll(on, { usage: reading(rest as SessionContextBreakdown) })
    engine(on)
    await $.session.start(START)
    await measure($)

    const lines = await usageTab($, surface)
    expect(lines.find(l => l.startsWith('Plugins'))).toBe('Plugins     alfred-code 9k: 45 agents')
  })
}

test('a memory file outside the project is named by type and base name', { timeoutMs: 15_000 }, async ($, on) => {
  expect(memoryName('/Users/jane/.claude/CLAUDE.md', 'User', '/w')).toBe('User CLAUDE.md')
  expect(memoryName('/w/.claude/CLAUDE.md', 'Project', '/w')).toBe('.claude/CLAUDE.md')
  expect(memoryName('/w/.claude/CLAUDE.md', 'Project', '/w/')).toBe('.claude/CLAUDE.md')
  // A sibling folder that starts with the project's name is outside it
  expect(memoryName('/w2/CLAUDE.md', 'Project', '/w')).toBe('Project CLAUDE.md')

  const state = watchState(on)
  stubAll(on, { usage: reading(breakdown()) })
  engine(on)
  await $.session.start(START)
  await measure($)
  expect((state.get('parts') as Parts).memory.top.map(t => t.name)).toEqual(['.claude/CLAUDE.md', 'User CLAUDE.md', 'AutoMem MEMORY.md'])
  expect(state.writes.some(w => w.includes('jane'))).toBe(false)
})

// A session started in the home folder or at a drive root: the auto memory's folder name and a drive path both hold the
// user name (release 3 review)
test('a memory file under the home folder or a drive root keeps no user name', () => {
  expect(memoryName('/Users/jane/.claude/projects/-Users-jane/memory/MEMORY.md', 'AutoMem', '/Users/jane')).toBe('AutoMem MEMORY.md')
  expect(memoryName('C:\\Users\\jane\\.claude\\CLAUDE.md', 'User', 'C:\\')).toBe('User CLAUDE.md')
  expect(memoryName('/Users/jane/CLAUDE.md', 'Project', '/')).toBe('Project CLAUDE.md')
  expect(memoryName('/w/.claude/rules/a.md', 'Project', '/w')).toBe('.claude/rules/a.md')
})

// Review Focus 4
test('a Windows memory path is named inside the project', () => {
  expect(memoryName('C:\\Users\\me\\proj\\.claude\\CLAUDE.md', 'Project', 'C:\\Users\\me\\proj')).toBe('.claude/CLAUDE.md')
  expect(memoryName('c:\\Users\\me\\proj\\.claude\\rules\\a.md', 'Project', 'C:\\Users\\me\\proj')).toBe('.claude/rules/a.md')
  expect(memoryName('C:\\Users\\me\\.claude\\CLAUDE.md', 'User', 'C:\\Users\\me\\proj')).toBe('User CLAUDE.md')
  const parts = partsOf(breakdown({ memoryFiles: [{ path: 'C:\\Users\\me\\.claude\\CLAUDE.md', type: 'User', tokens: 10 }] }), 'C:\\Users\\me\\proj', 0)
  expect(JSON.stringify(parts).includes('Users')).toBe(false)
})

test('one read serves the point and the parts', { timeoutMs: 15_000 }, async ($, on) => {
  const state = watchState(on)
  const { usage } = stubAll(on, { usage: reading(breakdown()) })
  engine(on)
  await $.session.start(START)
  await measure($)

  expect(usage.breakdowns).toBe(1)
  expect((state.get('handoff') as Handoff).point).toBe(160_000)
  const parts = state.get('parts') as Parts
  expect(parts.at).not.toBeNull()
  expect(parts.categories.map(c => c.name)).toEqual(['System prompt', 'System tools', 'MCP tools', 'Custom agents', 'Messages'])
  expect(parts.plugins).toEqual([
    { name: 'alfred-code', agents: 45, agentTokens: 9000, skills: 38, skillTokens: 1900 },
    { name: 'superpowers', agents: 0, agentTokens: 0, skills: 14, skillTokens: 1400 },
  ])
  expect(parts.memory).toMatchObject({ files: 5, tokens: 6500 })
})

test('a compaction and a stale Usage tab read again from a timer', { timeoutMs: 15_000 }, async ($, on) => {
  const { usage, clock: time } = stubAll(on, { usage: reading(breakdown()) })
  engine(on)
  await $.session.start(START)
  // The start reads one from a timer too (spec 2026-11-11, D4)
  await time.advance(0)
  expect(usage.breakdowns).toBe(1)
  await measure($)
  expect(usage.breakdowns).toBe(2)

  // A compaction reads again, from a timer: the hook does not wait on it
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'q', toolUses: [] }] as never })
  expect(usage.breakdowns).toBe(2)
  await time.advance(0)
  expect(usage.breakdowns).toBe(3)

  // The Usage tab 30 s after the last read: no read; 61 s after it: one more
  await time.advance(30_000)
  await inspect($, 'usage')
  await time.advance(0)
  expect(usage.breakdowns).toBe(3)
  await time.advance(31_000)
  await inspect($, 'usage')
  expect(usage.breakdowns).toBe(3)
  await time.advance(0)
  expect(usage.breakdowns).toBe(4)
})

// Spec 2026-11-11, D4: the always-on rules from the breakdown, by base name
test('ruleName: a rule under .claude/rules, or a User file under any rules folder; nothing else', () => {
  expect(ruleName('/w/.claude/rules/web.md', 'Project')).toBe('web.md')
  expect(ruleName('/w/.claude/rules/sub/deep.md', 'Project')).toBe('deep.md')
  expect(ruleName('C:\\Users\\u\\.claude\\rules\\a.md', 'User')).toBe('a.md')
  expect(ruleName('/cfg/rules/a.md', 'User')).toBe('a.md')
  expect(ruleName('/w/docs/rules/a.md', 'Project')).toBeNull()
  expect(ruleName('/w/CLAUDE.md', 'Project')).toBeNull()
  expect(ruleName('/w/.claude/CLAUDE.md', 'Project')).toBeNull()
})

const RULE_FILES = [
  { path: '/home/u/.claude/rules/user-pref.md', type: 'User', tokens: 40 },
  { path: '/w/CLAUDE.md', type: 'Project', tokens: 900 },
  { path: '/w/.claude/rules/always.md', type: 'Project', tokens: 60 },
  { path: '/w/sub/.claude/rules/always.md', type: 'Project', tokens: 60 },
]

test("the parts keep the breakdown's rule files in its order, each name once, other memory files left out", async ($, on) => {
  stubAll(on, { usage: reading(breakdown({ memoryFiles: RULE_FILES })) })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await measure($)
  expect((state.get('parts') as Parts).rules).toEqual(['user-pref.md', 'always.md'])
})

test('the breakdown is read at start off the start hook, so the rules are known within a tick', async ($, on) => {
  const kit = stubAll(on, { usage: reading(breakdown({ memoryFiles: [{ path: '/w/.claude/rules/always.md', type: 'Project', tokens: 60 }] })) })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  const atStart = kit.usage.breakdowns
  await kit.clock.advance(1)
  expect(kit.usage.breakdowns).toBe(atStart + 1)
  expect((state.get('parts') as Parts).rules).toEqual(['always.md'])
})

// The breakdown names a rule reached through a link by where the link lands, never the link (live, 2026-11-11): a link
// anywhere under the project's `.claude/rules/`, to a folder or a file, makes what it reaches a rule; an import is not
const LINKED = { text: 'x', mtimeMs: 0 }
test("a rule reached through a link under .claude/rules is kept by its target's name; an import is not", async ($, on) => {
  stubAll(on, {
    usage: reading(breakdown({ memoryFiles: [
      { path: '/w/CLAUDE.md', type: 'Project', tokens: 900 },
      { path: '/w/docs/notes.md', type: 'Project', tokens: 30 },
      { path: '/shared/rules/team.md', type: 'Project', tokens: 40 },
      { path: '/shared/house.md', type: 'Project', tokens: 20 },
      { path: '/shared/deep/nested.md', type: 'Project', tokens: 20 },
      { path: '/w/.claude/rules/always.md', type: 'Project', tokens: 60 },
    ] })),
    files: { 'docs/notes.md': LINKED, '/shared/rules/team.md': LINKED, '/shared/house.md': LINKED, '/shared/deep/nested.md': LINKED, '.claude/rules/always.md': LINKED },
    links: { '.claude/rules/shared': '/shared/rules', '.claude/rules/house.md': '/shared/house.md', '.claude/rules/team/deep': '/shared/deep' },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await measure($)
  expect((state.get('parts') as Parts).rules).toEqual(['team.md', 'house.md', 'nested.md', 'always.md'])
})

test('with every memory file a CLAUDE.md, a rule by its folder or the auto memory, no folder is listed', async ($, on) => {
  const kit = stubAll(on, { usage: reading(breakdown({ memoryFiles: [
    ...RULE_FILES,
    { path: '/w/CLAUDE.local.md', type: 'Local', tokens: 10 },
    { path: '/home/u/.claude/projects/p/memory/MEMORY.md', type: 'AutoMem', tokens: 10 },
  ] })) })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await measure($)
  expect((state.get('parts') as Parts).rules).toEqual(['user-pref.md', 'always.md'])
  expect(kit.files.lists.filter(d => d.endsWith('/.claude/rules'))).toEqual([])
})
