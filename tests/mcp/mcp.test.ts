// The MCP state (spec 2026-11-23, D5): the mcp.connect hook marks a server loading, a refusal marks it failed, the tools
// the engine lists settle it connected, and 60 s with none settle a loading one too.
// The kit's `$` carries no `mcp` noun, and a stand-in plugin cannot take the engine's name, so no session test raises the
// engine's own mcp.connect: its hook, trackMcpConnect, is called directly with a `next` that carries the engine as
// origin and a `$` of the test's own (its state and clock), and the servers it leaves loading are seeded as the state
// an earlier run stored in the session tests.
import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { EngineInterface, McpConnectResult, On } from 'claude-code'

import { PRESENTATION, START, emptyState, engine, stubAll } from '../kit'
import { register } from '../../hooks/register'
import { trackMcpConnect } from '../../hooks/mcp/effects'
import { stubTools } from '../transcript-stubs'
import { isEngineRaise, markFailed, markLoading, mcpItem, refusalOf, settle, shortName, toolServers } from '../../hooks/mcp/mcp'
import { EARLY_MS, POLL_MS, SETTLE_MS } from '../../hooks/mcp/constants'
import type { McpServer } from '../../hooks/mcp/types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const PASSED: McpConnectResult = { isConnected: true, server: 'plugin:p:files' }
const REFUSED: McpConnectResult = { isConnected: false, reason: 'auth', message: 'm' }
const SHAPE = 'mcp-2'
// Long enough for a poll in the idle cadence's first minutes
const IDLE_WAIT = POLL_MS * 8

const text = (servers: McpServer[]): string => mcpItem(servers).map(seg => ('text' in seg ? seg.text : '')).join('')
const loading = (name: string, since = NOW): McpServer => ({ name, state: 'loading', since })
const connected = (name: string, since = NOW): McpServer => ({ name, state: 'connected', since })
const seeded = (name: string, since = NOW): McpServer => ({ name, state: 'connected', since, isSeeded: true })

// Another plugin raises mcp.connect as a plugin does, through `$.mcp.connect`, on the command '/dial <server>', which
// answers the result as JSON. The mod's hook sits between the stand-in and the engine, and sees the stand-in's name as
// the origin, not the engine's.
const DIAL: Plugin = {
  name: 'dial-stand-in',
  tier: 'builtin',
  register(on) {
    on('command.run', { command: 'dial' }, async ($, e) => ({ text: JSON.stringify(await $.mcp.connect(e.args)) }))
  },
}
const OPTIONS = { plugins: [DIAL] }
const dial = async ($: Engine, server: string): Promise<McpConnectResult> => {
  const run = await $.command.run({ command: 'dial', args: server, origin: { kind: 'composer' }, presentation: PRESENTATION })
  return JSON.parse(run.text ?? 'null') as McpConnectResult
}

// A session whose atom `mcp` holds `stored` before it starts, as a run that stored it left it: `servers` reads the mod's
// last written list; `tools` is the tool list, changed mid-test
async function begin($: Engine, on: On, o: { tools?: string[]; stored?: McpServer[] } = {}) {
  const kit = stubAll(on, { root: '/work/app', cwd: '/work/app', now: NOW })
  const tools = stubTools(on, o.tools ?? [])
  const state = emptyState(on, ['mcp'], o.stored === undefined ? {} : { mcp: { shape: SHAPE, value: o.stored } })
  const beneath: { answer: McpConnectResult } = { answer: PASSED }
  on('mcp.connect', () => ({ value: beneath.answer }))
  engine(on)
  await $.session.start(START)
  const servers = (): McpServer[] => (state.get('mcp') as McpServer[] | undefined) ?? o.stored ?? []
  return { kit, tools, state, beneath, servers }
}

// A `$` of the test's own: the atom's state and the clock, every other call answering nothing. `stored` is the atom's
// value before the call (undefined reads as a state a /clear emptied).
function stateEngine(stored: McpServer[] | undefined) {
  let kept: unknown = stored === undefined ? undefined : { shape: SHAPE, value: stored }
  let version = 0
  const fake = {
    state: {
      get: async () => ({ value: kept, version }),
      set: async (_ref: unknown, next: unknown) => {
        kept = next
        return { isSet: true, version: ++version }
      },
    },
    clock: { now: async () => NOW },
  }
  return { $: fake as unknown as EngineInterface, servers: (): McpServer[] => (kept as { value: McpServer[] } | undefined)?.value ?? [] }
}
type EngineNext = Parameters<typeof trackMcpConnect>[2]
const raisedBy = (origin: { plugin: string; tier: string }, answer: { value?: McpConnectResult; deny?: string }): EngineNext =>
  Object.assign(async () => answer, { origin }) as never
