// The MCP state (spec 2026-11-23, D5): the mcp.connect hook marks a server loading, a refusal marks it failed, the tools
// the engine lists settle it connected, and 60 s with none settle it too
import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { McpConnectResult, On } from 'claude-code'

import { PRESENTATION, START, engine, stubAll, watchState } from '../kit'
import { stubTools } from '../transcript-stubs'
import { mcpItem, settle, shortName, toolServers } from '../../hooks/mcp/mcp'
import { POLL_MS, SETTLE_MS } from '../../hooks/mcp/constants'
import type { McpServer } from '../../hooks/mcp/types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const PASSED: McpConnectResult = { isConnected: true, server: 'plugin:p:files' }
const REFUSED: McpConnectResult = { isConnected: false, reason: 'auth', message: 'm' }

const text = (servers: McpServer[]): string => mcpItem(servers).map(seg => ('text' in seg ? seg.text : '')).join('')

type Beneath = { answer: McpConnectResult | { deny: string } }

// The kit's `$` raises no mcp.connect, so a stand-in plugin raises it as a plugin does, through `$.mcp.connect`, on the
// command '/dial <server>', which answers the result as JSON. The mod's hook sits between the stand-in and the engine.
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

// A session whose engine answers mcp.connect with `beneath.answer`; `servers` reads the mod's last written state
async function begin($: Engine, on: On, o: { tools?: string[] } = {}) {
  const kit = stubAll(on, { root: '/work/app', cwd: '/work/app', now: NOW })
  const tools = stubTools(on, o.tools ?? [])
  const state = watchState(on)
  const beneath: Beneath = { answer: PASSED }
  on('mcp.connect', () => ('deny' in beneath.answer ? beneath.answer : { value: beneath.answer }))
  engine(on)
  await $.session.start(START)
  const servers = (): McpServer[] => (state.get('mcp') as McpServer[] | undefined) ?? []
  return { kit, tools, beneath, servers }
}

test('an event marks loading and a passing answer keeps it', OPTIONS, async ($, on) => {
  const { servers } = await begin($, on)
  await dial($, 'plugin:p:files')
  expect(servers().map(s => [s.name, s.state])).toEqual([['plugin:p:files', 'loading']])
  expect(servers()[0]?.since).toBe(NOW)
  expect(text(servers())).toBe('mcp ◐ 0/1')
})

test('a refusal marks failed', OPTIONS, async ($, on) => {
  const { beneath, servers } = await begin($, on)
  beneath.answer = REFUSED
  await dial($, 'plugin:p:files')
  expect(servers()).toMatchObject([{ name: 'plugin:p:files', state: 'failed', reason: 'auth' }])
  expect(text(servers())).toBe('mcp ✗ 1 · ✓ 0')
})

