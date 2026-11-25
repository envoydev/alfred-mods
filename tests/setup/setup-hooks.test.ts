// /alfred-mods:init and /alfred-mods:configure: the field written into the project's settings file, the choices as text
// and as a pane, and the update a choice runs (its steps are update-hooks.test.ts's; here the folder it runs on is
// checked)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PRESENTATION, START, engine, fileAt, rows, stubAll, watchState } from '../kit'
import type { FileStub } from '../kit'
import { planText } from '../plans'

const PROJECT = '.claude/settings.json'
const PANE = { title: 'Plans folder', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const QUESTION = 'Where should plan and score files live?'
const LABELS = ['.alfred-mods (recommended)', ".alfred (Alfred Code's folder)", 'default (.claude)']
const ALFRED_LINE = 'Plans are read from .alfred/docs/work/plans/ (Alfred Code) and .alfred/alfred-mods/ (plansFolder ".alfred" in .claude/settings.json)'
const NOTE = 'new plans land there once each writer reads plansFolder - claude-kit does from its 0b09406 sync'
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
const plan = (path: string): Record<string, FileStub> => ({ [path]: { text: DONE, mtimeMs: 0 } })
const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })

type Asked = { question: string; header?: string; labels: string[] }

// `answer` is what the person picks or types in the question dialog; absent, they dismiss it, as every `-p` run does
async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}, answer?: string) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const asked: Asked[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const [first] = e.questions
    if (first === undefined) return { deny: 'test: no question' }
    asked.push({ question: first.question, header: first.header, labels: first.options.map(option => option.label) })
    return answer === undefined ? { deny: 'test: dismissed' } : { result: { questions: e.questions, answers: { [first.question]: answer } } }
  })
  engine(on)
  await $.session.start(START)
  return { ...kit, asked }
}
const alfred = async ($: Engine, verb: string, args = ''): Promise<string> =>
  (await $.command.run({ command: `alfred-mods:${verb}`, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''
const setupPane = ($: Engine) =>
  $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'Pane', requestId: 'alfred-mods-setup', props: PANE })
const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const FULLSCREEN = { columns: 200, rows: 50, isFullscreen: true }
const paneOn = ($: Engine, surface: 'terminal' | 'desktop', viewport?: typeof MAIN) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'alfred-mods-setup', props: PANE, ...(viewport === undefined ? {} : { viewport }) })
// The kit's invalidate only records the call, so the pane is mounted again to draw what a press left
async function again($: Engine, ui: { unmount: () => Promise<void> }): Promise<string[]> {
  await ui.unmount()
  return rows(await setupPane($))
}
const fieldIn = (text: string | undefined): unknown => (JSON.parse(text ?? '{}') as Record<string, Record<string, unknown>>)['alfred-mods']?.plansFolder

test('no alfred-mods command is registered: the plugin namespace comes from the commands folder', async ($, on) => {
  const { registered } = await start($, on)
  expect(registered).not.toContain('alfred-mods')
  expect(registered.filter(name => name.startsWith('alfred-mods'))).toEqual([])
})

test('the bare alfred-mods command, which the verbs replaced, is answered by no hook', async ($, on) => {
  await start($, on)
  const bare = await $.command.run({ command: 'alfred-mods', args: 'init .alfred', origin: { kind: 'composer' }, presentation: PRESENTATION }).catch(() => null)
  expect(bare).toBe(null)
})

test('init with a folder writes the project file, runs update on it and prints the writer note', async ($, on) => {
  const { files } = await start($, on)
  const text = await alfred($, 'init', '.alfred')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred')
  expect(text.split('\n')).toEqual([
    ALFRED_LINE, NOTE, 'nothing to update',
  ])
})

test('init with the recommended folder prints no writer note', async ($, on) => {
  const { files } = await start($, on)
  const text = await alfred($, 'init', '.alfred-mods')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred-mods')
  expect(text).not.toContain('claude-kit')
})

