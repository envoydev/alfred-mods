// The Plan tab, the Now tab's PLAN section and the band's plan line, from the plan and scores views to lines of
// styled segments. Every title, note and finding is file content: draw.tsx makes each printable and masks it.
import { bar, mins, oneLine, widthOf } from './format.ts'
import type { Line, Seg } from './band.ts'
import type { PlanView, ScoresView, StepRow } from './plan.ts'
import type { Finding, Scores, StepStatus } from '../types'

const MIN = 60_000
const NOTE = '✎ your note integrated'

const GLYPH: Record<StepStatus, Seg> = {
  done: { text: '✓', tone: 'ok' }, in_progress: { text: '⟳', bold: true }, pending: { text: '·', tone: 'dim' },
  failed: { text: '✗', tone: 'fail' }, blocked: { text: '⊘', tone: 'warn' }, skipped: { text: '–', tone: 'dim' },
}

// A total or a change: whole, or to one decimal on a 10-point scale
const num = (n: number): string => String(Math.round(n * 10) / 10)
// '×1.2'; under 0.1 its first significant digit, '×0.01', never '×0.0'
const ratioText = (r: number): string => (r >= 0.1 ? r.toFixed(1) : r.toPrecision(1))
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)
const agentCount = (k: number): string => `${k} ${k === 1 ? 'agent' : 'agents'}`

// Some open step has an estimate, or the task list has its 3 completed: the time left is known
const hasLeft = (v: PlanView): boolean => v.total - v.finished > v.unestimated
// The task list: no step has an estimate, and it never calibrates
const isTasks = (v: PlanView): boolean => v.isCalibrated && v.rows.every(r => r.step.estimateMin === null)

function planBar(percent: number): Line {
  const [filled, empty] = bar(percent)
  return [{ text: filled, tone: 'plan' }, { text: empty, tone: 'dim' }]
}

// 'Token refresh ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left │ ▶ Update interceptor', or 'Token refresh ▰▰▰▰▰ done ✓ in 1h 19m'
// once every step is finished. Past `columns` the step part goes, then the title is cut.
export function planLine(v: PlanView, columns: number): Line {
  const title = oneLine(v.title, 80)
  const rest: Line = v.isFinished
    ? [...planBar(100), { text: ` done ✓ in ${mins(v.workedMs)}` }]
    : [
      ...planBar(v.percent), { text: ` ${v.finished}/${v.total} · ` }, { text: `${v.percent}%`, tone: 'plan' },
      { text: ` · ${mins(v.workedMs)}${hasLeft(v) ? ` · ≈${mins(v.leftMs)} left` : ''}` },
    ]
  const first = v.running[0]
  const step: Line = first === undefined ? [] : [{ text: ` │ ▶ ${oneLine(first.step.title, 80)}` }]
  if (v.running.length > 1) step.push({ text: ` +${v.running.length - 1}`, tone: 'dim' })
  const full: Line = [{ text: `${title} ` }, ...rest, ...step]
  if (widthOf(full) <= columns) return full
  return [{ text: `${cut(title, columns - widthOf(rest) - 1)} ` }, ...rest]
}

// Under 100 columns: '⟳ S4 12m · 2 agents', the first running step's id and its time
export function narrowPlan(v: PlanView, agents: number): Line {
  const first = v.running[0]
  const head: Seg = v.isFinished ? { text: `✓ done in ${mins(v.workedMs)}`, bold: true }
    : first !== undefined ? { text: `⟳ ${oneLine(first.step.id, 12)} ${mins(first.actualMs)}`, bold: true }
    : { text: `⟳ ${v.finished}/${v.total}`, bold: true }
  return agents > 0 ? [head, { text: ` · ${agentCount(agents)}` }] : [head]
}

// 'done in 24m', '12m of ≈24m', '≈18m', with 'shared' after a shared step's time
function timeOf(r: StepRow): string {
  const s = r.step
  const forecast = r.forecastMs === null ? null : `≈${mins(r.forecastMs)}`
  const time = s.status === 'done' ? (r.actualMs > 0 ? `done in ${mins(r.actualMs)}` : 'done')
    : s.status === 'skipped' ? 'skipped'
    : s.status === 'in_progress' || r.actualMs > 0 ? `${mins(r.actualMs)}${forecast === null ? '' : ` of ${forecast}`}`
    : forecast ?? ''
  return r.isShared && time !== '' ? `${time} shared` : time
}

