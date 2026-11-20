// The account folder's types
import type { Account } from '../../types'
export type { Account }

// Where the global config is looked for: CLAUDE_CONFIG_DIR, empty when unset, and the home folder, empty when none
export type ConfigLocation = { configDir: string; home: string }

// What /alfred-mods:configure's arguments ask for: `other` is not the expectOrg command, `pin` the shown org, `usage`
// a name that is too long
export type OrgArgs = { kind: 'other' } | { kind: 'pin' } | { kind: 'usage' } | { kind: 'name'; name: string }
