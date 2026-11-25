// The MCP state's effects (spec 2026-11-23, D5): its $.state atom, the mcp.connect hook's bookkeeping and the tool-list
// poll. The atom is made, read and updated here alone: `claude plugin validate` refuses an atom handed to another module.
// A server's name goes nowhere but this atom: never `$.store`, a log or a file.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { HookInput, HookNext } from '../core/types'
import { EARLY_MS, INITIAL_SERVERS, IDLE_POLL_MS, POLL_MS } from './constants'
import { isEngineRaise, isSameServers, markFailed, markLoading, markPassed, markRead, readOutcome, refusalOf, serversToRead, settle, toolServers } from './mcp'
import type { McpServer, ReadOutcome } from './types'

const mcpAtom = atom({ plugin: 'alfred-mods', key: 'mcp' } as const, INITIAL_SERVERS as McpServer[], { shape: 'mcp-3' })

// When the tool list was last read, from the clock, whether a read runs now (a read never overlaps another), and the
// last list the atom held: Claude Code empties $.state at a /clear, a resume or a branch, and the servers stay connected
// across them with no mcp.connect coming again, so the start-over puts the list back. `reading` names the servers a
// state read waits on, `unreadable` those whose read was refused, by the raise's `since`; `isReadOff` holds with
// `leave_out_skipped_hooks`, where the mod asks nothing.
const mcpMemory = {
  lastReadAt: null as number | null,
  isReading: false,
  last: [] as McpServer[],
  reading: new Set<string>(),
  unreadable: new Map<string, number>(),
  isReadOff: false,
}

export function readMcp($: EngineInterface): Promise<McpServer[]> {
  return read($, mcpAtom)
}

// The list a change starts from: the atom's, or, where it reads empty, the last one it held, since a tick that began
// before a start-over emptied the atom must not drop the servers the start-over is about to put back
const baseOf = (servers: McpServer[]): McpServer[] => (servers.length > 0 ? servers : mcpMemory.last)

// A write only where the list changes: each tick reads the tool list, and a write on each would redraw the band
async function updateMcp($: EngineInterface, change: (servers: McpServer[]) => McpServer[]): Promise<void> {
  const current = await read($, mcpAtom)
  if (current.length > 0) mcpMemory.last = current
  const base = baseOf(current)
  if (isSameServers(base, change(base))) return
  await update($, mcpAtom, servers => {
    mcpMemory.last = change(baseOf(servers))
    return mcpMemory.last
  })
}

// A start-over (a /clear, a resume, a branch) emptied the atom: the last list is written back, unless the atom holds one
export async function keepMcp($: EngineInterface): Promise<void> {
  if (mcpMemory.last.length === 0 || (await read($, mcpAtom)).length > 0) return
  await update($, mcpAtom, servers => (servers.length > 0 ? servers : mcpMemory.last))
}

// The engine's raise for a server about to join: it is loading from now, and a refusal answer marks it failed. Any other
// answer leaves it loading, as the dial only follows; its state read, the tool list or the time decides it. The answer
// goes on untouched.
// Another plugin's `$.mcp.connect` goes through as it came: it spells a server as its manifest key, which no tool matches.
export async function trackMcpConnect($: EngineInterface, e: HookInput<'mcp.connect'>, next: HookNext<'mcp.connect'>) {
  if (!isEngineRaise(next.origin)) return next(e)
  const now = await $.clock.now()
  await updateMcp($, servers => markLoading(servers, e.server, now))
  const answer = await next(e)
  const refusal = refusalOf(answer)
  // A write that fails must not reach the hook's catch, which would raise the connect beneath a second time
  await updateMcp($, servers => (refusal === null ? markPassed(servers, e.server, now) : markFailed(servers, e.server, refusal))).catch(() => undefined)
  return answer
}

// One read of the tool list at `now`: a list that cannot be read leaves time alone to decide the unread servers
async function refreshMcp($: EngineInterface, now: number): Promise<void> {
  mcpMemory.lastReadAt = now
  const names = await $.tool.list().then(toolServers, () => [])
  await updateMcp($, servers => settle(servers, names, now, mcpMemory.isReadOff ? null : mcpMemory.unreadable))
  readServerStates($, baseOf(await read($, mcpAtom)))
}

// The state of each loading server an event made, read with `$.mcp.connect`, which never dials a server the session
// lists: it answers the server's state once its dial settles (the user's ruling, 2026-11-24: the one call past
// observing, as the engine's raise answers connected before the dial). Only a server whose raise passed the hooks
// beneath unrefused is read, so none a hook holds. A read can wait as long as the dial, so it is not awaited: it marks
// the server when it answers, and runs once per server at a time.
function readServerStates($: EngineInterface, servers: readonly McpServer[]): void {
  if (mcpMemory.isReadOff) return
  for (const server of serversToRead(servers, mcpMemory.reading, mcpMemory.unreadable)) {
    mcpMemory.reading.add(server.name)
    // Never rejects: readServerState catches every failure
    void readServerState($, server).finally(() => mcpMemory.reading.delete(server.name))
  }
}

// One read: its outcome marks the server, a refused read leaves it to the tool list and SETTLE_MS. A write that fails
// leaves it for the next poll to read again.
async function readServerState($: EngineInterface, server: McpServer): Promise<void> {
  let outcome: ReadOutcome | null
  try {
    outcome = readOutcome(await $.mcp.connect(server.name))
  } catch {
    // A build with no read throws at once, or rejects: the same as a refusal
    outcome = null
  }
  if (outcome === null) {
    mcpMemory.unreadable.set(server.name, server.since)
    return
  }
  await updateMcp($, servers => markRead(servers, server.name, server.since, outcome)).catch(() => undefined)
}

// The session start's read: servers that joined before the hook was in place show too. With the option on, no state is
// read (the mod asks nothing there).
export function seedMcp($: EngineInterface, now: number, isLeftOut: boolean): Promise<void> {
  mcpMemory.isReadOff = isLeftOut
  return refreshMcp($, now)
}

// Every POLL_MS while a server loads and for EARLY_MS after `startedAt`, else every IDLE_POLL_MS. It never rejects and
// never overlaps itself.
export async function pollMcpIfDue($: EngineInterface, now: number, startedAt: number): Promise<void> {
  if (mcpMemory.isReading || (mcpMemory.lastReadAt !== null && now - mcpMemory.lastReadAt < POLL_MS)) return
  mcpMemory.isReading = true
  try {
    const isHot = now - startedAt < EARLY_MS || (await readMcp($)).some(server => server.state === 'loading')
    if (mcpMemory.lastReadAt === null || now - mcpMemory.lastReadAt >= (isHot ? POLL_MS : IDLE_POLL_MS)) await refreshMcp($, now)
  } catch {
    // The next tick tries again
  } finally {
    mcpMemory.isReading = false
  }
}
