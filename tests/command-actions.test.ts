// Every switch a click or a key works has a command too (the user, 2026-11-12: in iTerm's main screen, with tabs,
// neither the mouse nor the pane's keys reach the mod): "band": "off" and /inspect band, /inspect show, copy, report and
// fill, /auto-handoff later and compact
import { expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderSurface, RenderViewport } from 'claude-code'

import { resolve, skippedToast } from '../hooks/settings.js'
import { STACK_TOASTS } from '../hooks/stack.js'
import type { Handoff, Meta, View } from '../types'
import { PRESENTATION, SPAWN, START, engine, engineSites, rows, setUser, stubAll, watchState } from './kit.js'
import type { FileStub } from './kit.js'

const run = async ($: Engine, command: string, args: string): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}, except: string[] = [], hasSites = false) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const state = watchState(on)
  if (hasSites) engineSites(on)
  engine(on, except)
  await $.session.start(START)
  return { ...kit, state, view: (): View => state.get('view') as View, handoff: (): Handoff => state.get('handoff') as Handoff }
}

// "band": "off"

const ABOVE = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const MAIN: RenderViewport = { columns: 130, rows: 40, isFullscreen: false }
const above = ($: Engine, surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: ABOVE, viewport: MAIN })
const footer = ($: Engine) =>
  $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: MAIN })
const measure = ($: Engine, percent: number) =>
  $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
// The band's gauge line: the detail rows wait for their first item (the user, 2026-11-12)
const isBand = (lines: string[]): boolean => lines.some(l => l.startsWith('ctx '))

test('"band" takes "off", and a bad value names it', () => {
  expect(resolve({ user: { band: 'off' } }, {}).values.band).toBe('off')
  const r = resolve({ local: { band: 'none' } }, {})
  expect(skippedToast(r.skipped[0]!, r)).toBe('"band" in .claude/settings.local.json takes "full", "calm" or "off" - using "full" from the default')
})

test('"band": "off" draws no band above, and "full" brings it back', async ($, on) => {
  const kit = await start($, on, {}, [], true)
  await measure($, 40)
  await setUser($, kit, { band: 'off' })
  expect(kit.state.get('band')).toMatchObject({ mode: 'off' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await above($, surface)
    // The engine stand-in's own empty line, and nothing of the band
    expect(await rows(ui)).toEqual([''])
    await ui.unmount()
  }
  await setUser($, kit, { band: 'full' })
  const ui = await above($)
  expect(isBand(await rows(ui))).toBe(true)
  await ui.unmount()
})

test('"band": "off" with "bandPlace": "under" draws the footer alone', async ($, on) => {
  const kit = await start($, on, {}, [], true)
  await measure($, 40)
  await setUser($, kit, { band: 'off', bandPlace: 'under' })
  const low = await footer($)
  // The engine stand-in's line, its props as text, and nothing of the band
  expect(await rows(low)).toEqual([JSON.stringify(HINT)])
  expect(JSON.stringify(await low.drawn())).toContain('? for shortcuts')
  await low.unmount()
})

test('"band": "off" counts the band as not shown, so the pinned line carries the context', async ($, on) => {
  const kit = await start($, on, {}, [], true)
  await setUser($, kit, { band: 'off' })
  const ui = await above($)
  await measure($, 82)
  await kit.clock.advance(1000)
  expect(kit.statuses.at(-1)).toBe('ctx 82%')
  await ui.unmount()
})

// /inspect band

const HOME = { HOME: '/home/u' }
const USER = '/home/u/.claude/settings.json'
const USER_TEXT = '{\n  "theme": "dark"\n}\n'
const fileAt = (files: { current: Record<string, FileStub> }, path: string): string | undefined =>
  Object.entries(files.current).find(([key]) => key === path || key.endsWith(path))?.[1].text

test('/inspect band off, calm and full write "band" in the user file', async ($, on) => {
  const { files } = await start($, on, { env: HOME, files: { [USER]: { text: USER_TEXT, mtimeMs: 0 } } })
  expect(await run($, 'inspect', 'band off')).toBe('Set "band": "off" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toBe('{\n  "theme": "dark",\n  "alfred-mods": {\n    "band": "off"\n  }\n}\n')
  expect(await run($, 'inspect', 'Band CALM')).toBe('Set "band": "calm" in ~/.claude/settings.json.')
  expect(await run($, 'inspect', 'band full')).toBe('Set "band": "full" in ~/.claude/settings.json.')
  expect(fileAt(files, USER)).toContain('"band": "full"')
})

test('/inspect band alone names the mode and its source, and a bad word writes nothing', async ($, on) => {
  const { files } = await start($, on, { env: HOME, sources: { user: { 'alfred-mods': { band: 'calm' } } } })
  expect(await run($, 'inspect', 'band')).toBe('Band: calm - from ~/.claude/settings.json. /inspect band off, calm or full sets "band" in ~/.claude/settings.json.')
  expect(await run($, 'inspect', 'band loud')).toBe('Band: calm - from ~/.claude/settings.json. /inspect band off, calm or full sets "band" in ~/.claude/settings.json.')
  expect(files.writes).toEqual([])
})

// /inspect show, copy and report

function failingCalls(on: On): void {
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command.startsWith('false') ? { isError: true as const, result: `Exit code 1\n${e.command}`, text: `Exit code 1\n${e.command}` } : { result: 'ok', text: 'ok' })
}

async function turn($: Engine, turnId: string, commands: string[]): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId })
  for (const [i, command] of commands.entries()) await $.tool.call({ tool: 'Bash', command, tool_use_id: `${turnId}-${i}` })
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' })
}

