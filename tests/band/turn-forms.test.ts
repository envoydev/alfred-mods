// The turn's whole forms, widest first, for line 1 (spec: docs/superpowers/specs/2026-11-25-band-turn-on-line-1-design.md)
import { expect, test } from 'claude-code/testing'

import { newRow } from '../../hooks/agents/agents'
import { turnForms } from '../../hooks/band/working'
import { planView } from '../../hooks/plan/plan'
import { narrowPlan } from '../../hooks/plan/planlines'
import { FIVE_OVERHEAD, FIVE_TIMES, NOW as PLAN_NOW, planOf } from '../plans'
import { NOW, input, text, texts } from './band-input'

const plan = planView(planOf({}), FIVE_TIMES, FIVE_OVERHEAD, {}, PLAN_NOW)
const live = {
  turnId: 't2', startedAt: NOW - 12_000, toolCalls: 3, toolFailures: 0, promptAt: NOW - 12_000,
  runningCalls: [{ id: 'c1', tool: 'Bash', label: 'npm test', startedAt: NOW - 5_000 }],
}
const agent = (id: string) => newRow({ id, parentId: null, type: 'Explore', description: 'd', prompt: 'p', isTeammate: false, model: 'claude-haiku-5-5' }, NOW)
const agents = [agent('a1'), agent('a2')]

test('the finished turn: with the plan tail, without it, then the narrow form; none is cut', () => {
  const forms = texts(turnForms(input({ plan, newFailures: 0 }), false, false, false))
  expect(forms[0]).toBe('✓ Turn 1 · 3s · 19 tools │ PLAN 3/5')
  expect(forms).toContain('✓ Turn 1 · 3s · 19 tools')
  expect(forms[forms.length - 1]).toBe('✓ Turn 1 · 3s')
})
test("with the failures item on the line, the turn's own failure count is left out", () => {
  const turns = [{ ...input().turns[0]!, toolFailures: 1 }]
  expect(texts(turnForms(input({ turns }), false, false, true))[0]).toBe('✓ Turn 1 · 3s · 19 tools')
  expect(texts(turnForms(input({ turns }), false, false, false))[0]).toBe('✓ Turn 1 · 3s · 19 tools · 1 ✗')
})
test('a drawn plan row keeps the plan tail off the turn, as withPlanTail does', () => {
  expect(texts(turnForms(input({ plan }), false, true, false))[0]).toBe('✓ Turn 1 · 3s · 19 tools')
})
test('the running turn: agents and Bash first, then folded, then no Bash, then the head, then the narrow head', () => {
  const forms = texts(turnForms(input({ isWorking: true, live, agents }), false, false, false))
  expect(forms[0]).toContain('Bash ▸ npm test')
  expect(forms.some(form => form.includes('+2 agents') && !form.includes('Bash'))).toBe(true)
  expect(forms).toContain('⟳ Turn 2 · 0:12 · 3 tools')
  expect(forms[forms.length - 1]).toBe('⟳ Turn 2 0:12')
})
test("the calm band's running plan line ends with narrowPlan's forms", () => {
  const forms = turnForms(input({ mode: 'calm', isWorking: true, live, plan }), false, false, false)
  expect(texts(forms).at(-1)).toBe(text(narrowPlan(plan, 0)))
})
test("narrow, the forms are today's narrow forms only", () => {
  expect(texts(turnForms(input(), true, false, false))).toEqual(['✓ Turn 1 · 3s'])
  expect(texts(turnForms(input({ isWorking: true, live, agents }), true, false, false))).toEqual(['⟳ Turn 2 0:12 · 2 agents', '⟳ Turn 2 0:12'])
})
test('no turn, no forms', () => {
  expect(turnForms(input({ turns: [] }), false, false, false)).toEqual([])
})
