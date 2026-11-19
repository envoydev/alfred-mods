// The setup commands' types: what the value typed after '/alfred-mods:init' or '/alfred-mods:configure' parses to
import type { PlansFolder } from '../plan/types'

export type SetupVerb = 'init' | 'configure' | 'update'

// ok with a null folder is no value typed; not ok is a word that is no folder, or more than one word
export type FolderValue = { ok: true; folder: PlansFolder | null } | { ok: false }

// One plan or scores file listed in a root other than the chosen one; `name` is its file's name without `.json`
export type ListedFile = { name: string; root: string; path: string; mtimeMs: number; size: number }

// The files to copy, the newest of each name, oldest first, and the newest file of each name the chosen root holds already
export type MoveQueue = { queue: ListedFile[]; clashed: ListedFile[]; listed: ListedFile[] }

// A copy into the chosen root, and the source it came from
export type Copy = { file: ListedFile; destination: string }

// How one copy ended: read back equal, a file there already (never overwritten), or a copy that did not read back equal
export type CopyResult = 'copied' | 'exists' | 'differs'
