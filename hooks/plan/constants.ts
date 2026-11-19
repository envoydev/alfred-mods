// The plan folder's named values: where a plan skill writes plans and scores, and where the mod reads them
import type { PlansFolder } from './types'

// The folders a plan skill writes plans and scores to. Claude Code asks before each write under `.claude/`, so a skill
// writes under `.alfred-mods/`; the old folders are read as a fallback, and a file of the new folder wins over a
// same-named one of the old
export const PLANS_DIR = '.alfred-mods/plans'
export const SCORES_DIR = '.alfred-mods/scores'
export const OLD_PLANS_DIR = '.claude/session-inspector/plans'
export const OLD_SCORES_DIR = '.claude/session-inspector/scores'

// The values of the `plansFolder` setting in the order the reader falls back through them; `.alfred/` holds Alfred
// Code's state, so the mod's files go one level down in it
export const PLANS_FOLDERS: readonly PlansFolder[] = ['.alfred-mods', 'default', '.alfred']

// The root folder each value of `plansFolder` names; plans sit under `<root>/plans`, scores under `<root>/scores`
export const PLANS_ROOTS: Readonly<Record<PlansFolder, string>> = {
  default: '.claude/session-inspector', '.alfred': '.alfred/alfred-mods', '.alfred-mods': '.alfred-mods'
}

// The value in force while the field is unset
export const UNSET_PLANS_FOLDER: PlansFolder = '.alfred-mods'

export const PLANS_SUBFOLDER = 'plans'
export const SCORES_SUBFOLDER = 'scores'
