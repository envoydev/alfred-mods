// The setup commands' types: what the value typed after '/alfred-mods:init' or '/alfred-mods:configure' parses to
import type { PlansFolder } from '../plan/types'

export type SetupVerb = 'init' | 'configure' | 'update'

// ok with a null folder is no value typed; not ok is a word that is no folder, or more than one word
export type FolderValue = { ok: true; folder: PlansFolder | null } | { ok: false }