// A row per step in columns: glyph, id and title with ✎ when a note of yours names it, the time, and the estimate.
// Wider than `columns`, the titles are cut and the mark is ✎ alone, so the time and estimate stay in view.
function stepRows(rows: StepRow[], indent: string, withEstimate: boolean, columns: number): Line[] {
  const times = rows.map(timeOf)
  const timeWidth = Math.max(0, ...times.map(t => t.length))
  const rights = rows.map((r, i) => {
    const est = withEstimate && r.step.estimateMin !== null ? `est ${mins(r.step.estimateMin * MIN)}` : ''
    return est === '' ? times[i] ?? '' : `${(times[i] ?? '').padEnd(timeWidth)}   ${est}`
  })
  const rightWidth = Math.max(0, ...rights.map(t => t.length))
  const natural = rows.map(r => `${oneLine(r.step.id, 12)} ${oneLine(r.step.title, 60)}`.length + (r.notes.length > 0 ? NOTE.length + 3 : 0))
  const room = Math.max(12, columns - indent.length - 2 - (rightWidth > 0 ? rightWidth + 3 : 0))
  const isTight = Math.max(0, ...natural) > room
  const mark = isTight ? '✎' : NOTE
  const lefts = rows.map(r => {
    const id = oneLine(r.step.id, 12)
    const marked = r.notes.length > 0 ? mark.length + (isTight ? 1 : 3) : 0
    return `${id} ${isTight ? cut(oneLine(r.step.title, 60), room - id.length - 1 - marked) : oneLine(r.step.title, 60)}`
  })
  const widths = rows.map((r, i) => (lefts[i] ?? '').length + (r.notes.length > 0 ? mark.length + (isTight ? 1 : 3) : 0))
  const leftWidth = Math.max(0, ...widths)
  const out: Line[] = []
  rows.forEach((r, i) => {
    const line: Line = [{ text: indent }, GLYPH[r.step.status], { text: ` ${lefts[i] ?? ''}` }]
    if (r.notes.length > 0) line.push({ text: isTight ? ' ' : '   ' }, { text: mark, tone: 'plan' })
    const right = rights[i] ?? ''
    if (right !== '') line.push({ text: `${' '.repeat(leftWidth - (widths[i] ?? 0) + 3)}${right}` })
    out.push(line)
    if (withEstimate) for (const note of r.notes) out.push([{ text: `${indent}     '${oneLine(note, 200)}'` }])
  })
  return out
}

// The Now tab's section, first: 'PLAN   Token refresh · 3/5 · ≈30m left of ≈1h 37m', then the last finished step,
// each running step and the next one, without the estimates
export function planSection(v: PlanView, columns: number): Line[] {
  const head: Line = [{ text: 'PLAN', bold: true, tone: 'plan' }, { text: `   ${oneLine(v.title, 60)} · ${v.finished}/${v.total}` }]
  if (v.isFinished) head.push({ text: ` · done in ${mins(v.workedMs)}` })
  else if (hasLeft(v)) head.push({ text: ` · ≈${mins(v.leftMs)} left of ≈${mins(v.totalMs)}` })
  const shown = [v.lastFinished, ...v.running, v.next].filter((r, i, all): r is StepRow => r !== null && all.indexOf(r) === i)
  return [head, ...stepRows(shown, '  ', false, columns)]
}

function deltaSegs(delta: number | null): Line {
  if (delta === null) return []
  if (delta > 0) return [{ text: ` ▲${num(delta)}`, tone: 'ok' }]
  return delta < 0 ? [{ text: ` ▼${num(-delta)}`, tone: 'fail' }] : [{ text: ' =', tone: 'dim' }]
}

const arrow = (d: number): Seg => (d > 0 ? { text: ' ▲', tone: 'ok' } : d < 0 ? { text: ' ▼', tone: 'fail' } : { text: ' =', tone: 'dim' })

// The band's 'score 81 ▲13': the last total and the change from the round before
export function scoreSeg(s: ScoresView): Line {
  const last = s.totals[s.totals.length - 1]
  return last === undefined ? [] : [{ text: `score ${num(last.total)}` }, ...deltaSegs(s.delta)]
}

// '<name> (<kind>) R3 88', for a scores file listed on one line
export function scoresLabel(name: string, s: Scores): string {
  const last = s.rounds[s.rounds.length - 1]
  return `${name} (${s.subject.kind})${last === undefined ? '' : ` R${last.round} ${num(last.total)}`}`
}

