// The setup command's types: what '/alfred-mods <verb> [folder]' parses to
import type { PlansFolder } from '../plan/types'

export type SetupVerb = 'init' | 'configure' | 'update'

export type SetupArgs = { verb: SetupVerb; folder: PlansFolder | null }

// One plan or scores file listed in a root other than the chosen one; `name` is its file's name without `.json`
export type ListedFile = { name: string; root: string; path: string; mtimeMs: number; size: number }

// The files to copy, the newest of each name, and the names the chosen root holds already
export type MoveQueue = { queue: ListedFile[]; clashes: string[] }
