import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import type { Handoff, Stack } from '../types'
import { PRESENTATION, START, engine, rows, stubAll, watchState } from './kit.ts'
import type { FileStub } from './kit.ts'

const STATUS = '.claude/session-inspector/status/s1.json'
const STATUS2 = '.claude/session-inspector/status/s2.json'
const PROMPT = 'Read docs/work/plans/inspector.md, check that branch feat/x is checked out, and continue from its Resume: line (Task 3).\nThen run npm test.'
const FULL = {
  schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-10-29T14:03:00Z',
  model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, autoRun: true,
  scorer: { on: true, level: 80, rounds: 3 }, handoffPrompt: PROMPT,
}
const status = (o: object = {}): FileStub => ({ text: JSON.stringify({ ...FULL, ...o }), mtimeMs: 1 })

// `beneath` hooks what Claude Code answers in place of the engine stand-ins it names, before the session starts
async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}, beneath: Record<string, () => void> = {}) {
  const kit = stubAll(on, o)
  const state = watchState(on)
  engine(on, Object.keys(beneath))
  for (const hook of Object.values(beneath)) hook()
  await $.session.start(START)
  const s = (): Stack => state.get('stack') as Stack
  const h = (): Handoff => state.get('handoff') as Handoff
  return { ...kit, s, h, state, written: state.writes }
}
const asked = (exists: string[], path: string): number => exists.filter(p => p === path || p.endsWith(`/${path}`)).length

test('a valid file fills the stack atom at session start', async ($, on) => {
  const { s } = await start($, on, { files: { [STATUS]: status() }, now: 5000 })
  expect(s()).toEqual({
    state: 'used', reason: null, fullContext: 'fresh-session', model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000,
    noOffer: false, autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, hasPrompt: true,
    updatedAt: Date.parse('2026-10-29T14:03:00Z'), readAt: 5000, ignored: [],
  })
})

test('no file gives none with NO_FILE', async ($, on) => {
  const { s } = await start($, on)
  expect(s()).toMatchObject({ state: 'none', reason: 'no status file for this session', hasPrompt: false })
})

test('an id statusPath refuses gives none with NO_FILE', async ($, on) => {
  const { s, files } = await start($, on, { sessionId: 'a/b' })
  expect(s()).toMatchObject({ state: 'none', reason: 'no status file for this session' })
  expect(files.exists.some(p => p.includes('status/'))).toBe(false)
})

test('a file over 4 MiB gives ignored with unreadable', async ($, on) => {
  const { s } = await start($, on, { files: { [STATUS]: { ...status(), size: 5 * 1024 * 1024 } } })
  expect(s()).toMatchObject({ state: 'ignored', reason: 'unreadable', hasPrompt: false })
})

test('a file that appears is read on the 30-second poll', async ($, on) => {
  const { s, files, clock } = await start($, on)
  files.current[STATUS] = status()
  await clock.advance(29_000)
  expect(s().state).toBe('none')
  await clock.advance(1000)
  expect(s()).toMatchObject({ state: 'used', hasPrompt: true })
})

test('a file removed goes back to none at the next poll', async ($, on) => {
  const { s, files, clock } = await start($, on, { files: { [STATUS]: status() } })
  delete files.current[STATUS]
  await clock.advance(30_000)
  expect(s()).toMatchObject({ state: 'none', reason: 'no status file for this session', hasPrompt: false, model: null })
})

test('the prompt is in no atom and no store key', async ($, on) => {
  const { written, store, clock } = await start($, on, { files: { [STATUS]: status() } })
  await clock.advance(30_000)
  expect(written.length).toBeGreaterThan(0)
  const everything = [...written, ...store.keys().map(k => JSON.stringify(store.get(k)))].join('\n')
  for (const part of ['Read docs/work', 'inspector.md', 'npm test', 'feat/x']) expect(everything.includes(part)).toBe(false)
})

test('a /clear with no new file keeps the values, rereads once at 2 seconds and clears after the window', async ($, on) => {
  const { s, files, clock, session } = await start($, on, { files: { [STATUS]: status() } })
  const before = s()
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(s()).toEqual(before)
  expect(asked(files.exists, STATUS2)).toBe(1)
  await clock.advance(2000)
  expect(asked(files.exists, STATUS2)).toBe(2)
  expect(s()).toEqual(before)
  await clock.advance(4000)
  expect(asked(files.exists, STATUS2)).toBe(2)
  // The first poll is at 30 s, past the 10-second window
  await clock.advance(24_000)
  expect(s()).toMatchObject({ state: 'none', reason: 'no status file for this session', hasPrompt: false })
})

