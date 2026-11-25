// The MCP state's read of a loading server (spec 2026-11-23, D5): the engine's raise answers connected before it dials,
// so a server that then fails to start would read connected. `$.mcp.connect` on a listed server never dials: it answers
// the server's state, once its dial settles. Measured on Claude Code 2.1.331: a server whose command is missing answers
// `failed` at once, a server slow to start holds the answer until it is up.
import { expect, test } from 'claude-code/testing'
import type { McpConnectResult } from 'claude-code'

import { markPassed, markRead, readOutcome, serversToRead, settle } from '../../hooks/mcp/mcp'
import { POLL_MS, SETTLE_MS } from '../../hooks/mcp/constants'
import type { McpServer } from '../../hooks/mcp/types'
import { NOW, begin, connected, loading, seeded, text } from '../mcp-session'

const FAILED: McpConnectResult = { isConnected: false, reason: 'failed', message: 'The MCP server did not connect.' }
const UP: McpConnectResult = { isConnected: true, server: 'plugin:p:files' }
const POLL = POLL_MS + 1000
// A test that drives minutes of 1 s ticks: the Windows runner is several times slower on them
const LONG = { timeoutMs: 30_000 }
const NONE = new Map<string, number>()
// A loading server whose raise passed the hooks beneath unrefused: the only kind the mod reads
const passed = (name: string, since = NOW): McpServer => ({ ...loading(name, since), isPassed: true })

test('a loading server whose state read answers failed shows failed, not connected after 60 s', LONG, async ($, on) => {
  const { kit, servers } = await begin($, on, { stored: [passed('plugin:p:files')], read: FAILED })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([{ name: 'plugin:p:files', state: 'failed', reason: 'failed', since: NOW }])
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✗ 1 · ✓ 0')
})

test('a loading server whose state read answers connected shows connected with no tools and before 60 s', async ($, on) => {
  const { kit, servers } = await begin($, on, { stored: [passed('plugin:p:files')], read: UP })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([connected('plugin:p:files')])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('a state read with no answer yet keeps the server loading past 60 s, is not asked again, and marks it on its answer', LONG, async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [passed('plugin:p:files')], read: UP, lateMs: SETTLE_MS * 3 })
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(servers()).toEqual([passed('plugin:p:files')])
  expect(text(servers())).toBe('mcp ◐ 0/1')
  expect(beneath.reads).toBe(1)
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(servers()).toEqual([connected('plugin:p:files')])
})

test('a seeded, connected or failed server is never read', async ($, on) => {
  const failed: McpServer = { name: 'plugin:p:db', state: 'failed', reason: 'auth', since: NOW }
  const { kit, beneath } = await begin($, on, { stored: [seeded('github'), connected('plugin:p:files'), failed], tools: ['mcp__github__x'], read: UP })
  await kit.clock.advance(POLL * 4)
  await kit.clock.settle()
  expect(beneath.reads).toBe(0)
})

test('a read the engine refuses leaves the server loading, to settle by tools or to leave the count at 60 s', LONG, async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [passed('plugin:p:files')], read: 'refused' })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([passed('plugin:p:files')])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers()).toEqual([])
  expect(beneath.reads).toBe(1)
})

test('a server the read answers unlisted, with no tools, is not counted beside the connected ones', LONG, async ($, on) => {
  const unlisted: McpConnectResult = { isConnected: false, reason: 'unlisted', message: 'No server of that name is listed.' }
  const { kit, servers } = await begin($, on, { stored: [passed('computer-use'), connected('admtools'), connected('easel')], read: unlisted })
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 2')
})

test('readOutcome takes only the reasons that tell the server\'s own state; a refusal of the read tells nothing', () => {
  expect(readOutcome(UP)).toEqual({ state: 'connected' })
  expect(readOutcome(FAILED)).toEqual({ state: 'failed', reason: 'failed' })
  expect(readOutcome({ isConnected: false, reason: 'auth', message: 'm' })).toEqual({ state: 'failed', reason: 'auth' })
  expect(readOutcome({ isConnected: false, reason: 'disabled', message: 'm' })).toEqual({ state: 'failed', reason: 'disabled' })
  expect(readOutcome({ isConnected: false, reason: 'policy', message: 'm' })).toBeNull()
  expect(readOutcome({ isConnected: false, reason: 'unlisted', message: 'm' })).toBeNull()
})

