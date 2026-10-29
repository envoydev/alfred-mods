import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, SessionUsage } from 'claude-code'

import { clock } from '../hooks/format.ts'
import { EMAILS } from '../hooks/samples.ts'
import { stackLines } from '../hooks/stack.ts'
import type { Stack } from '../types'
import { PRESENTATION, START, engine, rows, step, stepEngine, stubAll } from './kit.ts'
import type { FileStub } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const STATUS = '.claude/session-inspector/status/s1.json'
const NOW = Date.parse('2026-10-29T14:05:00Z')
const WRITTEN = '2026-10-29T14:03:00Z'
const PROMPT = 'Read docs/work/plans/inspector.md, check that branch feat/x is checked out, and continue from its Resume: line (Task 3).\nThen run npm test.'
const FULL = {
  schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: WRITTEN,
  model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, autoRun: true,
  scorer: { on: true, level: 80, rounds: 3 }, handoffPrompt: PROMPT,
}
const status = (o: Record<string, unknown> = {}): FileStub => ({ text: JSON.stringify({ ...FULL, ...o }), mtimeMs: 1 })
const without = (...names: string[]): FileStub => {
  const v: Record<string, unknown> = { ...FULL }
  for (const n of names) delete v[n]
  return { text: JSON.stringify(v), mtimeMs: 1 }
}
const READ = `read ${clock(NOW)} · written ${clock(Date.parse(WRITTEN))}`
const reading = (tokens: number, window = 1_000_000): SessionUsage =>
  ({ startedAt: 0, context: { window, tokens, percent: Math.round(tokens * 100 / window) }, rateLimits: [] })
