// The skip ask (spec 2026-11-23, D3): a skip notice in the transcript raises one ask in the band's action row, with the
// option off; 'Leave out' writes the option through `$.config.set`, 'Don't ask again' stores the answer
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { PRESENTATION, START, engine, engineSites, rows, stubAll, watchState } from '../kit'
import { stubTranscript } from '../transcript-stubs'
import { stubConfigSet } from '../skip-stubs'

const CONFIG = '/home/.claude'
const PATH = `${CONFIG}/projects/-work-app/s1.jsonl`
const NOW = Date.parse('2026-10-28T14:00:00Z')
const ASK = 'hooks skipped by a managed plugin · leave them out?'
const OPTION_KEY = 'alfred-mods.leave_out_skipped_hooks'
const ROW_TITLE = 'Leave out hooks a managed plugin skips'

const line = (value: unknown): string => `${JSON.stringify(value)}\n`
const notice = line({
  type: 'system', subtype: 'informational',
  content: 'alfred-mods: its classic.SessionStart hook was skipped. "p" runs first and sent the event on past it.',
})
const quoted = line({ type: 'user', message: { content: 'alfred-mods: its classic.SessionStart hook was skipped.' } })
  + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'alfred-mods: its x hook was skipped.' }] } })
const file = (text: string) => ({ text, mtimeMs: 0 })

const ABOVE = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const MAIN = { columns: 130, rows: 40, isFullscreen: false }
const above = ($: Engine) => $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: ABOVE, viewport: MAIN })
const footer = ($: Engine) => $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: MAIN })
const askRows = async (ui: { drawn: () => Promise<RenderElement> }): Promise<string[]> => (await rows(ui)).filter(row => row.includes(ASK))

type Setup = { text?: string; deny?: string; throws?: string; store?: Record<string, unknown>; isUnder?: boolean }

// A session on `/work/app` whose transcript holds `text`; the first tick reads it
async function begin($: Engine, on: On, o: Setup = {}) {
  const kit = stubAll(on, {
    root: '/work/app', cwd: '/work/app', env: { CLAUDE_CONFIG_DIR: CONFIG }, now: NOW, band: 'full',
    files: { [PATH]: file(o.text ?? notice) }, store: { ...(o.isUnder === true ? { 'settings:band-place': 'under' } : {}), ...o.store },
  })
  stubTranscript(on, {})
  const config = stubConfigSet(on, { ...(o.deny === undefined ? {} : { deny: o.deny }), ...(o.throws === undefined ? {} : { throws: o.throws }) })
  if (o.isUnder === true) engineSites(on)
  engine(on)
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  await kit.clock.advance(1000)
  await kit.clock.settle()
  return { kit, config }
}

test('a notice with the option off shows the ask once', async ($, on) => {
  const { kit } = await begin($, on)
  expect(await askRows(await above($))).toHaveLength(1)
  kit.files.current[PATH] = file(notice + notice)
  await kit.clock.advance(30_000)
  await kit.clock.settle()
  expect(await askRows(await above($))).toHaveLength(1)
})

test('the ask carries its two buttons on hotkeys 5 and 6', async ($, on) => {
  await begin($, on)
  const ui = await above($)
  expect((await ui.find({ key: 'skip-leave' }))?.props).toMatchObject({ label: 'Leave out', hotkey: '5' })
  expect((await ui.find({ key: 'skip-never' }))?.props).toMatchObject({ label: "Don't ask again", hotkey: '6' })
})

test('a user or assistant line quoting the notice raises none', async ($, on) => {
  await begin($, on, { text: quoted })
  expect(await askRows(await above($))).toEqual([])
})

test('Leave out calls config.set with the option key, and the ask closes', async ($, on) => {
  const { config } = await begin($, on)
  await (await above($)).press({ key: 'skip-leave' })
  expect(config.calls).toEqual([{ key: OPTION_KEY, value: true }])
  expect(await askRows(await above($))).toEqual([])
})

test('a deny toasts its reason and the config row', async ($, on) => {
  const { kit, config } = await begin($, on, { deny: 'locked' })
  await (await above($)).press({ key: 'skip-leave' })
  expect(config.calls).toHaveLength(1)
  expect(kit.toasts).toHaveLength(1)
  expect(kit.toasts[0]).toContain('locked')
  expect(kit.toasts[0]).toContain(ROW_TITLE)
})

test('a config.set that rejects toasts once, names the config row and leaves the ask up', async ($, on) => {
  const { kit, config } = await begin($, on, { throws: 'no config here' })
  await (await above($)).press({ key: 'skip-leave' })
  await kit.clock.settle()
  expect(config.calls).toHaveLength(1)
  expect(kit.toasts).toHaveLength(1)
  expect(kit.toasts[0]).toContain('Could not leave out the skipped hooks')
  expect(kit.toasts[0]).toContain(ROW_TITLE)
  expect(await askRows(await above($))).toHaveLength(1)
})

test('a second session.start leaves one listener, so one notice writes the ask once', async ($, on) => {
  const kit = stubAll(on, {
    root: '/work/app', cwd: '/work/app', env: { CLAUDE_CONFIG_DIR: CONFIG }, now: NOW, band: 'full', files: { [PATH]: file(notice) },
  })
  stubTranscript(on, {})
  stubConfigSet(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.session.start(START)
  await kit.clock.advance(1000)
  await kit.clock.settle()
  expect(state.writes.filter(write => write.includes('"shape":"skip-1"') && write.includes('"isAskUp":true'))).toHaveLength(1)
})

test('/inspect with a word it does not know lists the skip subcommand in its help', async ($, on) => {
  await begin($, on)
  const help = (await $.command.run({ command: 'inspect', args: 'nosuch', origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''
  expect(help).toContain('skip leave|never')
})

test("Don't ask again stores skip-ask and the ask stays away", async ($, on) => {
  const { kit } = await begin($, on)
  await (await above($)).press({ key: 'skip-never' })
  expect(kit.store.get('skip-ask')).toEqual({ answeredAt: NOW + 1000 })
  expect(await askRows(await above($))).toEqual([])
  kit.files.current[PATH] = file(notice + notice)
  await kit.clock.advance(30_000)
  await kit.clock.settle()
  expect(await askRows(await above($))).toEqual([])
})

test('an answer an earlier session stored keeps the ask away', async ($, on) => {
  await begin($, on, { store: { 'skip-ask': { answeredAt: 5 } } })
  expect(await askRows(await above($))).toEqual([])
})

test('with the option on nothing is asked', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  await begin($, on)
  expect(await askRows(await above($))).toEqual([])
})

test('the text form names the commands', async ($, on) => {
  await begin($, on, { isUnder: true })
  const drawn = (await rows(await footer($))).join('\n')
  expect(drawn).toContain(ASK)
  expect(drawn).toContain('/inspect skip leave')
  expect(drawn).toContain('/inspect skip never')
})

test('the commands do what the buttons do', async ($, on) => {
  const { kit, config } = await begin($, on)
  const run = async (args: string): Promise<string> =>
    (await $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''
  expect(await run('skip leave')).toContain('Left out')
  expect(config.calls).toEqual([{ key: OPTION_KEY, value: true }])
  await run('skip never')
  expect(kit.store.get('skip-ask')).toMatchObject({ answeredAt: expect.any(Number) })
})
