import { expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import { clock as clockText } from '../hooks/format.ts'
import { KEYS } from '../hooks/samples.ts'
import type { Handoff, Meta } from '../types'
import { PRESENTATION, SPAWN, START, engine, gitResult, rows, stubAll, watchState } from './kit.ts'
import type { FileStub } from './kit.ts'
import { PLAN_JSON, SCORES_JSON } from './plans.ts'

const STATUS = '.claude/session-inspector/status/s1.json'
const USAGE = 'Usage: /auto-handoff [ask|auto|off|at <percent>|now]'
const ASK = (step: number) => `Context past ${step}%: press 4 or run /auto-handoff now to save a handoff`
const status = (o: object = {}): FileStub => ({ text: JSON.stringify({ schema: 1, session: 's1', fullContext: 'fresh-session', ...o }), mtimeMs: 1 })

const handoff = ($: Engine, args: string) =>
  $.command.run({ command: 'auto-handoff', args, origin: { kind: 'composer' }, presentation: PRESENTATION }).then(r => r.text ?? '')

// A reading Claude Code pushes after a main-loop turn, the tokens over a window
const measure = ($: Engine, tokens: number, window = 200_000) =>
  $.session.measure({ context: { tokens, window, percent: Math.round(tokens * 100 / window) }, rateLimits: [], changed: ['context'] })
const at = ($: Engine, percent: number) => measure($, percent * 2000)

// What `$.session.usage({ breakdown })` answers: the point where Claude Code compacts by itself, or none when it is off
function withPoint(window: number, point: number | null): SessionUsage {
  const breakdown = { isAutoCompactEnabled: point !== null, ...(point === null ? {} : { autoCompactThreshold: point }) }
  return { startedAt: 0, context: { window, breakdown: breakdown as never }, rateLimits: [] }
}

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}, except: string[] = []) {
  const kit = stubAll(on, o)
  const state = watchState(on)
  engine(on, except)
  await $.session.start(START)
  const h = (): Handoff => state.get('handoff') as Handoff
  return { ...kit, h, state }
}

// A save runs on a 0 ms timer, off the hook path: the clock settles until its work lands, or 50 times
async function until(clock: MockClock, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !isDone(); i++) await clock.settle()
}
const saved = (clock: MockClock, h: () => Handoff, before: number | null = null) => until(clock, () => (h()?.lastSave?.at ?? null) !== before || h()?.lastSave?.isOk === false)

test('readings of 70 then 88 ask once, at 85', async ($, on) => {
  const { toasts, h } = await start($, on)
  await at($, 70)
  expect(h()?.isAskUp ?? false).toBe(false)
  await at($, 88)
  expect(h()).toMatchObject({ isAskUp: true, handled: 85, lastSave: null })
  await at($, 89)
  expect(toasts.filter(t => t.startsWith('Context past'))).toEqual([ASK(85)])
})

test('auto mode saves at 80, 85, 90 and 95', async ($, on) => {
  const { clock, toasts, h } = await start($, on, { store: { 'settings:handoff': { mode: 'auto', threshold: 80 } } })
  const saves: number[] = []
  for (const p of [70, 80, 82, 85, 91, 96, 97]) {
    await clock.advance(60_000)
    const before = h()?.lastSave?.at
    await at($, p)
    await until(clock, () => h()?.lastSave?.at !== before)
    if (h()?.lastSave?.at !== before) saves.push(p)
  }
  expect(saves).toEqual([80, 85, 91, 96])
  expect(h().isAskUp).toBe(false)
  expect(toasts.filter(t => t.startsWith('Context past'))).toEqual([])
})

test('a compaction to 40% re-arms 80', async ($, on) => {
  const { toasts } = await start($, on)
  await at($, 82)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await at($, 40)
  await at($, 81)
  expect(toasts.filter(t => t.startsWith('Context past'))).toEqual([ASK(80), ASK(80)])
})

test('off asks and saves nothing', async ($, on) => {
  const { toasts, h } = await start($, on, { store: { 'settings:handoff': { mode: 'off', threshold: 80 } } })
  await at($, 90)
  expect(h()).toMatchObject({ isAskUp: false, lastSave: null })
  expect(toasts).toEqual([])
})