const findingText = (f: Finding): string => `${f.id === null ? '' : `${oneLine(f.id, 12)} `}${oneLine(f.text, 80)}${f.by === null ? '' : ` (${oneLine(f.by, 12)})`}`

// '  fixed:  F1 No migration rollback (S3)', the label once and the rest beneath it
function findingRows(label: string, texts: string[]): Line[] {
  return texts.map((text, i) => [{ text: `  ${i === 0 ? label : ' '.repeat(label.length)}  ${text}` }])
}

// Scorer rule 4: the last 4 totals, the change per criterion, the count per severity, and the fixed, improved and
// open findings
function scoreLines(s: ScoresView): Line[] {
  const out: Line[] = [[
    { text: 'Scores', bold: true }, { text: `   ${s.totals.map(t => `R${t.round} ${num(t.total)}`).join(' → ')}` },
    ...deltaSegs(s.delta), { text: `   (scale ${num(s.scale)})`, tone: 'dim' },
  ]]
  if (s.criteria.length > 0) {
    const line: Line = []
    for (const c of s.criteria) {
      line.push({ text: `${line.length === 0 ? '  ' : '   '}${c.name} ` })
      if (s.delta === null) line.push({ text: num(c.last) })
      else if (c.prev === null) line.push({ text: `${num(c.last)} new`, tone: 'dim' })
      else line.push({ text: `${num(c.prev)}→${num(c.last)}` }, arrow(c.last - c.prev))
    }
    out.push(line)
  }
  // A first round has nothing to change from
  const count = (v: ScoresView['severities'][number]): string => (s.delta === null ? `${v.severity} ${v.last}` : `${v.severity} ${v.prev}→${v.last}`)
  if (s.severities.length > 0) out.push([{ text: `  ${s.severities.map(count).join('   ')}` }])
  if (s.hasStatus) {
    out.push(...findingRows('fixed:', s.fixed.map(findingText)), ...findingRows('improved:', s.improved.map(findingText)))
  }
  const open = s.open.slice(0, 3).map(findingText)
  if (s.open.length > 3) open.push(`+${s.open.length - 3} more`)
  out.push(...findingRows('open:', open))
  return out
}

// The Plan tab (Decision 20): the header, a row per step with your notes beneath, the overhead, the scores, the age of
// the last update (amber when stale) and the other plans
export function planLines(
  v: PlanView | null, s: ScoresView | null,
  o: { invalid: boolean; others: string[]; otherScores: string[]; updatedAt: number | null; now: number; columns: number },
): Line[] {
  const out: Line[] = []
  if (v === null) out.push([{ text: 'No plan file in .claude/session-inspector/plans/, and no task list this session.', tone: 'dim' }])
  else {
    const head: Line = [{ text: 'Plan', bold: true, tone: 'plan' }, { text: ` · ${oneLine(v.title, 60)}`, bold: true }, { text: `   ${v.finished}/${v.total}` }]
    if (v.isFinished) head.push({ text: ` · done in ${mins(v.workedMs)}` })
    else if (hasLeft(v)) {
      head.push({ text: ` · ≈${mins(v.totalMs)} total · ≈${mins(v.leftMs)} left` })
      if (!isTasks(v)) head.push(v.isCalibrated ? { text: ` (×${ratioText(v.ratio)})` } : { text: ' (uncalibrated)', tone: 'dim' })
    }
    if (!isTasks(v) && v.unestimated > 0) head.push({ text: ` · ${v.unestimated} without an estimate`, tone: 'dim' })
    out.push(head)
    if (o.invalid) out.push([{ text: 'plan file invalid: showing the last good read', tone: 'warn' }])
    out.push(...stepRows(v.rows, '', true, o.columns))
    for (const note of v.planNotes) out.push([{ text: '✎ ', tone: 'plan' }, { text: `'${oneLine(note, 200)}'` }])
    if (v.overheadMs > 0) out.push([{ text: `Overhead  ${mins(v.overheadMs)}` }])
  }
  if (s !== null) out.push(...scoreLines(s))
  for (const label of o.otherScores.slice(0, 3)) out.push([{ text: label, tone: 'dim' }])
  if (v !== null && o.updatedAt !== null) {
    out.push([{ text: `last update ${mins(Math.max(0, o.now - o.updatedAt))} ago`, tone: v.staleMs === null ? 'dim' : 'warn' }])
  }
  if (o.others.length > 0) out.push([{ text: `Other plans: ${o.others.join(', ')}   /inspect plan <name>`, tone: 'dim' }])
  return out
}
