// A managed plugin that sends events on past the user tier (`next.to`), as an organization's did on 2026-11-10: Claude
// Code then tells the model, once per event and conversation, that the mod's hook was skipped. The mod spots a new
// conversation by its session id, and its `leave_out_skipped_hooks` option leaves the six hooks out.
import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { PRESENTATION, START, engine, rows, stubAll, watchState } from './kit'
import type { Meta, Turn } from '../types'

const ON = 'Screen recording is on (alfred-mods REC). Until told it is off, do not write secret values, API keys, tokens, passwords, email addresses or phone numbers in replies; refer to them by name, such as "the token in .env". Work on the task as usual.'

// Stands in for the managed plugin: each of the six events the notices named goes on past the user tier, and a toast
// names the plugins whose links it skipped
const MANAGED: Plugin = {
  name: 'managed-stand-in',
  tier: 'prepend',
  register(on) {
    const skipped = (trace: readonly { plugin: string; outcome: string }[]): string =>
      trace.filter(t => t.outcome === 'skipped').map(t => t.plugin).join(',')
    on('classic.SessionStart', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`classic.SessionStart skipped: ${skipped(next.trace)}`)
      return r
    })
    on('classic.PostToolUse', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`classic.PostToolUse skipped: ${skipped(next.trace)}`)
      return r
    })
    on('classic.PermissionRequest', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`classic.PermissionRequest skipped: ${skipped(next.trace)}`)
      return r
    })
    on('classic.PostToolUseFailure', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`classic.PostToolUseFailure skipped: ${skipped(next.trace)}`)
      return r
    })
    on('classic.PermissionDenied', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`classic.PermissionDenied skipped: ${skipped(next.trace)}`)
      return r
    })
    on('skill.prompt', async ($, e, next) => {
      const r = await next.to(e, 'builtin')
      await $.ui.toast(`skill.prompt skipped: ${skipped(next.trace)}`)
      return r
    })
  },
}

const EVENTS = ['classic.SessionStart', 'classic.PostToolUse', 'classic.PermissionRequest', 'classic.PostToolUseFailure', 'classic.PermissionDenied', 'skill.prompt']

// Claude Code's answers beneath: no hook answered the request, so the person is asked; the skill's prompt as it is
function answerBeneath(on: On): void {
  on('classic.PermissionRequest', () => ({}))
  on('skill.prompt', (_, e) => ({ text: e.text }))
}

async function raiseAll($: Engine): Promise<void> {
  await $.classic.SessionStart({ source: 'startup' })
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 't1' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1', error: 'Exit code 1' })
  await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1', reason: 'destructive' })
  await $.skill.prompt({ skill: 'watch', text: 'x', frontmatter: {}, source: 'projectSettings' })
}

// The plugins each event skipped, by event, from the stand-in's toasts
const skippedBy = (toasts: string[]): Record<string, string> =>
  Object.fromEntries(toasts.filter(t => t.includes(' skipped: ')).map(t => t.split(' skipped: ') as [string, string]))

test('a managed plugin that passes the six events on skips each of the mod\'s hooks', { plugins: [MANAGED] }, async ($, on) => {
  const { toasts } = stubAll(on)
  answerBeneath(on)
  engine(on)
  await $.session.start(START)
  await raiseAll($)
  const by = skippedBy(toasts)
  for (const event of EVENTS) expect(by[event]?.split(',')).toContain('alfred-mods')
})

test('with leave_out_skipped_hooks on, the six events reach no hook of the mod', { plugins: [MANAGED], options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { toasts } = stubAll(on)
  answerBeneath(on)
  engine(on)
  await $.session.start(START)
  await raiseAll($)
  const by = skippedBy(toasts)
  expect(Object.keys(by).sort()).toEqual([...EVENTS].sort())
  for (const event of EVENTS) expect(by[event]?.split(',') ?? []).not.toContain('alfred-mods')
})

const complete = (turnId: string) => ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const })

async function oneTurn($: Engine): Promise<void> {
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(complete('t1'))
}

test('a /clear the managed plugin keeps classic.SessionStart from starts over at the next tick', { plugins: [MANAGED] }, async ($, on) => {
  const { clock, session } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await oneTurn($)
  expect(state.get('turns')).toHaveLength(1)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('turns')).toHaveLength(1)
  await clock.advance(1000)
  expect(state.get('turns')).toEqual([])
  expect(state.get('stats')).toEqual({})
})

test('the same id at the tick starts nothing over', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await oneTurn($)
  await clock.advance(3000)
  expect((state.get('turns') as Turn[]).length).toBe(1)
})

// What the model read beside each prompt, as Claude Code received it beneath the mod
function prompts(on: On): (readonly string[])[] {
  const seen: (readonly string[])[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context ?? [])
    return { text: e.text }
  })
  return seen
}

test('the first prompt after an unreported /clear starts over first and tells the new conversation of REC', async ($, on) => {
  const { session } = stubAll(on, { store: { 'settings:rec': 'on' } })
  const state = watchState(on)
  const seen = prompts(on)
  engine(on, ['prompt.submit'])
  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await oneTurn($)
  session.id = 's2'
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  expect(seen).toEqual([[ON], [ON]])
  expect(state.get('turns')).toEqual([])
})

// A start-over that fails, here at its usage read, still lets the prompt carry REC's note
test('the first prompt after an unreported /clear tells of REC when the start-over fails', async ($, on) => {
  const { session, usage } = stubAll(on, { store: { 'settings:rec': 'on' } })
  const seen = prompts(on)
  engine(on, ['prompt.submit'])
  await $.session.start(START)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  usage.fail = true
  session.id = 's2'
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  expect(seen).toEqual([[ON], [ON]])
})

test('a /clear classic.SessionStart started over is not started over again at the tick', async ($, on) => {
  const { clock, session } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await oneTurn($)
  await clock.advance(1000)
  expect(state.get('turns')).toHaveLength(1)
})

test('with leave_out_skipped_hooks on, a /clear starts over at the next tick', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { clock, session } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await oneTurn($)
  session.id = 's2'
  await clock.advance(1000)
  expect(state.get('turns')).toEqual([])
  const ran = await $.command.run({ command: 'inspect', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(ran.text).toBeDefined()
})

// Spec 2026-11-11, D4: the rules hook is left out with the six, on the safe side (assumption A1): the band's rules row
// still lists the always-on rules from the breakdown, and says the by-path ones are not tracked
const ALWAYS: SessionUsage = {
  startedAt: 0, rateLimits: [],
  context: {
    window: 200_000, tokens: 20_000, percent: 10,
    breakdown: {
      categories: [], totalTokens: 0, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 0, gridRows: [], model: 'claude-opus-5-5',
      memoryFiles: [{ path: '/w/.claude/rules/always.md', type: 'Project', tokens: 60 }], mcpTools: [], agents: [], isAutoCompactEnabled: true,
    } as never,
  },
}
const load = (file_path: string, load_reason: string) =>
  ({ file_path, memory_type: 'Project', load_reason, globs: ['src/**/*.ts'], trigger_file_path: '/w/src/app.ts' }) as never
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }

test('with leave_out_skipped_hooks on, a by-path load reaches no hook of the mod and the row says so', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { clock } = stubAll(on, { band: 'full', usage: ALWAYS })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(1)
  await $.classic.InstructionsLoaded(load('/w/.claude/rules/web.md', 'path_glob_match'))
  expect((state.get('meta') as Meta | undefined)?.pathRules).toBeUndefined()
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await rows(ui)).toContain('rules:   always.md │ 1 always-on · by path not tracked')
  await ui.unmount()
})
