// The MCP servers Claude Code's own records say are off, read out of the global config's text and the settings files.
// Pure: effects.ts reads the files.
import { folderKey, isFolderOf } from '../core/folders'
import { isRecord } from '../core/guards'
import { isShownBy, spelledName } from './mcp'
import {
  CONFIG_PROJECTS_KEY, DEFAULT_OFF_SERVERS, DENIED_NAME_FIELD, PROJECT_OFF_KEY, PROJECT_ON_KEY, SETTINGS_DENIED_KEY, SETTINGS_OFF_KEY,
} from './constants'
import type { McpServer, OffInput } from './types'

const namesIn = (value: unknown): string[] => (Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [])

// The config's entry for the project at `root`, or the nearest one above it for a session started in a subfolder; null
// where the text is no JSON object or holds none
function projectEntry(configText: string | null, root: string): Record<string, unknown> | null {
  if (configText === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(configText)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed[CONFIG_PROJECTS_KEY])) return null
  const found = Object.entries(parsed[CONFIG_PROJECTS_KEY])
    .filter(([key, entry]) => isRecord(entry) && isFolderOf(key, root))
    .sort(([a], [b]) => folderKey(b).length - folderKey(a).length)[0]
  return found !== undefined && isRecord(found[1]) ? found[1] : null
}

// Every server name the records turn off for the project: its own opt-out list, each default-off built-in it does not
// opt into, and from every settings file the rejected .mcp.json servers and the denied entries that name a server. A
// default-off built-in in the opt-out list is ignored, as Claude Code ignores it.
export function offServerNames(input: OffInput): Set<string> {
  const entry = projectEntry(input.configText, input.root)
  const optedIn = new Set(namesIn(entry?.[PROJECT_ON_KEY]))
  const optedOut = namesIn(entry?.[PROJECT_OFF_KEY]).filter(name => !DEFAULT_OFF_SERVERS.includes(name))
  const off = new Set([...optedOut, ...DEFAULT_OFF_SERVERS.filter(name => !optedIn.has(name))])
  for (const layer of Object.values(input.layers)) {
    if (!isRecord(layer)) continue
    for (const name of namesIn(layer[SETTINGS_OFF_KEY])) off.add(name)
    const denied = Array.isArray(layer[SETTINGS_DENIED_KEY]) ? layer[SETTINGS_DENIED_KEY] : []
    for (const rule of denied) if (isRecord(rule) && typeof rule[DENIED_NAME_FIELD] === 'string') off.add(rule[DENIED_NAME_FIELD])
  }
  return off
}

// The servers with those named off left out: by the name as written, or for one the tool list seeded, as a tool spells
// it. One whose tools show stays, as a record the mod could not read must not hide a working server. The same list
// where none leaves.
export function withoutOff(servers: McpServer[], off: ReadonlySet<string>, fromTools: readonly string[]): McpServer[] {
  const spelledOff = new Set([...off].map(spelledName))
  const isOff = (server: McpServer): boolean => (off.has(server.name) || (server.isSeeded === true && spelledOff.has(server.name)))
    && !fromTools.some(toolServer => isShownBy(server, toolServer))
  return servers.some(isOff) ? servers.filter(server => !isOff(server)) : servers
}