test('markRead marks only the server still loading from the raise the read began under', () => {
  const failed = { state: 'failed', reason: 'failed' } as const
  expect(markRead([loading('a', 10)], 'a', 10, failed)).toEqual([{ name: 'a', state: 'failed', reason: 'failed', since: 10 }])
  expect(markRead([loading('a', 20)], 'a', 10, failed)).toEqual([loading('a', 20)])
  expect(markRead([connected('a', 10)], 'a', 10, failed)).toEqual([connected('a', 10)])
  expect(markRead([loading('a', 10), loading('b', 10)], 'b', 10, { state: 'connected' })).toEqual([loading('a', 10), connected('b', 10)])
})

test('settle drops a loading server never read once its time is up: refused under its own raise, or not yet passed the hooks beneath', () => {
  const late = NOW + SETTLE_MS
  expect(settle([passed('a'), passed('b')], [], late, new Map([['b', NOW]]))).toEqual([passed('a')])
  expect(settle([passed('a')], [], late, new Map([['a', NOW - 1]]))).toEqual([passed('a')])
  expect(settle([loading('c')], [], late, NONE)).toEqual([])
  expect(settle([passed('d')], [], late, null)).toEqual([])
  expect(settle([loading('c')], [], late - 1, NONE)).toEqual([loading('c')])
  expect(settle([loading('c')], ['c'], late, NONE)).toEqual([connected('c')])
})

test('a loading server whose raise the hooks beneath have not answered is never read', async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [loading('plugin:p:files')], read: UP })
  await kit.clock.advance(POLL * 3)
  await kit.clock.settle()
  expect(beneath.reads).toBe(0)
  expect(servers()).toEqual([loading('plugin:p:files')])
})

test('with leave_out_skipped_hooks on, no state is read, and a passed server left loading is dropped by time', { ...LONG, options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [passed('plugin:p:files')], read: UP })
  await kit.clock.advance(POLL * 3)
  await kit.clock.settle()
  expect(beneath.reads).toBe(0)
  expect(servers()).toEqual([passed('plugin:p:files')])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers()).toEqual([])
})

test('serversToRead takes passed loading servers only, and a refusal under an older raise does not stop a newer one', () => {
  const failed: McpServer = { name: 'd', state: 'failed', reason: 'auth', since: NOW }
  const all = [passed('a'), loading('b'), { ...seeded('c'), state: 'loading' as const }, failed, passed('e')]
  expect(serversToRead(all, new Set(['e']), NONE).map(s => s.name)).toEqual(['a'])
  expect(serversToRead([passed('a', NOW + 5)], new Set(), new Map([['a', NOW]])).map(s => s.name)).toEqual(['a'])
  expect(serversToRead([passed('a')], new Set(), new Map([['a', NOW]]))).toEqual([])
})

test('markPassed marks only the server still loading from that raise', () => {
  expect(markPassed([loading('a', 10)], 'a', 10)).toEqual([passed('a', 10)])
  expect(markPassed([loading('a', 20)], 'a', 10)).toEqual([loading('a', 20)])
  expect(markPassed([connected('a', 10)], 'a', 10)).toEqual([connected('a', 10)])
})

test('a server whose state read answers disabled leaves the count, and 60 s do not bring it back', LONG, async ($, on) => {
  const off: McpConnectResult = { isConnected: false, reason: 'disabled', message: 'The MCP server is turned off.' }
  const { kit, servers } = await begin($, on, { stored: [passed('computer-use'), connected('plugin:p:files')], read: off })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 1')
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(servers()).toEqual([connected('plugin:p:files')])
})
