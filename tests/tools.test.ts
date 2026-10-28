import { expect, test } from 'claude-code/testing'

import { SPAWN, stubAll, watchState } from './kit.ts'
import type { Failure, Live } from '../types'

// Each test's own hooks stand for the engine, in the order Phase 0 saw the events
const failed = (text: string) => ({ isError: true as const, result: text, text })
const answered = (text = 'ok') => ({ result: text, text })

test('a failing Bash call counts as an error with its reason', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('tool.call', async (_, e) => {
    await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: e.tool_use_id, error: 'Exit code 1' })
    return failed('Exit code 1\nboom')
  })

  await $.tool.call({ tool: 'Bash', command: 'node -e "process.exit(1)"' })

  expect(state.get('stats')).toEqual({ Bash: { calls: 1, ok: 0, failed: 1, stopped: 0 } })
  expect((state.get('failures') as Failure[])[0]).toMatchObject({ outcome: 'error', reason: 'Exit code 1', isNew: true })
})

test('a guard hook block shows as blocked', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'guard: marked', hook: 'PreToolUse' }))
  on('tool.call', () => answered())

  await $.tool.call({ tool: 'Bash', command: 'echo probe-guard' })

  expect((state.get('failures') as Failure[])[0]).toMatchObject({ outcome: 'blocked', reason: 'guard: marked', isNew: false })
})

test('an ask answered No shows as denied', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  // No hook answers the request, so the person is asked; the kit's refusal stands for their No
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => answered())

  await $.tool.call({ tool: 'Bash', command: 'rm notes.txt' })

  expect((state.get('failures') as Failure[])[0]).toMatchObject({ outcome: 'denied', reason: 'denied by you', isNew: true })
})

test('a PermissionDenied after the result turns refused into blocked', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  // A hook answers the request, so the person never sees it: the ask ends refused
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'no' } }))
  on('tool.call', () => answered())

  await $.tool.call({ tool: 'Bash', command: 'git reset --hard', tool_use_id: 't1' })
  expect((state.get('failures') as Failure[])[0]?.outcome).toBe('refused')
  await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1', reason: 'destructive git' })

  const rows = state.get('failures') as Failure[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ outcome: 'blocked', reason: 'auto mode: destructive git' })
  expect(state.get('stats')).toEqual({ Bash: { calls: 1, ok: 0, failed: 0, stopped: 1 } })
})

test('a call from an agent no spawn announced is not counted', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('tool.call', () => answered())

  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'x' })

  expect(state.get('stats')).toBeUndefined()
})

test("an agent's call counts once its spawn was seen", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  on('tool.call', () => answered())

  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })

  expect(state.get('stats')).toEqual({ Bash: { calls: 1, ok: 1, failed: 0, stopped: 0 } })
})

test('the hook hands the result on unchanged', async ($, on) => {
  stubAll(on)
  on('tool.call', () => ({ result: 'claude code answered' }))

  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'claude code answered' })
})

test('parallel calls both count', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  on('tool.call', async () => {
    await clock.sleep(10)
    return answered()
  })

  const reads = Promise.all([$.tool.call({ tool: 'Read', file_path: '/w/a' }), $.tool.call({ tool: 'Read', file_path: '/w/b' })])
  await clock.advance(10)
  await reads
  expect(state.get('stats')).toEqual({ Read: { calls: 2, ok: 2, failed: 0, stopped: 0 } })

  const runs = Promise.all([$.tool.call({ tool: 'Bash', command: 'sleep 1' }), $.tool.call({ tool: 'Bash', command: 'sleep 2' })])
  await clock.settle()
  expect((state.get('live') as Live).running).toHaveLength(2)
  await clock.advance(10)
  await runs
  expect((state.get('live') as Live).running).toEqual([])
})

test('a skill the person runs counts once', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('skill.prompt', (_, e) => ({ text: e.text }))

  await $.skill.prompt({ skill: 'probe-skill', text: 'x', frontmatter: {}, source: 'projectSettings' })

  expect(state.get('stats')).toEqual({ 'Skill: probe-skill': { calls: 1, ok: 1, failed: 0, stopped: 0 } })
})

test('a skill the model runs counts once', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', async () => {
    await $.skill.prompt({ skill: 'probe-skill', text: 'x', frontmatter: {}, source: 'projectSettings' })
    return answered()
  })

  await $.tool.call({ tool: 'Skill', skill: 'probe-skill' })

  expect((state.get('stats') as Record<string, { calls: number }>)['Skill: probe-skill']?.calls).toBe(1)
})
