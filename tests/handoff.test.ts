import { expect, test } from 'claude-code/testing'

import type { Line } from '../hooks/band.ts'
import { TOASTS, gitPart, handoffLines, handoffText, nextStep, parseSettings, parseStatus, percentOf, stepsOf, windowThreshold } from '../hooks/handoff.ts'
import type { HandoffView, SaveInput } from '../hooks/handoff.ts'
import { gitResult } from './kit.ts'

test('settings read their defaults for a missing or bad field', () => {
  expect(parseSettings(undefined)).toEqual({ mode: 'ask', threshold: 80 })
  expect(parseSettings({ mode: 'auto', threshold: 70 })).toEqual({ mode: 'auto', threshold: 70 })
  expect(parseSettings({ mode: 'loud', threshold: 96 })).toEqual({ mode: 'ask', threshold: 80 })
  expect(parseSettings({ mode: 'off', threshold: 8.5 })).toEqual({ mode: 'off', threshold: 80 })
  expect(parseSettings('auto')).toEqual({ mode: 'ask', threshold: 80 })
})

test('steps run 5 points apart up to 95', () => {
  expect(stepsOf(80)).toEqual([80, 85, 90, 95])
  expect(stepsOf(93)).toEqual([93])
  expect(stepsOf(95)).toEqual([95])
  expect(stepsOf(10)).toHaveLength(18)
})

test('a reading handles the highest step reached and not yet handled', () => {
  const steps = stepsOf(80)
  expect(nextStep(null, 70, steps)).toBe(null)
  expect(nextStep(null, 88, steps)).toBe(85)
  expect(nextStep(85, 89, steps)).toBe(null)
  expect(nextStep(85, 96, steps)).toBe(95)
  expect(nextStep(null, 80, steps)).toBe(80)
})

test('the percent is over the compaction point, and the forecast threshold over the window', () => {
  expect(percentOf(312_000, 390_000)).toBe(80)
  expect(percentOf(160_000, 200_000)).toBe(80)
  expect(percentOf(311_999, 390_000)).toBe(79)
  expect(windowThreshold(80, 390_000, 1_000_000)).toBe(31)
  expect(windowThreshold(80, 200_000, 200_000)).toBe(80)
})

test('a status file stands F8 down only when valid and the stack handles a full context', () => {
  const file = (o: object) => JSON.stringify({ schema: 1, session: 's1', fullContext: 'fresh-session', ...o })
  expect(parseStatus(file({}), 's1')).toEqual({ state: 'stood-down', reason: null })
  expect(parseStatus(file({ fullContext: 'compact', extra: 1 }), 's1')).toEqual({ state: 'stood-down', reason: null })
  expect(parseStatus(file({ fullContext: 'off' }), 's1')).toEqual({ state: 'runs', reason: null })
  expect(parseStatus(file({}), 's2')).toEqual({ state: 'ignored', reason: 'another session' })
  expect(parseStatus(file({ schema: 2 }), 's1')).toEqual({ state: 'ignored', reason: 'schema 2' })
  expect(parseStatus('{not json', 's1')).toEqual({ state: 'ignored', reason: 'not JSON' })
  expect(parseStatus('[1]', 's1')).toEqual({ state: 'ignored', reason: 'not JSON' })
  expect(parseStatus(JSON.stringify({ session: 's1' }), 's1')).toEqual({ state: 'ignored', reason: 'no schema' })
})

const MIN = 60_000
const AT = new Date(2026, 9, 28, 14, 5).getTime()
const GIT = gitResult('## feature/token-refresh...origin/feature/token-refresh [ahead 2]\n M src/auth/interceptor.ts\n?? src/auth/refresh.test.ts\n')
const SAVE: SaveInput = {
  at: AT, percent: 82, threshold: 80, session: '3f2a9c1e-77aa-4b2c-9d10-aa11bb22cc33', model: 'claude-opus-5-5',
  git: gitPart(GIT),
  plan: {
    file: '.claude/session-inspector/plans/token-refresh.json', title: 'Token refresh', finished: 3, total: 5,
    steps: [
      { id: 'S1', title: 'Add refresh endpoint', status: 'done', actualMs: 20 * MIN, forecastMs: null, notes: 0 },
      { id: 'S2', title: 'Rotate tokens', status: 'done', actualMs: 24 * MIN, forecastMs: null, notes: 1 },
      { id: 'S3', title: 'Migration with rollback', status: 'done', actualMs: 12 * MIN, forecastMs: null, notes: 0 },
      { id: 'S4', title: 'Update interceptor', status: 'in_progress', actualMs: 12 * MIN, forecastMs: 24 * MIN, notes: 0 },
      { id: 'S5', title: 'E2E tests', status: 'pending', actualMs: 0, forecastMs: 18 * MIN, notes: 0 },
    ],
  },
  scores: { name: 'token-refresh', totals: [{ round: 1, total: 68 }, { round: 2, total: 81 }], open: [{ id: 'F2', text: 'No load test for refresh storm', severity: 'MATERIAL' }] },
  counts: { turn: 23, durationMs: 72 * MIN, calls: 140, failed: 3, agents: 2, costUsd: 3.12, isEstimate: true },
}

