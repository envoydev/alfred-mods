// The MCP state's named values (spec 2026-11-23, D5)

// A server still loading this long after its event, with no tools seen and no state to read (the read refused, a build
// with none, a raise a hook holds), leaves the count: nothing tells whether it is connected, off or failed, and it is
// counted again when its tools show (the user, 2026-11-25)
export const SETTLE_MS = 60_000

// The reasons a state read answers that tell the server's own state; any other is a refusal of the read itself, which
// tells nothing of the server
export const SERVER_STATE_REASONS: ReadonlySet<string> = new Set(['failed', 'auth', 'disabled'])
// A server turned off is no part of the count (the user, 2026-11-25)
export const SERVER_OFF_REASON = 'disabled'
// The tool list is read this often while a server loads and for EARLY_MS after the session starts, else every IDLE_POLL_MS
export const POLL_MS = 5_000
export const EARLY_MS = 120_000
export const IDLE_POLL_MS = 30_000

export const INITIAL_SERVERS: never[] = []

// A tool of an MCP server is `mcp__<server>__<tool>`
export const TOOL_PREFIX = 'mcp__'
export const TOOL_SEPARATOR = '__'
// The characters a tool's name spells as `_`
export const NAME_UNSAFE = /[^A-Za-z0-9_-]/g
export const PLUGIN_SEPARATOR = ':'

// The band's item: `mcp ◐ <connected>/<total>`, `mcp ✓ <total>` or `mcp ✗ <failed> · ✓ <connected>`
export const ITEM_LABEL = 'mcp'
export const GLYPH = { loading: '◐', connected: '✓', failed: '✗' } as const
export const ITEM_JOIN = ' · '

// The reason kept for a connect a hook beneath denied, which carries none of its own
export const DENIED_REASON = 'denied'

// `next.origin.plugin` of the engine's own raise: another plugin's `$.mcp.connect` carries its own name
export const ENGINE_ORIGIN = 'engine'