test('init with a folder passes the folder just written to update while the settings in force are stale', async ($, on) => {
  const { files } = await start($, on, { sources: { project: mod({ plansFolder: 'default' }) }, files: plan('.alfred-mods/plans/p.json') })
  expect((await alfred($, 'init', '.alfred')).split('\n')).toContain('moved 1 plan or scores file to .alfred/alfred-mods/')
  expect(fileAt(files, '.alfred/alfred-mods/plans/p.json')).toBe(DONE)
})

test('init with the field set in a file prints where plans live and runs update, writing nothing', async ($, on) => {
  const { files, opened } = await start($, on, { sources: { project: mod({ plansFolder: '.alfred' }) } })
  expect(await alfred($, 'init')).toBe(`${ALFRED_LINE} - /alfred-mods:configure changes it\nnothing to update`)
  expect(files.writes).toEqual([])
  expect(opened).not.toContain('alfred-mods-setup')
})

test('init with the field unset prints the three choices and opens the pane', async ($, on) => {
  const { files, opened, escapes } = await start($, on)
  const text = await alfred($, 'init')
  expect(text).toContain('/alfred-mods:init .alfred-mods (recommended - no permission asks)')
  expect(text).toContain("/alfred-mods:init .alfred (reads Alfred Code's plans too)")
  expect(text).toContain('/alfred-mods:init default (.claude/session-inspector - Claude Code asks before each write)')
  expect(text).not.toContain('(now)')
  expect(opened).toContain('alfred-mods-setup')
  expect(escapes).toContain('alfred-mods-setup')
  expect(files.writes).toEqual([])
})

test('configure with a local value marks it (now) and opens the pane', async ($, on) => {
  const { opened } = await start($, on, { sources: { local: mod({ plansFolder: '.alfred' }) } })
  const text = await alfred($, 'configure')
  expect(text).toContain("/alfred-mods:init .alfred (reads Alfred Code's plans too) (now)")
  expect(text.match(/\(now\)/g)).toHaveLength(1)
  expect(opened).toContain('alfred-mods-setup')
})

test('configure with a folder writes it, moves nothing and says how to move the files', async ($, on) => {
  const { files } = await start($, on)
  const text = await alfred($, 'configure', '.alfred')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred')
  expect(text.split('\n')).toEqual([NOTE, 'plansFolder is ".alfred" - /alfred-mods:update moves the files'])
  expect(text).not.toContain('nothing to update')
})

test('a higher file that wins over the value written is named, and update follows the one in force', async ($, on) => {
  await start($, on, { sources: { local: mod({ plansFolder: 'default' }) }, files: plan('.alfred-mods/plans/p.json') })
  const text = await alfred($, 'init', '.alfred')
  expect(text.split('\n')).toEqual([
    'plansFolder is "default" in .claude/settings.local.json, which wins over the value written', NOTE,
    'moved 1 plan or scores file to .claude/session-inspector/', 'update done',
  ])
})

test('under a shadow the writer note follows the folder in force, not the value written', async ($, on) => {
  await start($, on, { sources: { local: mod({ plansFolder: '.alfred-mods' }) } })
  const text = await alfred($, 'init', '.alfred')
  expect(text.split('\n')).toEqual(['plansFolder is ".alfred-mods" in .claude/settings.local.json, which wins over the value written', 'nothing to update'])
  expect(text).not.toContain('claude-kit')
})

test('configure with a value under a shadow prints the shadow line once and no closing line repeating it', async ($, on) => {
  await start($, on, { sources: { local: mod({ plansFolder: 'default' }) } })
  expect((await alfred($, 'configure', '.alfred')).split('\n')).toEqual([
    'plansFolder is "default" in .claude/settings.local.json, which wins over the value written', NOTE,
  ])
})

test('a project file that does not parse is refused and nothing is written', async ($, on) => {
  const { files } = await start($, on, { files: { [PROJECT]: { text: '{ bad', mtimeMs: 0 } } })
  for (const verb of ['init', 'configure']) expect(await alfred($, verb, '.alfred')).toBe('.claude/settings.json does not parse - plansFolder not written')
  expect(files.writes).toEqual([])
})

