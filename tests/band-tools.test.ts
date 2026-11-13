// Every tool by name and the skills in context (the user, 2026-11-11): the full band's toggle opens rows under its
// info line, kept in `settings:band-tools`; a skill is in the main context once the main loop loaded it
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, SessionContextBreakdown, SessionUsage } from 'claude-code'

import { PRESENTATION, START, engine, rows, setUser, step, stepEngine, stubAll, watchState } from './kit.js'
import { tokens } from '../hooks/format.js'

import type { Meta, Parts } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-28T14:00:00Z')
const READING: SessionUsage = {
  startedAt: NOW - 5 * 60_000, context: { window: 200_000, tokens: 20_000, percent: 10 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }], cost: { usd: 0.4 },
}
const MAIN_STEP = { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium' as const, messageCount: 1 }
const complete = { answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' as const }

const band = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const mount = ($: Engine, surface: RenderSurface) => $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: band })

// One turn on Sonnet that ran Bash and a context7 tool, then ended
async function oneTurn($: Engine): Promise<void> {
  await $.session.start(START)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await step($, MAIN_STEP)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'mcp__claude_ai_Context7__query-docs', query: 'x' } as never)
  await $.turn.complete(complete)
}

const isOpen = (lines: string[]): boolean => lines.some(l => l.startsWith('tools:   '))

for (const surface of SURFACES) {
  // Spec 2026-11-11, D1: the rows start open; settings-values S2: "bandRows" closes and opens them, and the toggle
  // writes nothing
  test(`a fresh store opens the rows; "bandRows" false closes them and true opens them again; no button toggles them (${surface})`, async ($, on) => {
    const kit = stubAll(on, { band: 'full', usage: READING, now: NOW })
    stepEngine(on, () => null)
    engine(on)
    await oneTurn($)
    const ui = await mount($, surface)
    expect(isOpen(await rows(ui))).toBe(true)

    await setUser($, kit, { bandRows: false })
    expect(isOpen(await rows(ui))).toBe(false)

    await setUser($, kit, { bandRows: true })
    const open = await rows(ui)
    expect(open).toContain('tools:   Bash ×1 │ Context7:query-docs ×1')
    expect(open.some(l => l.startsWith('skills:'))).toBe(false)

    // usage: is text now (spec settings-values, S6): no tools button to press, and nothing written
    expect(open).toContain('usage:   [ 2 tools ]')
    expect(await ui.press({ key: 'tools' }).then(() => true, () => false)).toBe(false)
    expect(isOpen(await rows(ui))).toBe(true)
    expect(kit.store.writes.filter(w => w.endsWith('settings:band-tools'))).toEqual([])
    await ui.unmount()
  })

  test(`a stored closed keeps the rows closed from the start, through a /clear and a resume (${surface})`, async ($, on) => {
    stubAll(on, { band: 'full', usage: READING, now: NOW, store: { 'settings:band-tools': 'closed' } })
    stepEngine(on, () => null)
    engine(on)
    await oneTurn($)
    expect(isOpen(await rows(await mount($, surface)))).toBe(false)
    await $.classic.SessionStart({ source: 'clear' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    expect(isOpen(await rows(await mount($, surface)))).toBe(false)
    await $.classic.SessionStart({ source: 'resume' })
    expect(isOpen(await rows(await mount($, surface)))).toBe(false)
  })

  test(`after a resume a fresh store still draws the rows open (${surface})`, async ($, on) => {
    stubAll(on, { band: 'full', usage: READING, now: NOW })
    stepEngine(on, () => null)
    engine(on)
    await oneTurn($)
    await $.classic.SessionStart({ source: 'resume' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    expect(await rows(await mount($, surface))).toContain('tools:   Read ×1')
  })
}

for (const value of [undefined, true, 'OPEN', 'open', 'yes']) {
  test(`a stored ${JSON.stringify(value)} reads as open`, async ($, on) => {
    stubAll(on, { band: 'full', store: value === undefined ? {} : { 'settings:band-tools': value } })
    const state = watchState(on)
    engine(on)
    await $.session.start(START)
    expect(state.get('band')).toEqual({ mode: 'full', isToolsOpen: true })
  })
}

test('a stored "closed" reads as closed', async ($, on) => {
  stubAll(on, { band: 'full', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band')).toEqual({ mode: 'full' })
})

test('another session closing the rows is picked up on the poll', async ($, on) => {
  const { clock, store } = stubAll(on, { band: 'full' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  store.set('settings:band-tools', 'closed')
  await clock.advance(30_000)
  expect(state.get('band')).toEqual({ mode: 'full' })
})

const skillsOf = (state: { get(key: string): unknown }): Record<string, number> | undefined => (state.get('meta') as Meta | undefined)?.skills

// The engine beneath, as it runs a Skill call: the skill's prompt expands inside the call, raised on the test's `$`
function skillCalls(on: On, $: Engine, isError = false): void {
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', async (_, e) => {
    if (e.tool === 'Skill' && !isError) await $.skill.prompt({ skill: e.skill, text: 'x', frontmatter: {}, source: 'projectSettings' })
    return isError ? { result: 'Unknown skill', text: 'Unknown skill', isError: true } : { result: 'ok', text: 'ok' }
  })
}

test("the main loop's Skill calls are in its context, by name and times loaded", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  skillCalls(on, $)
  await $.session.start(START)
  await $.tool.call({ tool: 'Skill', skill: 'solve-task' })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  await $.tool.call({ tool: 'Skill', skill: 'solve-task' })
  expect(skillsOf(state)).toEqual({ 'solve-task': 2, 'superpowers:brainstorming': 1 })
})

test("an agent's Skill call counts as a call, never in the main context", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call', 'agent.spawn'])
  skillCalls(on, $)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'general-purpose', description: 'd', prompt: 'p' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'solve-task', agentId: 'a1' } as never)
  expect((state.get('stats') as Record<string, { calls: number }>)['Skill: solve-task']?.calls).toBe(1)
  expect(skillsOf(state) ?? {}).toEqual({})
})

test('a Skill call that failed loaded nothing', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  skillCalls(on, $, true)
  await $.session.start(START)
  await $.tool.call({ tool: 'Skill', skill: 'no-such-skill' })
  expect(skillsOf(state) ?? {}).toEqual({})
})

test("a /name skill before the turn is the main chat's; one alone mid-turn is a subagent's preload", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  on('skill.prompt', (_, e) => ({ text: e.text }))
  await $.session.start(START)
  await $.skill.prompt({ skill: 'commit', text: 'x', frontmatter: {}, source: 'projectSettings' })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.skill.prompt({ skill: 'preloaded', text: 'x', frontmatter: {}, source: 'projectSettings' })
  expect(skillsOf(state)).toEqual({ commit: 1 })
})