test("the file reads as the spec's example", () => {
  expect(handoffText(SAVE)).toBe(`<!-- session-inspector handoff v1 -->
# Handoff - 2026-10-28 14:05

Saved at 82% context (asks at 80%) by session-inspector · session 3f2a9c1e · Opus 5.5 · branch feature/token-refresh.
To continue in a new session, ask Claude to read .claude/session-inspector/HANDOFF.md and resume from Next.

## Next

S4 Update interceptor - in progress, 12m of ≈24m.

## Plan - Token refresh, 3/5

From .claude/session-inspector/plans/token-refresh.json.

- [x] S1 Add refresh endpoint - done in 20m
- [x] S2 Rotate tokens - done in 24m - ✎ 1 note
- [x] S3 Migration with rollback - done in 12m
- [ ] S4 Update interceptor - in progress
- [ ] S5 E2E tests - pending

Scores (token-refresh): R1 68 → R2 81 · open: F2 No load test for refresh storm (MATERIAL)

## Git

    ## feature/token-refresh...origin/feature/token-refresh [ahead 2]
     M src/auth/interceptor.ts
    ?? src/auth/refresh.test.ts

## Session

Turn 23 · 1h 12m · 140 tool calls, 3 failed · 2 agents · $3.12 est.
`)
})

test('the header names the branch, and leaves it out with no git', () => {
  expect(handoffText(SAVE)).toContain('· branch feature/token-refresh.')
  const none = handoffText({ ...SAVE, git: gitPart(new Error('spawn git ENOENT')) })
  expect(none).toContain('· Opus 5.5.\n')
  expect(none).toContain('## Git\n\nGit: not available (git not found)\n')
})

test('with no plan or a task list, Next says so and the Plan part is left out', () => {
  const none = handoffText({ ...SAVE, plan: null, scores: null })
  expect(none).toContain('## Next\n\nNo plan file this session; see Git below.\n')
  expect(none).not.toContain('## Plan')
  expect(handoffText({ ...SAVE, plan: 'tasks', scores: null })).toContain('## Next\n\nTask list in use; its items are not written to this file.\n')
})

test('a git timeout, a folder that is no repository and another exit each write Git: not available', () => {
  expect(gitPart(new Error('process timed out after 2000 ms'))).toEqual(['Git: not available (timed out)'])
  expect(gitPart(gitResult('', 128, 'fatal: not a git repository (or any of the parent directories): .git'))).toEqual(['Git: not available (not a repository)'])
  expect(gitPart(gitResult('', 2, 'boom'))).toEqual(['Git: not available (exit 2)'])
})

test('50 paths then +N more', () => {
  const paths = Array.from({ length: 53 }, (_, i) => ` M f${i}.ts`).join('\n')
  const lines = gitPart(gitResult(`## main\n${paths}\n`))
  expect(lines).toHaveLength(52)
  expect(lines[50]).toBe('     M f49.ts')
  expect(lines[51]).toBe('    +3 more')
})

const VIEW: HandoffView = {
  mode: 'ask', threshold: 80, isAskUp: false, percent: 62, point: 200_000, window: 200_000, handled: null, lastSave: null,
  alfred: { state: 'none', reason: null }, isWorking: false, runway: null,
}
// Each line as drawn: a button as `<hotkey>: <label>`, as the types draw a `plain` one
const drawn = (lines: Line[]): string[] => lines.map(l => l.map(s => ('text' in s ? s.text : 'button' in s ? `${s.button.hotkey}: ${s.button.label}` : '')).join(''))