const USAGE = 'Usage: /alfred-mods:init [.alfred-mods|.alfred|default] | /alfred-mods:configure [.alfred-mods|.alfred|default] | /alfred-mods:update'

test('an unknown folder or an extra word prints the usage line, whichever command was typed', async ($, on) => {
  const { files } = await start($, on)
  for (const verb of ['init', 'configure']) for (const args of ['bogus', '.alfred default']) expect(await alfred($, verb, args)).toBe(USAGE)
  expect(files.writes).toEqual([])
})

test('update takes no value: one given prints the usage line and moves nothing', async ($, on) => {
  const { files } = await start($, on, { files: plan('.alfred-mods/plans/p.json') })
  expect(await alfred($, 'update', '.alfred')).toBe(USAGE)
  expect(files.writes).toEqual([])
})

test('the verb comes from the command that ran: the same value does a different thing for init and configure', async ($, on) => {
  const { files } = await start($, on, { files: plan('.alfred-mods/plans/p.json') })
  expect(await alfred($, 'configure', '.alfred')).not.toContain('moved')
  expect(files.writes).not.toContain('.alfred/alfred-mods/plans/p.json')
  expect(await alfred($, 'init', '.alfred')).toContain('moved 1 plan or scores file to .alfred/alfred-mods/')
})

test('update prints its report for the folder in force', async ($, on) => {
  await start($, on, { sources: { user: mod({ plansFolder: 'default' }) }, files: plan('.alfred-mods/plans/p.json') })
  expect(await alfred($, 'update')).toBe('moved 1 plan or scores file to .claude/session-inspector/\nupdate done')
})

test('an unplaced pane is named in the text', async ($, on) => {
  await start($, on, { unplaced: 'no pane on this surface' })
  const text = await alfred($, 'init')
  expect(text.split('\n').pop()).toBe('The pane is open but not drawn: no pane on this surface.')
})

test('the pane draws one button per choice, and a press writes the field and shows the update report', async ($, on) => {
  const { files, closed, clock, invalidates } = await start($, on)
  await alfred($, 'configure')
  const ui = await setupPane($)
  const before = await rows(ui)
  expect(before.filter(l => l.includes('.alfred-mods') || l.includes('.alfred') || l.includes('default'))).toHaveLength(3)
  expect(before.join('\n')).not.toContain('nothing to update')
  await ui.press({ key: 'choose-.alfred-mods' })
  await clock.settle()
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred-mods')
  expect(invalidates).toContain('ui.render')
  const after = (await again($, ui)).join('\n')
  expect(after).toContain('nothing to update')
  expect(after).toContain('(now)')
  expect(closed).toEqual([])
})

test('a press on a project file that does not parse shows the refusal in the pane', async ($, on) => {
  const { files, clock } = await start($, on, { files: { [PROJECT]: { text: '{ bad', mtimeMs: 0 } } })
  await alfred($, 'configure')
  const ui = await setupPane($)
  await ui.press({ key: 'choose-.alfred' })
  await clock.settle()
  expect((await again($, ui)).join('\n')).toContain('.claude/settings.json does not parse - plansFolder not written')
  expect(files.writes).toEqual([])
})

test('a press whose update fails leaves a could-not-update line in the pane', async ($, on) => {
  const { clock } = await start($, on, { refuseExists: ['.gitignore'] })
  await alfred($, 'configure')
  const ui = await setupPane($)
  await ui.press({ key: 'choose-.alfred-mods' })
  await clock.settle()
  const text = (await again($, ui)).join('\n')
  expect(text).toMatch(/\[could not update: .*\]/)
  expect(text).not.toContain('update done')
})

