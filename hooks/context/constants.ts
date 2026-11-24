// The context folder's named values: where a rule file lives and how its path is read

// A rule file lies directly inside a `.claude` folder's `rules` folder, slashes only
export const RULES_DIR = '/.claude/rules/'

// A User rule may lie under any `rules` folder, such as a config folder not named `.claude`
export const ANY_RULES_DIR = '/rules/'

export const MD_SUFFIX = /\.md$/i

// A drive path such as `C:/work`, compared without case, and a root that is only a drive
export const DRIVE_PATH = /^[A-Za-z]:\//
export const DRIVE_ROOT = /^[A-Za-z]:$/

export const TRAILING_SLASHES = /\/+$/