async function failing($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  failingCalls(on)
  const kit = await start($, on, o, ['tool.call'])
  await turn($, 't1', ['false one', 'false two'])
  return kit
}

test('/inspect show toggles the newest failure\'s detail and opens the pane on Now', async ($, on) => {
  const { view, opened } = await failing($, on)
  expect(await run($, 'inspect', 'show')).toBe('Showing failure 2 (Bash  false two) in the inspect pane.')
  expect(view().shown).toEqual(['t1-1'])
  expect(view().tab).toBe('now')
  expect(opened).toEqual(['inspect'])
  expect(await run($, 'inspect', 'show 2')).toBe('Hid failure 2 (Bash  false two).')
  expect(view().shown).toEqual([])
  expect(await run($, 'inspect', 'show 1')).toBe('Showing failure 1 (Bash  false one) in the inspect pane.')
  expect(view().shown).toEqual(['t1-0'])
})

// The side note's catch, 2026-11-12: a number counted from the newest moves when a failure lands mid-turn
test('a failure that lands later moves no other number', async ($, on) => {
  const { copied } = await failing($, on)
  await turn($, 't2', ['false three'])
  expect(await run($, 'inspect', 'copy 1')).toBe('Copied the error of failure 1 (Bash  false one).')
  expect(await run($, 'inspect', 'copy')).toBe('Copied the error of failure 3 (Bash  false three).')
  expect(copied).toEqual(['Exit code 1\nfalse one', 'Exit code 1\nfalse three'])
})

test('past the last 10 the numbers go on, and an old one is out of the list', async ($, on) => {
  failingCalls(on)
  await start($, on, {}, ['tool.call'])
  await turn($, 't1', Array.from({ length: 12 }, (_, i) => `false n${i}`))
  expect(await run($, 'inspect', 'show 2')).toBe('No failure 2: the pane lists failures 3 to 12.')
  expect(await run($, 'inspect', 'show 3')).toBe('Showing failure 3 (Bash  false n2) in the inspect pane.')
})

test('/inspect show keeps the Tools tab, and a number out of range says how many there are', async ($, on) => {
  const { view } = await failing($, on)
  await run($, 'inspect', 'tools')
  await run($, 'inspect', 'show')
  expect(view().tab).toBe('tools')
  expect(await run($, 'inspect', 'show 3')).toBe('No failure 3: the pane lists failures 1 to 2.')
  expect(await run($, 'inspect', 'show x')).toBe('No failure x: the pane lists failures 1 to 2.')
})

test('/inspect copy copies a failure\'s error', async ($, on) => {
  const { copied } = await failing($, on)
  expect(await run($, 'inspect', 'copy')).toBe('Copied the error of failure 2 (Bash  false two).')
  expect(await run($, 'inspect', 'copy 1')).toBe('Copied the error of failure 1 (Bash  false one).')
  expect(copied).toEqual(['Exit code 1\nfalse two', 'Exit code 1\nfalse one'])
})