// The review of 2026-11-11: a `context: fork` skill runs in a subagent of its own (code.claude.com/docs/en/skills)
test('a skill that runs forked is never in the main context, called or typed', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', async (_, e) => {
    if (e.tool === 'Skill') await $.skill.prompt({ skill: e.skill, text: 'x', frontmatter: { context: 'fork' }, source: 'projectSettings' })
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Skill', skill: 'forked' })
  await $.skill.prompt({ skill: 'forked-typed', text: 'x', frontmatter: { context: 'fork' }, source: 'projectSettings' })
  expect((state.get('stats') as Record<string, { calls: number }>)['Skill: forked']?.calls).toBe(1)
  expect(skillsOf(state) ?? {}).toEqual({})
})

test('a /clear empties the skills in context', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  skillCalls(on, $)
  await $.session.start(START)
  await $.tool.call({ tool: 'Skill', skill: 'solve-task' })
  await $.classic.SessionStart({ source: 'clear' })
  expect(skillsOf(state) ?? {}).toEqual({})
})

// A resumed or branched conversation holds skills loaded before the mod watched it (a side agent's note, 2026-11-11)
const metaOf = (state: { get(key: string): unknown }): Meta | undefined => state.get('meta') as Meta | undefined

test('a resume or a branch marks the skills as counted from it; a /clear does not', async ($, on) => {
  stubAll(on, { now: NOW })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state)?.isResumed).toBeUndefined()
  for (const source of ['resume', 'fork'] as const) {
    await $.classic.SessionStart({ source })
    expect(metaOf(state)?.isResumed).toBe(true)
  }
  await $.classic.SessionStart({ source: 'clear' })
  expect(metaOf(state)?.isResumed).toBeUndefined()
})

