import { expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import { PRESENTATION, SPAWN, START, engine, rows, spawns, stubAll } from './kit.ts'
import type { FileStub } from './kit.ts'
import { MIN, NOW, PLAN_JSON, SCORES_JSON, planText } from './plans.ts'

const SURFACES = ['terminal', 'desktop'] as const
const DIR = '.claude/session-inspector'
const PLAN_PATH = `${DIR}/plans/token-refresh.json`
const SCORES_PATH = `${DIR}/scores/token-refresh.json`
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const READING: SessionUsage = { startedAt: 0, context: { window: 200_000, tokens: 60_000, percent: 30 }, rateLimits: [] }

// Task 2's figures, stored by an earlier session: S1 18m, S2 24m, S3 12m, S4 12m and 6m of overhead
const at = (ms: number, isShared = false) => ({ ms, isShared, at: NOW })
const STORE = {
  'step:token-refresh:S1:s0': at(18 * MIN), 'step:token-refresh:S2:s0': at(24 * MIN),
  'step:token-refresh:S3:s0': at(12 * MIN), 'step:token-refresh:S4:s0': at(12 * MIN),
  'overhead:token-refresh:s0': { ms: 6 * MIN, at: NOW },
}
// The scores example with round 2 marking F1 fixed by S3
const SCORES_FIXED = (() => {
  const s = JSON.parse(SCORES_JSON) as { rounds: { findings: object[] }[] }
  s.rounds[1]?.findings.unshift({ id: 'F1', text: 'No migration rollback', severity: 'BLOCKER', status: 'fixed', by: 'S3' })
  return JSON.stringify(s)
})()
const PLAN_LINE = 'Token refresh ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left │ ▶ Update interceptor'

// A file written at the session's start, so its plan runs this session
const file = (text: string, mtimeMs = NOW): FileStub => ({ text, mtimeMs })
// Column padding is the drawing's: runs of spaces fold to one
const fold = (l: string): string => l.replace(/ +/g, ' ').trimEnd()

type Kit = ReturnType<typeof stubAll>
// A session started at NOW with the plan file and FIVE's stored times, its first read done
async function begin($: Engine, on: On, o: Parameters<typeof stubAll>[1] & { answer?: (on: On, clock: MockClock) => void } = {}): Promise<Kit> {
  const kit = stubAll(on, { now: NOW, usage: READING, store: STORE, files: { [PLAN_PATH]: file(PLAN_JSON) }, ...o })
  if (o.answer === undefined) engine(on)
  else o.answer(on, kit.clock)
  await $.session.start(START)
  await kit.clock.advance(300)
  return kit
}

const pane = ($: Engine, surface: RenderSurface, bodyColumns = 100) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns } })
const band = ($: Engine, surface: RenderSurface, isWorking: boolean, bodyColumns = 120) =>
  $.ui.mount({
    plugin: 'session-inspector', surface, component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
// The Plan tab's rows, the pane unmounted after
const planTab = async ($: Engine, surface: RenderSurface): Promise<string[]> => {
  await inspect($, 'plan')
  const ui = await pane($, surface)
  const lines = (await rows(ui)).map(fold)
  await ui.unmount()
  return lines
}

// The colour of the innermost Text drawing `text`
async function colorOf(ui: Pick<Awaited<ReturnType<typeof pane>>, 'findAll'>, text: RegExp): Promise<unknown> {
  const found = await ui.findAll({ type: 'Text', text })
  return found.reverse().find(el => el.props.color !== undefined)?.props.color
}

// Claude Code holds every call for a minute and answers each spawn by its description
function slowCalls(on: On, clock: MockClock): void {
  on('tool.call', async () => {
    await clock.sleep(60_000)
    return { result: 'ok', text: 'ok' }
  })
  spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' } })
  engine(on, ['tool.call', 'agent.spawn'])
}
const grep = (more: object = {}) => ({ tool: 'Grep', pattern: 'AuthService', ...more }) as never

// Lets the held calls answer before the test ends: one still held when the file ends rejects with nothing to catch it
async function finish(clock: MockClock, calls: Promise<unknown>[]): Promise<void> {
  await clock.advance(60_000)
  await Promise.all(calls)
}

for (const surface of SURFACES) {
  test(`the Plan tab reads as the brief's mockup (${surface})`, async ($, on) => {
    await begin($, on, { files: { [PLAN_PATH]: file(PLAN_JSON), [SCORES_PATH]: file(SCORES_FIXED) } })

    const lines = await planTab($, surface)
    for (const want of [
      'Plan · Token refresh   3/5 · ≈1h 42m total · ≈30m left (×1.2)',
      '✓ S2 Rotate tokens   ✎ your note integrated   done in 24m   est 20m',
      "     'Use sliding expiry, not fixed 15 min'",
      '⟳ S4 Update interceptor   12m of ≈24m   est 20m',
      '· S5 E2E tests   ≈18m   est 15m',
      'Overhead  6m',
      'Scores   R1 68 → R2 81 ▲13   (scale 100)',
      '  correctness 70→80 ▲   risk 50→80 ▲   completeness 80→80 =',
      '  BLOCKER 1→0   MATERIAL 0→1',
      '  fixed:  F1 No migration rollback (S3)',
      '  open:  F2 No load test for refresh storm',
      'last update 8m ago',
    ]) expect(lines).toContain(fold(want))
  })

  test(`an uncalibrated plan says so (${surface})`, async ($, on) => {
    await begin($, on, { files: { [PLAN_PATH]: file(planText({ S2: 'pending', S3: 'pending' })) } })

    const header = (await planTab($, surface)).find(l => l.startsWith('Plan · ')) ?? ''
    expect(header.endsWith('(uncalibrated)')).toBe(true)
  })

  test(`the band's line 1 is the plan line while it runs (${surface})`, async ($, on) => {
    const { clock } = await begin($, on, { answer: slowCalls })
    expect((await rows(await band($, surface, true)))[0]).toBe(PLAN_LINE)

    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'one' })
    const call = $.tool.call(grep({ agentId: 'a1' }))
    await clock.settle()
    expect((await rows(await band($, surface, true)))[0]).toBe(`${PLAN_LINE} │ Explore ▸ Grep AuthService`)
    expect((await rows(await band($, surface, true, 70)))[0]).toBe('⟳ S4 12m · 1 agent')
    await finish(clock, [call])
  })

  test(`past the width, agents fold first, then Bash, then the step (${surface})`, async ($, on) => {
    const { files, clock } = await begin($, on, { answer: slowCalls })
    for (const description of ['one', 'two']) await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description })
    const calls = [
      $.tool.call(grep({ agentId: 'a1' })), $.tool.call(grep({ agentId: 'a2' })),
      $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' }),
    ]
    await clock.settle()

    expect((await rows(await band($, surface, true, 110)))[0]).toBe(`${PLAN_LINE} +2 agents │ Bash ▸ Run tests 0:00`)
    expect((await rows(await band($, surface, true, 100)))[0]).toBe(`${PLAN_LINE} +2 agents`)

    const long = 'Update the interceptor and every caller of the refresh endpoint'
    files.current[PLAN_PATH] = file(planText({}, [], p => {
      const s4 = p.steps[3]
      if (s4 !== undefined) s4.title = long
    }), NOW + 1)
    await clock.advance(30_000)
    expect((await rows(await band($, surface, true, 100)))[0]).toBe('Token refresh ▰▰▰▱▱ 3/5 · 60% · 1h 12m · ≈30m left +2 agents')
    await finish(clock, calls)
  })

  test(`a pinned plan that does not run leaves the band on the plan that runs (${surface})`, async ($, on) => {
    await begin($, on, { files: { [PLAN_PATH]: file(PLAN_JSON), [`${DIR}/plans/old.json`]: file(PLAN_JSON, NOW - 60_000) } })
    await inspect($, 'plan old')
    await $.turn.start({ text: 'q', turnId: 't1' })

    expect((await rows(await band($, surface, true)))[0]).toBe(PLAN_LINE)
  })

  test(`a running turn's time shows on the running step as it goes (${surface})`, async ($, on) => {
    const { clock } = await begin($, on)
    await $.turn.start({ text: 'q', turnId: 't1' })
    await clock.advance(60_000)

    expect(await planTab($, surface)).toContain(fold('⟳ S4 Update interceptor   13m of ≈24m   est 20m'))
  })

  test(`a plan left running by an earlier session keeps out of line 1 (${surface})`, async ($, on) => {
    const { clock } = await begin($, on, { files: { [PLAN_PATH]: file(PLAN_JSON, NOW - 60_000) } })

    expect((await rows(await band($, surface, true)))[0]).toBe('⟳ Turn 1 · 0:00')
    await inspect($, 'plan')
    const ui = await pane($, surface)
    expect((await rows(ui)).map(fold)).toContain('Plan · Token refresh 3/5 · ≈1h 42m total · ≈30m left (×1.2)')
    expect(await colorOf(ui, /^last update/)).not.toBe('#f59e0b')
    await clock.advance(13 * MIN)
    expect((await rows(ui)).map(fold)).toContain('last update 21m ago')
    expect(await colorOf(ui, /^last update/)).toBe('#f59e0b')
  })

  test(`a finished plan draws its second form while working for 10 minutes (${surface})`, async ($, on) => {
    const { files, clock, toasts } = await begin($, on, { store: { ...STORE, 'step:token-refresh:S5:s0': at(7 * MIN) } })

    files.current[PLAN_PATH] = file(planText({ S4: 'done', S5: 'done' }), NOW + 1)
    await clock.advance(30_000)
    expect(toasts).toContain('Plan done: Token refresh in 1h 19m')
    await clock.advance(60_000)
    expect((await rows(await band($, surface, true)))[0]?.startsWith('Token refresh ▰▰▰▰▰ done ✓ in 1h 19m')).toBe(true)
    await clock.advance(600_000)
    expect((await rows(await band($, surface, true)))[0]).toBe('⟳ Turn 1 · 0:00')
  })

  test(`idle and calm, the plan adds nothing; idle with something to look at, PLAN and the score join line 1 (${surface})`, async ($, on) => {
    await begin($, on, {
      files: { [PLAN_PATH]: file(PLAN_JSON), [SCORES_PATH]: file(SCORES_JSON) },
      answer: o => {
        o('tool.call', (_, e) =>
          e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: 'ok', text: 'ok' })
        engine(o, ['tool.call'])
      },
    })
    const calm = await rows(await band($, surface, false))
    expect(calm).toHaveLength(1)
    expect(calm[0]).not.toMatch(/PLAN/)

    await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'q', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'false 1' })
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await rows(await band($, surface, false)))[0]?.endsWith(' │ PLAN 3/5 · score 81 ▲13')).toBe(true)
  })

  test(`an invalid plan file says so on line 2 and in the tab (${surface})`, async ($, on) => {
    const { files, clock } = await begin($, on)
    files.current[PLAN_PATH] = file('{"version":1,"title":"Tok', NOW + 1)
    await clock.advance(30_000)

    expect((await rows(await band($, surface, true)))[1]?.endsWith('│ plan file invalid')).toBe(true)
    const lines = await planTab($, surface)
    const header = lines.findIndex(l => l.startsWith('Plan · Token refresh'))
    expect(lines[header + 1]).toBe('plan file invalid: showing the last good read')
  })

  test(`a stale plan shows its age in amber (${surface})`, async ($, on) => {
    const stale = planText({}, [], p => {
      p.updatedAt = new Date(NOW - 25 * MIN).toISOString()
    })
    await begin($, on, { files: { [PLAN_PATH]: file(stale) } })
    await inspect($, 'plan')
    const ui = await pane($, surface)

    expect((await rows(ui)).map(fold)).toContain('last update 25m ago')
    expect(await colorOf(ui, /^last update/)).toBe('#f59e0b')
  })

  test(`the Now tab's PLAN comes first (${surface})`, async ($, on) => {
    await begin($, on, { answer: slowCalls })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'one' })
    await inspect($, 'now')

    const lines = (await rows(await pane($, surface))).map(fold)
    const order = [
      'PLAN   Token refresh · 3/5 · ≈30m left of ≈1h 42m', '  ✓ S3 Migration with rollback   done in 12m',
      '  ⟳ S4 Update interceptor   12m of ≈24m', '  · S5 E2E tests   ≈18m',
    ].map(want => lines.indexOf(fold(want)))
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(lines.findIndex(l => l.startsWith('AGENTS'))).toBeGreaterThan(order[3] ?? Infinity)
  })

  test(`with no plan file the task list shows as Tasks (${surface})`, async ($, on) => {
    await begin($, on, { files: {} })
    const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content })
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')] })

    expect((await planTab($, surface)).some(l => l.startsWith('Plan · Tasks 1/3'))).toBe(true)
    expect((await rows(await band($, surface, true)))[0]?.startsWith('Tasks ▰▱▱▱▱ 1/3 · 33%')).toBe(true)
  })

  test(`/inspect plan <name> pins a plan, and an unknown name lists the plans (${surface})`, async ($, on) => {
    const titled = (title: string, statuses: Record<string, string> = {}) => planText(statuses, [], p => {
      p.title = title
    })
    const { files, clock } = await begin($, on, {
      files: { [`${DIR}/plans/old.json`]: file(titled('Old plan'), NOW), [`${DIR}/plans/new.json`]: file(titled('New plan'), NOW + 1) },
    })
    expect((await planTab($, surface)).some(l => l.startsWith('Plan · New plan'))).toBe(true)

    expect((await inspect($, 'plan old')).text).toBe('Opened the inspect pane.')
    files.current[`${DIR}/plans/new.json`] = file(titled('New plan', { S4: 'done' }), NOW + 2)
    await clock.advance(30_000)
    expect((await rows(await pane($, surface))).some(l => l.startsWith('Plan · Old plan'))).toBe(true)
    expect((await inspect($, 'plan nope')).text).toBe('No plan named nope. Plans: new, old.')
  })

  test(`the Plan tab label and the plan bar take gold, and nothing under NO_COLOR (${surface})`, async ($, on) => {
    await begin($, on)
    await inspect($, 'plan')
    const ui = await pane($, surface)
    expect(await colorOf(ui, /^ Plan $/)).toBe('#ca8a04')
    expect(await colorOf(await band($, surface, true), /^▰▰▰$/)).toBe('#ca8a04')
  })

  test(`under NO_COLOR the Plan tab and the plan line have no colour (${surface})`, async ($, on) => {
    await begin($, on, { env: { NO_COLOR: '1' } })
    await inspect($, 'plan')

    expect(JSON.stringify(await (await pane($, surface)).drawn())).not.toMatch(/"(color|dimColor)"/)
    expect(JSON.stringify(await (await band($, surface, true)).drawn())).not.toMatch(/"(color|dimColor)"/)
  })
}
