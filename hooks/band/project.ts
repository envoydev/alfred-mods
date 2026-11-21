// The band's project rows: the plan, the place (project, folder, branch) and the usage summary
import { fitLine, widthOf } from '../core/format'
import { planRowParts, scoreSeg } from '../plan/planlines'
import type { BandInput } from './types'
import type { Line, Seg } from '../core/types'
import { ORG_STRICT, PERSONAL } from '../account/constants'
import { NAME_FLOOR_CELLS, ORG_LABEL, ORG_MAX_CELLS, ORG_UNKNOWN, ROW_JOIN, ROW_LABEL } from './constants'
import { rowLabel, toggleForms } from './detail'

// A folder past `max` cells: its last parts that fit after '…/', or its last part cut
function fitFolder(folder: string, max: number): string {
  if (widthOf([{ text: folder }]) <= max) return folder
  const parts = folder.split('/')
  let kept = parts.slice(-1)
  for (let i = parts.length - 2; i >= 0; i--) {
    const more = [parts[i] ?? '', ...kept]
    if (widthOf([{ text: `…/${more.join('/')}` }]) > max) break
    kept = more
  }
  return `…/${fitLine(kept.join('/'), max - 2)}`
}

// '…/<last part>' for a folder of several parts, else the folder
const lastPart = (folder: string): string => (folder.includes('/') ? `…/${folder.split('/').pop() ?? ''}` : folder)

// The full band's plan row, under the project row (the user, 2026-11-11): none in calm mode or with no plan
export function planRow(input: BandInput): Line[] {
  if (input.mode !== 'full' || input.plan === null) return []
  const score: Line = input.score === null || input.isPlanScore === false ? [] : [{ text: ' · ' }, ...scoreSeg(input.score, input.scoreLevel ?? null)]
  return [[rowLabel('plan:'), ...planRowParts(input.plan, input.columns - ROW_LABEL, score)]]
}

const dimSeg = (text: string): Seg => ({ text, tone: 'dim' })

// The signed-in account, after the changes and before the folder and kept in every width form: 'org Personal', 'org <company
// name>' cut to 40 cells, or 'org unknown'. Under REC strict a company name draws '‹org›'; Personal and unknown stay. None
// without an account in the input.
function orgSegs(input: BandInput, sep: Seg): Seg[] {
  const org = input.account?.org
  if (org === undefined) return []
  const isCompany = org !== null && org !== PERSONAL
  const name = org === null ? ORG_UNKNOWN : isCompany && input.rec?.level === 'strict' ? ORG_STRICT : fitLine(org, ORG_MAX_CELLS)
  return [sep, { text: ORG_LABEL, tone: 'dim' }, { text: name }]
}

// The names cut for a row too narrow for any form: the branch to NAME_FLOOR_CELLS cells, then the project down to one, then
// the branch to one, so the segments after them stay whole
function cutNames(project: string, branch: string | null): { project: string; branch: string | null }[] {
  const downTo = (from: number, to: number): number[] => Array.from({ length: Math.max(0, from - to + 1) }, (_, i) => from - i)
  const branchFloor = branch === null ? 0 : Math.min(NAME_FLOOR_CELLS, branch.length)
  return [
    ...(branch === null ? [] : downTo(branch.length - 1, branchFloor).map(cap => ({ project, branch: fitLine(branch, cap) }))),
    ...downTo(project.length - 1, 1).map(cap => ({ project: fitLine(project, cap), branch: branch === null ? null : fitLine(branch, branchFloor) })),
    ...(branch === null ? [] : downTo(branchFloor - 1, 1).map(cap => ({ project: fitLine(project, 1), branch: fitLine(branch, cap) }))),
  ]
}

// The project row (the user, 2026-11-11): 'project: my-app │ git:(develop) +12 −3 │ folder: .claude' - the session's
// project, the branch of the repository holding the folder Claude works in, and that folder when it is not the
// project's root, past 40 cells its last parts after '…/'; short of width the folder takes its last part, then goes
export function placeRow(input: BandInput): Line[] {
  const place = input.session.place
  if (place === undefined) return []
  const sep = dimSeg(ROW_JOIN)
  // The uncommitted changes after the branch, added in the OK colour and removed in the failure one; none when clean
  const changes = place.changes
  const counted: Seg[] = place.branch === null || changes === undefined || changes.added + changes.removed === 0 ? []
    : [{ text: ' ' }, { text: `+${changes.added}`, tone: 'ok' }, { text: ' ' }, { text: `−${changes.removed}`, tone: 'fail' }]
  // Commits ahead of and behind the upstream, in the purple of git:( ), before the changes; a side at 0 left out (the
  // user, 2026-11-12: 'git:(band-order) arrow-up-symbol 1 arrow-down-symbol 2 +41 −30')
  const sync = place.sync
  const synced: Seg[] = place.branch === null || sync === undefined ? [] : [
    ...(sync.ahead > 0 ? [{ text: ' ' }, { text: `↑${sync.ahead}`, tone: 'git' as const }] : []),
    ...(sync.behind > 0 ? [{ text: ' ' }, { text: `↓${sync.behind}`, tone: 'git' as const }] : []),
  ]
  const org = orgSegs(input, sep)
  const line = (folder: string | null, withChanges = true, withSync = true, names = { project: place.project, branch: place.branch }): Line => [
    { text: names.project },
    // git:( and ) purple, the branch yellow, the folder in the text's own colour (the user, 2026-11-11)
    ...(names.branch === null ? [] : [sep, { text: 'git:(', tone: 'git' as const }, { text: names.branch, tone: 'branch' as const }, { text: ')', tone: 'git' as const }]),
    ...(withSync ? synced : []),
    ...(withChanges ? counted : []),
    ...org,
    ...(folder === null ? [] : [sep, dimSeg('folder: '), { text: folder }]),
  ]
  const folder = place.folder
  // Short of width the folder goes first, then the changes, then the commits ahead and behind
  const forms = [...(folder === undefined ? [] : [line(fitFolder(folder, 40)), line(lastPart(folder))]), line(null), line(null, false), line(null, false, false)]
  // Still too wide, the branch and then the project are cut, so the org after them keeps its place and its tone
  const isFit = (candidate: Line): boolean => widthOf(candidate) <= input.columns - ROW_LABEL
  const cut = cutNames(place.project, place.branch).map(names => line(null, false, false, names))
  const form = [...forms, ...cut].find(isFit) ?? forms[forms.length - 1] ?? []
  return [[rowLabel('project:'), ...form]]
}

// The usage row (the user, 2026-11-11): 'usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]', the counts of
// what the detail rows under it list, as text: `bandRows` opens and closes those rows, not a click (spec
// settings-values, S6); short of width its forms drop the compactions, then the rules, the agents and the skills
export function usageRow(input: BandInput): Line[] {
  const texts = toggleForms(input).flatMap(line => line.flatMap(seg => ('text' in seg ? [`[ ${seg.text} ]`] : [])))
  const text = texts.find(candidate => widthOf([{ text: candidate }]) <= input.columns - ROW_LABEL) ?? texts[texts.length - 1]
  // Aqua, as the toggle's button was drawn (the user, 2026-11-11)
  return text === undefined ? [] : [[rowLabel('usage:'), { text, tone: 'counts' }]]
}
