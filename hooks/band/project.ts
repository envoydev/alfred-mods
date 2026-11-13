// The band's project rows: the plan, the place (project, folder, branch) and the usage summary
import { fitLine, widthOf } from '../core/format'
import { planRowParts, scoreSeg } from '../plan/planlines'
import type { BandInput } from './types'
import type { Line, Seg } from '../core/types'
import { ROW_JOIN, ROW_LABEL, rowLabel, toggleForms } from './detail'

// The labels' width, so the items of every row line up, and the band rows' joiner, as the owner's target draws them
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
export function planRow(b: BandInput): Line[] {
  if (b.mode !== 'full' || b.plan === null) return []
  const score: Line = b.score === null || b.isPlanScore === false ? [] : [{ text: ' · ' }, ...scoreSeg(b.score, b.scoreLevel ?? null)]
  return [[{ text: 'plan:'.padEnd(ROW_LABEL), tone: 'dim' }, ...planRowParts(b.plan, b.columns - ROW_LABEL, score)]]
}

const dimSeg = (text: string): Seg => ({ text, tone: 'dim' })

// The project row (the user, 2026-11-11): 'project: my-app │ git:(develop) +12 −3 │ folder: .claude' - the session's
// project, the branch of the repository holding the folder Claude works in, and that folder when it is not the
// project's root, past 40 cells its last parts after '…/'; short of width the folder takes its last part, then goes
export function placeRow(b: BandInput): Line[] {
  const place = b.meta.place
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
  const line = (folder: string | null, withChanges = true, withSync = true): Line => [
    { text: place.project },
    // git:( and ) purple, the branch yellow, the folder in the text's own colour (the user, 2026-11-11)
    ...(place.branch === null ? [] : [sep, { text: 'git:(', tone: 'git' as const }, { text: place.branch, tone: 'branch' as const }, { text: ')', tone: 'git' as const }]),
    ...(withSync ? synced : []),
    ...(withChanges ? counted : []),
    ...(folder === null ? [] : [sep, dimSeg('folder: '), { text: folder }]),
  ]
  const folder = place.folder
  // Short of width the folder goes first, then the changes, then the commits ahead and behind
  const forms = [...(folder === undefined ? [] : [line(fitFolder(folder, 40)), line(lastPart(folder))]), line(null), line(null, false), line(null, false, false)]
  const form = forms.find(f => widthOf(f) <= b.columns - ROW_LABEL) ?? forms[forms.length - 1] ?? []
  return [[rowLabel('project:'), ...form]]
}

// The usage row (the user, 2026-11-11): 'usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]', the counts of
// what the detail rows under it list, as text: `bandRows` opens and closes those rows, not a click (spec
// settings-values, S6); short of width its forms drop the rules, then the agents, then the skills
export function usageRow(b: BandInput): Line[] {
  const texts = toggleForms(b).flatMap(l => l.flatMap(s => ('text' in s ? [`[ ${s.text} ]`] : [])))
  const text = texts.find(t => widthOf([{ text: t }]) <= b.columns - ROW_LABEL) ?? texts[texts.length - 1]
  // Aqua, as the toggle's button was drawn (the user, 2026-11-11)
  return text === undefined ? [] : [[rowLabel('usage:'), { text, tone: 'counts' }]]
}
