import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement, RenderInput, RenderPropsOf } from 'claude-code'

import type { Line } from '../hooks/band.ts'
import { callLine, groupLines } from '../hooks/compact.ts'
import type { CompactCall } from '../hooks/compact.ts'
import { KEYS } from '../hooks/samples.ts'
import { PRESENTATION, START, engine, rows, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const KEY = KEYS[0]!

const command = ($: Engine, name: string, args: string) => $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const text = (lines: Line[]): string[] => lines.map(l => l.map(s => ('text' in s ? s.text : '')).join(''))

const CALL: CompactCall = { tool: 'Bash', input: {}, output: undefined, isErrored: false, isInterrupted: false, outcome: null, reason: null }
const bash = (input: Record<string, unknown>, more: Partial<CompactCall> = {}): CompactCall => ({ ...CALL, input, ...more })
const read = (file_path: string): CompactCall => ({ ...CALL, tool: 'Read', input: { file_path }, output: { type: 'text' } })
const OUT = (stdout: string, stderr = '') => ({ stdout, stderr, interrupted: false, isImage: false, noOutputExpected: false })
const THIRTY = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')

test('a Bash call draws ⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓', () => {
  const c = bash({ command: 'sed -n 1038,1042p ci.log', description: 'Show CI failure lines 1038-1042' }, { output: OUT(THIRTY) })
  expect(text(callLine(c, 120))).toEqual(['⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓'])
})

test("no description falls back to the command's first 60 characters", () => {
  const long = `sleep 25; gh run list --limit 5 --json status,conclusion,name,headBranch`
  expect(text(callLine(bash({ command: long }, { output: OUT('') }), 120))).toEqual([`⏺ Bash · ${long.slice(0, 59)}… · ✓`])
  expect(text(callLine(bash({ command: 'ls' }, { output: OUT('a\nb') }), 120))).toEqual(['⏺ Bash · ls · 2 lines ✓'])
})

test('a failure draws ✗ exit 1 and up to 3 error lines', () => {
  const c = bash({ command: 'npm test', description: 'Run guard tests' }, {
    isErrored: true, output: 'Exit code 1\nfirst\nsecond\n\nAssertionError: expected blocked (guard-sensitive-data.test.js:425)\nlast',
  })
  expect(text(callLine(c, 120))).toEqual([
    '⏺ Bash · Run guard tests · ✗ exit 1',
    '    second',
    '    AssertionError: expected blocked (guard-sensitive-data.test.js:425)',
    '    last',
  ])
  expect(text(callLine(bash({ command: 'x' }, { isErrored: true, output: 'boom' }), 120))).toEqual(['⏺ Bash · x · ✗', '    boom'])
})

test("a blocked call draws ⊘ blocked: and the reason's first sentence; repeats in a group fold to ×2", () => {
  const blocked = bash({ command: 'sleep 25; gh run list' }, {
    isErrored: true, outcome: 'blocked', reason: 'blocked: use Monitor or run_in_background. Sleeping holds the turn.',
  })
  expect(text(callLine(blocked, 120))).toEqual(['⏺ Bash · sleep 25; gh run list · ⊘ blocked: use Monitor or run_in_background'])
  expect(text(groupLines([blocked, blocked], 120))).toEqual(['⏺ Bash · sleep 25; gh run list · ⊘ blocked: use Monitor or run_in_background ×2'])
  expect(text(callLine(bash({ command: 'rm -rf dist' }, { isErrored: true, outcome: 'denied', reason: 'denied by you' }), 120)))
    .toEqual(['⏺ Bash · rm -rf dist · ⊘ denied by you'])
})

test('four reads draw ⏺ 4 reads · a, b, c ×2 · ✓', () => {
  expect(text(groupLines([read('/w/a'), read('/w/b'), read('/w/c'), read('/w/c')], 120))).toEqual(['⏺ 4 reads · a, b, c ×2 · ✓'])
  // Cut to the row width
  const narrow = text(groupLines([read('/w/habits-scorer-card.test.js'), read('/w/secret-chain.js'), read('/w/layout.js')], 40))[0]!
  expect(narrow.length <= 40).toBe(true)
  expect(narrow.endsWith('… · ✓')).toBe(true)
})

test('a non-text output draws its row without a count', () => {
  expect(text(callLine(read('/w/src/notes.md'), 120))).toEqual(['⏺ Read · notes.md · ✓'])
  expect(text(callLine({ ...CALL, tool: 'Grep', input: { pattern: 'TODO' }, output: { mode: 'files_with_matches', numFiles: 2 } }, 120))).toEqual(['⏺ Grep · TODO · ✓'])
})

test('an interrupted call draws ✗ interrupted', () => {
  expect(text(callLine(bash({ command: 'sleep 60' }, { isErrored: true, isInterrupted: true, output: 'Interrupted' }), 120))).toEqual(['⏺ Bash · sleep 60 · ✗ interrupted'])
})

test('a group draws one callLine per Bash and one reads line per run of reads', () => {
  const lines = groupLines([read('/w/a'), read('/w/b'), bash({ command: 'ls' }, { output: OUT('x') }), read('/w/c')], 120)
  expect(text(lines)).toEqual(['⏺ 2 reads · a, b · ✓', '⏺ Bash · ls · 1 line ✓', '⏺ 1 read · c · ✓'])
})

// Claude Code's own drawing of each site, beneath the mod: the props it was handed, as JSON
function sites(on: On): void {
  const json = (h$: EngineInterface, e: RenderInput): RenderElement => {
    const { Text } = h$.ui.resolve(e)
    return h(Text, null, JSON.stringify(e.props)) as RenderElement
  }
  on('ui.render', { component: 'ToolUse' }, json)
  on('ui.render', { component: 'ToolResult' }, json)
  on('ui.render', { component: 'ToolGroup' }, json)
  on('ui.render', { component: 'AssistantMessage' }, json)
}

async function start($: Engine, on: On, store: Record<string, unknown>, calls?: (e: { tool: string }) => unknown): Promise<ReturnType<typeof stubAll>> {
  const kit = stubAll(on, { env: { HOME: '/Users/jane' }, store })
  sites(on)
  if (calls !== undefined) on('tool.call', (_, e) => calls(e) as never)
  engine(on, calls === undefined ? [] : ['tool.call'])
  await $.session.start(START)
  return kit
}

// What a site drew: the props handed down when Claude Code drew it, else the mod's own lines
async function draw<C extends keyof RenderPropsOf>($: Engine, surface: (typeof SURFACES)[number], component: C, props: RenderPropsOf[C]): Promise<{ props: Record<string, unknown> | null; lines: string[] }> {
  const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component, props, viewport: { columns: 120, rows: 40 } })
  const lines = await rows(ui)
  await ui.unmount()
  const only = lines.length === 1 ? lines[0]! : ''
  return { props: only.startsWith('{') ? JSON.parse(only) as Record<string, unknown> : null, lines }
}