test("the HANDOFF row in each state, the ask's r: dismiss at 95, the last-save row", () => {
  expect(drawn(handoffLines(VIEW, 100))).toEqual(['HANDOFF', 'ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now'])
  expect(drawn(handoffLines({ ...VIEW, percent: null }, 100))).toEqual(['HANDOFF', 'ctx – · asks at 80%'])
  expect(drawn(handoffLines({ ...VIEW, percent: 79, point: 390_000, window: 1_000_000 }, 100))[1]).toBe('ctx ▰▰▰▱▱ 79% of 390k · asks at 80% · h: save now')
  expect(drawn(handoffLines({ ...VIEW, percent: 82, isAskUp: true, handled: 80 }, 100))[1])
    .toBe('⚠ ctx ▰▰▰▰▱ 82% · past 80% · h: save handoff · c: compact · r: remind at 85%')
  expect(drawn(handoffLines({ ...VIEW, percent: 96, isAskUp: true, handled: 95 }, 100))[1]).toBe('⚠ ctx ▰▰▰▰▱ 96% · past 95% · h: save handoff · c: compact · r: dismiss')
  expect(drawn(handoffLines({ ...VIEW, mode: 'auto' }, 100))).toEqual(['HANDOFF', 'ctx 62% · saves at 80%'])
  const saved = { at: AT, isOk: true, reason: null }
  expect(drawn(handoffLines({ ...VIEW, mode: 'auto', percent: 82, handled: 80, lastSave: saved }, 100)))
    .toEqual(['HANDOFF', 'ctx 82% · saved at 80% (14:05) · next save at 85%', 'last save 14:05 · .claude/session-inspector/HANDOFF.md'])
  expect(drawn(handoffLines({ ...VIEW, lastSave: { at: AT, isOk: false, reason: "HANDOFF.md exists and is not the mod's" } }, 100)))
    .toEqual(['HANDOFF', 'ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now', "✗ save failed 14:05: HANDOFF.md exists and is not the mod's"])
  expect(drawn(handoffLines({ ...VIEW, alfred: { state: 'stood-down', reason: null } }, 100))).toEqual(['HANDOFF', 'ctx 62% · handoff by Alfred Code'])
  // The reason moved to the ALFRED CODE section (Phase 5)
  expect(drawn(handoffLines({ ...VIEW, alfred: { state: 'ignored', reason: 'schema 2' } }, 100)))
    .toEqual(['HANDOFF', 'ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now'])
  expect(handoffLines({ ...VIEW, mode: 'off' }, 100)).toEqual([])
})

test('c is not drawn while a turn runs', () => {
  expect(drawn(handoffLines({ ...VIEW, percent: 82, isAskUp: true, handled: 80, isWorking: true }, 100))[1])
    .toBe('⚠ ctx ▰▰▰▰▱ 82% · past 80% · h: save handoff · r: remind at 85%')
})

test('after r, the calm row names the step it asks at next, and none once 95 is handled', () => {
  expect(drawn(handoffLines({ ...VIEW, percent: 82, handled: 80 }, 100))[1]).toBe('ctx ▰▰▰▰▱ 82% · asks at 85% · h: save now')
  expect(drawn(handoffLines({ ...VIEW, percent: 96, handled: 95 }, 100))[1]).toBe('ctx ▰▰▰▰▱ 96% · h: save now')
})

test('the row buttons are plain, on h, c and r, and the heading violet', () => {
  const [head, row] = handoffLines({ ...VIEW, percent: 82, isAskUp: true, handled: 80 }, 100)
  expect(head).toEqual([{ text: 'HANDOFF', bold: true, tone: 'handoff' }])
  const buttons = row!.flatMap(s => ('button' in s ? [s.button] : []))
  expect(buttons.map(b => [b.key, b.hotkey, b.plain])).toEqual([['handoff-save', 'h', true], ['handoff-compact', 'c', true], ['handoff-dismiss', 'r', true]])
})

test("each F8 toast reads as the spec's table", () => {
  expect(TOASTS.ask(80)).toBe('Context past 80%: press 4 or run /auto-handoff now to save a handoff')
  expect(TOASTS.autoFirst(82)).toBe('Handoff saved at 82% to .claude/session-inspector/HANDOFF.md - /clear fills a resume prompt')
  expect(TOASTS.saved()).toBe('Handoff saved to .claude/session-inspector/HANDOFF.md - /clear fills a resume prompt')
  expect(TOASTS.compacting()).toBe('Handoff saved to .claude/session-inspector/HANDOFF.md - compacting')
  expect(TOASTS.filled(AT)).toBe('Resume prompt filled from the handoff saved 14:05 - press Enter to send')
  expect(TOASTS.fallback(AT)).toBe('Handoff saved 14:05: ask Claude to read .claude/session-inspector/HANDOFF.md')
  expect(TOASTS.failed('boom')).toBe('Handoff not saved: boom')
})