const ENGINE = { plugin: 'engine', tier: 'core' }
const connect = (server: string) => ({ server }) as never

test('the engine\'s own raise marks the server loading and returns the answer untouched', async () => {
  const { $, servers } = stateEngine([])
  const answer = { value: PASSED }
  expect(await trackMcpConnect($, connect('unit-pass'), raisedBy(ENGINE, answer))).toBe(answer)
  expect(servers().find(s => s.name === 'unit-pass')).toEqual(loading('unit-pass'))
})

test('the engine\'s raise a refusal answers marks the server failed with its reason, the answer untouched', async () => {
  const { $, servers } = stateEngine([])
  const answer = { value: REFUSED }
  expect(await trackMcpConnect($, connect('unit-refused'), raisedBy(ENGINE, answer))).toBe(answer)
  expect(servers().find(s => s.name === 'unit-refused')).toEqual({ name: 'unit-refused', state: 'failed', reason: 'auth', since: NOW })
})

test('the engine\'s raise a hook beneath denied marks the server failed as denied, the answer untouched', async () => {
  const { $, servers } = stateEngine([])
  const answer = { deny: 'policy' }
  expect(await trackMcpConnect($, connect('unit-denied'), raisedBy(ENGINE, answer))).toBe(answer)
  expect(servers().find(s => s.name === 'unit-denied')).toEqual({ name: 'unit-denied', state: 'failed', reason: 'denied', since: NOW })
})

test('a raise from another plugin writes nothing, and its answer passes on untouched', async () => {
  const { $, servers } = stateEngine([])
  const answer = { value: REFUSED }
  expect(await trackMcpConnect($, connect('unit-other'), raisedBy({ plugin: 'other', tier: 'builtin' }, answer))).toBe(answer)
  expect(servers().find(s => s.name === 'unit-other')).toBeUndefined()
})

// A `register` call with a recording `on`: the events the module wires, in order
function wiredEvents(options: Record<string, unknown>): string[] {
  const events: string[] = []
  const on = (event: string) => {
    events.push(event)
    return { catch: () => undefined }
  }
  register(on as never, options as never)
  return events
}

test('the mcp.connect hook is wired by default and left out with leave_out_skipped_hooks', () => {
  expect(wiredEvents({})).toContain('mcp.connect')
  expect(wiredEvents({ leave_out_skipped_hooks: true })).not.toContain('mcp.connect')
})

test('a raise from another plugin is not counted, and its answer passes on untouched', OPTIONS, async ($, on) => {
  const { beneath, servers } = await begin($, on)
  expect(await dial($, 'files')).toEqual(PASSED)
  beneath.answer = REFUSED
  expect(await dial($, 'files')).toEqual(REFUSED)
  expect(servers()).toEqual([])
})

test('only the engine\'s own raise counts', () => {
  expect(isEngineRaise({ plugin: 'engine' })).toBe(true)
  expect(isEngineRaise({ plugin: 'other' })).toBe(false)
})

test('a loading server is shown as loading', () => {
  expect(text([loading('plugin:p:files')])).toBe('mcp ◐ 0/1')
})

test('a refusal marks failed with its reason, any other answer leaves it loading', () => {
  expect(refusalOf({ value: REFUSED })).toBe('auth')
  expect(refusalOf({ value: PASSED })).toBeNull()
  expect(refusalOf({ deny: 'policy' })).toBe('denied')
  const failed = markFailed(markLoading([], 'plugin:p:files', NOW), 'plugin:p:files', 'auth')
  expect(failed).toEqual([{ name: 'plugin:p:files', state: 'failed', reason: 'auth', since: NOW }])
  expect(text(failed)).toBe('mcp ✗ 1 · ✓ 0')
})

