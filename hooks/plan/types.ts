// The plan's types: plans, scores, step times and the drawn plan
import type { Outcome } from '../tools/types'
import type { Credit, Finding, Plan, PlanChange, PlanStep, Plans, ScoreRound, Scores, Severity, Slice, StepStatus, StepTime, TaskItem, Watched } from '../../types'
export type { Credit, Finding, Plan, PlanChange, PlanStep, Plans, ScoreRound, Scores, Severity, Slice, StepStatus, StepTime, TaskItem, Watched }

export type StepRow = { step: PlanStep; actualMs: number; forecastMs: number | null; isShared: boolean; notes: string[] }

export type PlanView = {
  title: string; finished: number; total: number; percent: number
  running: StepRow[]; next: StepRow | null; lastFinished: StepRow | null; rows: StepRow[]
  workedMs: number; overheadMs: number; leftMs: number; totalMs: number
  ratio: number; isCalibrated: boolean; unestimated: number; isFinished: boolean; staleMs: number | null; planNotes: string[]
  // Alfred Code's plan before its approval
  isAwaiting: boolean
}

// `shown`: the round whose total is the score, the released one when the writer names it, else the newest;
// `isGrading`: Alfred Code's grading still runs, so that total may change
export type ScoresView = {
  scale: number; totals: { round: number; total: number }[]; delta: number | null
  shown: { round: number; total: number }; isGrading: boolean
  criteria: { name: string; prev: number | null; last: number }[]
  severities: { severity: Severity; prev: number; last: number }[]
  fixed: Finding[]; improved: Finding[]; open: Finding[]; hasStatus: boolean
}

export type NamedStep = { plan: string | null; task: string | null }

export type CloseTarget = { steps: string[]; isShared: boolean } | 'overhead' | null

// The store keys a loop's span is split among, equally; none: the span is taken and goes nowhere, or to the task list
export type SliceClose = { loop: string; keys: string[]; isShared: boolean }

export type TimeEntries = Record<string, unknown>

// A settled call, for the person's wait inside it
export type CallWait = { tool: string; ms: number; isMain: boolean; isAsked: boolean; outcome: Outcome | null; durationMs: number | null }

// What the band and the Plan tab draw of the plans (Decisions 5, 7, 18): the tab the shown plan or task list, the
// band the one this session's time goes to, only while it runs or for 10 minutes after it finished this session;
// their scores, else the newest; the rest
export type PlanDrawing = {
  shown: PlanView | null; band: PlanView | null; invalid: boolean; scores: ScoresView | null; score: ScoresView | null
  isPlanScore: boolean; others: string[]; otherScores: string[]; updatedAt: number | null
}
