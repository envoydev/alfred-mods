import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import type { Cache } from '../../types'
import { PRESENTATION, engine, rows, stubAll } from '../kit'

// The other atoms' renamed fields move their shape tags: a session reloaded over a value an earlier version stored drops
// it once and starts that atom from its start value
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const ABOVE = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

test("state stored under the other atoms' old tags is dropped once", { timeoutMs: 15_000 }, async ($, on) => {
  // The warm cache of tests/cache/cache-hooks.test.ts, under its old field names
  const warm = {
    tier: '1h', tierAt: 0, tierBilling: 'plan', config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: true },
    ratePerToken: 0.000008, rateModel: 'claude-opus-5-5', lastAt: 0, last: { read: 169_200, write: 10_800, input: 0 },
    session: { read: 169_200, write: 10_800, input: 0 }, toastedFor: null,
  } as unknown as Cache
  const failure = { id: 'f0', at: 0, tool: 'Bash', target: 'Push', outcome: 'failed', reason: 'exit 1', detail: '', count: 1, isNew: true, by: null, n: 1 }
  const old: Record<string, unknown> = {
    failures: { shape: 'failures-1', value: [failure] },
    view: { shape: 'view-3', value: { tab: 'tools', shown: ['x'], planSlug: null } },
    rec: { shape: 'rec-1', value: { level: 'on', count: 3, note: null } },
    cache: { shape: 'cache-1', value: warm },
  }
  const written = new Set<string>()
  on('state.set', async (_, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', async (_, e, next) => {
    const r = await next(e)
    const seed = old[e.key]
    return seed === undefined || written.has(e.key) || r.value === undefined ? r : { value: { ...r.value, value: seed } }
  })
  stubAll(on)
  engine(on)
  // The pane mounted before any command draws the stored tab, and the Tools tab lists the stored failure rows
  const view = await pane($, 'terminal')
  expect((await rows(view)).some(l => l.startsWith('Tools '))).toBe(false)
  await inspect($, 'tools')
  expect((await rows(view)).some(l => l.includes('Push'))).toBe(false)
  const band = await rows(await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: ABOVE }))
  expect(band.some(l => l.includes('● REC'))).toBe(false)
  await inspect($, 'cache')
  expect((await rows(view)).some(l => l.includes('last request'))).toBe(false)
})
