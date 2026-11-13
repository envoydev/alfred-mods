// Alfred Code's plan folder (alfred-code's plan folder contract, schema 1, the user's ruling of 2026-11-13):
import type { Plan, PlanStep, ScoreRound, Scores, Severity, StepStatus } from './types'
// `status.json` read as a plan and `scoring.json` as that plan's scores, so the band, the Plan tab and the step times
// treat them as any other plan. A file breaking the contract reads as null, which keeps its last good read.

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const time = (value: unknown): number | null => {
  const t = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : null
}

function json(text: string): Obj | null {
  try {
    const value: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObj(value) ? value : null
  } catch {
    return null
  }
}

// The contract's five words; `todo` is the mod's pending
const STATUSES: Record<string, StepStatus> = { todo: 'pending', in_progress: 'in_progress', blocked: 'blocked', done: 'done', failed: 'failed' }

function taskOf(value: unknown): PlanStep | null {
  if (!isObj(value) || typeof value.id !== 'string' || value.id === '' || typeof value.title !== 'string') return null
  const status = typeof value.status === 'string' && Object.hasOwn(STATUSES, value.status) ? STATUSES[value.status] : undefined
  if (status === undefined) return null
  if (!(value.estimateMin === null || value.estimateMin === undefined || isWhole(value.estimateMin))) return null
  return { id: value.id, title: value.title, status, estimateMin: isWhole(value.estimateMin) ? value.estimateMin : null, startedAt: time(value.startedAt), doneAt: time(value.doneAt) }
}

export function parseAlfredStatus(text: string): Plan | null {
  const value = json(text)
  if (value === null || value.schema !== 1 || typeof value.title !== 'string' || value.title === '' || !Array.isArray(value.tasks) || value.tasks.length === 0) return null
  const steps = value.tasks.map(taskOf)
  if (steps.some(s => s === null)) return null
  return {
    title: value.title, updatedAt: time(value.updatedAt), steps: steps as PlanStep[], changes: [],
    approvedAt: time(value.approvedAt), completedAt: time(value.completedAt),
  }
}

const SEVERITIES: readonly Severity[] = ['BLOCKER', 'MATERIAL', 'MINOR']

function roundOf(value: unknown): ScoreRound | null {
  if (!isObj(value) || !isWhole(value.round) || typeof value.total !== 'number' || !Number.isFinite(value.total)) return null
  const counts: Partial<Record<Severity, number>> = {}
  if (isObj(value.severities)) for (const s of SEVERITIES) if (isWhole(value.severities[s])) counts[s] = value.severities[s]
  return { round: value.round, at: time(value.at), total: value.total, criteria: {}, findings: [], counts }
}

// `ref`: the plan folder's name, which the plan's own name is too
export function parseAlfredScoring(text: string, ref: string): Scores | null {
  const value = json(text)
  if (value === null || value.schema !== 1 || typeof value.scale !== 'number' || !(value.scale > 0) || !Array.isArray(value.rounds)) return null
  const rounds = value.rounds.map(roundOf)
  if (rounds.some(r => r === null)) return null
  const sorted = (rounds as ScoreRound[]).sort((a, b) => a.round - b.round)
  const released = value.released ?? null
  if (released !== null && !sorted.some(r => r.round === released)) return null
  const newest = sorted.reduce<number | null>((n, r) => (r.at !== null && (n === null || r.at > n) ? r.at : n), null)
  return { subject: { kind: 'plan', ref }, updatedAt: newest, scale: value.scale, rounds: sorted, released: released as number | null }
}
