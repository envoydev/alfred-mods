import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows, spawns, step, stepEngine, stubAll, watchState } from './kit.ts'
import type { Loop } from '../types'

// Spec C3: model loops no spawn announced are counted apart, as Other loops (D3: workflow agents raise agent.spawn, so
// the note names compactions and forks)
const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const NOTE = '(no spawn: compactions, forks)'
const usage = (output: number) => ({ input_tokens: 10, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' })
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })

// Each loop step's output tokens, in the order a test sets them
function outputs(on: On): number[] {
  const queue: number[] = []
  stepEngine(on, () => usage(queue.shift() ?? 0))
  return queue
}
const loopStep = ($: Engine, agentId: string, index = 0) => step($, { turnId: `x-${agentId}`, index, model: 'claude-haiku-5-5', messageCount: 1, agentId })

const agentsTab = async ($: Engine, surface: RenderSurface): Promise<string[]> => {
  await $.command.run({ command: 'inspect', args: 'agents', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
  const out = (await rows(ui)).map(l => l.trimEnd())
  await ui.unmount()
  return out
}

for (const surface of SURFACES) {
  test(`a step from an unknown loop is counted (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on)
    engine(on, ['agent.spawn'])
    spawns(on, { scout: { agentId: 'a1' } })
    const out = outputs(on)

    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'scout' })
    out.push(20_000, 21_000)
    await loopStep($, 'w1', 0)
    await loopStep($, 'w1', 1)

    const lines = await agentsTab($, surface)
    const at = lines.indexOf('Other loops 1 · 1 active · out 41k')
    expect(at > 0).toBe(true)
    expect(lines[at + 1]).toBe(NOTE)
    // After the tree: the agent's rows come first
    expect(lines.findIndex(l => l.includes('Explore')) < at).toBe(true)
  })

  test(`a loop goes quiet after 15 seconds or at its turn.complete (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    const { clock } = stubAll(on)
    engine(on)
    outputs(on)

    await loopStep($, 'w1')
    await clock.advance(14_000)
    expect((await agentsTab($, surface)).find(l => l.startsWith('Other loops'))).toBe('Other loops 1 · 1 active · out 0')
    await clock.advance(2_000)
    expect((await agentsTab($, surface)).find(l => l.startsWith('Other loops'))).toBe('Other loops 1 · 0 active · out 0')

    await loopStep($, 'w2')
    expect((await agentsTab($, surface)).find(l => l.startsWith('Other loops'))).toBe('Other loops 2 · 1 active · out 0')
    await $.turn.complete(complete('x-w2', { agentId: 'w2' }))
    expect((await agentsTab($, surface)).find(l => l.startsWith('Other loops'))).toBe('Other loops 2 · 0 active · out 0')
  })

  test(`no line while no loop was seen (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on)
    engine(on)
    const lines = await agentsTab($, surface)
    expect(lines.some(l => l.startsWith('Other loops') || l === NOTE)).toBe(false)
  })
}

// A background agent's first step can come before its spawn resolves
test('a spawn that names a counted loop moves it out', { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on, { late: { agentId: 'w1' } })
  outputs(on).push(5000)

  await loopStep($, 'w1')
  expect((state.get('loops') as Loop[]).map(l => l.id)).toEqual(['w1'])
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'late' })
  expect(state.get('loops')).toEqual([])
  const lines = await agentsTab($, 'terminal')
  expect(lines.some(l => l.startsWith('Other loops'))).toBe(false)
})

test('the 61st loop drops the oldest', { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  outputs(on)

  for (let i = 0; i <= 60; i++) await loopStep($, `l${i}`)
  const loops = state.get('loops') as Loop[]
  expect(loops).toHaveLength(60)
  expect(loops[0]?.id).toBe('l1')
  expect(loops[59]?.id).toBe('l60')
})

test('/clear empties the loops', { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  outputs(on)

  await $.session.start(START)
  await loopStep($, 'w1')
  expect(state.get('loops')).toHaveLength(1)
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('loops')).toEqual([])
})

test('tool calls from a loop stay uncounted', { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  outputs(on)

  await loopStep($, 'w1')
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'w1' })
  expect(state.get('stats')).toBeUndefined()
  expect((state.get('loops') as Loop[])[0]).toMatchObject({ id: 'w1', steps: 1, isDone: false })
})