test('tools showing settle connected', OPTIONS, async ($, on) => {
  const { kit, tools, servers } = await begin($, on)
  await dial($, 'plugin:p:files')
  tools.names = ['Bash', 'mcp__files__read']
  await kit.clock.advance(POLL_MS + 1000)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('60 s with no tools settles connected', OPTIONS, async ($, on) => {
  const { kit, servers } = await begin($, on)
  await dial($, 'plugin:p:files')
  await kit.clock.advance(SETTLE_MS - 10_000)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['loading'])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('a tool list that refuses leaves the server loading until it settles by time', OPTIONS, async ($, on) => {
  const { kit, tools, servers } = await begin($, on)
  tools.refuse = true
  await dial($, 'plugin:p:files')
  await kit.clock.advance(POLL_MS * 2)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['loading'])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers().map(s => s.state)).toEqual(['connected'])
})

test('the answer passes on untouched', OPTIONS, async ($, on) => {
  const { beneath } = await begin($, on)
  const refusal = { ...REFUSED }
  beneath.answer = refusal
  expect(await dial($, 'plugin:p:files')).toEqual(refusal)
  beneath.answer = PASSED
  expect(await dial($, 'plugin:p:files')).toEqual(PASSED)
})

test('with every state read and write refused, the answer beneath still comes back', OPTIONS, async ($, on) => {
  const refuse = { isOn: false }
  on('state.get', (_, e, next) => (refuse.isOn ? { deny: 'test: state read refused' } : next(e)))
  on('state.set', (_, e, next) => (refuse.isOn ? { deny: 'test: state write refused' } : next(e)))
  stubAll(on, { root: '/work/app', cwd: '/work/app', now: NOW })
  stubTools(on)
  on('mcp.connect', () => ({ value: REFUSED }))
  engine(on)
  await $.session.start(START)
  refuse.isOn = true
  expect(await dial($, 'plugin:p:files')).toEqual(REFUSED)
})

test('a hook beneath that denies the connect marks the server failed', OPTIONS, async ($, on) => {
  const { beneath, servers } = await begin($, on)
  beneath.answer = { deny: 'policy' }
  await dial($, 'plugin:p:files').catch(() => undefined)
  expect(servers().map(s => [s.state, s.reason])).toEqual([['failed', 'denied']])
})

test('the seed marks connected', OPTIONS, async ($, on) => {
  const { servers } = await begin($, on, { tools: ['Read', 'mcp__github__x'] })
  expect(servers().map(s => [s.name, s.state])).toEqual([['github', 'connected']])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('same short name from two plugins counts twice', OPTIONS, async ($, on) => {
  const { servers } = await begin($, on)
  await dial($, 'plugin:a:files')
  await dial($, 'plugin:b:files')
  expect(servers()).toHaveLength(2)
  expect(text(servers())).toBe('mcp ◐ 0/2')
})

test('a server name is never drawn', OPTIONS, async ($, on) => {
  const { beneath, servers } = await begin($, on)
  beneath.answer = REFUSED
  await dial($, 'plugin:p:files')
  await dial($, 'files')
  expect(text(servers())).not.toContain('files')
  expect(text(servers())).not.toContain('plugin')
})

test('a tool server that no event named counts as connected beside the loading one', OPTIONS, async ($, on) => {
  const { kit, tools, servers } = await begin($, on)
  await dial($, 'plugin:p:files')
  tools.names = ['mcp__github__x']
  await kit.clock.advance(POLL_MS + 1000)
  await kit.clock.settle()
  expect(servers().map(s => [s.name, s.state])).toEqual([['plugin:p:files', 'loading'], ['github', 'connected']])
  expect(text(servers())).toBe('mcp ◐ 1/2')
})

test('a polled list is read every 5 s while a server loads', OPTIONS, async ($, on) => {
  const { kit, tools } = await begin($, on)
  await dial($, 'plugin:p:files')
  const before = tools.calls
  await kit.clock.advance(POLL_MS * 3)
  await kit.clock.settle()
  expect(tools.calls - before).toBeGreaterThanOrEqual(2)
})

test('with the option on the hook is not registered and the seed serves', { plugins: [DIAL], options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const kit = stubAll(on, { root: '/work/app', cwd: '/work/app', now: NOW })
  stubTools(on, ['mcp__github__x'])
  const state = watchState(on)
  let raised = 0
  on('mcp.connect', () => {
    raised++
    return { value: PASSED }
  })
  engine(on)
  await $.session.start(START)
  await dial($, 'plugin:p:files')
  await kit.clock.settle()
  const servers = (state.get('mcp') as McpServer[]).map(s => [s.name, s.state])
  expect(servers).toEqual([['github', 'connected']])
  expect(raised).toBe(1)
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
  const loading = (name: string): McpServer => ({ name, state: 'loading', since: 1000 })
  const full = settle([loading('plugin:p:files')], ['plugin_p_files'], 2000)
  expect(full.map(s => s.state)).toEqual(['connected'])
  const short = settle([loading('plugin:p:files')], ['files', 'github'], 2000)
  expect(short.map(s => [s.name, s.state])).toEqual([['plugin:p:files', 'connected'], ['github', 'connected']])
  const failed: McpServer = { name: 'x', state: 'failed', reason: 'auth', since: 1000 }
  expect(settle([failed], ['x'], SETTLE_MS * 2)).toEqual([failed])
})

test('mcpItem is none for an empty list, and a loading server wins over a failed one', () => {
  expect(mcpItem([])).toEqual([])
  const servers: McpServer[] = [
    { name: 'a', state: 'failed', reason: 'auth', since: 0 }, { name: 'b', state: 'loading', since: 0 }, { name: 'c', state: 'connected', since: 0 },
  ]
  expect(mcpItem(servers)).toEqual([{ text: 'mcp ◐ 1/3', tone: 'warn' }])
})
