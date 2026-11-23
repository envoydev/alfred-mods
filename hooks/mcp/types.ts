// The MCP state's types: its atom's value is declared in types/index.d.ts, with the mod's other $.state values
import type { McpConnectResult } from 'claude-code'
import type { McpServer } from '../../types'
export type { McpServer }

// What `$.tool.list()` answers, as far as the MCP state reads it
export type ListedTool = { name: string; mcp: boolean }

// What an mcp.connect hook's `next(e)` answers: the engine's result, or a hook's refusal
export type ConnectAnswer = { value?: McpConnectResult; deny?: string }