// `claude --resume` where a managed plugin keeps classic.SessionStart from the mod: the transcript has prompts the mod
// never saw. A reload keeps $.state, and its readings with it, so it is not one.
test('a process that starts on a conversation with prompts is a resume; a reload is not', async ($, on) => {
  const kit = stubAll(on, { now: NOW })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state)?.isResumed).toBeUndefined()
  kit.session.turns = 3
  await $.session.start(START)
  expect(metaOf(state)?.isResumed).toBeUndefined()
})

test('a process that starts on a resumed conversation counts its skills from the start', async ($, on) => {
  const kit = stubAll(on, { now: NOW })
  kit.session.turns = 3
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(metaOf(state)?.isResumed).toBe(true)
})

// The skill listing from the context's breakdown: how many skills it carries of the session's, and its tokens
const SKILLS = Array.from({ length: 3 }, (_, i) => ({ name: `s-${i}`, source: 'userSettings' as const, tokens: 80 }))
const withListing = (b: Partial<SessionContextBreakdown> = {}): SessionUsage => ({
  startedAt: 0, rateLimits: [],
  context: {
    window: 200_000,
    breakdown: {
      categories: [], totalTokens: 0, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 0, gridRows: [], model: 'claude-opus-5-5',
      memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true,
      skills: { totalSkills: 60, includedSkills: 57, tokens: 3200, skillFrontmatter: SKILLS }, ...b,
    } as never,
  },
})
const measure = ($: Engine) =>
  $.session.measure({ context: { tokens: 90_000, window: 200_000, percent: 45 }, rateLimits: [], changed: ['context'] })
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const usageRows = async ($: Engine, surface: RenderSurface, bodyColumns = 160): Promise<string[]> => {
  await $.command.run({ command: 'inspect', args: 'usage', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns } })
  const out = (await rows(ui)).map(l => l.trimEnd())
  await ui.unmount()
  return out
}

test('the parts keep the skill listing: listed, of how many, and its tokens', async ($, on) => {
  stubAll(on, { usage: withListing() })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await measure($)
  expect((state.get('parts') as Parts).skills).toEqual({ listed: 57, total: 60, tokens: 3200 })
})

for (const surface of SURFACES) {
  test(`the Usage tab's Skills row names the skills loaded and the listing (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on, { usage: withListing() })
    engine(on, ['tool.call'])
    skillCalls(on, $)
    await $.session.start(START)
    await measure($)
    expect((await usageRows($, surface)).find(l => l.startsWith('Skills'))).toBe(`Skills      none loaded · 57 of 60 listed · ${tokens(3200)}`)
    await $.tool.call({ tool: 'Skill', skill: 'solve-task' })
    expect((await usageRows($, surface)).find(l => l.startsWith('Skills'))).toBe(`Skills      solve-task ×1 · 57 of 60 listed · ${tokens(3200)}`)
  })

  test(`after a resume the Usage tab's Skills row counts from it (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on, { now: NOW, usage: withListing() })
    engine(on)
    await $.session.start(START)
    await $.classic.SessionStart({ source: 'resume' })
    await measure($)
    expect((await usageRows($, surface)).find(l => l.startsWith('Skills'))).toBe(`Skills      none seen since resume · 57 of 60 listed · ${tokens(3200)}`)
  })

  // The review of 2026-11-11: in a docked pane the row wraps, so the listing is never cut off
  test(`in a docked pane the Skills row wraps whole items (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on, { usage: withListing() })
    engine(on, ['tool.call'])
    skillCalls(on, $)
    await $.session.start(START)
    await measure($)
    await $.tool.call({ tool: 'Skill', skill: 'solve-task' })
    const lines = await usageRows($, surface, 46)
    const i = lines.findIndex(l => l.startsWith('Skills'))
    expect(lines.slice(i, i + 2)).toEqual(['Skills      solve-task ×1', `            57 of 60 listed · ${tokens(3200)}`])
  })

  test(`with no listing and no skill loaded, the Usage tab has no Skills row (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { skills: _, ...rest } = withListing().context.breakdown as SessionContextBreakdown
    stubAll(on, { usage: { ...withListing(), context: { window: 200_000, breakdown: rest as never } } })
    engine(on)
    await $.session.start(START)
    await measure($)
    expect((await usageRows($, surface)).some(l => l.startsWith('Skills'))).toBe(false)
  })
}