test('tools showing settle connected', async ($, on) => {
  const { kit, tools, servers } = await begin($, on, { stored: [loading('plugin:p:files')] })
  tools.names = ['Bash', 'mcp__files__read']
  await kit.clock.advance(POLL_MS + 1000)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('60 s with no tools settles a loading server connected', async ($, on) => {
  const { kit, servers } = await begin($, on, { stored: [loading('plugin:p:files')] })
  await kit.clock.advance(SETTLE_MS - 10_000)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['loading'])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('a tool list that refuses leaves the server loading until it settles by time', async ($, on) => {
  const { kit, tools, servers } = await begin($, on, { stored: [loading('plugin:p:files')] })
  tools.refuse = true
  await kit.clock.advance(POLL_MS * 2)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['loading'])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
})

test('a failed server recovers once its tools show, and time alone never settles it', async ($, on) => {
  const failed: McpServer = { name: 'plugin:p:files', state: 'failed', reason: 'auth', since: NOW }
  const { kit, tools, servers } = await begin($, on, { stored: [failed] })
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(servers()).toEqual([failed])
  tools.names = ['mcp__files__read']
  await kit.clock.advance(IDLE_WAIT)
  await kit.clock.settle()
  expect(servers()).toEqual([{ name: 'plugin:p:files', state: 'connected', since: NOW }])
})

test('the seed marks connected', async ($, on) => {
  const { servers } = await begin($, on, { tools: ['Read', 'mcp__github__x'] })
  expect(servers().map(s => [s.name, s.state])).toEqual([['github', 'connected']])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('same short name from two plugins counts twice', () => {
  const servers = markLoading(markLoading([], 'plugin:a:files', NOW), 'plugin:b:files', NOW)
  expect(servers).toHaveLength(2)
  expect(text(servers)).toBe('mcp ◐ 0/2')
})

test('an event replaces the connected entry the tool list seeded under its short name', () => {
  const servers = markLoading([seeded('files'), seeded('github')], 'plugin:p:files', NOW + 5)
  expect(servers).toEqual([loading('plugin:p:files', NOW + 5), seeded('github')])
  expect(markLoading([seeded('files')], 'files', NOW + 5)).toEqual([loading('files', NOW + 5)])
  expect(markLoading([loading('files')], 'plugin:p:files', NOW + 5)).toHaveLength(2)
})

test('two events whose names share a short name are two servers, in either order', () => {
  const settled: McpServer[] = [connected('files')]
  expect(markLoading(settled, 'plugin:p:files', NOW + 5)).toEqual([connected('files'), loading('plugin:p:files', NOW + 5)])
  expect(markLoading([connected('plugin:p:files')], 'files', NOW + 5)).toEqual([connected('plugin:p:files'), loading('files', NOW + 5)])
  const afterSeed = markLoading(markLoading([seeded('files')], 'plugin:p:files', NOW + 5), 'files', NOW + 6)
  expect(afterSeed).toEqual([loading('plugin:p:files', NOW + 5), loading('files', NOW + 6)])
})

test('the tool list marks the servers it adds as seeded, and a settled seed stays seeded', () => {
  expect(settle([], ['files'], NOW)).toEqual([seeded('files')])
  expect(settle([{ ...seeded('files'), state: 'failed' }], ['files'], NOW)).toEqual([seeded('files')])
})

test('a server name is never drawn', () => {
  const servers: McpServer[] = [{ name: 'plugin:p:files', state: 'failed', reason: 'auth', since: 0 }, connected('files')]
  expect(text(servers)).not.toContain('files')
  expect(text(servers)).not.toContain('plugin')
})

test('a tool server that no event named counts as connected beside the loading one', async ($, on) => {
  const { kit, tools, servers } = await begin($, on, { stored: [loading('plugin:p:files')] })
  tools.names = ['mcp__github__x']
  await kit.clock.advance(POLL_MS + 1000)
  await kit.clock.settle()
  expect(servers().map(s => [s.name, s.state])).toEqual([['plugin:p:files', 'loading'], ['github', 'connected']])
  expect(text(servers())).toBe('mcp ◐ 1/2')
})

// A loading server whose event is in the future never settles by time, so the cadence past EARLY_MS is the loading one
test('past the first 2 minutes the tool list is read every 5 s while a server loads', async ($, on) => {
  const hot = await begin($, on, { stored: [loading('plugin:p:files', NOW + 3_600_000)] })
  await hot.kit.clock.advance(EARLY_MS + POLL_MS)
  await hot.kit.clock.settle()
  const hotBefore = hot.tools.calls
  await hot.kit.clock.advance(20_000)
  await hot.kit.clock.settle()
  expect(hot.tools.calls - hotBefore).toBeGreaterThanOrEqual(3)
  expect(hot.tools.calls - hotBefore).toBeLessThanOrEqual(5)
})

test('past the first 2 minutes a list with no loading server is read every 30 s', async ($, on) => {
  const { kit, tools } = await begin($, on, { stored: [connected('plugin:p:files')], tools: ['mcp__files__x'] })
  await kit.clock.advance(EARLY_MS + POLL_MS)
  await kit.clock.settle()
  const before = tools.calls
  await kit.clock.advance(60_000)
  await kit.clock.settle()
  expect(tools.calls - before).toBeGreaterThanOrEqual(1)
  expect(tools.calls - before).toBeLessThanOrEqual(3)
})

test('a /clear empties the atom and the start-over writes the servers back', async ($, on) => {
  const stored = [connected('plugin:p:files'), loading('github', NOW + 3_600_000)]
  const { kit, state } = await begin($, on, { stored })
  state.empty()
  expect(state.get('mcp')).toBeUndefined()
  await $.classic.SessionStart({ source: 'clear' } as never)
  await kit.clock.settle()
  expect(state.get('mcp')).toEqual(stored)
})

test('with the option on the seed still serves', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { state } = await begin($, on, { tools: ['mcp__github__x'] })
  expect((state.get('mcp') as McpServer[]).map(s => [s.name, s.state])).toEqual([['github', 'connected']])
})

test('a tick that begins as a start-over empties the atom keeps the failed and loading servers', async ($, on) => {
  const failed: McpServer = { name: 'plugin:p:files', state: 'failed', reason: 'auth', since: NOW }
  const { kit, tools, state } = await begin($, on, { stored: [failed, loading('plugin:p:db', NOW + 3_600_000)], tools: [] })
  state.empty()
  tools.names = ['mcp__github__x']
  await kit.clock.advance(POLL_MS + 1000)
  await kit.clock.settle()
  expect((state.get('mcp') as McpServer[]).map(s => [s.name, s.state])).toEqual([
    ['plugin:p:files', 'failed'], ['plugin:p:db', 'loading'], ['github', 'connected'],
  ])
})

test('shortName takes the last colon part and reads other characters as underscores', () => {
  expect(shortName('plugin:p:files')).toBe('files')
  expect(shortName('claude.ai Gmail')).toBe('claude_ai_Gmail')
  expect(shortName('a-b_c')).toBe('a-b_c')
})

test('toolServers takes the part between mcp__ and the next __, only where mcp is true', () => {
  const tools = [
    { name: 'mcp__files__read', mcp: true }, { name: 'mcp__files__write', mcp: true }, { name: 'mcp__github__x__y', mcp: true },
    { name: 'mcp__fake__x', mcp: false }, { name: 'Bash', mcp: false }, { name: 'mcp__odd', mcp: true },
  ]
  expect(toolServers(tools)).toEqual(['files', 'github'])
})

test('settle matches both spellings of a plugin server and adds a stranger as connected', () => {
  const full = settle([loading('plugin:p:files', 1000)], ['plugin_p_files'], 2000)
  expect(full.map(s => s.state)).toEqual(['connected'])
  const short = settle([loading('plugin:p:files', 1000)], ['files', 'github'], 2000)
  expect(short.map(s => [s.name, s.state])).toEqual([['plugin:p:files', 'connected'], ['github', 'connected']])
  const failed: McpServer = { name: 'x', state: 'failed', reason: 'auth', since: 1000 }
  expect(settle([failed], [], SETTLE_MS * 2)).toEqual([failed])
  expect(settle([failed], ['x'], 2000)).toEqual([{ name: 'x', state: 'connected', since: 1000 }])
})

test('mcpItem is none for an empty list, and a loading server wins over a failed one', () => {
  expect(mcpItem([])).toEqual([])
  const servers: McpServer[] = [
    { name: 'a', state: 'failed', reason: 'auth', since: 0 }, { name: 'b', state: 'loading', since: 0 }, { name: 'c', state: 'connected', since: 0 },
  ]
  expect(mcpItem(servers)).toEqual([{ text: 'mcp ◐ 1/3', tone: 'warn' }])
})