test('on the main screen the pane draws each choice as the line to type, and the help says to type one', async ($, on) => {
  await start($, on)
  const ui = await paneOn($, 'terminal', MAIN)
  const lines = await rows(ui)
  expect(lines.some(l => l.startsWith('/alfred-mods:init .alfred-mods') && l.includes('recommended'))).toBe(true)
  expect(lines.some(l => l.startsWith('/alfred-mods:init .alfred '))).toBe(true)
  expect(lines.some(l => l.startsWith('/alfred-mods:init default'))).toBe(true)
  expect(lines.some(l => l.startsWith('Type a line to write plansFolder'))).toBe(true)
  expect(lines.some(l => l.startsWith('A press writes'))).toBe(false)
  expect(await ui.find({ key: 'choose-.alfred' })).toBeFalsy()
})

test('in fullscreen, on the Desktop and with no viewport the pane keeps its buttons', async ($, on) => {
  await start($, on)
  for (const [surface, viewport] of [['terminal', FULLSCREEN], ['desktop', MAIN], ['terminal', undefined]] as const) {
    const ui = await paneOn($, surface, viewport)
    expect(await ui.find({ key: 'choose-.alfred' })).toBeTruthy()
    const lines = await rows(ui)
    expect(lines.some(l => l.startsWith('/alfred-mods:init'))).toBe(false)
    expect(lines.some(l => l.startsWith('A press writes'))).toBe(true)
    await ui.unmount()
  }
})

test('init with no value asks where plans live, the recommended folder first, and writes the answer and updates', async ($, on) => {
  const { files, asked, opened } = await start($, on, { files: plan('.claude/session-inspector/plans/p.json') }, LABELS[0])
  const text = await alfred($, 'init')
  expect(asked).toEqual([{ question: QUESTION, header: 'Plans folder', labels: LABELS }])
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred-mods')
  expect(text.split('\n')).toContain('moved 1 plan or scores file to .alfred-mods/')
  expect(opened).not.toContain('alfred-mods-setup')
})

test('init asks while the field is set too, marks that folder (now) and writes the other one picked', async ($, on) => {
  const { files, asked } = await start($, on, { sources: { project: mod({ plansFolder: 'default' }) } }, LABELS[1])
  await alfred($, 'init')
  expect(asked[0]?.labels).toEqual([LABELS[0], LABELS[1], `${LABELS[2]} (now)`])
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred')
})

test('picking the folder in force writes nothing: init updates it, configure only says it', async ($, on) => {
  const { files } = await start($, on, { sources: { project: mod({ plansFolder: '.alfred' }) } }, `${LABELS[1]} (now)`)
  expect(await alfred($, 'init')).toBe(`${ALFRED_LINE} - /alfred-mods:configure changes it\nnothing to update`)
  expect(await alfred($, 'configure')).toBe(ALFRED_LINE)
  expect(files.writes).toEqual([])
})

test('configure with no value asks, writes the answer and moves nothing', async ($, on) => {
  const { files } = await start($, on, { files: plan('.alfred-mods/plans/p.json') }, LABELS[2])
  const text = await alfred($, 'configure')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('default')
  expect(text).not.toContain('moved')
})

test('a folder typed as the other answer is taken', async ($, on) => {
  const { files } = await start($, on, {}, ' .alfred ')
  await alfred($, 'configure')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('.alfred')
})

test('a typed answer that names no folder writes nothing and prints the usage line', async ($, on) => {
  const { files } = await start($, on, {}, 'somewhere else')
  expect(await alfred($, 'init')).toBe(USAGE)
  expect(files.writes).toEqual([])
})

test("the mod's own question is no tool call of the session: a dismissed one counts nothing and fails nothing", async ($, on) => {
  const state = watchState(on)
  await start($, on)
  await alfred($, 'init')
  expect(state.get('stats') ?? {}).toEqual({})
  expect(state.get('failures') ?? []).toEqual([])
})

test('a folder given with the command asks nothing', async ($, on) => {
  const { asked } = await start($, on, {}, LABELS[0])
  await alfred($, 'init', '.alfred')
  expect(asked).toEqual([])
})