test('at 9, at 96 and at 8.5 are refused', async ($, on) => {
  const { store } = await start($, on)
  for (const bad of ['at 9', 'at 96', 'at 8.5', 'at', 'at x']) {
    expect(await handoff($, bad)).toBe('Threshold must be a whole percent from 10 to 95.')
  }
  expect(store.get('settings:handoff')).toBe(undefined)
  expect(await handoff($, 'at 70')).toBe('Handoff: ask at 70% · ctx –')
  expect(store.get('settings:handoff')).toEqual({ mode: 'ask', threshold: 70 })
})

test('a bare /auto-handoff prints the state and the usage line, and anything else the usage line', async ($, on) => {
  await start($, on)
  expect(await handoff($, '')).toBe(`Handoff: ask at 80% · ctx –\n${USAGE}`)
  await at($, 62)
  expect(await handoff($, '')).toBe(`Handoff: ask at 80% · ctx 62%\n${USAGE}`)
  expect(await handoff($, 'loud')).toBe(USAGE)
  expect(await handoff($, 'off')).toBe('Handoff: off · ctx 62%')
})

test('on a 1M window with autoCompactThreshold 390,000, 312k tokens asks at the point', async ($, on) => {
  const { toasts, h } = await start($, on, { usage: withPoint(1_000_000, 390_000) })
  await measure($, 311_000, 1_000_000)
  expect(h().isAskUp).toBe(false)
  await measure($, 312_000, 1_000_000)
  expect(h()).toMatchObject({ isAskUp: true, point: 390_000, handled: 80 })
  expect(toasts).toEqual([ASK(80)])
})

test('with auto-compaction off a 200k window asks at 160k', async ($, on) => {
  const { h } = await start($, on, { usage: withPoint(200_000, null) })
  await measure($, 159_000)
  expect(h().isAskUp).toBe(false)
  await measure($, 160_000)
  expect(h()).toMatchObject({ isAskUp: true, point: 200_000 })
})

test('a valid status file with fullContext fresh-session stands F8 down', async ($, on) => {
  const { clock, toasts, h } = await start($, on, { files: { [STATUS]: status() } })
  await at($, 88)
  expect(h()).toMatchObject({ isAskUp: false, alfred: { state: 'stood-down', reason: null } })
  expect(toasts).toEqual([])
  expect(await handoff($, '')).toBe(`ctx 88% · handoff by Alfred Code\n${USAGE}`)
  // An explicit save still runs
  await handoff($, 'now')
  await until(clock, () => h().lastSave !== null)
  expect(h().lastSave).toMatchObject({ isOk: true })
})

test('off, another session, schema 2 and bad JSON each leave F8 running, the last three with their reason', async ($, on) => {
  const { files, clock, h } = await start($, on, { files: { [STATUS]: status({ fullContext: 'off' }) } })
  expect(h().alfred).toEqual({ state: 'none', reason: null })
  const cases: [FileStub, string][] = [
    [status({ session: 's9' }), 'another session'], [status({ schema: 2 }), 'schema 2'], [{ text: '{oops', mtimeMs: 1 }, 'not JSON'],
  ]
  for (const [file, reason] of cases) {
    files.current[STATUS] = file
    await clock.advance(30_000)
    expect(h().alfred).toEqual({ state: 'ignored', reason })
  }
  await at($, 88)
  expect(h().isAskUp).toBe(true)
})

test('no file draws no such row', async ($, on) => {
  const { h } = await start($, on)
  await at($, 50)
  expect(h()?.alfred ?? { state: 'none', reason: null }).toEqual({ state: 'none', reason: null })
})

test('a file removed mid-session brings the ask back on the next poll, at the last reading', async ($, on) => {
  const { files, clock, toasts, h } = await start($, on, { files: { [STATUS]: status() } })
  await at($, 82)
  expect(h().isAskUp).toBe(false)
  delete files.current[STATUS]
  await clock.advance(30_000)
  await until(clock, () => h().isAskUp)
  expect(toasts).toEqual([ASK(80)])
  // The next reading asks nothing more at the same step
  await at($, 83)
  expect(toasts).toEqual([ASK(80)])
})

