// The plugins folder's types
import type { Source } from '../settings/types'
import type { ConfigLocation } from '../account/types'
export type { ConfigLocation, Source }

// One plugin a settings file names: on or off as the highest source that names it says, that source, and whether it is
// installed for this project (null where the install record cannot tell)
export type PluginRow = { id: string; isOn: boolean; from: Source; isInstalled: boolean | null }

// What the rows are read from: each settings source as loaded, the install record's text (null where it cannot be
// read) and the project root
export type PluginsInput = { layers: Readonly<Partial<Record<Source, unknown>>>; installedText: string | null; root: string }
