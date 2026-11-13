import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { PRESENTATION, START, engine, stubAll } from '../kit'
import { PLAN_JSON } from '../plans'

// What the store holds is shared with sessions on other versions of the mod: its keys and each value's fields stay
// as they are through the hooks restructure (2026-11-13), whatever the code's own names become
const READING: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 20_000, percent: 10 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }],
  cost: { usd: 0.5 },
}
const PLAN_PATH = '.claude/session-inspector/plans/token-refresh.json'
const PANE = { title: 'REC words', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const shapeOf = (v: unknown): unknown =>
  Array.isArray(v) ? [shapeOf(v[0])] : typeof v === 'object' && v !== null
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shapeOf((v as Record<string, unknown>)[k])])) : typeof v

const STORE_SHAPES = {
  'cost-last:s1': { at: 'number', micros: 'number' },
  'cost:<day>:s1': 'number',
  'rec:words': ['string'],
  'step:token-refresh:S4:s1': { at: 'number', isShared: 'boolean', ms: 'number' },
  'usage:windows': { at: 'number', windows: [{ kind: 'string', percentUsed: 'number', resetsAt: 'string' }] },
}

test('the store keeps its keys and each value\'s fields', { timeoutMs: 15_000 }, async ($, on) => {
  const kit = stubAll(on, { usage: READING, files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 } }, env: { HOME: '/Users/jane' } })
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  await kit.clock.set(1000)
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' } as never)
  await kit.clock.set(121_000)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.session.measure({ context: READING.context, rateLimits: READING.rateLimits, changed: ['rateLimits'] } as never)
  await $.command.run({ command: 'rec', args: 'words', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'Pane', requestId: 'rec', props: PANE })
  await ui.input({ key: 'word', text: 'Acme' })
  await ui.unmount()
  const shapes = Object.fromEntries(kit.store.keys().sort().map(k => [k.replace(/\d{4}-\d{2}-\d{2}/, '<day>'), shapeOf(kit.store.get(k))]))
  expect(shapes).toEqual(STORE_SHAPES)
})
