// The account folder's named values

// Claude Code's global config, in CLAUDE_CONFIG_DIR or the home folder
export const CONFIG_FILE_NAME = '.claude.json'

// A turn's end reads the config again once this long has passed since the last read
export const READ_EVERY_MS = 300_000

// What the band shows for a free, Pro or Max account, as the Claude mobile app does, and the organization types that
// are one: Claude Code 2.1.329 maps claude_free, claude_pro and claude_max to the free, pro and max plans, and
// claude_team and claude_enterprise to the team and enterprise plans (the owner, 2026-11-21)
export const PERSONAL = 'Personal'

export const PERSONAL_ORG_TYPES: readonly string[] = ['claude_free', 'claude_pro', 'claude_max']

// What REC strict draws in a company name's place
export const ORG_STRICT = '‹org›'
