import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface, SessionUsage } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows as rowsOf, spawns, step, stepEngine, stubAll } from './kit.ts'
import { drawLines } from '../hooks/draw.tsx'
import type { Line } from '../hooks/band.ts'
import type { FileStub } from './kit.ts'
import { NOW, PLAN_JSON, SCORES_JSON } from './plans.ts'

// The tree checks, ported from claude-flightdeck's tests (f9c3c52, tests/flightdeck.test.ts 938-995). The kit lays
// nothing out, so they read the drawn tree as a row layout would.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
const cellsOf = (s: string): number => [...s].length
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isDrawn(n) ? (n.children ?? []).map(textOf).join('') : ''
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

// What a graphical surface needs of a line: no Text holds a Text (the Desktop app wraps nested pieces, or lays them out
// as blocks), no Text alone in a Box starts or ends with a space, and off the terminal no Text holds a run of spaces
// (a proportional face collapses them)
export function faults(tree: RenderElement, surface: RenderSurface): string[] {
  const out: string[] = []
  const walk = (n: unknown, path: string, parent: string): void => {
    if (!isDrawn(n)) return
    const p = n.props ?? {}
    const here = `${path}/${String(p.key ?? n.type)}`
    const kids = (n.children ?? []).filter(isDrawn)
    if (n.type === 'Text') {
      const text = textOf(n)
      if (kids.some(k => k.type === 'Text')) out.push(`${here}: a Text holds a Text "${text}"`)
      if (parent === 'Box' && text !== text.trim()) out.push(`${here}: edge spaces "${text}"`)
      if (surface !== 'terminal' && text.includes('  ')) out.push(`${here}: a run of spaces "${text}"`)
      return
    }
    kids.forEach((k, i) => walk(k, `${here}[${i}]`, n.type))
  }
  walk(tree, '', '')
  return out
}

// The fewest cells an element needs: a truncating Text one, any other Text its length; a Button its label and frame
// (Decision 12); a Code piece, a chart and an Input one, as each is alone or sized by its Box; a row Box the sum of its
// children and margins. A Box given a width must hold what it needs.
export function spills(tree: RenderElement): string[] {
  const out: string[] = []
  const needs = (n: unknown, path: string): number => {
    if (typeof n === 'string') return cellsOf(n)
    if (!isDrawn(n)) return 0
    const p = n.props ?? {}
    const here = `${path}/${String(p.key ?? n.type)}`
    if (n.type === 'Text') return p.wrap === 'truncate-end' ? 1 : cellsOf(textOf(n))
    if (n.type === 'Button') {
      const label = cellsOf(String(p.label ?? ''))
      return p.plain === true ? (typeof p.hotkey === 'string' ? p.hotkey.length + 2 : 0) + label : label + 4
    }
    if (n.type !== 'Box') return 1
    const kids = (n.children ?? []).filter(c => c !== null && c !== undefined && c !== false && c !== '')
    const inner = kids.map((c, i) => needs(c, `${here}[${i}]`))
    const isColumn = p.flexDirection === 'column'
    const need = isColumn ? Math.max(0, ...inner) : inner.reduce((a, b) => a + b, 0)
    const margin = num(p.marginLeft) + num(p.marginRight)
    if (typeof p.width === 'number') {
      if (need > p.width) out.push(`${here}: needs ${need} in ${p.width}`)
      return p.width + margin
    }
    return need + margin
  }
  needs(tree, '')
  return out
}

// One busy session: two agents running and one done, a failure, a block, a plan with scores, a warm cache, the
// handoff ask up, a valid stack status file, REC on with one private word
const DIR = '.claude/session-inspector'
const STATUS = `${DIR}/status/s1.json`
const file = (text: string): FileStub => ({ text, mtimeMs: NOW })
const STACK = {
  schema: 1, session: 's1', fullContext: 'compact', updatedAt: '2026-10-29T14:03:00Z', model: 'claude-opus-5-5',
  window: 1000000, resumeAt: 150000, autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, handoffPrompt: null,
}
const READING: SessionUsage = {
  startedAt: 0, context: { window: 200_000, tokens: 164_000, percent: 82 }, cost: { usd: 3.12 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-27T17:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' }],
}
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' }
const complete = (turnId: string, more: object = {}) => ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })

