// The handoff's types
import type { Severity, StepStatus } from '../plan/types'
import type { Runway } from '../stack/types'
import type { Handoff, HandoffMode, SaveResult } from '../../types'
export type { Handoff, HandoffMode, SaveResult }

export type PlanPart = {
  file: string; title: string; finished: number; total: number
  steps: { id: string; title: string; status: StepStatus; actualMs: number; forecastMs: number | null; notes: number }[]
}

export type ScoresPart = { name: string; totals: { round: number; total: number }[]; open: { id: string | null; text: string; severity: Severity | null }[] }

// What a save copies: only what is on disk in the project or what the mod counts, never a prompt, a note's text, a
// tool input, a failure's reason or an agent's description
export type SaveInput = {
  at: number; percent: number | null; threshold: number; session: string; model: string | null; git: string[]
  plan: PlanPart | 'tasks' | null; scores: ScoresPart | null
  counts: { turn: number; durationMs: number | null; calls: number; failed: number; agents: number; costUsd: number | null; isEstimate: boolean }
}

// What the Now tab's HANDOFF section reads: the atom with F8's context percent, whether a main-loop turn runs and
// Alfred Code's runway, which the stood-down row measures against
export type HandoffView = Pick<Handoff, 'mode' | 'threshold' | 'isAskUp' | 'point' | 'handled' | 'lastSave' | 'alfred'> & {
  percent: number | null; window: number | null; isWorking: boolean; runway: Runway | null
}

// Who asked for a save: auto mode, a press of h or 4 or `/auto-handoff now`, or c, which compacts after it
export type SaveTrigger = 'auto' | 'press' | 'compact'
