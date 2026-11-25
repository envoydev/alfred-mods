// The plugins the settings files turn on or off, with the file that decides each and whether it is installed here.
// Pure: effects.ts reads the files.
import { isFolderOf } from '../core/folders'
import { fitLine, printable } from '../core/format'
import { isRecord } from '../core/guards'
import type { Line } from '../core/types'
import { SOURCES, sourceFileName } from '../settings/settings'
import {
  CLAUDE_FOLDER, ENABLED_KEY, EVERY_PROJECT_SCOPES, INSTALLED_FILE, INSTALLED_PLUGINS_KEY, NOT_INSTALLED, OFF_WORD, ON_WORD, ORIGIN_SEPARATOR,
  PLUGINS_HEAD, PLUGINS_NOTE, PROJECT_PATH_FIELD, ROW_JOIN, SCOPE_FIELD, SHOWN_ROWS, STACK_IDS, UNRECORDED_ORIGINS,
} from './constants'
import type { ConfigLocation, PluginRow, PluginsInput, Source } from './types'

const withoutTrailingSeparators = (folder: string): string => folder.replace(/[\\/]+$/, '')

// The install record's path: in CLAUDE_CONFIG_DIR when set, else in the home folder's .claude; null with neither
export function installedPathOf(location: ConfigLocation): string | null {
  if (location.configDir !== '') return `${withoutTrailingSeparators(location.configDir)}/${INSTALLED_FILE}`
  return location.home === '' ? null : `${withoutTrailingSeparators(location.home)}/${CLAUDE_FOLDER}/${INSTALLED_FILE}`
}

// Per plugin id, the value and source of the highest source that names it with true or false
function decided(layers: PluginsInput['layers']): Map<string, { isOn: boolean; from: Source }> {
  const out = new Map<string, { isOn: boolean; from: Source }>()
  for (const source of SOURCES) {
    const layer = layers[source]
    const enabled = isRecord(layer) ? layer[ENABLED_KEY] : undefined
    if (!isRecord(enabled)) continue
    for (const [id, value] of Object.entries(enabled)) if (typeof value === 'boolean' && !out.has(id)) out.set(id, { isOn: value, from: source })
  }
  return out
}

// The install record's plugins, or null for text that is no JSON object or holds none
function installedPlugins(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) && isRecord(parsed[INSTALLED_PLUGINS_KEY]) ? parsed[INSTALLED_PLUGINS_KEY] : null
  } catch {
    return null
  }
}

// Installed for the project at `root`: an install of a scope that reaches every project, or one made for this project or
// a project above it, as a session started in a subfolder belongs to that one
function isInstalledHere(entries: unknown, root: string): boolean {
  if (!Array.isArray(entries)) return false
  return entries.some(entry => isRecord(entry) && typeof entry[SCOPE_FIELD] === 'string' && (EVERY_PROJECT_SCOPES.includes(entry[SCOPE_FIELD])
    || (typeof entry[PROJECT_PATH_FIELD] === 'string' && isFolderOf(entry[PROJECT_PATH_FIELD], root))))
}

const originOf = (id: string): string => id.slice(id.lastIndexOf(ORIGIN_SEPARATOR) + 1)

const stackRank = (id: string): number => {
  const at = STACK_IDS.indexOf(id)
  return at === -1 ? STACK_IDS.length : at
}

// Every plugin a settings file names, the envoydev stack first in its order, then the rest by id
export function pluginRows(input: PluginsInput): PluginRow[] {
  const record = installedPlugins(input.installedText)
  const rows = [...decided(input.layers)].map(([id, { isOn, from }]): PluginRow => ({
    id, isOn, from,
    isInstalled: record === null || UNRECORDED_ORIGINS.includes(originOf(id)) ? null : isInstalledHere(record[id], input.root),
  }))
  return rows.sort((a, b) => stackRank(a.id) - stackRank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// The Now tab's PLUGINS section: what the rows mean, then each plugin with its value and the file that decides it; one
// turned on that the record shows is not installed here says so. Past SHOWN_ROWS the rest are counted.
export function pluginLines(rows: readonly PluginRow[], columns: number): Line[] {
  if (rows.length === 0) return []
  const shown = rows.slice(0, SHOWN_ROWS).map((row): Line => {
    const parts = [`${printable(row.id)} ${row.isOn ? ON_WORD : OFF_WORD}`, sourceFileName(row.from), ...(row.isOn && row.isInstalled === false ? [NOT_INSTALLED] : [])]
    return [{ text: fitLine(parts.join(ROW_JOIN), columns), ...(row.isOn && row.isInstalled === false ? { tone: 'warn' as const } : {}) }]
  })
  const rest = rows.length - shown.length
  return [
    [{ text: PLUGINS_HEAD, bold: true }], [{ text: fitLine(PLUGINS_NOTE, columns), tone: 'dim' }], ...shown,
    ...(rest > 0 ? [[{ text: `${rest} more`, tone: 'dim' as const }]] : []),
  ]
}
