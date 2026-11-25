// The plugins folder's effects: the settings sources and the install record, read for the Now tab
import type { EngineInterface } from 'claude-code'
import { readConfigLocation } from '../account/effects'
import { readSettingsLayers } from '../settings/effects'
import { READ_EVERY_MS } from './constants'
import { installedPathOf, pluginRows } from './plugins'
import type { PluginRow } from './types'

// The rows last read and when, from the clock: a pane redraws often, and the files change rarely
const pluginsMemory = { rows: [] as PluginRow[], readAt: null as number | null }

// The plugins the settings files name, read again once READ_EVERY_MS has passed. It never rejects: a failed read gives
// the rows it can, and none where the settings cannot be read.
export async function readPluginRows($: EngineInterface): Promise<PluginRow[]> {
  const now = await $.clock.now().catch(() => null)
  if (now !== null && pluginsMemory.readAt !== null && now - pluginsMemory.readAt < READ_EVERY_MS) return pluginsMemory.rows
  const path = installedPathOf(await readConfigLocation($))
  const installedText = path === null ? null : await $.fs.read(path).catch(() => null)
  const root = await $.session.root().catch(() => $.session.cwd()).catch(() => '')
  pluginsMemory.rows = pluginRows({ layers: await readSettingsLayers($), installedText, root })
  pluginsMemory.readAt = now
  return pluginsMemory.rows
}
