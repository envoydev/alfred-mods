// The Plan tab, the Now tab's PLAN section and the band's plan line, from the plan and scores views to lines of
// styled segments. Every title, note and finding is file content: draw.tsx makes each printable and masks it.
import { barText, fitLine, minutesText, widthOf } from '../core/format'
import type { Line, Seg } from '../core/types'
import type { Finding, PlanView, Scores, ScoresView, StepRow, StepStatus } from './types'

const MIN = 60_000
const NOTE = '✎ your note integrated'

const GLYPH: Record<StepStatus, Seg> = {
  done: { text: '✓', tone: 'ok' }, in_progress: { text: '⟳', bold: true }, pending: { text: '·', tone: 'dim' },
  failed: { text: '✗', tone: 'fail' }, blocked: { text: '⊘', tone: 'warn' }, skipped: { text: '–', tone: 'dim' },
}

// A total or a change: whole, or to one decimal on a 10-point scale
const num = (value: number): string => String(Math.round(value * 10) / 10)
// '×1.2'; under 0.1 its first significant digit, '×0.01', never '×0.0'
const ratioText = (ratio: number): string => (ratio >= 0.1 ? ratio.toFixed(1) : ratio.toPrecision(1))
// Cut on the masked text, never inside a REC token
const cut = (text: string, max: number): string => fitLine(text, Math.max(2, max))
const agentCount = (count: number): string => `${count} ${count === 1 ? 'agent' : 'agents'}`

// Some open step has an estimate, or the task list has its 3 completed: the time left is known
const hasLeft = (view: PlanView): boolean => view.total - view.finished > view.unestimated
// The task list: no step has an estimate, and it never calibrates
const isTasks = (view: PlanView): boolean => view.isCalibrated && view.rows.every(row => row.step.estimateMin === null)

function planBar(percent: number): Line {
  const [filled, empty] = barText(percent)
  return [{ text: filled, tone: 'plan' }, { text: empty, tone: 'dim' }]
}

// 'Token refresh ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left │ ▶ Update interceptor', or 'Token refresh ▰▰▰▰▰ done ✓ in 1h 19m'
// once every step is finished. Past `columns` the step part goes, then the title is cut.
export function planLine(view: PlanView, columns: number): Line {
  const title = fitLine(view.title, 80)
  const rest: Line = view.isFinished
    ? [...planBar(100), { text: ` done ✓ in ${minutesText(view.workedMs)}` }]
    : [
      ...planBar(view.percent), { text: ` ${view.finished}/${view.total} · ` }, { text: `${view.percent}%`, tone: 'plan' },
      { text: ` · ${minutesText(view.workedMs)}${hasLeft(view) ? ` · ≈${minutesText(view.leftMs)} left` : ''}` },
    ]
  const first = view.running[0]
  const step: Line = first === undefined ? [] : [{ text: ` │ ▶ ${fitLine(first.step.title, 80)}` }]
  if (view.running.length > 1) step.push({ text: ` +${view.running.length - 1}`, tone: 'dim' })
  const full: Line = [{ text: `${title} ` }, ...rest, ...step]
  if (widthOf(full) <= columns) return full
  return [{ text: `${cut(title, columns - widthOf(rest) - 1)} ` }, ...rest]
}

// The full band's plan row after its label (the owner's target, 2026-11-11): 'Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update
// interceptor', a dim ' +1' for each further running step, ' · done ✓' once finished, ' · awaiting approval' for
// Alfred Code's plan before its approval, the count alone with none running; then `tail`, the plan's score. Past
// `columns` the step's title is cut, then the step goes, then the plan's title is cut; the score goes last.
export function planRowParts(view: PlanView, columns: number, tail: Line = []): Line {
  const count: Line = [{ text: ' ' }, ...planBar(view.percent), { text: ` ${view.finished}/${view.total}` }]
  // The score stays while the plan's title keeps 4 cells beside it and the count, or the count and ' · done ✓'
  const after = view.isFinished ? widthOf(count) + widthOf([{ text: ' · done ✓' }]) : widthOf(count)
  const keepsTail = tail.length > 0 && columns - widthOf(tail) - after >= 4
  const body = planBody(view, keepsTail ? columns - widthOf(tail) : columns, count)
  return keepsTail ? [...body, ...tail] : body
}