test('a file that appears mid-session takes an ask down', async ($, on) => {
  const { files, clock, h } = await start($, on)
  await at($, 82)
  expect(h().isAskUp).toBe(true)
  files.current[STATUS] = status()
  await clock.advance(30_000)
  expect(h()).toMatchObject({ isAskUp: false, alfred: { state: 'stood-down' } })
})

test('/auto-handoff at 70 in a session whose copy says ask while the store says auto stores auto at 70', async ($, on) => {
  const { store, h } = await start($, on)
  expect(h()?.mode ?? 'ask').toBe('ask')
  store.set('settings:handoff', { mode: 'auto', threshold: 80 })
  await handoff($, 'at 70')
  expect(store.get('settings:handoff')).toEqual({ mode: 'auto', threshold: 70 })
  expect(h()).toMatchObject({ mode: 'auto', threshold: 70 })
})

test('a new session after /auto-handoff auto saves at its first step', async ($, on) => {
  const { clock, h } = await start($, on, { store: { 'settings:handoff': { mode: 'auto', threshold: 80 } } })
  await at($, 86)
  await until(clock, () => h().lastSave !== null)
  expect(h().lastSave).toMatchObject({ isOk: true })
  expect(h().handled).toBe(85)
})

test('/auto-handoff auto, then /clear: the next reading past the threshold saves', async ($, on) => {
  const { clock, h } = await start($, on)
  await handoff($, 'auto')
  await $.classic.SessionStart({ source: 'clear' })
  expect(h()).toMatchObject({ mode: 'auto', handled: null, lastSave: null })
  await at($, 81)
  await until(clock, () => h().lastSave !== null)
  expect(h().lastSave).toMatchObject({ isOk: true })
})

test('another session picks up the settings on its poll', async ($, on) => {
  const { store, clock, h } = await start($, on)
  store.set('settings:handoff', { mode: 'off', threshold: 60 })
  await clock.advance(30_000)
  expect(h()).toMatchObject({ mode: 'off', threshold: 60 })
})

test("a stood-down session, then /clear before the new id's file exists: no ask until a read finds no file", async ($, on) => {
  const { session, clock, toasts, h } = await start($, on, { files: { [STATUS]: status() } })
  await at($, 82)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await at($, 88)
  expect(h()).toMatchObject({ isAskUp: false, alfred: { state: 'stood-down' } })
  await clock.advance(30_000)
  expect(h().alfred).toEqual({ state: 'none', reason: null })
  await at($, 89)
  expect(toasts).toEqual([ASK(85)])
})

