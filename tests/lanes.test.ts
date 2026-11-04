import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows, spawns, stubAll } from './kit.ts'

// Spec C2: two or more agents draw on one time axis between the Agents tab's head and its tree
const PANE = { title: 'Inspect', isFocused: false, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
function all(tree: unknown, type: string): Drawn[] {
  if (!isDrawn(tree)) return []
  return [...(tree.type === type ? [tree] : []), ...(tree.children ?? []).flatMap(c => all(c, type))]
}

const mount = async ($: Engine, surface: RenderSurface, columns: number) => {
  await $.command.run({ command: 'inspect', args: 'agents', origin: { kind: 'composer' }, presentation: PRESENTATION })
  return $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: columns } })
}
const agentsTab = async ($: Engine, surface: RenderSurface, columns: number): Promise<string[]> => {
  const ui = await mount($, surface, columns)
  const out = (await rows(ui)).map(l => l.trimEnd())
  await ui.unmount()
  return out
}

// An Explore agent from 1 s to 5 s, then one on task T-7 from 3 s, still running at 9 s
async function two($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}, task = 'T-7') {
  const kit = stubAll(on, o)
  engine(on, ['agent.spawn'])
  spawns(on, { first: { agentId: 'a1' }, second: { agentId: 'a2' } })
  await $.session.start(START)
  await kit.clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'first' })
  await kit.clock.advance(2000)
  await $.agent.spawn({ ...SPAWN, description: 'second', prompt: `task: ${task}\nlook` })
  await kit.clock.advance(2000)
  await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'ok' }))
  await kit.clock.advance(4000)
  return kit
}

// At 60 columns the bar is 27 cells: a glyph and a space, a 14-cell label, the bar, a space and a 16-cell time
const LANE_1 = `✓ ${'Explore'.padEnd(14)}${'━'.repeat(14)}${'·'.repeat(13)} done in 4s`
const LANE_2 = `⟳ ${'task T-7'.padEnd(14)}${'·'.repeat(6)}${'━'.repeat(21)} 6s`

test('two agents draw lanes between the head and the tree at 60 columns and wider', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  const lines = await agentsTab($, 'terminal', 60)
  const head = lines.findIndex(l => l.startsWith('Agents (2)'))
  expect(lines.slice(head + 1, head + 3)).toEqual([LANE_1, LANE_2])
  expect(lines[head + 3]).toBe('✓ main chat · 0 tools')

  const wide = await agentsTab($, 'terminal', 100)
  const at = wide.findIndex(l => l.startsWith('Agents (2)'))
  expect(wide[at + 1]?.startsWith(`✓ ${'Explore'.padEnd(14)}━`)).toBe(true)
  expect([...(wide[at + 1] ?? '')].filter(c => c === '━' || c === '·').length).toBe(100 - 33)
})

test('under 60 columns draws none', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  expect((await agentsTab($, 'terminal', 59)).some(l => l.includes('━'))).toBe(false)
})

test('one agent alone draws no lanes', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = stubAll(on)
  engine(on, ['agent.spawn'])
  spawns(on, { first: { agentId: 'a1' } })
  await clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'first' })
  expect((await agentsTab($, 'terminal', 100)).some(l => l.includes('━'))).toBe(false)
})

test('a row with startedAt 0 is left out', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = stubAll(on)
  engine(on, ['agent.spawn'])
  spawns(on, { zero: { agentId: 'a0' }, first: { agentId: 'a1' }, second: { agentId: 'a2' } })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Plan', description: 'zero' })
  await clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'first' })
  await clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, description: 'second' })
  const lines = await agentsTab($, 'terminal', 80)
  expect(lines.filter(l => l.includes('━'))).toHaveLength(2)
  expect(lines.some(l => l.includes('━') && l.includes('Plan'))).toBe(false)
})

test('the 8 newest rows only', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = stubAll(on)
  engine(on, ['agent.spawn'])
  spawns(on, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`agent ${i}`, { agentId: `a${i}` }])))
  for (let i = 0; i < 10; i++) {
    await clock.advance(1000)
    await $.agent.spawn({ ...SPAWN, subagentType: `Type${i}`, description: `agent ${i}` })
  }
  const lanes = (await agentsTab($, 'terminal', 80)).filter(l => l.includes('━'))
  expect(lanes).toHaveLength(8)
  expect(lanes[0]?.startsWith(`⟳ ${'Type2'.padEnd(14)}`)).toBe(true)
  expect(lanes[7]?.startsWith(`⟳ ${'Type9'.padEnd(14)}`)).toBe(true)
})

test("a lane's label is task <id> or the type, 14 cells, through mask() under REC", { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on, { store: { 'settings:rec': 'on', 'rec:words': ['Zephyrine'] } }, 'T-Zephyrine')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface, 80)
    expect(JSON.stringify(await ui.drawn()).includes('Zephyrine')).toBe(false)
    await ui.unmount()
  }
  const lines = await agentsTab($, 'terminal', 80)
  const lane = lines.find(l => l.startsWith('⟳ task T-'))
  expect(lane === undefined).toBe(false)
  // The label is a 14-cell cell: the bar starts at cell 16 whatever the label's length
  expect([...(lane ?? '')].slice(16, 17).join('')).toMatch(/[·━]/)
})

test('terminal and mobile draw text lanes, mobile in its monospaced face', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await mount($, surface, 60)
    const lines = (await rows(ui)).map(l => l.trimEnd())
    expect(lines).toContain(LANE_1)
    expect(lines).toContain(LANE_2)
    const tree = await ui.drawn()
    expect(all(tree, 'Svg')).toEqual([])
    const bars = all(tree, 'Text').filter(t => /^[━·]+$/.test(String((t.children ?? []).join(''))))
    expect(bars.length >= 4).toBe(true)
    expect(bars.every(t => (t.props?.['mono'] === true) === (surface === 'mobile'))).toBe(true)
    await ui.unmount()
  }
})

test('desktop and vscode draw one Svg with a rect per lane in fixed hex', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await mount($, surface, 60)
    const tree = await ui.drawn()
    const svgs = all(tree, 'Svg')
    expect(svgs).toHaveLength(1)
    const source = String(svgs[0]?.props?.['source'] ?? '')
    expect(source.match(/<rect /g)?.length).toBe(2)
    // Completed green, running blue: flightdeck's SVG_COLORS, mid-tones that read on light and dark
    expect(source.includes('fill="#16a34a"')).toBe(true)
    expect(source.includes('fill="#3b82f6"')).toBe(true)
    expect(source.includes('>Explore<')).toBe(true)
    expect(source.includes('>task T-7<')).toBe(true)
    expect((await rows(ui)).some(l => l.includes('━'))).toBe(false)
    await ui.unmount()
  }
})
