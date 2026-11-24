// The MCP state's types: its atom's value is declared in types/index.d.ts, with the mod's other $.state values
import type { McpConnectResult } from 'claude-code'
import type { McpServer } from '../../types'
export type { McpServer }

// What `$.tool.list()` answers, as far as the MCP state reads it
export type ListedTool = { name: string; mcp: boolean }

// The servers whose state read was refused, each with the `since` of the raise it was read under
export type Unreadable = ReadonlyMap<string, number>

// What a state read tells of a server
export type ReadOutcome = { state: 'connected' } | { state: 'failed'; reason: string }

// What an mcp.connect hook's `next(e)` answers: the engine's result, or a hook's refusal
export type ConnectAnswer = { value?: McpConnectResult; deny?: string }
