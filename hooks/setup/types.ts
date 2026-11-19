// The setup command's types: what '/alfred-mods <verb> [folder]' parses to
import type { PlansFolder } from '../plan/types'

export type SetupVerb = 'init' | 'configure' | 'update'

export type SetupArgs = { verb: SetupVerb; folder: PlansFolder | null }
