// The account folder's types
import type { Account } from '../../types'
export type { Account }

// Where the global config is looked for: CLAUDE_CONFIG_DIR, empty when unset, and the home folder, empty when none
export type ConfigLocation = { configDir: string; home: string }