test('a poll tick while the /clear handler loads its stores keeps the values', async ($, on) => {
  const holdStore: { key: string; until: Promise<void> | null } = { key: 'settings:rec', until: null }
  const { s, clock, session } = await start($, on, { files: { [STATUS]: status() }, holdStore })
  const before = s()
  await clock.advance(29_999)
  session.id = 's2'
  let release = (): void => undefined
  holdStore.until = new Promise<void>(r => { release = r })
  const clear = $.classic.SessionStart({ source: 'clear' })
  // The 30-second poll reads the new id while the handler waits on the store
  await clock.advance(1)
  holdStore.until = null
  release()
  await clear
  expect(s()).toEqual(before)
})

test('a new file at 1 second is drawn at the 2-second reread', async ($, on) => {
  const { s, files, clock, session } = await start($, on, { files: { [STATUS]: status() } })
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(1000)
  files.current[STATUS2] = status({ session: 's2', model: 'claude-sonnet-5-5' })
  expect(s().model).toBe('claude-opus-5-5')
  await clock.advance(1000)
  expect(s()).toMatchObject({ state: 'used', model: 'claude-sonnet-5-5', hasPrompt: true })
})

test('a poll at 1 s and a file at 5 s leave no gap', async ($, on) => {
  const { s, files, clock, session } = await start($, on, { files: { [STATUS]: status() } })
  await clock.advance(29_000)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  // The poll ticks at 30 s, 1 s after the /clear; the reread at 31 s
  for (const step of [1000, 1000, 3000]) {
    await clock.advance(step)
    expect(s()).toMatchObject({ state: 'used', model: 'claude-opus-5-5', hasPrompt: true })
  }
  files.current[STATUS2] = status({ session: 's2', model: 'claude-sonnet-5-5' })
  await clock.advance(10_000)
  expect(s()).toMatchObject({ state: 'used', model: 'claude-opus-5-5' })
  // The next read, the poll at 60 s, draws the new file
  await clock.advance(16_000)
  expect(s()).toMatchObject({ state: 'used', model: 'claude-sonnet-5-5', hasPrompt: true })
})

test('an ignored file, then /clear with no new file, stays ignored through the window', async ($, on) => {
  const { s, clock, session } = await start($, on, { files: { [STATUS]: status({ schema: 2 }) }, usage: reading(93_000) })
  expect(s()).toMatchObject({ state: 'ignored', reason: 'schema 2', hasPrompt: false })
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(s()).toMatchObject({ state: 'ignored', reason: 'schema 2', hasPrompt: false })
  expect((await rows(await band($, 'terminal'))).join('\n')).not.toContain('of 150k')
  await clock.advance(9000)
  expect(s()).toMatchObject({ state: 'ignored', reason: 'schema 2', hasPrompt: false })
  await clock.advance(21_000)
  expect(s()).toMatchObject({ state: 'none', reason: 'no status file for this session' })
})

test("the keep window holds Phase 4's stand-down too", async ($, on) => {
  const { h, clock, session } = await start($, on, { files: { [STATUS]: status() } })
  expect(h().alfred.state).toBe('stood-down')
  await clock.advance(29_000)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(1000)
  expect(h().alfred.state).toBe('stood-down')
  await clock.advance(30_000)
  expect(h().alfred).toEqual({ state: 'none', reason: null })
})

test('a throwing read after a used one clears the prompt and names unreadable', async ($, on) => {
  const { s, files, clock } = await start($, on, { files: { [STATUS]: status() } })
  files.current[STATUS] = { ...status(), size: 5 * 1024 * 1024 }
  await clock.advance(30_000)
  expect(s()).toMatchObject({ state: 'ignored', reason: 'unreadable', hasPrompt: false, model: null })
  files.current[STATUS] = status()
  await clock.advance(30_000)
  expect(s()).toMatchObject({ state: 'used', reason: null, hasPrompt: true, model: 'claude-opus-5-5' })
})

