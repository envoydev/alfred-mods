// Plan and scores fixtures shared by the plan tests
import { parsePlan } from '../hooks/plan/plan'
import type { Plan, PlanStep, StepStatus, StepTime } from '../hooks/plan/types'

// The brief's two examples ('Data contracts for the plan and scorer skills'), verbatim
export const PLAN_JSON = `{
  "version": 1,
  "slug": "token-refresh",
  "title": "Token refresh",
  "updatedAt": "2026-10-27T14:22:00Z",
  "steps": [
    { "id": "S1", "title": "Add refresh endpoint", "status": "done", "estimateMin": 15, "startedAt": "2026-10-27T13:20:00Z", "doneAt": "2026-10-27T13:40:00Z" },
    { "id": "S2", "title": "Rotate tokens", "status": "done", "estimateMin": 20, "startedAt": "2026-10-27T13:41:00Z", "doneAt": "2026-10-27T14:10:00Z" },
    { "id": "S3", "title": "Migration with rollback", "status": "done", "estimateMin": 10, "startedAt": "2026-10-27T14:11:00Z", "doneAt": "2026-10-27T14:21:00Z" },
    { "id": "S4", "title": "Update interceptor", "status": "in_progress", "estimateMin": 20, "startedAt": "2026-10-27T14:22:00Z" },
    { "id": "S5", "title": "E2E tests", "status": "pending", "estimateMin": 15 }
  ],
  "changes": [
    { "at": "2026-10-27T13:05:00Z", "kind": "created", "source": "claude" },
    { "at": "2026-10-27T14:05:00Z", "kind": "integrated", "step": "S2", "source": "user", "note": "Use sliding expiry, not fixed 15 min" }
  ]
}`

export const SCORES_JSON = `{
  "version": 1,
  "slug": "token-refresh",
  "subject": { "kind": "plan", "ref": "token-refresh" },
  "updatedAt": "2026-10-27T14:25:00Z",
  "scale": 100,
  "rounds": [
    { "round": 1, "at": "2026-10-27T13:10:00Z", "total": 68,
      "criteria": { "correctness": 70, "risk": 50, "completeness": 80 },
      "findings": [ { "id": "F1", "text": "No migration rollback", "severity": "BLOCKER" } ] },
    { "round": 2, "at": "2026-10-27T14:25:00Z", "total": 81,
      "criteria": { "correctness": 80, "risk": 80, "completeness": 80 },
      "findings": [ { "id": "F2", "text": "No load test for refresh storm", "severity": "MATERIAL" } ] }
  ]
}`

// Task 2's fixture: the plan example with S1 18m, S2 24m, S3 12m and S4 12m worked and 6m of overhead, at 14:30,
// so the ratio is exactly 1.2 (54 over 45 minutes)
export const MIN = 60_000
export const FIVE: Plan = parsePlan(PLAN_JSON) as Plan
export const FIVE_TIMES: Record<string, StepTime> = {
  S1: { ms: 18 * MIN, isShared: false }, S2: { ms: 24 * MIN, isShared: false },
  S3: { ms: 12 * MIN, isShared: false }, S4: { ms: 12 * MIN, isShared: false },
}
export const FIVE_OVERHEAD = 6 * MIN
export const NOW = Date.parse('2026-10-27T14:30:00Z')

// FIVE with each step's status (or more) changed: `{ S4: 'done' }`, `{ S5: { estimateMin: null } }`
export function planOf(changes: Record<string, StepStatus | Partial<PlanStep>>, extra: PlanStep[] = [], plan: Plan = FIVE): Plan {
  const steps = plan.steps.map(s => {
    const c = changes[s.id]
    return c === undefined ? s : typeof c === 'string' ? { ...s, status: c } : { ...s, ...c }
  })
  return { ...plan, steps: [...steps, ...extra] }
}

type PlanJson = { title: string; updatedAt: string; steps: { id: string; title: string; status: string }[]; changes: object[] }

// The plan example as file text, its steps' statuses changed, more changes appended, then anything else edited
export function planText(statuses: Record<string, string> = {}, changes: object[] = [], edit?: (p: PlanJson) => void): string {
  const p = JSON.parse(PLAN_JSON) as PlanJson
  for (const s of p.steps) s.status = statuses[s.id] ?? s.status
  p.changes.push(...changes)
  edit?.(p)
  return JSON.stringify(p)
}

// alfred-code's plan folder contract (schema 1, the user's ruling of 2026-11-13): `<plan folder>/status.json` and
// `<plan folder>/scoring.json`, the contract's two examples verbatim
export const STATUS_JSON = `{
  "schema": 1,
  "title": "Waste bin (plannings)",
  "updatedAt": "2026-11-13T11:40Z",
  "approvedAt": "2026-11-13T09:55Z",
  "completedAt": null,
  "tasks": [
    { "id": "1", "title": "Menu tile and its icon", "status": "blocked", "estimateMin": 45,
      "startedAt": "2026-11-13T10:12Z", "doneAt": null },
    { "id": "2", "title": "Load the deleted plannings", "status": "done", "estimateMin": 80,
      "startedAt": "2026-11-13T10:40Z", "doneAt": "2026-11-13T11:35Z" },
    { "id": "3", "title": "Restore deleted plan books", "status": "in_progress", "estimateMin": 105,
      "startedAt": "2026-11-13T11:36Z", "doneAt": null },
    { "id": "4", "title": "SignalR load and restore", "status": "todo", "estimateMin": 60,
      "startedAt": null, "doneAt": null }
  ]
}`

export const SCORING_JSON = `{
  "schema": 1,
  "scale": 100,
  "released": 2,
  "rounds": [
    { "round": 1, "at": "2026-11-13T10:50Z", "total": 72, "severities": { "BLOCKER": 1, "MATERIAL": 3, "MINOR": 2 } },
    { "round": 2, "at": "2026-11-13T11:01Z", "total": 85, "severities": { "BLOCKER": 0, "MATERIAL": 1, "MINOR": 2 } },
    { "round": 3, "at": "2026-11-13T11:13Z", "total": 82, "severities": { "BLOCKER": 0, "MATERIAL": 2, "MINOR": 1 } }
  ]
}`