const USE = { tool_use_id: 'c1', isRunning: false, isErrored: false, isInterrupted: false } as const
const BASH_USE = { ...USE, tool: 'Bash', input: { command: 'ls', description: 'List files' }, output: OUT('a\nb') }
const groupCall = (id: string, tool: string, input: unknown, more: object = {}) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, output: { type: 'text' }, ...more })
const QUIET = { 'settings:quiet': true }

for (const surface of SURFACES) {
  test(`with /quiet on, a settled row draws its compact line, and a blocked call its reason (${surface})`, async ($, on) => {
    await start($, on, QUIET, () => ({ deny: 'use Monitor or run_in_background. Sleeping holds the turn.' }))
    expect((await draw($, surface, 'ToolUse', BASH_USE)).lines).toEqual(['⏺ Bash · List files · 2 lines ✓'])
    await $.tool.call({ tool: 'Bash', command: 'sleep 25', tool_use_id: 'b1' })
    const blocked = await draw($, surface, 'ToolUse', { ...USE, tool_use_id: 'b1', tool: 'Bash', input: { command: 'sleep 25' }, isErrored: true, output: 'use Monitor' })
    expect(blocked.lines).toEqual(['⏺ Bash · sleep 25 · ⊘ blocked: use Monitor or run_in_background'])
  })

  // Live, an emptied Write drew 'Wrote 1 line to …' and '(No content)' for three lines written, and an emptied Edit a
  // bare ⎿ (2026-10-28), so their result blocks draw nothing under the compact row
  test(`with /quiet on, a Bash result draws next(e) with its preview emptied, Edit and Write an empty Box, other tools untouched (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const b = await draw($, surface, 'ToolResult', { tool_use_id: 'c1', tool: 'Bash', output: OUT('a\nb', 'warn'), isErrored: false })
    expect(b.props?.output).toEqual(OUT('', ''))
    const editOut = { filePath: '/w/a.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [{ lines: ['-a', '+b'] }], userModified: false, replaceAll: false }
    const edit = await draw($, surface, 'ToolResult', { tool_use_id: 'c2', tool: 'Edit', output: editOut, isErrored: false })
    expect([edit.props, edit.lines.join('')]).toEqual([null, ''])
    const writeOut = { type: 'create', filePath: '/w/b.ts', content: 'x\ny', structuredPatch: [{ lines: ['+x'] }] }
    const write = await draw($, surface, 'ToolResult', { tool_use_id: 'c3', tool: 'Write', output: writeOut, isErrored: false })
    expect([write.props, write.lines.join('')]).toEqual([null, ''])
    const readOut = { type: 'text', file: { filePath: '/w/c.md', content: 'hi', numLines: 1, startLine: 1, totalLines: 1 } }
    expect((await draw($, surface, 'ToolResult', { tool_use_id: 'c4', tool: 'Read', output: readOut, isErrored: false })).props?.output).toEqual(readOut)
  })

  test(`with /quiet on, an errored result draws an empty Box under its compact row, for Bash and for Edit (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    for (const tool of ['Bash', 'Edit']) {
      const failed = await draw($, surface, 'ToolResult', { tool_use_id: 'c1', tool, output: 'Exit code 1\nboom', isErrored: true })
      expect(failed.props).toBe(null)
      expect(failed.lines.join('')).toBe('')
    }
  })

  test(`a group with isCallsOnly true draws one callLine per Bash and one reads line per run of reads (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const calls = [groupCall('g1', 'Read', { file_path: '/w/a.ts' }), groupCall('g2', 'Read', { file_path: '/w/b.ts' }), groupCall('g3', 'Bash', { command: 'ls' }, { output: OUT('x') })]
    const group = await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: true })
    expect(group.lines).toEqual(['⏺ 2 reads · a.ts, b.ts · ✓', '⏺ Bash · ls · 1 line ✓'])
  })

  test(`a group with isCallsOnly false or absent passes next with isExpanded true (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const calls = [groupCall('g1', 'Bash', { command: 'false' }, { isErrored: true, output: 'Exit code 1' })]
    for (const isCallsOnly of [false, undefined]) {
      const group = await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, ...(isCallsOnly === undefined ? {} : { isCallsOnly }) })
      expect(group.props?.isExpanded).toBe(true)
    }
  })

  test(`a marked row arriving expanded is compact, and a group drawn expanded unmarks its calls (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const calls = [groupCall('g1', 'Bash', { command: 'false' }, { isErrored: true, output: 'Exit code 1\nboom' })]
    await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: false })
    const row = { ...USE, tool_use_id: 'g1', tool: 'Bash', input: { command: 'false' }, isErrored: true, output: 'Exit code 1\nboom', isExpanded: true }
    expect((await draw($, surface, 'ToolUse', row)).lines).toEqual(['⏺ Bash · false · ✗ exit 1', '    boom'])
    // ctrl+o on the main screen draws the group expanded: its rows show in full again
    await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: true, isCallsOnly: false })
    expect((await draw($, surface, 'ToolUse', row)).props).toEqual(row)
  })

  // Fullscreen's ctrl+o draws no group, only ToolUse rows over their ToolResults (types, ToolGroup), while an unfolded
  // group draws its rows' output inline with no ToolResult: an expanded result is the sign its row is in that view
  test(`in fullscreen's ctrl+o, a marked row's expanded result unmarks it and redraws, so the row shows in full (${surface})`, async ($, on) => {
    const { invalidates } = await start($, on, QUIET)
    const calls = [groupCall('g1', 'Bash', { command: 'false' }, { isErrored: true, output: 'Exit code 1\nboom' })]
    await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: false })
    const row = { ...USE, tool_use_id: 'g1', tool: 'Bash', input: { command: 'false' }, isErrored: true, output: 'Exit code 1\nboom', isExpanded: true }
    expect((await draw($, surface, 'ToolUse', row)).lines[0]).toBe('⏺ Bash · false · ✗ exit 1')
    const before = invalidates.length
    await draw($, surface, 'ToolResult', { tool_use_id: 'g1', tool: 'Bash', output: 'Exit code 1\nboom', isErrored: true, isExpanded: true })
    expect(invalidates.slice(before)).toEqual(['ui.render'])
    expect((await draw($, surface, 'ToolUse', row)).props).toEqual(row)
    // Back in the normal view the group draws again and marks its calls
    await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: false })
    expect((await draw($, surface, 'ToolUse', row)).lines[0]).toBe('⏺ Bash · false · ✗ exit 1')
  })

  test(`an expanded row or group passes next(e); a running call passes next(e) (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const expanded = { ...BASH_USE, isExpanded: true }
    expect((await draw($, surface, 'ToolUse', expanded)).props).toEqual(expanded)
    const group = { calls: [groupCall('g9', 'Read', { file_path: '/w/a' })], isActive: false, isExpanded: true, isCallsOnly: true }
    expect((await draw($, surface, 'ToolGroup', group)).props).toEqual(group)
    const running = { ...USE, tool: 'Bash', input: { command: 'sleep 9' }, isRunning: true }
    expect((await draw($, surface, 'ToolUse', running)).props).toEqual(running)
    const result = { tool_use_id: 'c1', tool: 'Bash', output: OUT('a'), isErrored: false, isExpanded: true }
    expect((await draw($, surface, 'ToolResult', result)).props).toEqual(result)
  })

  test(`with /quiet off every site passes next(e) (${surface})`, async ($, on) => {
    await start($, on, {})
    expect((await draw($, surface, 'ToolUse', BASH_USE)).props).toEqual(BASH_USE)
    const result = { tool_use_id: 'c1', tool: 'Bash', output: OUT('a'), isErrored: false }
    expect((await draw($, surface, 'ToolResult', result)).props).toEqual(result)
    const group = { calls: [groupCall('g1', 'Read', { file_path: '/w/a' })], isActive: false, isExpanded: false, isCallsOnly: true }
    expect((await draw($, surface, 'ToolGroup', group)).props).toEqual(group)
  })

  test(`/quiet on, then /clear: the first tool row is compact (${surface})`, async ($, on) => {
    await start($, on, {})
    await command($, 'quiet', 'on')
    await $.classic.SessionStart({ source: 'clear' })
    expect((await draw($, surface, 'ToolUse', BASH_USE)).lines).toEqual(['⏺ Bash · List files · 2 lines ✓'])
  })

  test(`REC on and /quiet on: a running row, an expanded row and an MCP result holding a fake key draw ‹key› (${surface})`, async ($, on) => {
    await start($, on, { ...QUIET, 'settings:rec': 'on' })
    const running = await draw($, surface, 'ToolUse', { ...USE, tool: 'Bash', input: { command: `export T=${KEY.text}` }, isRunning: true })
    expect(JSON.stringify(running.props)).toContain('‹key›')
    const expanded = await draw($, surface, 'ToolUse', { ...BASH_USE, output: OUT(KEY.text), isExpanded: true })
    expect(JSON.stringify(expanded.props)).toContain('‹key›')
    const mcp = await draw($, surface, 'ToolResult', { tool_use_id: 'm1', tool: 'mcp__vault__read', output: { secret: KEY.text }, isErrored: false })
    expect(mcp.props?.output).toEqual({ secret: '‹key›' })
    expect(JSON.stringify([running, expanded, mcp])).not.toContain(KEY.text)
  })

  test(`REC on and /quiet on: an active group draws expanded and its rows are marked (${surface})`, async ($, on) => {
    await start($, on, { ...QUIET, 'settings:rec': 'on' })
    const calls = [groupCall('g1', 'Read', { file_path: '/w/a' }), groupCall('g2', 'Bash', { command: 'sleep 9' }, { isRunning: true, output: undefined })]
    expect((await draw($, surface, 'ToolGroup', { calls, isActive: true, isExpanded: false, isCallsOnly: true })).props?.isExpanded).toBe(true)
    const row = { ...USE, tool_use_id: 'g1', tool: 'Read', input: { file_path: '/w/a' }, output: { type: 'text' }, isExpanded: true }
    expect((await draw($, surface, 'ToolUse', row)).lines).toEqual(['⏺ Read · a · ✓'])
  })

  test(`with REC on a compact row whose call holds a fake key draws ‹key› (${surface})`, async ($, on) => {
    await start($, on, { ...QUIET, 'settings:rec': 'on' })
    const row = await draw($, surface, 'ToolUse', { ...USE, tool: 'Bash', input: { command: `export T=${KEY.text}` }, output: OUT('') })
    expect(row.lines).toEqual(['⏺ Bash · export T=‹key› · ✓'])
  })

  test(`a command whose fake key spans the 60-character cut draws ‹key›, never its prefix (${surface})`, async ($, on) => {
    await start($, on, { ...QUIET, 'settings:rec': 'on' })
    const cmd = `echo ${KEY.text} | tee out.txt`
    expect(cmd.length > 60).toBe(true)
    const row = await draw($, surface, 'ToolUse', { ...USE, tool: 'Bash', input: { command: cmd }, output: OUT('') })
    expect(row.lines).toEqual(['⏺ Bash · echo ‹key› | tee out.txt · ✓'])
    expect(row.lines.join('')).not.toContain(KEY.text.slice(0, 8))
  })

  test(`AssistantMessage is never compacted (${surface})`, async ($, on) => {
    await start($, on, QUIET)
    const said = { text: 'Three of the Windows failures reveal a real security gap', isFirstOfReply: true }
    expect((await draw($, surface, 'AssistantMessage', said)).props).toEqual(said)
  })
}