function planBody(view: PlanView, columns: number, count: Line): Line {
  const title = fitLine(view.title, 80)
  const first = view.running[0]
  // The title with `after`, the title cut to fit; with no room for 4 cells of title, the title alone, cut
  const titled = (after: Line): Line =>
    widthOf([{ text: title }, ...after]) <= columns ? [{ text: title }, ...after]
      : columns - widthOf(after) >= 4 ? [{ text: cut(title, columns - widthOf(after)) }, ...after]
      : [{ text: cut(title, Math.max(1, columns)) }]
  if (view.isFinished) {
    const done: Line = [...count, { text: ' · done ' }, { text: '✓', tone: 'ok' }]
    return columns - widthOf(done) >= 4 ? titled(done) : titled(count)
  }
  const bare: Line = [{ text: title }, ...count]
  if (view.isAwaiting) {
    const awaiting: Line = [...bare, { text: ' · awaiting approval', tone: 'warn' }]
    if (widthOf(awaiting) <= columns) return awaiting
  }
  if (first === undefined || view.isAwaiting) return titled(count)
  const more: Line = view.running.length > 1 ? [{ text: ` +${view.running.length - 1}`, tone: 'dim' }] : []
  const lead = ` · ▸ ${fitLine(first.step.id, 12)} `
  const stepTitle = fitLine(first.step.title, 80)
  const full: Line = [...bare, { text: `${lead}${stepTitle}` }, ...more]
  if (widthOf(full) <= columns) return full
  const room = columns - widthOf(bare) - widthOf([{ text: lead }, ...more])
  if (room >= 4) return [...bare, { text: `${lead}${cut(stepTitle, room)}` }, ...more]
  return titled(count)
}

// Under 100 columns: '⟳ S4 12m · 2 agents', the first running step's id and its time
export function narrowPlan(view: PlanView, agents: number): Line {
  const first = view.running[0]
  const head: Seg = view.isFinished ? { text: `✓ done in ${minutesText(view.workedMs)}`, bold: true }
    : first !== undefined ? { text: `⟳ ${fitLine(first.step.id, 12)} ${minutesText(first.actualMs)}`, bold: true }
    : { text: `⟳ ${view.finished}/${view.total}`, bold: true }
  return agents > 0 ? [head, { text: ` · ${agentCount(agents)}` }] : [head]
}

// 'done in 24m', '12m of ≈24m', '≈18m', with 'shared' after a shared step's time
function timeOf(row: StepRow): string {
  const step = row.step
  const forecast = row.forecastMs === null ? null : `≈${minutesText(row.forecastMs)}`
  const time = step.status === 'done' ? (row.actualMs > 0 ? `done in ${minutesText(row.actualMs)}` : 'done')
    : step.status === 'skipped' ? 'skipped'
    : step.status === 'in_progress' || row.actualMs > 0 ? `${minutesText(row.actualMs)}${forecast === null ? '' : ` of ${forecast}`}`
    : forecast ?? ''
  return row.isShared && time !== '' ? `${time} shared` : time
}

// A row per step in columns: glyph, id and title with ✎ when a note of yours names it, the time, and the estimate.
// Wider than `columns`, the titles are cut and the mark is ✎ alone, so the time and estimate stay in view.
function stepRows(rows: StepRow[], indent: string, withEstimate: boolean, columns: number): Line[] {
  const times = rows.map(timeOf)
  const timeWidth = Math.max(0, ...times.map(text => text.length))
  const ests = rows.map(row => (withEstimate && row.step.estimateMin !== null ? `est ${minutesText(row.step.estimateMin * MIN)}` : ''))
  const rights = rows.map((_, i) => (ests[i] === '' ? times[i] ?? '' : `${(times[i] ?? '').padEnd(timeWidth)}   ${ests[i] ?? ''}`))
  const rightWidth = Math.max(0, ...rights.map(text => text.length))
  const natural = rows.map(row => `${fitLine(row.step.id, 12)} ${fitLine(row.step.title, 60)}`.length + (row.notes.length > 0 ? NOTE.length + 3 : 0))
  const room = Math.max(12, columns - indent.length - 2 - (rightWidth > 0 ? rightWidth + 3 : 0))
  const isTight = Math.max(0, ...natural) > room
  const mark = isTight ? '✎' : NOTE
  const lefts = rows.map(row => {
    const id = fitLine(row.step.id, 12)
    const marked = row.notes.length > 0 ? mark.length + (isTight ? 1 : 3) : 0
    return `${id} ${isTight ? cut(fitLine(row.step.title, 60), room - id.length - 1 - marked) : fitLine(row.step.title, 60)}`
  })
  const widths = rows.map((row, i) => (lefts[i] ?? '').length + (row.notes.length > 0 ? mark.length + (isTight ? 1 : 3) : 0))
  const leftWidth = Math.max(0, ...widths)
  const out: Line[] = []
  rows.forEach((row, i) => {
    const line: Line = [{ text: indent }, GLYPH[row.step.status], { text: ` ${lefts[i] ?? ''}` }]
    if (row.notes.length > 0) line.push({ text: isTight ? ' ' : '   ' }, { text: mark, tone: 'plan' })
    // The time and estimate start at one column: the gap a margin, the time a cell as wide as the longest
    const gap = leftWidth - (widths[i] ?? 0) + 3
    const time = times[i] ?? ''
    const est = ests[i] ?? ''
    if (est !== '') {
      line.push({ text: ' '.repeat(gap) })
      if (timeWidth > 0) line.push({ text: time, width: timeWidth })
      line.push({ text: `   ${est}` })
    } else if (time !== '') line.push({ text: `${' '.repeat(gap)}${time}` })
    out.push(line)
    if (withEstimate) for (const note of row.notes) out.push([{ text: `${indent}     '${fitLine(note, 200)}'` }])
  })
  return out
}

