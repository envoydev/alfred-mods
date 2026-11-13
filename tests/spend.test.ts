import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows, spawns, step, stubAll, watchState } from './kit'
import type { Turn } from '../types'

// Spec C4: an agent cut off at max_tokens is flagged, and each main turn shows the session's spend while it ran
const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })
const costing = (usd: number, rateLimits: SessionUsage['rateLimits'] = []): SessionUsage =>
  ({ startedAt: 0, context: { window: 200_000 }, rateLimits, cost: { usd } })

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : isDrawn(n) ? (n.children ?? []).map(textOf).join('') : ''
// Every Text in a drawn tree whose text is `text`
function textsOf(tree: unknown, text: string): Drawn[] {
  if (!isDrawn(tree)) return []
  const here = tree.type === 'Text' && textOf(tree) === text ? [tree] : []
  return [...here, ...(tree.children ?? []).flatMap(c => textsOf(c, text))]
}

// Every step answers with the stop reason a test sets
function stopsAt(on: On): { reason: 'max_tokens' | 'end_turn' } {
  const stop = { reason: 'max_tokens' as 'max_tokens' | 'end_turn' }
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: stop.reason, usage: null }
  })
  return stop
}

// A main turn from start to end, the session's cost read as `from` at its start and `to` at its end
async function turn($: Engine, usage: { current: SessionUsage }, turnId: string, from: number, to: number): Promise<void> {
  usage.current = costing(from, usage.current.rateLimits)
  await $.turn.start({ text: `q ${turnId}`, turnId })
  usage.current = costing(to, usage.current.rateLimits)
  await $.turn.complete(complete(turnId))
}

const timeline = async ($: Engine, surface: RenderSurface): Promise<string[]> => {
  await inspect($, 'timeline')
  const ui = await pane($, surface)
  const out = await rows(ui)
  await ui.unmount()
  return out
}

