import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { PRESENTATION, engine, rows, stubAll } from '../kit'

// A stored field renamed moves its atom's shape tag: a session reloaded over a value an earlier version stored drops it
// once and starts that atom from its start value, rather than reading a field that is no longer there
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const ABOVE = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

test('state stored under the tags before the field renames is dropped once', { timeoutMs: 15_000 }, async ($, on) => {
  const old: Record<string, unknown> = {
    turns: { shape: 'turns-1', value: [{ n: 7, turnId: 't0', promptAt: null, replyAt: 0, durationMs: 3000, tokensIn: 10, tokensOut: 2, tools: 0, failures: 0, contextPercent: null, end: 'answer' }] },
    live: { shape: 'live-3', value: { turnId: 't0', startedAt: 0, tools: 4, failures: 1, running: [], promptAt: null } },
    usage: { shape: 'usage-1', value: { tokens: 150_000, window: 200_000, percent: 75, startedAt: 0, windows: [], costUsd: 9.99, todayUsd: 9.99, at: 0 } },
    pace: { shape: 'pace-1', value: { five_hour: { resetsAt: null, points: [], toasted: [50] } } },
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
  await inspect($, 'timeline')
  expect((await rows(await pane($, 'terminal'))).some(l => l.startsWith('7 '))).toBe(false)
  const band = await rows(await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: ABOVE }))
  expect(band.some(l => l.includes('75%'))).toBe(false)
  expect(band.length).toBeGreaterThan(0)
})
