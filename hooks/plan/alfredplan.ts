// Alfred Code's plan folder (alfred-code's plan folder contract, schema 1, the user's ruling of 2026-11-13):
import type { Plan, PlanStep, ScoreRound, Scores, Severity, StepStatus } from './types'
// `status.json` read as a plan and `scoring.json` as that plan's scores, so the band, the Plan tab and the step times
// treat them as any other plan. A file breaking the contract reads as null, which keeps its last good read.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

function json(text: string): Obj | null {
  try {
    const v: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

// The contract's five words; `todo` is the mod's pending
const STATUSES: Record<string, StepStatus> = { todo: 'pending', in_progress: 'in_progress', blocked: 'blocked', done: 'done', failed: 'failed' }

function taskOf(v: unknown): PlanStep | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '' || typeof v.title !== 'string') return null
  const status = typeof v.status === 'string' && Object.hasOwn(STATUSES, v.status) ? STATUSES[v.status] : undefined
  if (status === undefined) return null
  if (!(v.estimateMin === null || v.estimateMin === undefined || isWhole(v.estimateMin))) return null
  return { id: v.id, title: v.title, status, estimateMin: isWhole(v.estimateMin) ? v.estimateMin : null, startedAt: time(v.startedAt), doneAt: time(v.doneAt) }
}

export function parseAlfredStatus(text: string): Plan | null {
  const v = json(text)
  if (v === null || v.schema !== 1 || typeof v.title !== 'string' || v.title === '' || !Array.isArray(v.tasks) || v.tasks.length === 0) return null
  const steps = v.tasks.map(taskOf)
  if (steps.some(s => s === null)) return null
  return {
    title: v.title, updatedAt: time(v.updatedAt), steps: steps as PlanStep[], changes: [],
    approvedAt: time(v.approvedAt), completedAt: time(v.completedAt),
  }
}

const SEVERITIES: readonly Severity[] = ['BLOCKER', 'MATERIAL', 'MINOR']

function roundOf(v: unknown): ScoreRound | null {
  if (!isObj(v) || !isWhole(v.round) || typeof v.total !== 'number' || !Number.isFinite(v.total)) return null
  const counts: Partial<Record<Severity, number>> = {}
  if (isObj(v.severities)) for (const s of SEVERITIES) if (isWhole(v.severities[s])) counts[s] = v.severities[s]
  return { round: v.round, at: time(v.at), total: v.total, criteria: {}, findings: [], counts }
}

// `ref`: the plan folder's name, which the plan's own name is too
export function parseAlfredScoring(text: string, ref: string): Scores | null {
  const v = json(text)
  if (v === null || v.schema !== 1 || typeof v.scale !== 'number' || !(v.scale > 0) || !Array.isArray(v.rounds)) return null
  const rounds = v.rounds.map(roundOf)
  if (rounds.some(r => r === null)) return null
  const sorted = (rounds as ScoreRound[]).sort((a, b) => a.round - b.round)
  const released = v.released ?? null
  if (released !== null && !sorted.some(r => r.round === released)) return null
  const newest = sorted.reduce<number | null>((n, r) => (r.at !== null && (n === null || r.at > n) ? r.at : n), null)
  return { subject: { kind: 'plan', ref }, updatedAt: newest, scale: v.scale, rounds: sorted, released: released as number | null }
}
