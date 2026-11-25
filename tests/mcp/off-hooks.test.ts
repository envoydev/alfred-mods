// A server Claude Code's records say is off leaves the band's MCP count at the next read of the tool list, also when it
// is turned off in the middle of the session
import { expect, test } from 'claude-code/testing'

import { POLL_MS } from '../../hooks/mcp/constants'
import { begin, connected, loading, text } from '../mcp-session'

const CONFIG = '/cfg/.claude.json'
const configOf = (entry: Record<string, unknown>, mtimeMs = 1) => ({ text: JSON.stringify({ projects: { '/work/app': entry } }), mtimeMs })
const POLL = POLL_MS + 1000
const ENV = { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' }

test('a server the project disabled is not counted, nor computer-use while it is not opted in', async ($, on) => {
  const { kit, servers } = await begin($, on, {
    stored: [connected('admtools'), connected('easel'), connected('offsrv'), loading('computer-use')], tools: ['mcp__admtools__a', 'mcp__easel__b'],
    kit: { env: ENV, files: { [CONFIG]: configOf({ disabledMcpServers: ['offsrv'] }) } },
  })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 2')
})

test('a server turned off mid-session leaves the count once the config changes and its tools go', async ($, on) => {
  const { kit, tools, servers } = await begin($, on, {
    stored: [connected('admtools'), connected('easel')], tools: ['mcp__admtools__a', 'mcp__easel__b'],
    kit: { env: ENV, files: { [CONFIG]: configOf({}) } },
  })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 2')
  kit.files.current[CONFIG] = configOf({ disabledMcpServers: ['easel'] }, 2)
  tools.names = ['mcp__admtools__a']
  await kit.clock.advance(POLL * 7)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 1')
})

test('a .mcp.json server a settings file rejects is not counted', async ($, on) => {
  const { kit, servers } = await begin($, on, {
    stored: [connected('admtools'), connected('db')], tools: ['mcp__admtools__a'],
    kit: { env: ENV, sources: { local: { disabledMcpjsonServers: ['db'] } } },
  })
  await kit.clock.advance(POLL)
  await kit.clock.settle()
  expect(text(servers())).toBe('mcp ✓ 1')
})