for (const surface of SURFACES) {
  test(`an agent cut at max_tokens shows ⚠ max_tokens (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on)
    engine(on, ['agent.spawn'])
    spawns(on, { 'Write the parser': { agentId: 'a1' } })
    const stop = stopsAt(on)

    await $.turn.start({ text: 'q', turnId: 't1' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', description: 'Write the parser' })
    await step($, { turnId: 'x1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })
    await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'The parser reads each line and' }))
    await inspect($, 'agents')

    const ui = await pane($, surface)
    const lines = await rows(ui)
    expect(lines.some(l => l.startsWith('└ ✓ general-purpose · haiku') && l.endsWith('⚠ max_tokens'))).toBe(true)
    expect(lines.some(l => l.trim().startsWith('result (cut off): The parser reads each line and'))).toBe(true)
    const flags = textsOf(await ui.drawn(), '⚠ max_tokens')
    expect(flags.map(t => t.props?.['color'])).toEqual(['warning'])
    await ui.unmount()

    // Sent on with SendMessage, the agent ends its next step at end_turn: the flag goes
    stop.reason = 'end_turn'
    await step($, { turnId: 'x2', index: 0, model: 'claude-haiku-5-5', messageCount: 3, agentId: 'a1' })
    await $.turn.complete(complete('x2', { agentId: 'a1', answer: 'The parser reads each line and keeps the rest.' }))
    const after = await rows(await pane($, surface))
    expect(after.some(l => l.includes('max_tokens'))).toBe(false)
    expect(after.some(l => l.trim().startsWith('result: The parser reads each line and keeps the rest.'))).toBe(true)
  })

  test(`a turn's spend is the session cost between its start and end (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { usage } = stubAll(on)
    const state = watchState(on)
    engine(on)

    await turn($, usage, 't1', 1.2, 1.45)
    expect(Math.abs(((state.get('turns') as Turn[])[0]?.spendUsd ?? 0) - 0.25) < 1e-9).toBe(true)
    const lines = await timeline($, surface)
    expect(lines.find(l => l.startsWith('#'))).toMatch(/^# +you +Claude +took +in \/ out +tools +spend +✗$/)
    expect(lines.find(l => l.startsWith('1 '))).toMatch(/ \$0\.25 +0$/)
  })

  test(`spend is null under half a cent, when negative or when a read fails (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { usage } = stubAll(on)
    const state = watchState(on)
    engine(on)

    await turn($, usage, 't1', 1.2, 1.204)
    await turn($, usage, 't2', 1.5, 1.4)
    usage.current = costing(1.5)
    usage.fail = true
    await $.turn.start({ text: 'q t3', turnId: 't3' })
    usage.fail = false
    usage.current = costing(2.5)
    await $.turn.complete(complete('t3'))

    expect((state.get('turns') as Turn[]).map(t => t.spendUsd)).toEqual([null, null, null])
    const lines = await timeline($, surface)
    for (const n of ['1', '2', '3']) expect(lines.find(l => l.startsWith(`${n} `))).toMatch(/ - +0$/)
  })

  test(`the header says est. on a plan (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const plan = [{ kind: 'five_hour' as const, percentUsed: 20, resetsAt: '2026-10-27T17:00:00Z' }]
    const { usage } = stubAll(on, { usage: costing(1, plan) })
    engine(on)

    await turn($, usage, 't1', 1, 1.5)
    const lines = await timeline($, surface)
    expect(lines.find(l => l.startsWith('#'))).toMatch(/ +tools +spend, est\. +✗$/)
    expect(lines.find(l => l.startsWith('1 '))).toMatch(/ \$0\.50 +0$/)
  })

  test(`a turn across /clear has no spend (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { usage } = stubAll(on, { usage: costing(1) })
    const state = watchState(on)
    engine(on)

    await $.session.start(START)
    await $.turn.start({ text: 'q', turnId: 't1' })
    await $.classic.SessionStart({ source: 'clear' })
    usage.current = costing(1.8)
    await $.turn.complete(complete('t1'))
    expect((state.get('turns') as Turn[]).map(t => t.spendUsd)).toEqual([null])
  })

  test(`REC strict hides the spend (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { usage } = stubAll(on, { store: { 'settings:rec': 'strict' } })
    engine(on)

    await $.session.start(START)
    await turn($, usage, 't1', 1.2, 1.45)
    const lines = await timeline($, surface)
    expect(lines.find(l => l.startsWith('1 '))).toMatch(/ \$•\.•• +0$/)
    expect(lines.some(l => l.includes('$0.25'))).toBe(false)
  })
}

// Spec 'Backward compatibility': a turn and an agent row kept by an earlier version have neither field
test('an old atom without the fields reads as null', { timeoutMs: 15_000 }, async ($, on) => {
  const oldTurn = { n: 1, turnId: 't0', promptAt: null, replyAt: 0, durationMs: 3000, tokensIn: 10, tokensOut: 2, tools: 0, failures: 0, contextPercent: null, end: 'answer' }
  const oldRow = {
    id: 'a0', parentId: null, type: 'Explore', description: 'old', plan: null, task: null, isTeammate: false, model: 'claude-haiku-5-5',
    effort: null, status: 'completed', isListed: false, startedAt: 0, endedAt: 1000, action: null, report: 'found it', contextTokens: null, tools: {},
  }
  const seeded: Record<string, unknown> = { turns: { shape: 'turns-1', value: [oldTurn] }, agents: { shape: 'agents-2', value: [oldRow] } }
  const written = new Set<string>()
  on('state.set', async ($$, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', async ($$, e, next) => {
    const r = await next(e)
    const seed = seeded[e.key]
    if (seed === undefined || written.has(e.key) || r.value === undefined) return r
    return { value: { ...r.value, value: seed } }
  })
  stubAll(on)
  engine(on)

  await inspect($, 'timeline')
  const lines = await rows(await pane($, 'terminal'))
  expect(lines.find(l => l.startsWith('1 '))).toMatch(/ - +0$/)
  await inspect($, 'agents')
  const agents = await rows(await $.ui.mount({ plugin: 'alfred-mods', surface: 'desktop', component: 'Pane', requestId: 'inspect', props: PANE }))
  expect(agents.some(l => l.trim().startsWith('result: found it'))).toBe(true)
  expect(agents.some(l => l.includes('max_tokens'))).toBe(false)
})
