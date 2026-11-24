// The transcript folder's named values: how much to read, and what to look for in a line

export const CHUNK_BYTES = 1_048_576
export const RUN_BYTES = 16 * 1_048_576
export const RUN_MS = 250
export const FIRST_TAIL_BYTES = 8 * 1_048_576
// A run starts at least this often, and sooner when the session's turn count moved
export const READ_EVERY_MS = 30_000

// An attachment type that names a rule file Claude Code loaded on demand
export const NESTED_MEMORY = 'nested_memory'

// A skip notice is a system line that starts with SKIP_PREFIX and holds SKIP_TEXT
export const SKIP_TEXT = 'hook was skipped'
export const SKIP_PREFIX = 'alfred-mods: its '
export const SYSTEM_TYPE = 'system'
export const INFORMATIONAL_SUBTYPE = 'informational'
export const ATTACHMENT_TYPE = 'attachment'

export const NEWLINE = '\n'
export const TRAILING_CR = /\r$/

// A project folder name keeps A-Z a-z 0-9 and turns every other character into a dash
export const NON_ALPHANUMERIC = /[^A-Za-z0-9]/g
export const PROJECTS_FOLDER = 'projects'
export const TRANSCRIPT_SUFFIX = '.jsonl'
export const TRAILING_SLASHES = /[\\/]+$/

// UTF-8 length steps by code point
export const UTF8_ONE_BYTE_MAX = 0x7f
export const UTF8_TWO_BYTE_MAX = 0x7ff
export const UTF8_THREE_BYTE_MAX = 0xffff
export const HIGH_SURROGATE_MIN = 0xd800
export const HIGH_SURROGATE_MAX = 0xdbff
export const LOW_SURROGATE_MIN = 0xdc00
export const LOW_SURROGATE_MAX = 0xdfff

// Where Claude Code keeps its files, below the home folder, when CLAUDE_CONFIG_DIR is not set
export const CONFIG_FOLDER = '.claude'

// The type a rule file has: a User rule lies under the config folder, as `memory_type` says in the classic hook
export const RULE_TYPE = { user: 'User', project: 'Project' } as const
