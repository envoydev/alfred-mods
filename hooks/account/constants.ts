// The account folder's named values
import { SLASH } from '../setup/constants'

// Claude Code's global config, in CLAUDE_CONFIG_DIR or the home folder
export const CONFIG_FILE_NAME = '.claude.json'

// A turn's end reads the config again once this long has passed since the last read
export const READ_EVERY_MS = 300_000

// What REC strict draws in the organization name's place, in the band and in the command's replies
export const ORG_STRICT = '‹org›'

// expectOrg takes a name of 1 to this many characters
export const EXPECT_ORG_MAX = 100

// The word after /alfred-mods:configure that makes the command this folder's
export const EXPECT_ORG_KEYWORD = 'expectOrg'

export const EXPECT_ORG_UNKNOWN = `The signed-in organization is unknown - type ${SLASH.configure} ${EXPECT_ORG_KEYWORD} <name>`

export const EXPECT_ORG_WARNS = 'the band warns when the signed-in organization differs'
