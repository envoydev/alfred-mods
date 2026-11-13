import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows, spawns, stubAll } from './kit.js'

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
// The element whose children hold one of `type`
function parentOf(tree: unknown, type: string): Drawn | undefined {
  if (!isDrawn(tree)) return undefined
  if ((tree.children ?? []).some(c => isDrawn(c) && c.type === type)) return tree
  for (const c of tree.children ?? []) {
    const found = parentOf(c, type)
    if (found !== undefined) return found
  }
  return undefined
}

const mount = async ($: Engine, surface: RenderSurface, columns: number) => {
  await $.command.run({ command: 'inspect', args: 'agents', origin: { kind: 'composer' }, presentation: PRESENTATION })
  return $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: columns } })
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

// A glyph and a space, the label as wide as the longest ('task T-7 · second', 17) and a space, the bar, a space and the
// time in a cell as wide as the longest lane's ('done in 4s', 10): at 60 columns the bar is 29 cells, the axis 8 s, the
// first lane 0-4 s of it and the second 2-8 s
const LANE_1 = `✓ ${'first'.padEnd(17)} ${'━'.repeat(15)}${'·'.repeat(14)} done in 4s`
const LANE_2 = `⟳ task T-7 · second ${'·'.repeat(7)}${'━'.repeat(22)} 6s`

test('two agents draw lanes between the head and the tree at 60 columns and wider', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  const lines = await agentsTab($, 'terminal', 60)
  const head = lines.findIndex(l => l.startsWith('Agents (2)'))
  expect(lines.slice(head + 1, head + 3)).toEqual([LANE_1, LANE_2])
  expect(lines[head + 3]).toBe('✓ main chat · 0 tools')

  const wide = await agentsTab($, 'terminal', 100)
  const at = wide.findIndex(l => l.startsWith('Agents (2)'))
  expect(wide[at + 1]?.startsWith(`✓ ${'first'.padEnd(17)} ━`)).toBe(true)
  // The bar stops at 40 cells, however wide the pane
  expect([...(wide[at + 1] ?? '')].filter(c => c === '━' || c === '·').length).toBe(40)
})

// A pane docked beside a 120-column terminal is about 49 columns: the lanes draw there with their whole label
test('a pane docked beside a 120-column terminal draws the lanes', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  const lines = await agentsTab($, 'terminal', 49)
  const head = lines.findIndex(l => l.startsWith('Agents (2)'))
  expect(lines.slice(head + 1, head + 3)).toEqual([
    `✓ ${'first'.padEnd(17)} ${'━'.repeat(9)}${'·'.repeat(9)} done in 4s`,
    `⟳ task T-7 · second ${'·'.repeat(4)}${'━'.repeat(14)} 6s`,
  ])
})

// Narrower, the label gives way down to 6 cells so the bar keeps 10; with less room no lane is drawn
test('a narrow pane shortens the label to keep a 10-cell bar, and draws none below that', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  const lines = await agentsTab($, 'terminal', 32)
  const head = lines.findIndex(l => l.startsWith('Agents (2)'))
  expect(lines.slice(head + 1, head + 3)).toEqual([
    `✓ ${'first'.padEnd(8)} ${'━'.repeat(5)}${'·'.repeat(5)} done in 4s`,
    `⟳ task T-… ${'·'.repeat(2)}${'━'.repeat(8)} 6s`,
  ])
  expect((await agentsTab($, 'terminal', 30)).filter(l => l.includes('━'))).toHaveLength(2)
  expect((await agentsTab($, 'terminal', 29)).some(l => l.includes('━'))).toBe(false)
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
  expect(lanes[0]?.startsWith('⟳ agent 2 ')).toBe(true)
  expect(lanes[7]?.startsWith('⟳ agent 9 ')).toBe(true)
})

test("a lane's label is task <id> and what was asked, through mask() under REC", { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on, { store: { 'settings:rec': 'on', 'rec:words': ['Zephyrine'] } }, 'T-Zephyrine')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface, 80)
    expect(JSON.stringify(await ui.drawn()).includes('Zephyrine')).toBe(false)
    await ui.unmount()
  }
  const lines = await agentsTab($, 'terminal', 80)
  const lane = lines.find(l => l.startsWith('⟳ task T-'))
  expect(lane === undefined).toBe(false)
  expect(lane?.includes(' · second ')).toBe(true)
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
    expect(source.includes('>first<')).toBe(true)
    expect(source.includes('>task T-7 · second<')).toBe(true)
    expect((await rows(ui)).some(l => l.includes('━'))).toBe(false)
    // In a Box as wide as the pane, so the drawing scales down to it rather than spilling past it (release 3 review)
    const slot = parentOf(tree, 'Svg')
    expect(slot?.props?.['width']).toBe(60)
    expect(slot?.props?.['flexShrink'] === 0).toBe(false)
    await ui.unmount()
  }
})

// The longest time a lane draws, whole (release 3 review: a 16-cell time cut 'stopped after 12m 30s' to 'stopped after 1…')
test("a lane's time is never cut", { timeoutMs: 15_000 }, async ($, on) => {
  const kit = stubAll(on)
  engine(on, ['agent.spawn'])
  spawns(on, { first: { agentId: 'a1' }, second: { agentId: 'a2' } })
  await $.session.start(START)
  await kit.clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'first' })
  await kit.clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, description: 'second' })
  await kit.clock.advance(749_000)
  await $.turn.complete(complete('x1', { agentId: 'a1', reason: 'aborted', isAborted: true }))
  const lanes = (await agentsTab($, 'terminal', 60)).filter(l => l.includes('━'))
  expect(lanes[0]?.endsWith(' stopped after 12m 30s')).toBe(true)
  expect([...(lanes[0] ?? '')].length).toBe(60)
})

// The user, 2026-11-12: 'they cut in a half and a lot of dots are seeing - I want to see what agents are doing or did'.
// A lane names what the agent was asked, the task id first; the label takes the longest's width up to 40 cells and the
// bar at most 40, so a wide pane is not a row of dots
test('a lane names what the agent was asked, the task id first', { timeoutMs: 15_000 }, async ($, on) => {
  await two($, on)
  const lanes = (await agentsTab($, 'terminal', 100)).filter(l => /[━·]{5}/.test(l))
  expect(lanes[0]?.startsWith(`✓ ${'first'.padEnd(17)} ━`)).toBe(true)
  expect(lanes[1]?.startsWith('⟳ task T-7 · second ·')).toBe(true)
})

test('a wide pane caps the bar at 40 cells and a label at 40', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = stubAll(on)
  engine(on, ['agent.spawn'])
  const long = 'Review the plan against the rubric and quote evidence for each check'
  spawns(on, { [long]: { agentId: 'a1' }, short: { agentId: 'a2' } })
  await clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, description: long })
  await clock.advance(1000)
  await $.agent.spawn({ ...SPAWN, description: 'short' })
  const lanes = (await agentsTab($, 'terminal', 240)).filter(l => /[━·]{5}/.test(l))
  expect(lanes).toHaveLength(2)
  for (const lane of lanes) expect([...lane].filter(c => c === '━' || c === '·').length).toBe(40)
  expect(lanes[0]?.startsWith(`⟳ ${long.slice(0, 39)}… ━`)).toBe(true)
  expect(lanes[1]?.startsWith(`⟳ ${'short'.padEnd(40)} ·`)).toBe(true)
})
