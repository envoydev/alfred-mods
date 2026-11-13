import { expect, test } from 'claude-code/testing'
import type { SessionUsage, TurnUsage } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, step, stepEngine, stubAll } from '../kit'
import { GOLDEN } from './trace-golden'

// The reading tests/fresh.test.ts builds: a cost and one five_hour limit
const READING: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 20_000, percent: 10 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }],
  cost: { usd: 0.5 },
}
// The TurnUsage tests/agent-hooks.test.ts's stepEngine gives
const STEP_USAGE: TurnUsage = {
  input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000, model: 'claude-haiku-5-5',
}
const stamp = (text: string): string => text.replace(/\d{4}-\d{2}-\d{2}/g, '<day>').replace(/\b\d{1,2}:\d{2}\b/g, '<time>')

// Pins what a session writes, in order, so the restructure's moves are seen to change none of it
test('a scripted session writes the same state keys, toasts, status texts and store keys, in order', { timeoutMs: 15_000 }, async ($, on) => {
  const state: string[] = []
  on('state.set', async (_, e, next) => {
    state.push(e.key)
    return next(e)
  })
  const kit = stubAll(on, { usage: READING, model: 'claude-opus-5-5', version: '2.1.323', repo: { root: '/w' }, diff: '', untracked: '' })
  engine(on)
  stepEngine(on, () => STEP_USAGE)
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'startup' } as never)
  await kit.clock.advance(1000)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.classic.UserPromptSubmit({ prompt: 'q', permission_mode: 'auto' } as never)
  await $.turn.start({ text: 'q', turnId: 't1' } as never)
  await step($, { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1' } as never)
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.session.measure({ context: READING.context, rateLimits: READING.rateLimits, changed: ['rateLimits'] } as never)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user' as const, text: 'q', toolUses: [] }] } as never)
  await $.command.run({ command: 'inspect', args: 'tools', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await kit.clock.advance(5000)
  state.push('-- clear')
  kit.session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' } as never)
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  await kit.clock.advance(1000)
  const trace = {
    state, toasts: kit.toasts.map(stamp), statuses: kit.statuses.map(s => stamp(s ?? '(clear)')),
    store: kit.store.writes.map(stamp), invalidates: kit.invalidates, opened: kit.opened,
  }
  if (GOLDEN === null) throw new Error(`TRACE ${JSON.stringify(trace)}`)
  expect(trace).toEqual(GOLDEN)
})
