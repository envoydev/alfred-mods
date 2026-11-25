// The MCP servers turned off, read from Claude Code's own records (code.claude.com/docs/en/mcp, 'Disable a server
// without removing it', and settings-reference, read 2026-11-25): the project's `disabledMcpServers` and
// `enabledMcpServers` in the global config, and `disabledMcpjsonServers` and `deniedMcpServers` in any settings file
import { expect, test } from 'claude-code/testing'

import { offServerNames, withoutOff } from '../../hooks/mcp/off'
import type { McpServer } from '../../hooks/mcp/types'

const ROOT = '/work/app'
const config = (entry: Record<string, unknown>, key = ROOT): string => JSON.stringify({ projects: { [key]: entry, '/work/other': { disabledMcpServers: ['admtools'] } } })
const off = (text: string | null, layers = {}) => [...offServerNames({ configText: text, root: ROOT, layers })].sort()

test("the project's disabledMcpServers are off, another project's are not", () => {
  expect(off(config({ disabledMcpServers: ['files', 'claude.ai Slack'] }))).toEqual(['claude.ai Slack', 'computer-use', 'files'])
})

test('computer-use is off unless the project lists it in enabledMcpServers', () => {
  expect(off(config({}))).toEqual(['computer-use'])
  expect(off(config({ enabledMcpServers: ['computer-use'] }))).toEqual([])
  expect(off(null)).toEqual(['computer-use'])
  expect(off('{ broken')).toEqual(['computer-use'])
})

test('the project key matches with a trailing slash or Windows separators', () => {
  expect(off(config({ disabledMcpServers: ['files'] }, '/work/app/'))).toContain('files')
  const windows = offServerNames({ configText: config({ disabledMcpServers: ['files'] }, 'C:/work/app'), root: 'C:\\work\\app', layers: {} })
  expect([...windows]).toContain('files')
})

test('disabledMcpjsonServers and the names in deniedMcpServers count from any settings file; other entries are ignored', () => {
  const layers = {
    local: { disabledMcpjsonServers: ['db'] }, user: { deniedMcpServers: [{ serverName: 'web' }, { serverUrl: 'https://x/*' }, 'bad'] },
    project: { disabledMcpjsonServers: 'not a list', disabledMcpServers: ['ignored-here'] },
  }
  expect(off(config({ enabledMcpServers: ['computer-use'] }), layers)).toEqual(['db', 'web'])
})

test('withoutOff drops a server named off, matched exactly', () => {
  const servers: McpServer[] = [{ name: 'files', state: 'connected', since: 0 }, { name: 'plugin:p:files', state: 'connected', since: 0 }]
  expect(withoutOff(servers, new Set(['files']), []).map(s => s.name)).toEqual(['plugin:p:files'])
  expect(withoutOff(servers, new Set(), [])).toBe(servers)
})

test('a server whose tools show is kept, whatever the records say: a record the mod could not read must not hide it', () => {
  const servers: McpServer[] = [{ name: 'computer-use', state: 'connected', since: 0 }, { name: 'gone', state: 'connected', since: 0 }]
  expect(withoutOff(servers, new Set(['computer-use', 'gone']), ['computer-use']).map(s => s.name)).toEqual(['computer-use'])
})

test('a server the tool list seeded is matched by its name as a tool spells it', () => {
  const seeded: McpServer[] = [{ name: 'plugin_p_files', state: 'connected', since: 0, isSeeded: true }, { name: 'claude_ai_Slack', state: 'connected', since: 0, isSeeded: true }]
  expect(withoutOff(seeded, new Set(['plugin:p:files', 'claude.ai Slack']), [])).toEqual([])
})

test('a session started in a subfolder takes the nearest project above it', () => {
  const text = JSON.stringify({ projects: { '/work': { disabledMcpServers: ['far'] }, '/work/app': { disabledMcpServers: ['near'] } } })
  const off = offServerNames({ configText: text, root: '/work/app/packages/web', layers: {} })
  expect([...off].sort()).toEqual(['computer-use', 'near'])
  expect([...offServerNames({ configText: text, root: '/workshop', layers: {} })]).toEqual(['computer-use'])
})

test('a default-off built-in in the opt-out list is ignored, as Claude Code ignores it', () => {
  expect(off(config({ disabledMcpServers: ['computer-use'], enabledMcpServers: ['computer-use'] }))).toEqual([])
})
