// A session for the MCP state's tests (spec 2026-11-23, D5): the stubs it reads through, a stand-in plugin that raises
// mcp.connect as another plugin does, and the values the tests share
import type { Engine, Plugin } from 'claude-code/testing'
import type { McpConnectResult, On } from 'claude-code'

import { PRESENTATION, START, emptyState, engine, stubAll } from './kit'
import { stubTools } from './transcript-stubs'
import { mcpItem } from '../hooks/mcp/mcp'
import type { McpServer } from '../hooks/mcp/types'

export const NOW = Date.parse('2026-10-28T14:00:00Z')
export const PASSED: McpConnectResult = { isConnected: true, server: 'plugin:p:files' }
export const REFUSED: McpConnectResult = { isConnected: false, reason: 'auth', message: 'm' }
export const SHAPE = 'mcp-2'

export const text = (servers: McpServer[]): string => mcpItem(servers).map(seg => ('text' in seg ? seg.text : '')).join('')
export const loading = (name: string, since = NOW): McpServer => ({ name, state: 'loading', since })
export const connected = (name: string, since = NOW): McpServer => ({ name, state: 'connected', since })
export const seeded = (name: string, since = NOW): McpServer => ({ name, state: 'connected', since, isSeeded: true })

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
export const OPTIONS = { plugins: [DIAL] }
export const dial = async ($: Engine, server: string): Promise<McpConnectResult> => {
  const run = await $.command.run({ command: 'dial', args: server, origin: { kind: 'composer' }, presentation: PRESENTATION })
  return JSON.parse(run.text ?? 'null') as McpConnectResult
}

// What the mod's own `$.mcp.connect` (its read of a server's state) gets beneath: a refusal of the read itself (the
// default, which leaves a server to the tool list and the time, as a build with no read does) or a result, given
// `lateMs` after the read on the test's clock. `reads` counts the reads and `answer` serves the stand-in's raise.
export type Read = { read?: 'refused' | McpConnectResult; lateMs?: number }
export type Beneath = { answer: McpConnectResult; reads: number }

// A session whose atom `mcp` holds `stored` before it starts, as a run that stored it left it: `servers` reads the mod's
// last written list; `tools` is the tool list, changed mid-test
export async function begin($: Engine, on: On, o: { tools?: string[]; stored?: McpServer[] } & Read = {}) {
  const kit = stubAll(on, { root: '/work/app', cwd: '/work/app', now: NOW })
  const tools = stubTools(on, o.tools ?? [])
  const state = emptyState(on, ['mcp'], o.stored === undefined ? {} : { mcp: { shape: SHAPE, value: o.stored } })
  const beneath: Beneath = { answer: PASSED, reads: 0 }
  on('mcp.connect', async (_engine, _e, next) => {
    if (next.origin.plugin === DIAL.name) return { value: beneath.answer }
    beneath.reads++
    if (o.lateMs !== undefined) await kit.clock.sleep(o.lateMs)
    const read = o.read ?? 'refused'
    return read === 'refused' ? { deny: 'test: read refused' } : { value: read }
  })
  engine(on)
  await $.session.start(START)
  const servers = (): McpServer[] => (state.get('mcp') as McpServer[] | undefined) ?? o.stored ?? []
  return { kit, tools, state, beneath, servers }
}