// The Now tab's section, first: 'PLAN   Token refresh · 3/5 · ≈30m left of ≈1h 37m', then the last finished step,
// each running step and the next one, without the estimates
export function planSection(view: PlanView, columns: number): Line[] {
  const head: Line = [{ text: 'PLAN', bold: true, tone: 'plan' }, { text: `   ${fitLine(view.title, 60)} · ${view.finished}/${view.total}` }]
  if (view.isFinished) head.push({ text: ` · done in ${minutesText(view.workedMs)}` })
  else if (hasLeft(view)) head.push({ text: ` · ≈${minutesText(view.leftMs)} left of ≈${minutesText(view.totalMs)}` })
  const shown = [view.lastFinished, ...view.running, view.next].filter((row, i, all): row is StepRow => row !== null && all.indexOf(row) === i)
  return [head, ...stepRows(shown, '  ', false, columns)]
}

function deltaSegs(delta: number | null): Line {
  if (delta === null) return []
  if (delta > 0) return [{ text: ` ▲${num(delta)}`, tone: 'ok' }]
  return delta < 0 ? [{ text: ` ▼${num(-delta)}`, tone: 'fail' }] : [{ text: ' =', tone: 'dim' }]
}

const arrow = (delta: number): Seg => (delta > 0 ? { text: ' ▲', tone: 'ok' } : delta < 0 ? { text: ' ▼', tone: 'fail' } : { text: ' =', tone: 'dim' })

// The band's 'score 81 ▲13': the shown round's total (Alfred Code's released round, else the last), a dim 'grading'
// while Alfred Code's grading runs (a dim 'withheld' once it withheld the plan), and the change from the round before; against `level`, Alfred Code's scoring
// level, green at or above it and amber under it, no colour without one
export function scoreSeg(scoresView: ScoresView, level: number | null = null): Line {
  const total = scoresView.shown.total
  const score: Seg = level === null ? { text: `score ${num(total)}` } : { text: `score ${num(total)}`, tone: (total * 100) / scoresView.scale >= level ? 'ok' : 'warn' }
  return [score, ...(scoresView.isGrading ? [{ text: ' grading', tone: 'dim' } as Seg] : scoresView.isWithheld === true ? [{ text: ' withheld', tone: 'dim' } as Seg] : []), ...deltaSegs(scoresView.delta)]
}

// '<name> (<kind>) R3 88', for a scores file listed on one line
export function scoresLabel(name: string, scores: Scores): string {
  const last = scores.rounds[scores.rounds.length - 1]
  return `${name} (${scores.subject.kind})${last === undefined ? '' : ` R${last.round} ${num(last.total)}`}`
}

const findingText = (finding: Finding): string =>
  `${finding.id === null ? '' : `${fitLine(finding.id, 12)} `}${fitLine(finding.text, 80)}${finding.by === null ? '' : ` (${fitLine(finding.by, 12)})`}`

// '  fixed:  F1 No migration rollback (S3)', the label once and the rest beneath it
function findingRows(label: string, texts: string[]): Line[] {
  return texts.map((text, i) => [{ text: `  ${i === 0 ? label : ' '.repeat(label.length)}  ${text}` }])
}