const PANE = { title: 'Inspect', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const band = ($: Engine, surface: RenderSurface) => $.ui.mount({ plugin: 'session-inspector', surface, component: 'AbovePrompt', props: BAND })

async function now($: Engine, on: On, surface: RenderSurface, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { now: NOW, usage: reading(93_000), ...o })
  engine(on)
  await $.session.start(START)
  await $.command.run({ command: 'inspect', args: 'now', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await pane($, surface)
  return { ...kit, ui }
}
// The ALFRED CODE section as drawn: its heading up to the next section's
async function section(ui: Awaited<ReturnType<typeof pane>>): Promise<string[]> {
  const lines = await rows(ui)
  const at = lines.indexOf('ALFRED CODE')
  if (at === -1) return []
  const end = lines.findIndex((l, i) => i > at && /^(AGENTS|NEEDS A LOOK)/.test(l))
  return lines.slice(at, end === -1 ? undefined : end)
}

for (const surface of SURFACES) {
  test(`no file draws the heading and one dim line, and the band is unchanged (${surface})`, async ($, on) => {
    const { ui } = await now($, on, surface)
    expect(await section(ui)).toEqual(['ALFRED CODE', 'Alfred Code: no status file for this session'])
    expect(await rows(await band($, surface))).toEqual(['ctx ▱▱▱▱▱ 9%'])
  })

  test(`each not-used reason draws its one dim line, and HANDOFF no longer draws it (${surface})`, async ($, on) => {
    const { ui, files, clock: c } = await now($, on, surface, { files: { [STATUS]: { text: '{oops', mtimeMs: 1 } } })
    const cases: [FileStub, string][] = [
      [{ text: '{oops', mtimeMs: 1 }, 'not JSON'], [{ text: JSON.stringify({ session: 's1' }), mtimeMs: 1 }, 'no schema'],
      [status({ schema: 2 }), 'schema 2'], [status({ session: 's9' }), 'another session'], [{ ...status(), size: 5 * 1024 * 1024 }, 'unreadable'],
    ]
    for (const [file, reason] of cases) {
      files.current[STATUS] = file
      await c.advance(30_000)
      expect(await section(ui)).toEqual(['ALFRED CODE', `Alfred Code status file not used: ${reason}`])
      expect((await rows(ui)).filter(l => l.includes('not used')).length).toBe(1)
    }
  })

  test(`a full used file draws the six lines at 120 columns (${surface})`, async ($, on) => {
    const { ui } = await now($, on, surface, { files: { [STATUS]: status() } })
    const lines = await section(ui)
    expect(lines.slice(0, 4)).toEqual([
      'ALFRED CODE', 'fresh session offered from 150k of 1.0M · ctx 62% of it', 'auto-run on · scorer on (level 80, 3 rounds)', 'model claude-opus-5-5',
    ])
    expect(lines[4]!.startsWith('resume: Read docs/work/plans/inspector.md, check that branch feat/x is checke')).toBe(true)
    expect(lines[4]!.endsWith('…  fill prompt')).toBe(true)
    expect(lines[4]!.length - 'fill prompt'.length + 'f: fill prompt'.length).toBeLessThanOrEqual(120)
    expect(lines[5]).toBe(READ)
    expect(lines).toHaveLength(6)
    const button = await ui.find({ key: 'stack-fill' })
    expect(button?.props.hotkey).toBe('f')
    expect(button?.props.plain).toBe(true)
    // The stood-down HANDOFF row reads the runway
    expect((await rows(ui)).includes('ctx 62% of 150k · handoff by Alfred Code')).toBe(true)
  })

  test(`the reduced forms (${surface})`, async ($, on) => {
    const { ui, files, clock: c } = await now($, on, surface, { files: { [STATUS]: status({ resumeAt: null }) } })
    const at = async (file: FileStub): Promise<string[]> => {
      files.current[STATUS] = file
      await c.advance(30_000)
      return section(ui)
    }
    expect((await section(ui))[1]).toBe('fresh session: no offer at this window')
    expect((await at(status({ fullContext: 'compact' })))[1]).toBe('compacts where Claude Code compacts')
    expect((await at(status({ fullContext: 'off' })))[1]).toBe('full context: off · Handoff runs')
    expect((await at(without('window')))[1]).toBe('fresh session offered from 150k · ctx 62% of it')
    expect((await at(without('autoRun')))[2]).toBe('scorer on (level 80, 3 rounds)')
    expect((await at(status({ autoRun: false, scorer: { on: false, level: 70, rounds: 1 } })))[2]).toBe('auto-run off · scorer off')
    expect((await at(status({ scorer: null })))[2]).toBe('auto-run on')
    const noModes = await at(without('autoRun', 'scorer'))
    expect(noModes[2]).toBe('model claude-opus-5-5')
    const noModel = await at(without('model'))
    expect(noModel.some(l => l.startsWith('model '))).toBe(false)
    expect(noModel).toHaveLength(5)
    const noPrompt = await at(status({ handoffPrompt: null }))
    expect(noPrompt.some(l => l.startsWith('resume: '))).toBe(false)
    // Each poll reads 30 s after the one before: this is the tenth, then the eleventh
    expect((await at(status({ window: 'big' })))).toContain(`read ${clock(NOW + 10 * 30_000)} · written ${clock(Date.parse(WRITTEN))} · ignored: window`)
    expect((await at(without('updatedAt'))).at(-1)).toBe(`read ${clock(NOW + 11 * 30_000)}`)
  })

  test(`a disagreeing model adds its warning and turns the runway off (${surface})`, async ($, on) => {
    stepEngine(on, () => null)
    const { ui } = await now($, on, surface, { files: { [STATUS]: status() } })
    await step($, { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })
    const lines = await section(ui)
    expect(lines[1]).toBe('fresh session offered from 150k of 1.0M')
    expect(lines[3]).toBe('model claude-opus-5-5 · this session runs claude-sonnet-5-5: runway not used')
  })

  test(`line 5 skips a leading blank line (${surface})`, async ($, on) => {
    const { ui } = await now($, on, surface, { files: { [STATUS]: status({ handoffPrompt: '\n  \nRead a.md, then b' }) } })
    expect((await section(ui))[4]).toBe('resume: Read a.md, then b  fill prompt')
  })

  test(`off with a prompt draws no line 5; compact with a prompt draws it (${surface})`, async ($, on) => {
    const { ui, files, clock: c } = await now($, on, surface, { files: { [STATUS]: status({ fullContext: 'off' }) } })
    expect((await section(ui)).some(l => l.startsWith('resume: '))).toBe(false)
    expect(await ui.find({ key: 'stack-fill' })).toBe(undefined)
    files.current[STATUS] = status({ fullContext: 'compact' })
    await c.advance(30_000)
    expect((await section(ui)).some(l => l.startsWith('resume: Read docs/work'))).toBe(true)
  })

  test(`the section draws with /auto-handoff off (${surface})`, async ($, on) => {
    const { ui } = await now($, on, surface, { files: { [STATUS]: status() }, store: { 'settings:handoff': { mode: 'off', threshold: 80 } } })
    expect((await rows(ui)).some(l => l.startsWith('HANDOFF'))).toBe(false)
    expect((await section(ui))[1]).toBe('fresh session offered from 150k of 1.0M · ctx 62% of it')
  })

  test(`right after /clear, line 5 and f stay (${surface})`, async ($, on) => {
    const { ui, session } = await now($, on, surface, { files: { [STATUS]: status() } })
    session.id = 's2'
    await $.classic.SessionStart({ source: 'clear' })
    expect((await section(ui)).some(l => l.startsWith('resume: Read docs/work'))).toBe(true)
    expect(await ui.find({ key: 'stack-fill' })).not.toBe(undefined)
  })
}

// Task 7: REC
for (const surface of SURFACES) {
  test(`with REC on, a fake email in the prompt draws ‹email› in line 5 (${surface})`, async ($, on) => {
    const email = EMAILS[0]!.text
    const { ui } = await now($, on, surface, { files: { [STATUS]: status({ handoffPrompt: `Mail ${email} the plan` }) }, store: { 'settings:rec': 'on' } })
    const line = (await section(ui)).find(l => l.startsWith('resume: '))
    expect(line).toBe('resume: Mail ‹email› the plan  fill prompt')
    expect((await rows(ui)).join('\n')).not.toContain(email)
  })

  test(`the banner draws unchanged under /rec strict (${surface})`, async ($, on) => {
    await now($, on, surface, { files: { [STATUS]: status() }, store: { 'settings:rec': 'strict' } })
    expect((await rows(await band($, surface)))[0]!.startsWith('● REC │ auto-run · scorer 80 │ ctx ▰▰▰▱▱ 62% of 150k')).toBe(true)
  })
}

const STACK: Stack = {
  state: 'used', reason: null, fullContext: 'fresh-session', model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, noOffer: false,
  autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, hasPrompt: true, updatedAt: null, readAt: NOW, ignored: [],
}

test('the heading is bold violet, the reason line and line 6 dim, the model warning warn', () => {
  const none = stackLines({ ...STACK, state: 'none', reason: 'no status file for this session' }, { prompt: null, runway: null, sessionModel: null, columns: 120 })
  expect(none[0]).toEqual([{ text: 'ALFRED CODE', bold: true, tone: 'handoff' }])
  expect(none[1]).toEqual([{ text: 'Alfred Code: no status file for this session', tone: 'dim' }])
  const used = stackLines(STACK, { prompt: 'Read a.md', runway: null, sessionModel: 'claude-sonnet-5-5', columns: 120 })
  expect(used[3]).toContainEqual({ text: ' · this session runs claude-sonnet-5-5: runway not used', tone: 'warn' })
  expect(used.at(-1)).toEqual([{ text: `read ${clock(NOW)}`, tone: 'dim' }])
  // A state never read draws the no-file line
  expect(stackLines({ ...STACK, state: 'none', reason: null }, { prompt: null, runway: null, sessionModel: null, columns: 120 })[1])
    .toEqual([{ text: 'Alfred Code: no status file for this session', tone: 'dim' }])
})

test('a narrow pane cuts line 5 to fit beside the button', () => {
  const lines = stackLines(STACK, { prompt: PROMPT, runway: null, sessionModel: null, columns: 60 })
  const row = lines[4]!
  const width = row.reduce((n, s) => n + ('text' in s ? s.text.length : 'button' in s ? `${s.button.hotkey}: ${s.button.label}`.length : 0), 0)
  expect(width).toBeLessThanOrEqual(60)
  expect(row.some(s => 'button' in s && s.button.key === 'stack-fill' && s.button.hotkey === 'f')).toBe(true)
})
