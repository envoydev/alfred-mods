import { expect, test } from 'claude-code/testing'

import { SPAWN, START, engine, spawns, step, stepEngine, stubAll, watchState } from './kit.ts'
import type { AgentRow, Live, Meta, ToolStat } from '../types'

const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })
const ok = (calls: number): ToolStat => ({ calls, ok: calls, failed: 0, stopped: 0 })
// Grep is not among this build's typed tools (its search runs through Bash), but other builds call it
const grep = (more: object = {}) => ({ tool: 'Grep', pattern: 'AuthService', ...more }) as never
const rowOf = (get: (key: string) => unknown, id: string) => (get('agents') as AgentRow[]).find(r => r.id === id)

test('two parallel agents each keep their own current action', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn', 'tool.call'])
  spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' } })
  on('tool.call', async () => {
    await clock.sleep(60_000)
    return { result: 'ok', text: 'ok' }
  })

  await $.agent.spawn({ ...SPAWN, description: 'one' })
  await $.agent.spawn({ ...SPAWN, description: 'two' })
  const calls = Promise.all([
    $.tool.call(grep({ agentId: 'a1' })),
    $.tool.call({ tool: 'Read', file_path: '/w/src/auth/token.ts', agentId: 'a2' }),
  ])
  await clock.settle()
  expect(rowOf(state.get, 'a1')?.action).toBe('Grep AuthService')
  expect(rowOf(state.get, 'a2')?.action).toBe('Read src/auth/token.ts')

  await clock.advance(60_000)
  await calls
  expect(rowOf(state.get, 'a1')?.action).toBe('Grep AuthService')
  expect(rowOf(state.get, 'a2')?.action).toBe('Read src/auth/token.ts')
  expect(rowOf(state.get, 'a1')?.tools).toEqual({ Grep: ok(1) })
})

test("an agent's failed call tallies on its row and in the Tools table", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  on('tool.call', async (_, e) => {
    await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: e.tool_use_id, error: 'Exit code 1' })
    return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }
  })

  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Bash', command: 'false', agentId: 'a1' })

  const failed = { calls: 1, ok: 0, failed: 1, stopped: 0 }
  expect(rowOf(state.get, 'a1')?.tools.Bash).toEqual(failed)
  expect((state.get('stats') as Record<string, ToolStat>).Bash).toEqual(failed)
})

test("an agent's step gives its model, effort and context tokens", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  stepEngine(on, () => ({
    input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000, model: 'claude-haiku-5-5',
  }))

  await $.agent.spawn(SPAWN)
  await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 3, agentId: 'a1' })

  expect(rowOf(state.get, 'a1')).toMatchObject({ model: 'claude-haiku-5-5', effort: 'medium', contextTokens: 31_200 })
  expect(state.get('meta')).toBe(undefined)
})

test("an agent's end keeps its report and status", async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' }, mate: { agentId: 'a3' } })

  await $.agent.spawn({ ...SPAWN, description: 'one' })
  await $.agent.spawn({ ...SPAWN, description: 'two' })
  await $.agent.spawn({ ...SPAWN, description: 'mate', isTeammate: true })
  await clock.advance(65_000)
  await $.turn.complete(complete('x1', { agentId: 'a1', answer: '12 files, 3 untested services\nmore' }))
  await $.turn.complete(complete('x2', { agentId: 'a2', reason: 'error' }))
  await $.turn.complete(complete('x3', { agentId: 'a3' }))

  expect(rowOf(state.get, 'a1')).toMatchObject({ status: 'completed', endedAt: 65_000, report: '12 files, 3 untested services\nmore' })
  expect(rowOf(state.get, 'a2')?.status).toBe('failed')
  expect(rowOf(state.get, 'a3')?.status).toBe('idle')
})

test('a resumed agent runs again on its one row', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'found it' }))
  await $.agent.spawn({ ...SPAWN, resume: { agentId: 'a1' } })

  const rows = state.get('agents') as AgentRow[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ status: 'running', endedAt: null, report: 'found it', tools: { Read: ok(1) } })
})

test('the list is read each second while an agent runs, and not otherwise', async ($, on) => {
  const { clock, listed } = stubAll(on, { agents: [{ id: 'a1', description: 'a look', type: 'general-purpose', status: 'waiting' }] })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  await clock.advance(3000)
  expect(listed.calls).toBe(3)
  expect(rowOf(state.get, 'a1')?.status).toBe('waiting')

  await $.turn.complete(complete('x1', { agentId: 'a1' }))
  await clock.advance(3000)
  expect(listed.calls).toBe(3)
})

test('a live agent the list stops naming ends', async ($, on) => {
  const { clock, listed } = stubAll(on, { agents: [{ id: 'a1', description: 'a look', type: 'general-purpose', status: 'running' }] })
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  await clock.advance(1000)
  expect(rowOf(state.get, 'a1')?.isListed).toBe(true)

  listed.current = []
  await clock.advance(1000)
  expect(rowOf(state.get, 'a1')).toMatchObject({ status: 'completed', endedAt: clock.now() })
})

test('the clock ticks while an agent runs and stops when none does', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  await clock.advance(3000)
  const ticks = state.get('tick') as number
  expect(ticks).toBeGreaterThanOrEqual(3)

  await $.turn.complete(complete('x1', { agentId: 'a1' }))
  const ended = state.get('tick')
  await clock.advance(3000)
  expect(state.get('tick')).toBe(ended)
})

test("the main loop's calls in flight are its current action", async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on, ['tool.call'])
  on('tool.call', async () => {
    await clock.sleep(10)
    return { result: 'ok', text: 'ok' }
  })

  const main = $.tool.call(grep())
  await clock.settle()
  expect((state.get('live') as Live).running).toMatchObject([{ tool: 'Grep', label: 'AuthService' }])

  await clock.advance(10)
  await main
  expect((state.get('live') as Live).running).toEqual([])
  expect((state.get('meta') as Meta).mainCalls).toBe(1)

  await $.agent.spawn(SPAWN)
  const agentCall = $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  await clock.advance(10)
  await agentCall
  expect((state.get('meta') as Meta).mainCalls).toBe(1)
})
