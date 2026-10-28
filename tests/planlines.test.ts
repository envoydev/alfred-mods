import { expect, test } from 'claude-code/testing'

import { parseScores, planView, scoresView } from '../hooks/plan.ts'
import { planLine, planLines, scoresLabel } from '../hooks/planlines.ts'
import type { Line } from '../hooks/band.ts'
import { widthOf } from '../hooks/format.ts'
import { FIVE, FIVE_OVERHEAD, FIVE_TIMES, MIN, NOW, SCORES_JSON, planOf } from './plans.ts'
import type { Scores, ScoreRound } from '../types'

const text = (line: Line): string => line.map(s => ('text' in s ? s.text : '')).join('').replace(/ +/g, ' ').trim()
const O = { invalid: false, others: [], otherScores: [], updatedAt: null, now: NOW, columns: 120 }
const SCORES = parseScores(SCORES_JSON) as Scores
const withRound = (round: Partial<ScoreRound>): Scores =>
  ({ ...SCORES, rounds: [...SCORES.rounds, { round: 3, at: null, total: 75, criteria: {}, findings: [], ...round }] })

test('with no plan and no task list the tab says so, and shows the newest scores in full', () => {
  const lines = planLines(null, scoresView(SCORES), O).map(text)
  expect(lines[0]).toBe('No plan file in .claude/session-inspector/plans/, and no task list this session.')
  expect(lines).toContain('Scores R1 68 → R2 81 ▲13 (scale 100)')
})

test('a failed, a blocked and a skipped step draw their own glyphs, and a shared step says so', () => {
  const plan = planOf({ S3: 'skipped', S4: 'failed', S5: 'blocked' })
  const v = planView(plan, { ...FIVE_TIMES, S4: { ms: 12 * MIN, isShared: true } }, 0, {}, NOW)
  const lines = planLines(v, null, O).map(text)
  expect(lines).toContain('– S3 Migration with rollback skipped est 10m')
  expect(lines).toContain('✗ S4 Update interceptor 12m of ≈24m shared est 20m')
  expect(lines).toContain('⊘ S5 E2E tests ≈18m est 15m')
})

test('a falling total, a criterion new this round, the improved list and more than 3 open findings', () => {
  const finding = (id: string, status?: string) => ({ id, text: `finding ${id}`, severity: null, status: status ?? null, by: null })
  const s = scoresView(withRound({
    criteria: { correctness: 70, speed: 60 },
    findings: [finding('F2', 'improved'), ...['F3', 'F4', 'F5', 'F6'].map(id => finding(id))] as ScoreRound['findings'],
  }))
  const lines = planLines(null, s, O).map(text)
  expect(lines).toContain('Scores R1 68 → R2 81 → R3 75 ▼6 (scale 100)')
  expect(lines).toContain('correctness 80→70 ▼ speed 60 new')
  expect(lines).toContain('improved: F2 finding F2')
  expect(lines).toContain('open: F3 finding F3')
  expect(lines).toContain('F5 finding F5')
  expect(lines).toContain('+1 more')
})

test('other plans and other scores files are listed, an invalid one marked', () => {
  const v = planView(FIVE, FIVE_TIMES, FIVE_OVERHEAD, {}, NOW)
  const lines = planLines(v, null, { ...O, others: ['beta (invalid)', 'gamma'], otherScores: [scoresLabel('reply-7', withRound({ total: 88 }))] }).map(text)
  expect(lines).toContain('reply-7 (plan) R3 88')
  expect(lines).toContain('Other plans: beta (invalid), gamma /inspect plan <name>')
})

test('steps without an estimate are counted in the header', () => {
  const v = planView(planOf({ S5: { estimateMin: null } }), FIVE_TIMES, FIVE_OVERHEAD, {}, NOW)
  expect(text(planLines(v, null, O)[0] ?? [])).toBe('Plan · Token refresh 3/5 · ≈1h 24m total · ≈12m left (×1.2) · 1 without an estimate')
})

test('a plan line too wide loses its step, then its title is cut', () => {
  const v = planView(FIVE, FIVE_TIMES, FIVE_OVERHEAD, {}, NOW)
  expect(text(planLine(v, 60))).toBe('Token refresh ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left')
  expect(text(planLine(v, 45))).toBe('Token r… ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left')
})

test('a ratio under 0.1 keeps its first digit rather than reading ×0.0', () => {
  const quick = { S1: { ms: 9000, isShared: false }, S2: { ms: 12_000, isShared: false }, S3: { ms: 6000, isShared: false } }
  expect(text(planLines(planView(FIVE, quick, 0, {}, NOW), null, O)[0] ?? []).endsWith('(×0.01)')).toBe(true)
})

test('a first round shows its figures, with no change against a round before it', () => {
  const lines = planLines(null, scoresView({ ...SCORES, rounds: SCORES.rounds.slice(0, 1) }), O).map(text)
  expect(lines).toContain('correctness 70 risk 50 completeness 80')
  expect(lines).toContain('BLOCKER 1')
})

test('in a narrow pane the titles are cut so each step keeps its time and estimate', () => {
  const v = planView(FIVE, FIVE_TIMES, FIVE_OVERHEAD, {}, NOW)
  const rows = planLines(v, null, { ...O, columns: 46 }).filter(l => /^[✓⟳·] S\d/.test(text(l)))
  expect(rows).toHaveLength(5)
  for (const l of rows) expect(widthOf(l)).toBeLessThanOrEqual(46)
  const steps = rows.map(text)
  expect(steps[1]).toBe('✓ S2 Rotate tokens ✎ done in 24m est 20m')
  expect(steps[2]).toMatch(/^✓ S3 Migration with r… done in 12m est 10m$/)
  expect(steps[3]).toMatch(/^⟳ S4 .* 12m of ≈24m est 20m$/)
})
