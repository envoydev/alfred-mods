// What names a rule (spec 2026-11-23, D1): the rule key that tells two files of one base name apart, and the label the
// band draws. No path is kept but one inside or above the project, as a relative key: a rule elsewhere is keyed by its
// type and base name, so no home folder or user name reaches the atom.
import { baseName } from '../place/place'
import { ANY_RULES_DIR, DRIVE_PATH, DRIVE_ROOT, MD_SUFFIX, RULES_DIR, TRAILING_SLASHES } from './constants'
import type { RuleEntry } from './types'

export const slashed = (filePath: string): string => filePath.replace(/\\/g, '/')
export const isDrive = (filePath: string): boolean => DRIVE_PATH.test(filePath)

// A rule file's base name, else null: a `rules` folder directly inside a `.claude` folder, or a User file under any
// `rules` folder (a CLAUDE_CONFIG_DIR not named .claude); `\` read as `/`. Only the name is kept, never its folder.
export function ruleName(path: string, type: string): string | null {
  const file = slashed(path)
  const isRule = file.includes(RULES_DIR) || (type === 'User' && file.includes(ANY_RULES_DIR))
  return isRule ? baseName(file) : null
}

// `file` and `root` slashed, the root without a trailing slash, and the compare each is read through: a Windows path
// compares without case. A root that is empty or a drive root names no project to key against.
function placed(path: string, root: string) {
  const file = slashed(path)
  const base = slashed(root).replace(TRAILING_SLASHES, '')
  const fold = (text: string): string => (isDrive(file) || isDrive(`${base}/`) ? text.toLowerCase() : text)
  return { file, base, fold, isRootless: base === '' || DRIVE_ROOT.test(base) }
}

// The key and label of a file known to be a rule; `isLinked` for one a link under the root reaches, which reads as the root's own
function entryOf(path: string, type: string, root: string, isLinked: boolean): RuleEntry {
  const { file, base, fold, isRootless } = placed(path, root)
  const name = baseName(file).replace(MD_SUFFIX, '')
  const typed: RuleEntry = { key: `${type}:${baseName(file)}`, label: name }
  if (isRootless) return typed
  const cut = file.indexOf(RULES_DIR)
  const owner = cut < 0 ? null : file.slice(0, cut)
  const isOwnerBelow = owner !== null && fold(owner).startsWith(`${fold(base)}/`)
  const label = isLinked || type === 'User' || !isOwnerBelow ? name : `${owner.slice(base.length + 1)}:${name}`
  if (fold(file).startsWith(`${fold(base)}/`)) return { key: file.slice(base.length + 1), label }
  if (owner !== null && (fold(base) === fold(owner) || fold(base).startsWith(`${fold(owner)}/`))) {
    const climbs = base.slice(owner.length).split('/').filter(part => part !== '').length
    return { key: `${'../'.repeat(climbs)}${file.slice(owner.length + 1)}`, label }
  }
  return { key: typed.key, label }
}

// The rule a file is, else null: a rule by its folder, or one a link under the root's `.claude/rules/` reaches, which
// lies under one of the `linkEnds` (slashed real paths); a linked rule reads as the root's own
export function ruleEntry(path: string, type: string, root: string, linkEnds: readonly string[] = []): RuleEntry | null {
  const { file, fold } = placed(path, root)
  const isLinked = linkEnds.some(end => fold(file) === fold(end) || fold(file).startsWith(`${fold(end)}/`))
  if (!isLinked && ruleName(path, type) === null) return null
  return entryOf(path, type, root, isLinked)
}

// A file known to be a rule though no folder says so, such as one a path glob loaded or one the breakdown's link
// walk reached: a rule's frontmatter matches by path wherever a link lands the file
export function assumedRuleEntry(path: string, type: string, root: string): RuleEntry {
  return entryOf(path, type, root, ruleName(path, type) === null)
}
