// The account folder's types
import type { Account, AccountKind } from '../../types'
export type { Account, AccountKind }

// Where the global config is looked for: CLAUDE_CONFIG_DIR, empty when unset, and the home folder, empty when none
export type ConfigLocation = { configDir: string; home: string }
