// The plugins folder's named values. Precedence, the install record and the origins are from
// code.claude.com/docs/en/plugins/loading, 'Find where a plugin is enabled' and 'Find where a plugin came from', read
// 2026-11-25.

// The settings key that turns a plugin on or off, keyed `<name>@<origin>`
export const ENABLED_KEY = 'enabledPlugins'

// The install record: `<CLAUDE_CONFIG_DIR>/plugins/installed_plugins.json`, else `~/.claude/plugins/...`
export const CLAUDE_FOLDER = '.claude'
export const INSTALLED_FILE = 'plugins/installed_plugins.json'
export const INSTALLED_PLUGINS_KEY = 'plugins'
export const PROJECT_PATH_FIELD = 'projectPath'
export const SCOPE_FIELD = 'scope'
// The install scopes that reach every project; `project` and `local` reach the one at their projectPath
export const EVERY_PROJECT_SCOPES: readonly string[] = ['user', 'managed']

// The origins no marketplace install stands behind, so the record cannot tell whether one is there
export const ORIGIN_SEPARATOR = '@'
export const UNRECORDED_ORIGINS: readonly string[] = ['inline', 'skills-dir', 'synced']

// The envoydev stack, shown first in this order
export const STACK_IDS: readonly string[] = ['alfred-code@envoydev', 'alfred-tools@envoydev', 'alfred-mods@envoydev']

// The Now tab's section
export const PLUGINS_HEAD = 'PLUGINS'
export const PLUGINS_NOTE = 'Set in settings files; a plugin with no entry follows its default, and --plugin-dir copies are not listed'
export const SHOWN_ROWS = 12
export const ON_WORD = 'on'
export const OFF_WORD = 'off'
export const NOT_INSTALLED = 'not installed here'
export const ROW_JOIN = ' · '

// The rows are read again at most this often while the pane draws
export const READ_EVERY_MS = 5_000
