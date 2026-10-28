import { expect, test } from 'claude-code/testing'

import {
  actionOf, agentTree, isLive, keepRows, newRow, promptLines, refreshAgents, statusAt, toolSummary, upsertSpawn,
} from '../hooks/agents.ts'
import { modelParts, modelText } from '../hooks/format.ts'
import { SPAWN, engine, spawns, stubAll, watchState } from './kit.ts'
import type { AgentRow, ToolStat } from '../types'

const s = (calls: number, ok: number, failed: number, stopped: number): ToolStat => ({ calls, ok, failed, stopped })

// A row as a spawn makes it, at `t`, under `parentId`
const row = (id: string, parentId: string | null, t: number, status: AgentRow['status'] = 'running'): AgentRow => ({
  ...newRow({ id, parentId, type: 'Explore', description: id, prompt: '', isTeammate: false, model: 'claude-haiku-5-5' }, t),
  status,
})

// The list named it while it ran before; until it names it again, its silence says nothing of the new run
test('a resumed row waits for the list to name it again before the list can end it', () => {
  const ended: AgentRow = { ...row('a1', null, 0, 'completed'), isListed: true, endedAt: 5000 }
  const resumed = upsertSpawn([ended], row('a1', null, 9000), true)
  expect(resumed[0]).toMatchObject({ status: 'running', isListed: false, endedAt: null })
  expect(refreshAgents(resumed, [], 10_000)[0]?.status).toBe('running')
})

test('promptLines reads the plan and task lines alone', () => {
  expect(promptLines('Find the auth code.\nplan: token-refresh\ntask: S4\n')).toEqual({ plan: 'token-refresh', task: 'S4' })
  expect(promptLines('Read the task: it says x')).toEqual({ plan: null, task: null })
  expect(promptLines('task:   3  \r\nplan: p')).toEqual({ plan: 'p', task: '3' })
  // Seen live: the model wrote the brief on the task line; only the id is kept, never the prompt's words
  expect(promptLines('task: T7 - Read the file notes.txt in /w\nplan: docs/p.md, then more')).toEqual({ plan: 'docs/p.md,', task: 'T7' })
})

test('a model id reads as its family and version', () => {
  expect(modelParts('claude-opus-5-5')).toEqual({ family: 'opus', version: '5.5' })
  expect(modelParts('claude-haiku-5')?.version).toBe('5')
  expect(modelParts('haiku')).toEqual({ family: 'haiku', version: null })
  expect(modelParts('vendor.custom-model')).toBe(null)
  expect(modelText('claude-opus-5-5')).toBe('opus 5.5')
  expect(modelText('claude-opus-5-5', true)).toBe('Opus 5.5')
  expect(modelText('vendor.custom-model')).toBe('vendor.custom-model')
})

test("a run's end sets the status", () => {
  expect(statusAt('answer', false)).toBe('completed')
  expect(statusAt('error', false)).toBe('failed')
  expect(statusAt('refusal', false)).toBe('failed')
  expect(statusAt('aborted', false)).toBe('killed')
  expect(statusAt('answer', true)).toBe('idle')
  expect((['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed'] as const).filter(isLive)).toEqual(['pending', 'running', 'waiting'])
})

test('the tree nests each agent under the one that started it, oldest first', () => {
  const tree = agentTree([row('a3', null, 3), row('a1', null, 1), row('a4', 'zz', 4), row('a2', 'a1', 2)])
  expect(tree.map(t => t.prefix + t.row.id)).toEqual(['├ a1', '│ └ a2', '├ a3', '└ a4'])
  expect(tree.find(t => t.row.id === 'a2')?.depth).toBe(2)
})

test('a parent cycle sits under the root', () => {
  expect(agentTree([row('a1', 'a2', 1), row('a2', 'a1', 2)]).map(t => t.prefix + t.row.id)).toEqual(['├ a1', '└ a2'])
})

test('tools read with their failures, skills apart', () => {
  expect(toolSummary({ Read: s(6, 6, 0, 0), Grep: s(3, 3, 0, 0), Bash: s(1, 0, 1, 0), 'Skill: watch': s(1, 1, 0, 0) }))
    .toEqual({ tools: ['Read ×6 ✓', 'Grep ×3 ✓', 'Bash ×1 ✗'], skills: ['watch ×1'] })
  expect(toolSummary({ Bash: s(4, 2, 1, 1) }).tools).toEqual(['Bash ×4 ✗1 ⊘1'])
  expect(toolSummary({ Edit: s(2, 0, 0, 2) }).tools).toEqual(['Edit ×2 ⊘'])
})