async function busy($: Engine, on: On): Promise<void> {
  const kit = stubAll(on, {
    now: NOW, usage: READING, env: { HOME: '/Users/jane' },
    store: { 'settings:rec': 'on', 'rec:words': ['Zephyrine'] },
    files: { [`${DIR}/plans/token-refresh.json`]: file(PLAN_JSON), [`${DIR}/scores/token-refresh.json`]: file(SCORES_JSON), [STATUS]: file(JSON.stringify(STACK)) },
  })
  engine(on, ['agent.spawn', 'tool.call', 'session.measure'])
  spawns(on, { lead: { agentId: 'a1' }, scout: { agentId: 'a2' }, done: { agentId: 'a3' } })
  stepEngine(on, () => USAGE)
  on('tool.check', (_, e, next) => (e.tool === 'Bash' && String((e as { command?: string }).command).includes('probe-guard') ? { decision: 'deny', reason: 'guard: marked', hook: 'PreToolUse' } : next(e)))
  on('tool.call', (_, e) => (e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1\nboom', text: 'Exit code 1\nboom' } : { result: 'ok', text: 'ok' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start(START)
  await kit.clock.advance(300)
  await $.turn.start({ text: 'q', turnId: 't1' })
  await step($, { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await $.tool.call({ tool: 'Read', file_path: '/w/src/auth/refresh.ts' })
  await $.tool.call({ tool: 'Bash', command: 'false Zephyrine', tool_use_id: 'f1' })
  await $.tool.call({ tool: 'Bash', command: 'echo probe-guard', tool_use_id: 'b1' })
  await $.agent.spawn({ ...SPAWN, description: 'lead' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'scout', parentAgentId: 'a1' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'done' })
  await $.turn.complete(complete('x3', { agentId: 'a3', answer: 'found it' }))
  await $.session.measure({ context: { tokens: 164_000, window: 200_000, percent: 82 }, rateLimits: READING.rateLimits, changed: ['context'] })
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const PANE = { title: 'Inspect', isFocused: false, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const TABS = ['now', 'usage', 'agents', 'tools', 'cache', 'timeline', 'plan'] as const
const ALL: RenderSurface[] = ['terminal', 'desktop', 'vscode', 'mobile']

const check = (tree: RenderElement, surface: RenderSurface, where: string): string[] =>
  [...faults(tree, surface), ...spills(tree)].map(f => `${where}: ${f}`)

test('no faults or spills in the band', async ($, on) => {
  await busy($, on)
  const found: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [60, 80, 100, 120, 160]) {
      const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns } })
      found.push(...check(await ui.drawn(), surface, `band ${surface} ${columns}`))
      await ui.unmount()
    }
  }
  expect(found).toEqual([])
})

test('no faults or spills in each tab and the rec pane', async ($, on) => {
  await busy($, on)
  const found: string[] = []
  for (const tab of TABS) {
    await $.command.run({ command: 'inspect', args: tab, origin: { kind: 'composer' }, presentation: PRESENTATION })
    for (const surface of ALL) {
      for (const columns of [40, 48, 64, 80, 100, 120]) {
        const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: columns } })
        found.push(...check(await ui.drawn(), surface, `${tab} ${surface} ${columns}`))
        await ui.unmount()
      }
    }
  }
  for (const surface of ALL) {
    for (const columns of [40, 48, 64, 80, 100, 120]) {
      const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'rec', props: { ...PANE, title: 'REC words', bodyColumns: columns } })
      found.push(...check(await ui.drawn(), surface, `rec ${surface} ${columns}`))
      await ui.unmount()
    }
  }
  expect(found).toEqual([])
})

