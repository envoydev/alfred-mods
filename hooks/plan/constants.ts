// The plan folder's named values: where a plan skill writes plans and scores, and where the mod reads them
import type { PlansFolder } from './types'

// The values of the `plansFolder` setting in the order the reader falls back through them; `.alfred/` holds Alfred
// Code's state, so the mod's files go one level down in it
export const PLANS_FOLDERS: readonly PlansFolder[] = ['.alfred-mods', 'default', '.alfred']

// The root folder each value of `plansFolder` named before each value read its own plans (the user, 2026-11-25): read
// all three while the field is unset, and the folders `/alfred-mods:update` moves files out of. Plans sit under
// `<root>/plans`, scores under `<root>/scores`
export const PLANS_ROOTS: Readonly<Record<PlansFolder, string>> = {
  default: '.claude/session-inspector', '.alfred': '.alfred/alfred-mods', '.alfred-mods': '.alfred-mods'
}

// The value in force while the field is unset
export const UNSET_PLANS_FOLDER: PlansFolder = '.alfred-mods'

// claude-kit's choice: the one value whose plans are plan and score files, so the one root the update moves files into
// and adds to .gitignore. `.alfred` reads Alfred Code's own plan folders, and `default` reads no plan file.
export const FILE_PLANS_FOLDER: PlansFolder = '.alfred-mods'

// The 'no plan' texts' words for `default`, which reads no plan file
export const NO_PLAN_FILES_READ = 'plansFolder "default" reads no plan file.'

export const PLANS_SUBFOLDER = 'plans'
export const SCORES_SUBFOLDER = 'scores'

// Alfred Code's plan folders (its plan folder contract), one `<id>/` per plan: read with `plansFolder` `.alfred` (the
// user, 2026-11-25), the newest ALFRED_PLANS_READ of them
export const ALFRED_PLANS_DIR = '.alfred/docs/work/plans'
export const ALFRED_STATUS_FILE = 'status.json'
export const ALFRED_SCORING_FILE = 'scoring.json'
export const ALFRED_PLANS_READ = 20

// The largest plan or scores file the reader reads: `$.fs.read` refuses a file over 4 MiB
export const MAX_PLAN_BYTES = 4 * 1024 * 1024