// Task 4: the runway and the banner, drawn
const SURFACES = ['terminal', 'desktop'] as const
const BAND = (bodyColumns: number) => ({ hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {} })
const band = ($: Engine, surface: RenderSurface, columns = 120) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: BAND(columns) })
const PANE = { title: 'Inspect', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const reading = (tokens: number, window = 1_000_000): SessionUsage =>
  ({ startedAt: 0, context: { window, tokens, percent: Math.round(tokens * 100 / window) }, rateLimits: [] })
async function turnAt($: Engine, usage: { current: SessionUsage }, n: number, tokens: number): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: `t${n}` })
  usage.current = reading(tokens)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: `t${n}`, reason: 'answer' })
}

for (const surface of SURFACES) {
  test(`the band draws the banner and the runway at 120 and 90 columns (${surface})`, async ($, on) => {
    await start($, on, { files: { [STATUS]: status() }, usage: reading(93_000) })
    for (const columns of [120, 90]) {
      const lines = await rows(await band($, surface, columns))
      expect(lines[0]!.startsWith('auto-run · scorer 80 │ ')).toBe(true)
      expect(lines.join('\n')).toContain('ctx ▰▰▰▱▱ 62% of 150k')
    }
  })

  test(`with 5h and 7d windows at 90 columns the banner takes line 1 alone and every row fits (${surface})`, async ($, on) => {
    const windowed: SessionUsage = {
      ...reading(93_000),
      rateLimits: [{ kind: 'five_hour', percentUsed: 45, resetsAt: '2026-10-28T17:00:00Z' }, { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-31T09:00:00Z' }],
    }
    await start($, on, { files: { [STATUS]: status() }, usage: windowed })
    const lines = await rows(await band($, surface, 90))
    expect(lines[0]).toBe('auto-run · scorer 80')
    expect(lines[1]).toMatch(/^ctx ▰▰▰▱▱ 62% of 150k · 5h .* · 7d ▰▱▱▱▱ 20% \(\d\d\.\d\d \d\d:\d\d\)$/)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(90)
  })

  test(`an ignored file draws no runway and no banner (${surface})`, async ($, on) => {
    await start($, on, { files: { [STATUS]: status({ schema: 2 }) }, usage: reading(93_000) })
    const lines = await rows(await band($, surface))
    expect(lines.join('\n')).not.toContain('of 150k')
    expect(lines.join('\n')).not.toContain('auto-run')
    expect(lines[0]!.startsWith('ctx ▱▱▱▱▱ 9%')).toBe(true)
  })

  test(`compact, off and both modes off draw the core band (${surface})`, async ($, on) => {
    const { files, clock } = await start($, on, { files: { [STATUS]: status({ fullContext: 'compact', autoRun: false, scorer: null }) }, usage: reading(93_000) })
    expect((await rows(await band($, surface)))[0]).toBe('ctx ▱▱▱▱▱ 9%')
    files.current[STATUS] = status({ fullContext: 'off', autoRun: false, scorer: { on: false, level: 80, rounds: 3 } })
    await clock.advance(30_000)
    expect((await rows(await band($, surface)))[0]).toBe('ctx ▱▱▱▱▱ 9%')
  })

  test(`the Usage tab counts turns to the runway's tokens (${surface})`, async ($, on) => {
    const { usage, files, clock } = await start($, on, { files: { [STATUS]: status() }, usage: reading(40_000) })
    for (const [n, tokens] of [[1, 50_000], [2, 70_000], [3, 90_000]] as const) await turnAt($, usage, n, tokens)
    await inspect($, 'usage')
    const ui = await pane($, surface)
    expect((await rows(ui)).join('\n')).toContain('≈3 turns to 150k')
    // Without the runway, F8's threshold
    delete files.current[STATUS]
    await clock.advance(30_000)
    expect((await rows(ui)).join('\n')).toMatch(/≈\d+ turns to 80%/)
  })
}

test('a bare /auto-handoff names the runway as the HANDOFF row does', async ($, on) => {
  await start($, on, { files: { [STATUS]: status() }, usage: reading(93_000) })
  const r = await $.command.run({ command: 'auto-handoff', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect((r.text ?? '').split('\n')[0]).toBe('ctx 62% of 150k · handoff by Alfred Code')
})

// Task 6: the fill
const TOAST = {
  filled: "Alfred Code's resume prompt filled - Enter in the prompt box sends it",
  notEmpty: "Prompt not empty: clear it, then press f to fill Alfred Code's resume prompt",
  dialog: 'A dialog holds the keys: close it, then press f again',
  noBox: 'No prompt box here to fill',
  notFilled: "Alfred Code's resume prompt was not filled",
  gone: 'Alfred Code has no resume prompt now',
}
const RESUME = 'Read .claude/session-inspector/HANDOFF.md, check that the branch it names is checked out, and continue from its Next section.'

// The session with the pane open on the Now tab; Claude Code's prompt.submit counts every submission, which must stay 0
async function filling($: Engine, on: On, surface: RenderSurface, o: Parameters<typeof stubAll>[1] = {}) {
  const sent = { count: 0 }
  const kit = await start($, on, { files: { [STATUS]: status() }, ...o }, {
    'prompt.submit': () => on('prompt.submit', (_, e) => {
      sent.count++
      return { text: e.text }
    }),
  })
  await inspect($, 'now')
  const ui = await pane($, surface)
  return { ...kit, ui, sent }
}

for (const surface of SURFACES) {
  test(`an empty draft gets the prompt verbatim (${surface})`, async ($, on) => {
    const { ui, prompt, toasts, sent } = await filling($, on, surface, { draft: '  ' })
    await ui.press({ key: 'stack-fill' })
    expect(prompt.fills).toEqual([PROMPT])
    expect(toasts).toEqual([TOAST.filled])
    expect(sent.count).toBe(0)
  })

  test(`a draft with text is untouched (${surface})`, async ($, on) => {
    const { ui, prompt, toasts, sent } = await filling($, on, surface, { draft: 'hi' })
    await ui.press({ key: 'stack-fill' })
    expect(prompt.fills).toEqual([])
    expect(prompt.draft).toBe('hi')
    expect(toasts).toEqual([TOAST.notEmpty])
    expect(sent.count).toBe(0)
  })

  test(`a refused fill toasts not filled (${surface})`, async ($, on) => {
    const { ui, prompt, toasts, sent } = await filling($, on, surface, { fill: { isFilled: false } })
    await ui.press({ key: 'stack-fill' })
    expect(prompt.fills).toEqual([])
    expect(toasts).toEqual([TOAST.notFilled])
    expect(sent.count).toBe(0)
  })

  // A press reaches only a drawn button, and the mount redraws on each change, so a stale frame cannot be staged here:
  // fillReady's own tests cover the press-time check (Decision 7)
  test(`the fill button goes when the prompt goes null, the file turns off or a read throws (${surface})`, async ($, on) => {
    const { ui, files, clock } = await filling($, on, surface)
    for (const file of [status({ handoffPrompt: null }), status({ fullContext: 'off' }), { ...status(), size: 5 * 1024 * 1024 }]) {
      files.current[STATUS] = status()
      await clock.advance(30_000)
      expect(await ui.find({ key: 'stack-fill' })).not.toBe(undefined)
      files.current[STATUS] = file
      await clock.advance(30_000)
      expect(await ui.find({ key: 'stack-fill' })).toBe(undefined)
    }
  })

  test(`a second press after a fill toasts not-empty and fills nothing (${surface})`, async ($, on) => {
    const { ui, prompt, toasts, sent } = await filling($, on, surface)
    await ui.press({ key: 'stack-fill' })
    await ui.press({ key: 'stack-fill' })
    expect(prompt.fills).toEqual([PROMPT])
    expect(toasts).toEqual([TOAST.filled, TOAST.notEmpty])
    expect(sent.count).toBe(0)
  })

  test(`off draws no fill button and Phase 4's /clear fill runs alone (${surface})`, async ($, on) => {
    const { ui, prompt, clock, h, session } = await filling($, on, surface, { files: { [STATUS]: status({ fullContext: 'off' }) } })
    expect(await ui.find({ key: 'stack-fill' })).toBe(undefined)
    await $.command.run({ command: 'auto-handoff', args: 'now', origin: { kind: 'composer' }, presentation: PRESENTATION })
    for (let i = 0; i < 50 && h().lastSave === null; i++) await clock.settle()
    expect(h().lastSave).toMatchObject({ isOk: true })
    session.id = 's2'
    await $.classic.SessionStart({ source: 'clear' })
    expect(prompt.fills).toEqual([RESUME])
  })
}

test('no toast carries the prompt', async ($, on) => {
  const { ui, toasts, prompt } = await filling($, on, 'terminal', { draft: 'x' })
  await ui.press({ key: 'stack-fill' })
  prompt.draft = ''
  await ui.press({ key: 'stack-fill' })
  await ui.press({ key: 'stack-fill' })
  expect(toasts.length).toBe(3)
  for (const t of toasts) expect(Object.values(TOAST)).toContain(t)
})