test('fifty rows are kept, the oldest ended dropped first, never a live one', () => {
  const ended = Array.from({ length: 49 }, (_, i) => row(`d${i + 1}`, null, i + 1, 'completed'))
  const live = [50, 51, 52].map(t => row(`r${t}`, null, t))
  const kept = keepRows([...ended, ...live])
  expect(kept).toHaveLength(50)
  expect(kept.filter(r => r.status === 'running')).toHaveLength(3)
  expect(kept.some(r => r.startedAt === 1 || r.startedAt === 2)).toBe(false)
  expect(keepRows(Array.from({ length: 52 }, (_, i) => row(`r${i}`, null, i)))).toHaveLength(52)
})

test('the list moves live rows only', () => {
  const info = (id: string, status: AgentRow['status'], parentId?: string) =>
    ({ id, description: id, type: 'Explore', status, ...(parentId === undefined ? {} : { parentId }) })
  const rows = [
    row('w', null, 1), row('f', null, 2), row('c', null, 3, 'completed'),
    { ...row('gone', null, 4), isListed: true }, row('never', null, 5),
  ]
  const out = refreshAgents(rows, [info('w', 'waiting', 'a2'), info('f', 'failed'), info('c', 'running')], 9000)
  const by = (id: string) => out.find(r => r.id === id)
  expect(by('w')).toMatchObject({ status: 'waiting', isListed: true, parentId: 'a2', endedAt: null })
  expect(by('f')).toMatchObject({ status: 'failed', endedAt: 9000 })
  expect(by('c')).toMatchObject({ status: 'completed', endedAt: null })
  expect(by('gone')).toMatchObject({ status: 'completed', endedAt: 9000 })
  expect(by('never')).toMatchObject({ status: 'running', endedAt: null })
})

test('an action is the tool and its target', () => {
  expect(actionOf('Grep', 'AuthService')).toBe('Grep AuthService')
  expect(actionOf('TodoWrite', '')).toBe('TodoWrite')
})

test('a spawn adds a running row with its type, model, lines and parent, and keeps no prompt', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.agent.spawn({ ...SPAWN, prompt: 'secret-words\nplan: p1\ntask: S4', description: 'Finding auth code', subagentType: 'Explore' })

  expect((state.get('agents') as AgentRow[])[0]).toMatchObject({
    id: 'a1', parentId: null, type: 'Explore', description: 'Finding auth code', plan: 'p1', task: 'S4',
    model: 'claude-haiku-5-5', status: 'running', isListed: false, endedAt: null, tools: {},
  })
  expect(JSON.stringify(state.get('agents'))).not.toContain('secret-words')
})

test("an agent's spawn names the agent that started it", async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on, { child: { agentId: 'a2' } })

  await $.agent.spawn({ ...SPAWN, description: 'child', parentAgentId: 'a1' })

  expect((state.get('agents') as AgentRow[])[0]).toMatchObject({ id: 'a2', parentId: 'a1' })
})

test('an agent resumed by SendMessage keeps its one row', async ($, on) => {
  const { clock } = stubAll(on)
  const state = watchState(on)
  engine(on)

  await $.agent.spawn(SPAWN)
  await clock.advance(5000)
  await $.agent.spawn({ ...SPAWN, resume: { agentId: 'a1' } })

  const rows = state.get('agents') as AgentRow[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: 'a1', status: 'running', startedAt: 5000 })
})

test('a resume of an agent no spawn announced adds its row', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  spawns(on, {})

  await $.agent.spawn({ ...SPAWN, resume: { agentId: 'a9' } })

  expect((state.get('agents') as AgentRow[]).map(r => r.id)).toEqual(['a9'])
})

test('a denied spawn adds no row', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on, ['agent.spawn'])
  on('agent.spawn', () => ({ deny: 'no' }))

  await $.agent.spawn(SPAWN)

  expect(state.get('agents')).toBe(undefined)
})
