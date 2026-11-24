// The MCP state's read of a loading server (spec 2026-11-23, D5): the engine's raise answers connected before it dials,
// so a server that then fails to start would read connected. `$.mcp.connect` on a listed server never dials: it answers
// the server's state, once its dial settles. Measured on Claude Code 2.1.331: a server whose command is missing answers
// `failed` at once, a server slow to start holds the answer until it is up.
import { expect, test } from 'claude-code/testing'
import type { McpConnectResult } from 'claude-code'

import { markRead, readOutcome, settle } from '../../hooks/mcp/mcp'
import { POLL_MS, SETTLE_MS } from '../../hooks/mcp/constants'
import type { McpServer } from '../../hooks/mcp/types'
import { NOW, begin, connected, loading, seeded, text } from '../mcp-session'

const FAILED: McpConnectResult = { isConnected: false, reason: 'failed', message: 'The MCP server did not connect.' }
const UP: McpConnectResult = { isConnected: true, server: 'plugin:p:files' }
const POLL = POLL_MS + 1000

test('a loading server whose state read answers failed shows failed, not connected after 60 s', async ($, on) => {
  const { kit, servers } = await begin($, on, { stored: [loading('plugin:p:files')], read: FAILED })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([{ name: 'plugin:p:files', state: 'failed', reason: 'failed', since: NOW }])
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✗ 1 · ✓ 0')
})

test('a loading server whose state read answers connected shows connected with no tools and before 60 s', async ($, on) => {
  const { kit, servers } = await begin($, on, { stored: [loading('plugin:p:files')], read: UP })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([connected('plugin:p:files')])
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('a state read with no answer yet keeps the server loading past 60 s, is not asked again, and marks it on its answer', async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [loading('plugin:p:files')], read: UP, lateMs: SETTLE_MS * 3 })
  await kit.clock.advance(SETTLE_MS * 2)
  await kit.clock.settle()
  expect(servers()).toEqual([loading('plugin:p:files')])
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

test('a read the engine refuses leaves the server loading, to settle by tools or by 60 s', async ($, on) => {
  const { kit, beneath, servers } = await begin($, on, { stored: [loading('plugin:p:files')], read: 'refused' })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(servers()).toEqual([loading('plugin:p:files')])
  await kit.clock.advance(SETTLE_MS)
  await kit.clock.settle()
  expect(servers()).toEqual([connected('plugin:p:files')])
  expect(beneath.reads).toBe(1)
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

test('settle times out only the loading servers named as unreadable', () => {
  const late = NOW + SETTLE_MS
  expect(settle([loading('a'), loading('b')], [], late, new Set(['b']))).toEqual([loading('a'), connected('b')])
})
