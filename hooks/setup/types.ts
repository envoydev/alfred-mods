// The setup commands' types: what the value typed after '/alfred-mods:init' or '/alfred-mods:configure' parses to
import type { PlansFolder } from '../plan/types'

export type SetupVerb = 'init' | 'configure' | 'update'

// ok with a null folder is no value typed; not ok is a word that is no folder, or more than one word
export type FolderValue = { ok: true; folder: PlansFolder | null } | { ok: false }

// One plan or scores file listed in a root other than the chosen one; `name` is its file's name without `.json`.
// `mtimeMs` is the time it counts as written (the source's, for a copy an earlier update made); `diskMtimeMs` is the
// file's own.
export type ListedFile = { name: string; root: string; path: string; mtimeMs: number; diskMtimeMs: number; size: number }

// `queue`: the files to copy, the newest of each name, oldest first. `clashed`: the newest file of each name the chosen
// root holds already, which stays unless its copy there is byte-equal. `listed`: every file seen.
export type MoveQueue = { queue: ListedFile[]; clashed: ListedFile[]; listed: ListedFile[] }

// A copy into the chosen root, and the source it came from
export type Copy = { file: ListedFile; destination: string }

// How one copy ended: read back equal, a file there already (never overwritten), a destination whose check rejected, a
// copy that did not read back equal, or one that read back equal but whose stat rejected
export type CopyResult = 'copied' | 'exists' | 'unchecked' | 'differs' | 'unstatted'

// The endings that leave the source in place and the file named as not moved
export type CopyFailure = Exclude<CopyResult, 'copied' | 'exists'>

// Why a plan stays: `writing` - its writer may still use it; `unreadable` - it does not parse and is past the window
export type LiveReason = 'writing' | 'unreadable'

// How a source folder stands to the chosen one: another folder, the same folder, or one that cannot be told apart
export type FolderRelation = 'distinct' | 'same' | 'unknown'
