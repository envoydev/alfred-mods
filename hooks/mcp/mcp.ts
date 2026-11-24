// The MCP state's logic (spec 2026-11-23, D5): which server a tool belongs to, how a loading server settles and the band's
// item. Pure: effects.ts reads the tool list and keeps the atom.
import type { Seg } from '../core/types'
import type { McpConnectResult } from 'claude-code'
import { DENIED_REASON, ENGINE_ORIGIN, GLYPH, ITEM_JOIN, ITEM_LABEL, NAME_UNSAFE, PLUGIN_SEPARATOR, SERVER_STATE_REASONS, SETTLE_MS, TOOL_PREFIX, TOOL_SEPARATOR } from './constants'
import type { ConnectAnswer, ListedTool, McpServer, ReadOutcome } from './types'

const spelled = (name: string): string => name.replace(NAME_UNSAFE, '_')

// A server's name as a tool's name spells it: the last `:`-part, characters outside [A-Za-z0-9_-] read `_`
export function shortName(name: string): string {
  return spelled(name.slice(name.lastIndexOf(PLUGIN_SEPARATOR) + 1))
}

// The servers whose tools the list shows, once each: the part of a tool's name between `mcp__` and the next `__`, taken
// only where the tool is an MCP server's
export function toolServers(tools: readonly ListedTool[]): string[] {
  const servers = new Set<string>()
  for (const tool of tools) {
    if (!tool.mcp || !tool.name.startsWith(TOOL_PREFIX)) continue
    const rest = tool.name.slice(TOOL_PREFIX.length)
    const end = rest.indexOf(TOOL_SEPARATOR)
    if (end > 0) servers.add(rest.slice(0, end))
  }
  return [...servers]
}

// A server's name matches a tool server by its last `:`-part or by the whole name, either spelled as a tool's name is
const isShownBy = (server: McpServer, toolServer: string): boolean => toolServer === shortName(server.name) || toolServer === spelled(server.name)

// The servers after a read of the tool list at `now`: a loading or failed one whose tools show is connected, a loading
// one in `unreadable` (its state read refused) that has loaded for SETTLE_MS too; a failed one with no tools stays so; a
// tool server no server names is added as connected
export function settle(servers: readonly McpServer[], fromTools: readonly string[], now: number, unreadable: ReadonlySet<string>): McpServer[] {
  const named = new Set<string>()
  const settled = servers.map((server): McpServer => {
    const shown = fromTools.filter(toolServer => isShownBy(server, toolServer))
    for (const toolServer of shown) named.add(toolServer)
    if (server.state === 'connected') return server
    const isSettled = shown.length > 0 || (server.state === 'loading' && unreadable.has(server.name) && now - server.since >= SETTLE_MS)
    return isSettled ? { name: server.name, state: 'connected', since: server.since, ...(server.isSeeded === true ? { isSeeded: true } : {}) } : server
  })
  const added = fromTools.filter(toolServer => !named.has(toolServer)).map((toolServer): McpServer => ({ name: toolServer, state: 'connected', since: now, isSeeded: true }))
  return [...settled, ...added]
}

// Only the engine's own raise is counted: another plugin's `$.mcp.connect` spells a server as its manifest key
export const isEngineRaise = (origin: { readonly plugin: string }): boolean => origin.plugin === ENGINE_ORIGIN

// The reason a connect answer refuses, or null for any other answer: a refusal from the engine (`{ value }` with
// `isConnected` false) or a hook beneath that denied the connect
export function refusalOf(answer: ConnectAnswer): string | null {
  if (answer.value === undefined) return DENIED_REASON
  return answer.value.isConnected ? null : answer.value.reason
}

// The list with `name` loading since `now`, in the place the name already held or last. An entry only the tool list
// seeded under the name's short name is the same server: the event replaces it. An entry an event made is never
// replaced by another name: two events are two servers.
export function markLoading(servers: readonly McpServer[], name: string, now: number): McpServer[] {
  const loading: McpServer = { name, state: 'loading', since: now }
  const exact = servers.findIndex(server => server.name === name)
  const place = exact >= 0 ? exact : servers.findIndex(server => server.isSeeded === true && isShownBy(loading, server.name))
  if (place < 0) return [...servers, loading]
  return servers.map((server, index) => (index === place ? loading : server))
}

export function markFailed(servers: readonly McpServer[], name: string, reason: string): McpServer[] {
  return servers.map(server => (server.name === name ? { name, state: 'failed', reason, since: server.since } : server))
}

export function isSameServers(left: readonly McpServer[], right: readonly McpServer[]): boolean {
  return left.length === right.length && left.every((server, index) => {
    const other = right[index]
    return other !== undefined && server.name === other.name && server.state === other.state && server.reason === other.reason && server.since === other.since && server.isSeeded === other.isSeeded
  })
}

// The band's item, counts only: a server's name is untrusted text and is never drawn. None with no server known.
export function mcpItem(servers: readonly McpServer[]): Seg[] {
  if (servers.length === 0) return []
  const count = (state: McpServer['state']): number => servers.filter(server => server.state === state).length
  const connected = count('connected')
  if (count('loading') > 0) return [{ text: `${ITEM_LABEL} ${GLYPH.loading} ${connected}/${servers.length}`, tone: 'warn' }]
  const failed = count('failed')
  if (failed > 0) return [{ text: `${ITEM_LABEL} ${GLYPH.failed} ${failed}${ITEM_JOIN}${GLYPH.connected} ${connected}`, tone: 'fail' }]
  return [{ text: `${ITEM_LABEL} ${GLYPH.connected} ${servers.length}`, tone: 'dim' }]
}

// The servers whose state is read: loading ones an event made (a seeded one is connected already), none a read runs for
// or was refused for
export function serversToRead(servers: readonly McpServer[], reading: ReadonlySet<string>, unreadable: ReadonlySet<string>): McpServer[] {
  return servers.filter(server => server.state === 'loading' && server.isSeeded !== true && !reading.has(server.name) && !unreadable.has(server.name))
}

// What a state read tells: connected, failed with a reason of the server's own, or null for a refusal of the read itself
export function readOutcome(result: McpConnectResult): ReadOutcome | null {
  if (result.isConnected) return { state: 'connected' }
  return SERVER_STATE_REASONS.has(result.reason) ? { state: 'failed', reason: result.reason } : null
}

// The servers after a state read of `name` begun while it loaded since `since`: a server a later event marked loading
// again, or one already settled, is left as it is
export function markRead(servers: readonly McpServer[], name: string, since: number, outcome: ReadOutcome): McpServer[] {
  return servers.map((server): McpServer => {
    if (server.name !== name || server.state !== 'loading' || server.since !== since) return server
    return outcome.state === 'connected' ? { name, state: 'connected', since } : { name, state: 'failed', reason: outcome.reason, since }
  })
}