test('no faults or spills in the tool rows', async ($, on) => {
  await busy($, on)
  await $.command.run({ command: 'quiet', args: 'on', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const use = { tool_use_id: 'f1', tool: 'Bash', input: { command: 'false Zephyrine', description: 'Fail on purpose' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'Exit code 1\nboom' }
  const sites = [
    { component: 'ToolUse', props: use },
    { component: 'ToolResult', props: { tool_use_id: 'r1', tool: 'Read', output: { type: 'text', file: { filePath: '/w/a.ts', content: 'x\ny', numLines: 2, startLine: 1, totalLines: 2 } }, isErrored: false } },
    { component: 'ToolGroup', props: { calls: [{ tool_use_id: 'g1', tool: 'Read', input: { file_path: '/w/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }, { tool_use_id: 'g2', tool: 'Read', input: { file_path: '/w/b.ts' }, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false, isCallsOnly: true } },
  ] as const
  const found: string[] = []
  for (const site of sites) {
    for (const surface of ALL) {
      for (const columns of [60, 80, 120]) {
        const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: site.component, props: site.props, viewport: { columns, rows: 40 } } as never)
        found.push(...check(await ui.drawn(), surface, `${site.component} ${surface} ${columns}`))
        await ui.unmount()
      }
    }
  }
  expect(found).toEqual([])
})

test('a Box keeps its key in the drawn tree', async ($, on) => {
  stubAll(on)
  engine(on)
  on('ui.render', { component: 'Pane', requestId: 'p3' }, ($$, e) => {
    const { Box, Text } = $$.ui.resolve(e)
    return h(Box, { key: 'line-0' }, h(Text, null, 'x')) as RenderElement
  })
  const ui = await $.ui.mount({ plugin: 'session-inspector', surface: 'terminal', component: 'Pane', requestId: 'p3', props: { ...PANE, bodyColumns: 40 } })
  const tree = await ui.drawn() as Drawn
  expect(tree.type).toBe('Box')
  expect(tree.props?.['key']).toBe('line-0')
})

// A pane the test draws: the lines it is given, through drawLines at the pane's width
const FIT_PANE = { title: 'Fit', isFocused: false, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
function fitPane(on: On, lines: Line[]): void {
  on('ui.render', { component: 'Pane', requestId: 'fit' }, ($$, e) =>
    drawLines($$, e, lines, { noColor: false, press: {}, columns: e.props.bodyColumns }))
}
const mountFit = ($: Engine, surface: RenderSurface, columns: number) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'fit', props: { ...FIT_PANE, bodyColumns: columns } })
// The drawn line Boxes, in order
const lineBoxes = (tree: RenderElement): Drawn[] => {
  const out: Drawn[] = []
  const find = (n: unknown): void => {
    if (!isDrawn(n)) return
    if (n.type === 'Box' && String(n.props?.['key'] ?? '').startsWith('line-')) out.push(n)
    else (n.children ?? []).forEach(find)
  }
  find(tree)
  return out
}
const pieces = (line: Drawn): Drawn[] => (line.children ?? []).filter(isDrawn)

async function turns($: Engine, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'q', turnId: `t${i}` })
    await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: `c${i}` })
    await $.turn.complete(complete(`t${i}`))
  }
}
const inspect = ($: Engine, tab: string) => $.command.run({ command: 'inspect', args: tab, origin: { kind: 'composer' }, presentation: PRESENTATION })
const failing = (on: On) => on('tool.call', (_, e) => (e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: 'ok', text: 'ok' }))
const tabRows = async ($: Engine, surface: RenderSurface, columns: number) =>
  (await rowsOf(await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: columns } })))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a Timeline at 40 columns ends at a whole column (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['tool.call'])
    failing(on)
    await turns($, 2)
    await inspect($, 'timeline')
    const lines = await tabRows($, surface, 40)
    const head = lines.findIndex(l => l.startsWith('#'))
    expect(lines[head]?.trimEnd()).toBe('#   you     Claude   took')
    for (const l of lines.slice(head)) {
      expect([...l].length <= 40).toBe(true)
      expect(l.includes(' / ')).toBe(false)
    }
  })

  test(`a Tools table at 40 columns ends at a whole column (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['tool.call'])
    failing(on)
    await turns($, 1)
    await inspect($, 'tools')
    const lines = await tabRows($, surface, 40)
    const head = lines.find(l => l.startsWith('Tools'))
    expect(head).toBe(`${'Tools'.padEnd(24)}${'calls'.padStart(6)}${'ok'.padStart(5)}${'✗'.padStart(5)}`)
    expect(lines.find(l => l.startsWith('Bash'))).toBe(`${'Bash'.padEnd(24)}${'1'.padStart(6)}${'0'.padStart(5)}${'1'.padStart(5)}`)
  })

  test(`a CJK tool name keeps the Tools row on one line (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    // An MCP tool counts under its server's name, here 31 code points
    const name = 'mcp: 検索サーバーと全文検索ツールの長い日本語の名前です'
    await $.tool.call({ tool: 'mcp__検索サーバーと全文検索ツールの長い日本語の名前です__search', query: 'x' } as never)
    await inspect($, 'tools')
    const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: 80 } })
    const tree = await ui.drawn()
    const row = lineBoxes(tree).find(l => textOf(l).startsWith(name))
    expect(row === undefined).toBe(false)
    const cell = pieces(row!)[0]!
    expect(cell.props).toMatchObject({ width: 24, flexShrink: 0 })
    expect((cell.children ?? []).filter(isDrawn)[0]?.props).toMatchObject({ wrap: 'truncate-end' })
    expect(spills(tree)).toEqual([])
  })

  test(`a pane narrowed from 120 to 40 drops whole Timeline columns (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['tool.call'])
    failing(on)
    await turns($, 2)
    await inspect($, 'timeline')
    const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: 120 } })
    expect((await rowsOf(ui)).find(l => l.startsWith('#'))?.trimEnd()).toBe('#   you     Claude   took     in / out      tools   ✗')
    await ui.redraw({ ...PANE, bodyColumns: 40 })
    expect((await rowsOf(ui)).find(l => l.startsWith('#'))?.trimEnd()).toBe('#   you     Claude   took')
  })

  test(`a Show button at the end of a row that does not fit is left out whole (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    fitPane(on, [[{ text: 'x'.repeat(50) }, { text: ' ' }, { button: { key: 'show-1', label: 'Show' } }]])
    const line = lineBoxes(await (await mountFit($, surface, 40)).drawn())[0]!
    expect(pieces(line).some(p => p.type === 'Button')).toBe(false)
    expect(pieces(line)[0]?.props).toMatchObject({ width: 40 })
  })

  test(`a button that fits keeps its place after the text (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    fitPane(on, [[{ text: 'short' }, { text: ' ' }, { button: { key: 'show-1', label: 'Show' } }]])
    const line = lineBoxes(await (await mountFit($, surface, 40)).drawn())[0]!
    expect(pieces(line).map(p => p.type)).toEqual(['Box', 'Box', 'Button'])
  })

  test(`a long text line truncates with an ellipsis as today (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    fitPane(on, [[{ text: 'word '.repeat(20).trim() }]])
    const line = lineBoxes(await (await mountFit($, surface, 40)).drawn())[0]!
    const [piece] = pieces(line)
    expect(piece?.props).toMatchObject({ width: 40, flexShrink: 0 })
    expect((piece?.children ?? []).filter(isDrawn)[0]?.props).toMatchObject({ wrap: 'truncate-end' })
  })

  test(`a line that is only spaces draws an empty row (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    fitPane(on, [[{ text: 'top' }], [{ text: '   ' }], [{ text: 'bottom' }]])
    const ui = await mountFit($, surface, 40)
    expect((await rowsOf(ui)).map(l => l.trim())).toEqual(['top', '', 'bottom'])
    expect(faults(await ui.drawn(), surface)).toEqual([])
  })

  test(`a pane narrower than the first column truncates that cell (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['tool.call'])
    failing(on)
    await turns($, 1)
    await inspect($, 'tools')
    const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: 20 } })
    const head = lineBoxes(await ui.drawn()).find(l => textOf(l).startsWith('Tools'))!
    expect(pieces(head).length).toBe(1)
    expect(pieces(head)[0]?.props).toMatchObject({ width: 20 })
  })

  test(`a two-column text keeps its gap as a margin, no run of spaces drawn (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    fitPane(on, [[{ text: '  lead   middle  ' }, { text: 'end' }]])
    const ui = await mountFit($, surface, 40)
    expect(await rowsOf(ui)).toEqual(['  lead   middle  end'])
    expect(faults(await ui.drawn(), surface)).toEqual([])
  })
}

test('the per turn chart sits in a Box of its spark length at 40 columns on desktop', async ($, on) => {
  stubAll(on)
  engine(on)
  fitPane(on, [[{ text: 'per turn', width: 10 }, { chart: [10, 20, 30, 40, 50] }]])
  const line = lineBoxes(await (await mountFit($, 'desktop', 40)).drawn())[0]!
  const chart = pieces(line)[1]!
  expect(chart.props).toMatchObject({ width: 5, flexShrink: 0 })
  expect((chart.children ?? []).filter(isDrawn)[0]?.type).toBe('Svg')
})