test('/inspect copy says when the copy did not take', async ($, on) => {
  await failing($, on, { copyRefused: 'no-clipboard' })
  expect(await run($, 'inspect', 'copy')).toBe('Not copied: this terminal has no clipboard path.')
})

test('/inspect show and copy with no failure say so', async ($, on) => {
  const { opened } = await start($, on)
  expect(await run($, 'inspect', 'show')).toBe('No tool failure to show.')
  expect(await run($, 'inspect', 'copy')).toBe('No tool failure to copy.')
  expect(opened).toEqual([])
})

const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })

test('/inspect report toggles an agent\'s report and opens the Agents tab', async ($, on) => {
  const { view } = await start($, on)
  await $.agent.spawn(SPAWN)
  await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'found it' }))
  expect(await run($, 'inspect', 'report')).toBe('Showing report 1 (general-purpose · a look) in the inspect pane.')
  expect(view().shown).toEqual(['report:a1'])
  expect(view().tab).toBe('agents')
  expect(await run($, 'inspect', 'report 1')).toBe('Hid report 1 (general-purpose · a look).')
  expect(view().shown).toEqual([])
  expect(await run($, 'inspect', 'report 2')).toBe('No report 2: there is 1, 1 the top.')
})

test('/inspect report with no finished agent says so', async ($, on) => {
  await start($, on)
  expect(await run($, 'inspect', 'report')).toBe('No agent report to show.')
})

// /inspect fill

const STATUS = '.claude/session-inspector/status/s1.json'
const PROMPT = 'Read docs/work/plans/inspector.md, check that branch feat/x is checked out, and continue from its Resume: line (Task 3).\nThen run npm test.'
const FULL = {
  schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-10-29T14:03:00Z',
  model: 'claude-opus-5-5', window: 1000000, resumeAt: 150000, autoRun: true,
  scorer: { on: true, level: 80, rounds: 3 }, handoffPrompt: PROMPT,
}

test('/inspect fill fills Alfred Code\'s resume prompt and answers as the toast did', async ($, on) => {
  const { prompt, toasts } = await start($, on, { files: { [STATUS]: { text: JSON.stringify(FULL), mtimeMs: 1 } } })
  expect(await run($, 'inspect', 'fill')).toBe(STACK_TOASTS.filled)
  expect(prompt.fills).toEqual([PROMPT])
  expect(toasts).toEqual([])
})

test('/inspect fill with no resume prompt says so', async ($, on) => {
  const { prompt } = await start($, on)
  expect(await run($, 'inspect', 'fill')).toBe(STACK_TOASTS.gone)
  expect(prompt.fills).toEqual([])
})

// /auto-handoff later and compact

const at = ($: Engine, percent: number) =>
  $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
async function until(clock: MockClock, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !isDone(); i++) await clock.settle()
}

test('/auto-handoff later takes the ask down until the next step', async ($, on) => {
  const { handoff } = await start($, on)
  expect(await run($, 'auto-handoff', 'later')).toBe('No handoff ask is up.')
  await at($, 82)
  expect(handoff().isAskUp).toBe(true)
  expect(await run($, 'auto-handoff', 'later')).toBe('The handoff ask is down until the next step.')
  expect(handoff().isAskUp).toBe(false)
  expect(handoff().lastSave ?? null).toBe(null)
})

test('/auto-handoff compact saves a handoff, then compacts', async ($, on) => {
  const { clock, state, handoff } = await start($, on)
  await at($, 82)
  expect(await run($, 'auto-handoff', 'compact')).toBe('Saving a handoff to .claude/session-inspector/HANDOFF.md, then compacting.')
  await until(clock, () => ((state.get('meta') as Meta | undefined)?.compactions ?? 0) > 0)
  expect(handoff()).toMatchObject({ isAskUp: false, lastSave: { isOk: true } })
  expect((state.get('meta') as Meta | undefined)?.compactions).toBe(1)
})

