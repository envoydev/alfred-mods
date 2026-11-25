import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parsePlan, parseScores, scoresView } from '../../hooks/plan/plan'
import { START, engine, rows, stubAll } from '../kit'
import { NOW } from '../plans'

// claude-kit's two files as the prompt for its session gives them (the spec's D4, K1 and K2): the same text goes
// into that prompt, so both repos work from one shape. The scores findings carry `text` and `severity` only,
// because a fresh grader each round cannot recognise a finding across rounds.
const SLUG = 'claude-kit-view'
const DIR = '.claude/session-inspector'
const PLAN_PATH = `${DIR}/plans/${SLUG}.json`
const SCORES_PATH = `${DIR}/scores/${SLUG}.json`

const K2_PLAN = `{
  "version": 1,
  "slug": "claude-kit-view",
  "title": "Claude-kit view",
  "updatedAt": "2026-10-27T14:22:00Z",
  "steps": [
    { "id": "T1", "title": "Read the kit line", "status": "done", "estimateMin": 20, "startedAt": "2026-10-27T13:00:00Z", "doneAt": "2026-10-27T13:20:00Z" },
    { "id": "T2", "title": "Record the turn's parts", "status": "done", "estimateMin": 30, "startedAt": "2026-10-27T13:21:00Z", "doneAt": "2026-10-27T13:50:00Z" },
    { "id": "T3", "title": "Draw the Prompt tab", "status": "in_progress", "estimateMin": 30, "startedAt": "2026-10-27T14:22:00Z" },
    { "id": "T4", "title": "Draw the kit banner", "status": "pending", "estimateMin": 25 },
    { "id": "T5", "title": "Fixtures and the kit prompt", "status": "pending", "estimateMin": 15 }
  ]
}`

const K1_SCORES = `{
  "version": 1,
  "slug": "claude-kit-view",
  "subject": { "kind": "plan", "ref": "claude-kit-view" },
  "updatedAt": "2026-10-27T14:25:00Z",
  "scale": 100,
  "rounds": [
    { "round": 0, "at": "2026-10-27T13:10:00Z", "total": 64,
      "criteria": { "C1": 70, "C2": 60, "C3": 65, "C4": 55, "C5": 70, "C6": 60, "C7": 68 },
      "findings": [
        { "text": "The resume path has no test", "severity": "BLOCKER" },
        { "text": "Step T2 names no file", "severity": "MATERIAL" },
        { "text": "No rollback is stated", "severity": "MATERIAL" },
        { "text": "The import layering is unchecked", "severity": "MATERIAL" },
        { "text": "Two steps share one contract", "severity": "MATERIAL" }
      ] },
    { "round": 1, "at": "2026-10-27T14:25:00Z", "total": 91,
      "criteria": { "C1": 92, "C2": 90, "C3": 91, "C4": 88, "C5": 93, "C6": 90, "C7": 93 },
      "findings": [
        { "text": "No load figure for a long turn", "severity": "MATERIAL" },
        { "text": "The tab order is left open", "severity": "MATERIAL" },
        { "text": "A comment names a step", "severity": "MINOR" }
      ] }
  ]
}`

const SURFACES = ['terminal', 'desktop'] as const

test('parsePlan reads the K2 plan file', () => {
  const plan = parsePlan(K2_PLAN)
  expect(plan?.title).toBe('Claude-kit view')
  expect(plan?.steps.map(step => [step.id, step.status, step.estimateMin])).toEqual([
    ['T1', 'done', 20], ['T2', 'done', 30], ['T3', 'in_progress', 30], ['T4', 'pending', 25], ['T5', 'pending', 15],
  ])
})

test('parseScores reads the K1 scores file, its findings without id, status or by', () => {
  const scores = parseScores(K1_SCORES)
  expect(scores?.subject).toEqual({ kind: 'plan', ref: SLUG })
  expect(scores?.scale).toBe(100)
  expect(scores?.rounds.map(round => [round.round, round.total, Object.keys(round.criteria).length, round.findings.length])).toEqual([
    [0, 64, 7, 5], [1, 91, 7, 3],
  ])
  expect(scores?.rounds[0]?.findings[1]).toEqual({ id: null, text: 'Step T2 names no file', severity: 'MATERIAL', status: null, by: null })
})

test('scoresView counts MATERIAL 4 -> 2 and shows round 1 at 91, up 27', () => {
  const view = scoresView(parseScores(K1_SCORES)!)
  expect(view?.shown).toEqual({ round: 1, total: 91 })
  expect(view?.delta).toBe(27)
  expect(view?.severities.find(row => row.severity === 'MATERIAL')).toEqual({ severity: 'MATERIAL', prev: 4, last: 2 })
  expect(view?.criteria).toHaveLength(7)
  expect(view?.hasStatus).toBe(false)
})

async function band($: Engine, surface: (typeof SURFACES)[number]) {
  return $.ui.mount({
    plugin: 'alfred-mods', surface, component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
}

for (const surface of SURFACES) {
  test(`the band shows the K2 plan and the K1 score (${surface})`, { timeoutMs: 15_000 }, async ($, on: On) => {
    const kit = stubAll(on, {
      now: NOW, files: { [PLAN_PATH]: { text: K2_PLAN, mtimeMs: NOW }, [SCORES_PATH]: { text: K1_SCORES, mtimeMs: NOW } },
    })
    on('tool.call', (_, e) =>
      e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: 'ok', text: 'ok' })
    engine(on, ['tool.call'])
    await $.session.start(START)
    await kit.clock.advance(300)

    await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'q', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'false 1' })
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })

    // Line 1 holds the new failure; the turn line under it ends with the plan
    const line = (await rows(await band($, surface))).find(l => l.includes('PLAN'))
    expect(line).toMatch(/ │ PLAN 2\/5 · score 91 ▲27/)
  })
}