// Scorer rule 4: the last 4 totals, the change per criterion, the count per severity, and the fixed, improved and
// open findings
function scoreLines(scoresView: ScoresView): Line[] {
  const out: Line[] = [[
    { text: 'Scores', bold: true }, { text: `   ${scoresView.totals.map(point => `R${point.round} ${num(point.total)}`).join(' → ')}` },
    ...deltaSegs(scoresView.delta), { text: `   (scale ${num(scoresView.scale)})`, tone: 'dim' },
  ]]
  if (scoresView.criteria.length > 0) {
    const line: Line = []
    for (const criterion of scoresView.criteria) {
      line.push({ text: `${line.length === 0 ? '  ' : '   '}${criterion.name} ` })
      if (scoresView.delta === null) line.push({ text: num(criterion.last) })
      else if (criterion.prev === null) line.push({ text: `${num(criterion.last)} new`, tone: 'dim' })
      else line.push({ text: `${num(criterion.prev)}→${num(criterion.last)}` }, arrow(criterion.last - criterion.prev))
    }
    out.push(line)
  }
  // A first round has nothing to change from
  const count = (severityRow: ScoresView['severities'][number]): string => (scoresView.delta === null ? `${severityRow.severity} ${severityRow.last}` : `${severityRow.severity} ${severityRow.prev}→${severityRow.last}`)
  if (scoresView.severities.length > 0) out.push([{ text: `  ${scoresView.severities.map(count).join('   ')}` }])
  if (scoresView.hasStatus) {
    out.push(...findingRows('fixed:', scoresView.fixed.map(findingText)), ...findingRows('improved:', scoresView.improved.map(findingText)))
  }
  const open = scoresView.open.slice(0, 3).map(findingText)
  if (scoresView.open.length > 3) open.push(`+${scoresView.open.length - 3} more`)
  out.push(...findingRows('open:', open))
  return out
}

// The Plan tab (Decision 20): the header, a row per step with your notes beneath, the overhead, the scores, the age of
// the last update (amber when stale) and the other plans
export function planLines(
  view: PlanView | null, scoresView: ScoresView | null,
  options: { invalid: boolean; others: string[]; otherScores: string[]; updatedAt: number | null; now: number; columns: number },
): Line[] {
  const out: Line[] = []
  if (view === null) out.push([{ text: 'No plan file in .claude/session-inspector/plans/, and no task list this session.', tone: 'dim' }])
  else {
    const head: Line = [{ text: 'Plan', bold: true, tone: 'plan' }, { text: ` · ${fitLine(view.title, 60)}`, bold: true }, { text: `   ${view.finished}/${view.total}` }]
    if (view.isFinished) head.push({ text: ` · done in ${minutesText(view.workedMs)}` })
    else if (hasLeft(view)) {
      head.push({ text: ` · ≈${minutesText(view.totalMs)} total · ≈${minutesText(view.leftMs)} left` })
      if (!isTasks(view)) head.push(view.isCalibrated ? { text: ` (×${ratioText(view.ratio)})` } : { text: ' (uncalibrated)', tone: 'dim' })
    }
    if (!isTasks(view) && view.unestimated > 0) head.push({ text: ` · ${view.unestimated} without an estimate`, tone: 'dim' })
    out.push(head)
    if (options.invalid) out.push([{ text: 'plan file invalid: showing the last good read', tone: 'warn' }])
    out.push(...stepRows(view.rows, '', true, options.columns))
    for (const note of view.planNotes) out.push([{ text: '✎ ', tone: 'plan' }, { text: `'${fitLine(note, 200)}'` }])
    if (view.overheadMs > 0) out.push([{ text: `Overhead  ${minutesText(view.overheadMs)}` }])
  }
  if (scoresView !== null) out.push(...scoreLines(scoresView))
  for (const label of options.otherScores.slice(0, 3)) out.push([{ text: label, tone: 'dim' }])
  if (view !== null && options.updatedAt !== null) {
    out.push([{ text: `last update ${minutesText(Math.max(0, options.now - options.updatedAt))} ago`, tone: view.staleMs === null ? 'dim' : 'warn' }])
  }
  if (options.others.length > 0) out.push([{ text: `Other plans: ${options.others.join(', ')}   /inspect plan <name>`, tone: 'dim' }])
  return out
}
