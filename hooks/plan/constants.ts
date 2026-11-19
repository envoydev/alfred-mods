// The plan folder's named values: where a plan skill writes plans and scores, and where the mod reads them
import type { PlansFolder } from './types'

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