// Task 8: the save, HANDOFF.md, the resume prompt, the row and the keys
const PATH = '.claude/session-inspector/HANDOFF.md'
const PLAN_PATH = '.claude/session-inspector/plans/token-refresh.json'
const SCORES_PATH = '.claude/session-inspector/scores/token-refresh.json'
const MARKER = '<!-- session-inspector handoff v1 -->'
const SAVED = `Handoff saved to ${PATH} - /clear fills a resume prompt`
const RESUME = 'Read .claude/session-inspector/HANDOFF.md, check that the branch it names is checked out, and continue from its Next section.'
const PANE = { title: 'Inspect', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = ($: Engine, surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const band = ($: Engine, surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: BAND })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const written = (files: { current: Record<string, FileStub> }): string | undefined =>
  Object.entries(files.current).find(([k]) => k === PATH || k.endsWith(`/${PATH}`))?.[1].text
const writesOf = (files: { writes: string[] }): number => files.writes.filter(k => k === PATH || k.endsWith(`/${PATH}`)).length

test('/auto-handoff now writes HANDOFF.md from a 0 ms timer: the marker, the header with the branch, and the git call', async ($, on) => {
  const { files, git, clock, toasts, h } = await start($, on, { git: gitResult('## feature/x...origin/feature/x [ahead 1]\n M src/a.ts\n') })
  await at($, 62)
  expect(await handoff($, 'now')).toBe(`Saving a handoff to ${PATH}.`)
  expect(writesOf(files)).toBe(0)
  await saved(clock, h)
  const text = written(files) ?? ''
  expect(text.startsWith(`${MARKER}\n# Handoff - `)).toBe(true)
  expect(text).toContain('\nSaved at 62% context (asks at 80%) by session-inspector · session s1 · branch feature/x.\n')
  expect(text).toContain('## Git\n\n    ## feature/x...origin/feature/x [ahead 1]\n     M src/a.ts\n')
  expect(text.endsWith('\n')).toBe(true)
  expect(git.argv).toEqual(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'])
  expect(git.timeoutMs).toBe(2000)
  expect(h().lastSave).toMatchObject({ isOk: true, reason: null })
  expect(toasts).toEqual([SAVED])
})

test('with REC strict on, HANDOFF.md keeps a private word and the home path, and writes a fake key as ‹key›', async ($, on) => {
  const key = KEYS[0]?.text ?? ''
  const title = `Acme rollout in /Users/jane/acme with ${key}`
  const plan = PLAN_JSON.replace('"title": "Token refresh"', `"title": ${JSON.stringify(title)}`)
  const { files, clock, h } = await start($, on, {
    env: { HOME: '/Users/jane' }, store: { 'settings:rec': 'strict', 'rec:words': ['Acme'] },
    files: { [PLAN_PATH]: { text: plan, mtimeMs: 1 } },
  })
  await clock.advance(300)
  await handoff($, 'now')
  await saved(clock, h)
  const text = written(files) ?? ''
  expect(text).toContain('## Plan - Acme rollout in /Users/jane/acme with ‹key›, 3/5')
  expect(text).not.toContain(key)
})

test('HANDOFF.md holds no failure reason, task subject, agent description or note text', async ($, on) => {
  on('tool.call', (_, e) => (e.tool === 'TaskCreate'
    ? { result: { task: { id: '1', subject: 'Write the rotation tests' } }, text: 'Task #1 created' }
    : e.tool === 'Bash' ? { isError: true as const, result: 'boom-reason-xyz', text: 'boom-reason-xyz' } : { result: 'ok', text: 'ok' }))
  const { files, clock, h } = await start($, on, { files: { [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 1 }, [SCORES_PATH]: { text: SCORES_JSON, mtimeMs: 1 } } }, ['tool.call'])
  await clock.advance(300)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write the rotation tests', description: 'd' })
  await $.tool.call({ tool: 'Bash', command: 'run-the-thing' })
  await $.agent.spawn({ ...SPAWN, description: 'peek at the vault' })
  await handoff($, 'now')
  await saved(clock, h)
  const text = written(files) ?? ''
  expect(text).toContain('- [x] S2 Rotate tokens - done in')
  expect(text).toContain('✎ 1 note')
  expect(text).toContain('Scores (token-refresh): R1 68 → R2 81 · open: F2 No load test for refresh storm (MATERIAL)')
  expect(text).toContain('1 agent')
  for (const hidden of ['sliding expiry', 'boom-reason-xyz', 'run-the-thing', 'Write the rotation tests', 'peek at the vault']) {
    expect(text).not.toContain(hidden)
  }
})

test("a foreign HANDOFF.md is left alone and the save fails with its reason", async ($, on) => {
  const { files, git, clock, toasts, h } = await start($, on, { files: { [PATH]: { text: '# my own notes\n', mtimeMs: 1 } } })
  await handoff($, 'now')
  await saved(clock, h)
  expect(h().lastSave).toMatchObject({ isOk: false, reason: "HANDOFF.md exists and is not the mod's" })
  expect(written(files)).toBe('# my own notes\n')
  expect(writesOf(files)).toBe(0)
  expect(git.calls).toBe(0)
  expect(toasts).toEqual(["Handoff not saved: HANDOFF.md exists and is not the mod's"])
})

test('a HANDOFF.md the mod cannot read, such as one over 4 MiB, is left alone', async ($, on) => {
  const big = { text: '# my own notes\n', mtimeMs: 1, size: 5 * 1024 * 1024 }
  const { files, clock, h } = await start($, on, { files: { [PATH]: big } })
  await handoff($, 'now')
  await saved(clock, h)
  expect(h().lastSave).toMatchObject({ isOk: false, reason: "HANDOFF.md exists and is not the mod's" })
  expect(writesOf(files)).toBe(0)
})

test('an ask up, then /auto-handoff off or auto, takes the ask off the band', async ($, on) => {
  const { h } = await start($, on)
  for (const mode of ['off', 'auto']) {
    await handoff($, 'ask')
    await at($, 50)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await at($, 50)
    await at($, 82)
    expect(h().isAskUp).toBe(true)
    await handoff($, mode)
    expect(h().isAskUp).toBe(false)
    const lines = await rows(await band($))
    expect(lines.some(l => l.includes('ctx past'))).toBe(false)
  }
})

test('a compaction, then /resume before any reading: the resumed session asks at 85 at its first reading of 86', async ($, on) => {
  const { h, toasts } = await start($, on)
  await at($, 82)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await $.classic.SessionStart({ source: 'resume' })
  await at($, 86)
  expect(h()).toMatchObject({ isAskUp: true, handled: 85 })
  expect(toasts.at(-1)).toBe(ASK(85))
})

test("a file of the mod's own is overwritten", async ($, on) => {
  const { files, clock, h } = await start($, on, { files: { [PATH]: { text: `${MARKER}\n# Handoff - old\n`, mtimeMs: 1 } } })
  await handoff($, 'now')
  await saved(clock, h)
  expect(h().lastSave).toMatchObject({ isOk: true })
  expect(written(files)).not.toContain('# Handoff - old')
})

test('a git timeout writes Git: not available (timed out)', async ($, on) => {
  const { files, clock, h } = await start($, on, { git: 'process timed out after 2000 ms' })
  await handoff($, 'now')
  await saved(clock, h)
  expect(written(files)).toContain('## Git\n\nGit: not available (timed out)\n')
  expect(h().lastSave).toMatchObject({ isOk: true })
})

test('two saves at once make one write', async ($, on) => {
  const { files, git, clock, h } = await start($, on)
  await handoff($, 'now')
  await handoff($, 'now')
  await saved(clock, h)
  await until(clock, () => false)
  expect(writesOf(files)).toBe(1)
  expect(git.calls).toBe(1)
})

test('a /clear within 2 hours fills the resume prompt once, only into an empty draft', async ($, on) => {
  const { prompt, clock, toasts, h } = await start($, on)
  await handoff($, 'now')
  await saved(clock, h)
  const at = h().lastSave?.at ?? 0
  await clock.advance(60 * 60_000)
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([RESUME])
  expect(toasts).toContain(`Resume prompt filled from the handoff saved ${clockText(at)} - press Enter to send`)
  prompt.draft = ''
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([RESUME])
})

test('a draft that is not empty gets the fallback toast', async ($, on) => {
  const { prompt, clock, toasts, h } = await start($, on, { draft: 'half typed' })
  await handoff($, 'now')
  await saved(clock, h)
  const at = h().lastSave?.at ?? 0
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([])
  expect(toasts).toContain(`Handoff saved ${clockText(at)}: ask Claude to read ${PATH}`)
})

test('no save, or past 2 hours, fills nothing', async ($, on) => {
  const { prompt, clock, toasts, h } = await start($, on)
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([])
  await handoff($, 'now')
  await saved(clock, h)
  await clock.advance(2 * 60 * 60_000 + 1)
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([])
  expect(toasts).toEqual([SAVED])
})

test('a stood-down session arms no resume prompt', async ($, on) => {
  const { prompt, clock, toasts, h } = await start($, on, { files: { [STATUS]: status() } })
  await handoff($, 'now')
  await saved(clock, h)
  expect(h().lastSave).toMatchObject({ isOk: true })
  await $.classic.SessionStart({ source: 'clear' })
  expect(prompt.fills).toEqual([])
  expect(toasts.filter(t => t.startsWith('Resume') || t.includes('ask Claude to read'))).toEqual([])
})

test('h saves and takes the ask down, r takes it down until the next step, c saves then compacts, 4 does what h does', async ($, on) => {
  const { clock, toasts, h, state } = await start($, on)
  await inspect($, 'now')
  await at($, 82)
  const ui = await pane($)
  expect((await rows(ui)).some(l => l.includes('past 80% · save handoff · compact · remind at 85%'))).toBe(true)
  await ui.press({ key: 'handoff-save' })
  await saved(clock, h)
  expect(h()).toMatchObject({ isAskUp: false, lastSave: { isOk: true } })

  await at($, 86)
  expect(h().isAskUp).toBe(true)
  const before = h().lastSave?.at ?? null
  await ui.press({ key: 'handoff-dismiss' })
  expect(h().isAskUp).toBe(false)
  expect(h().lastSave?.at ?? null).toBe(before)

  await clock.advance(60_000)
  await at($, 91)
  await ui.press({ key: 'handoff-compact' })
  await saved(clock, h, before)
  await until(clock, () => (state.get('meta') as Meta).compactions > 0)
  expect((state.get('meta') as Meta).compactions).toBe(1)
  expect(toasts).toContain(`Handoff saved to ${PATH} - compacting`)

  // The compaction re-arms: the reading after it sets the handled step, and 82 asks at 80 again
  await clock.advance(60_000)
  await at($, 40)
  await at($, 82)
  expect(h().isAskUp).toBe(true)
  const third = h().lastSave?.at ?? null
  await (await band($)).press({ key: 'handoff' })
  await saved(clock, h, third)
  expect(h()).toMatchObject({ isAskUp: false })
  expect(h().lastSave?.at).not.toBe(third)
})

test('c is not drawn while a turn runs', async ($, on) => {
  await start($, on)
  await inspect($, 'now')
  await at($, 82)
  await $.turn.start({ text: 'q', turnId: 't1' })
  const ui = await pane($)
  expect(await ui.find({ key: 'handoff-save' })).toBeTruthy()
  expect(await ui.find({ key: 'handoff-compact' })).toBeFalsy()
})

test('the Cache tab answers k, and c belongs to the HANDOFF row', async ($, on) => {
  await start($, on)
  await inspect($, 'now')
  await at($, 82)
  const ui = await pane($)
  expect((await ui.find({ key: 'tab-cache' }))?.props.hotkey).toBe('k')
  expect((await ui.find({ key: 'handoff-compact' }))?.props).toMatchObject({ hotkey: 'c', plain: true })
  expect((await ui.find({ key: 'handoff-save' }))?.props).toMatchObject({ hotkey: 'h', plain: true })
  expect((await ui.find({ key: 'handoff-dismiss' }))?.props).toMatchObject({ hotkey: 'r', plain: true })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the HANDOFF heading and the band's Handoff button are violet #a78bfa (${surface})`, async ($, on) => {
    await start($, on)
    await inspect($, 'now')
    await at($, 82)
    const texts = await (await pane($, surface)).findAll({ type: 'Text' })
    expect(texts.some(t => t.text === 'HANDOFF' && t.props.color === '#a78bfa' && t.props.bold === true)).toBe(true)
    const b = await band($, surface)
    expect((await rows(b)).some(l => l.includes('⚠ ctx past 80% Handoff'))).toBe(true)
    expect((await b.find({ key: 'handoff' }))?.props).toMatchObject({ hotkey: '4', plain: true })
    const labels = await b.findAll({ type: 'Text' })
    expect(labels.some(t => t.text === 'Handoff' && t.props.color === '#a78bfa' && t.props.bold === true)).toBe(true)
  })

  test(`under NO_COLOR the HANDOFF heading is plain (${surface})`, async ($, on) => {
    await start($, on, { env: { NO_COLOR: '1' } })
    await inspect($, 'now')
    await at($, 82)
    const headings = (await (await pane($, surface)).findAll({ type: 'Text' })).filter(t => t.text === 'HANDOFF')
    expect(headings.length).toBeGreaterThan(0)
    expect(headings.every(t => t.props.color === undefined)).toBe(true)
  })
}

test('off draws no HANDOFF section and no band item', async ($, on) => {
  await start($, on, { store: { 'settings:handoff': { mode: 'off', threshold: 80 } } })
  await inspect($, 'now')
  await at($, 90)
  expect((await rows(await pane($))).some(l => l.startsWith('HANDOFF'))).toBe(false)
  expect((await rows(await band($))).some(l => l.includes('ctx past'))).toBe(false)
})