// Each failure and report carries the n its command takes, and on the terminal's main screen, where nothing takes a
// click and the pane's keys may not reach the mod, each button draws as its command (the user, 2026-11-12: 'Becasue
// right now I need to count and order')

const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FULLSCREEN: RenderViewport = { columns: 200, rows: 50, isFullscreen: true }
const pane = ($: Engine, viewport?: RenderViewport, surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE, ...(viewport === undefined ? {} : { viewport }) })
// The pane's rows, mounted for the read alone
async function look($: Engine, viewport?: RenderViewport): Promise<string[]> {
  const ui = await pane($, viewport)
  const lines = await rows(ui)
  await ui.unmount()
  return lines
}

test('each failure row starts with its number, the newest the highest and on top, on Now and on Tools', async ($, on) => {
  await failing($, on)
  await run($, 'inspect', 'now')
  const now = await look($)
  const at = (re: RegExp): number => now.findIndex(l => re.test(l))
  expect(at(/^2 ✗ \S+ Bash +false two/)).toBeGreaterThan(-1)
  expect(at(/^1 ✗ \S+ Bash +false one/)).toBe(at(/^2 ✗ /) + 1)
  await run($, 'inspect', 'tools')
  const tools = await look($)
  expect(tools.some(l => /^2 ✗ \S+ Bash +false two/.test(l))).toBe(true)
})

test('from 10 failures the numbers line up', async ($, on) => {
  failingCalls(on)
  await start($, on, {}, ['tool.call'])
  await turn($, 't1', Array.from({ length: 10 }, (_, i) => `false n${i}`))
  await run($, 'inspect', 'now')
  const lines = await look($)
  expect(lines.some(l => /^10 ✗ \S+ Bash +false n9/.test(l))).toBe(true)
  expect(lines.some(l => /^ 1 ✗ \S+ Bash +false n0/.test(l))).toBe(true)
})

test('on the main screen Show and Copy draw as their commands', async ($, on) => {
  await failing($, on)
  await run($, 'inspect', 'now')
  const ui = await pane($, MAIN)
  const lines = await rows(ui)
  expect(lines.some(l => /^2 ✗ .*false two.*\/inspect show 2 · \/inspect copy 2$/.test(l))).toBe(true)
  expect(lines.some(l => /^1 ✗ .*false one.*\/inspect show 1 · \/inspect copy 1$/.test(l))).toBe(true)
  expect(await ui.find({ key: 'show-t1-1' })).toBeFalsy()
})

test('in fullscreen, on the Desktop and with no viewport they stay buttons', async ($, on) => {
  await failing($, on)
  await run($, 'inspect', 'now')
  for (const [viewport, surface] of [[FULLSCREEN, 'terminal'], [MAIN, 'desktop'], [undefined, 'terminal']] as const) {
    const ui = await pane($, viewport, surface)
    expect(await ui.find({ key: 'show-t1-1' })).toBeTruthy()
    expect((await rows(ui)).some(l => l.includes('/inspect show'))).toBe(false)
    await ui.unmount()
  }
})

test('a report\'s button carries its number, and on the main screen its command', async ($, on) => {
  await start($, on)
  await $.agent.spawn(SPAWN)
  await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'found it' }))
  await run($, 'inspect', 'agents')
  expect((await look($)).some(l => l.endsWith('result: found it Show report 1'))).toBe(true)
  expect((await look($, MAIN)).some(l => l.endsWith('result: found it /inspect report 1'))).toBe(true)
})

test('on the main screen the handoff ask draws its commands', async ($, on) => {
  await start($, on)
  await at($, 82)
  await run($, 'inspect', 'now')
  const lines = await look($, MAIN)
  expect(lines.some(l => /past 80% · \/auto-handoff now · \/auto-handoff compact · \/auto-handoff later$/.test(l))).toBe(true)
})

test('on the main screen Alfred Code\'s fill draws as /inspect fill', async ($, on) => {
  await start($, on, { files: { [STATUS]: { text: JSON.stringify(FULL), mtimeMs: 1 } } })
  await run($, 'inspect', 'now')
  const lines = await look($, MAIN)
  expect(lines.some(l => l.includes('/inspect fill'))).toBe(true)
  expect(lines.some(l => l.includes('fill prompt'))).toBe(false)
})
