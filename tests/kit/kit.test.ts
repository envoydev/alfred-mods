// claude-kit's settings file read by the mod: the pure parse, and what the hooks do with the file - read at a start, a
// start-over and a main turn's end, written only when the values change, and never a toast or an error
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isKitOn, kitPassScore, kitPathOf, parseKitSettings } from '../../hooks/kit/kit'
import { KIT_FILE_MAX_CHARS } from '../../hooks/kit/constants'
import { START, engine, rows, stubAll, watchState } from '../kit'
import { KIT_VALUES, SETTINGS, SETTINGS_PATH, SETTINGS_TEXT } from './settings'

test('the kit file reads all nine names', () => {
  expect(parseKitSettings(SETTINGS_TEXT)).toEqual(KIT_VALUES)
})

test('a name the mod does not know is ignored, and a model may be absent', () => {
  expect(parseKitSettings('{"new_flag":"on","auto_run":"on","plan_model":"fable"}')).toEqual({ auto_run: 'on', plan_model: 'fable' })
})

test('a bad value drops that name only', () => {
  const text = JSON.stringify({ auto_run: 'maybe', scoring: 'on', auto_approve: true, plan_model: 'gpt', review_model: 'opus', pass_score: 'high', search_model: 7 })
  expect(parseKitSettings(text)).toEqual({ scoring: 'on', review_model: 'opus' })
})

test('the pass score is a whole number from 1 to 100, as a JSON number or a string of digits, as the kit takes it', () => {
  for (const bad of [0, 101, 8.5, -3, '0', '101', '8.5', '-3', ' 90', '9 0', '', 'high', null, true, [90]]) expect(parseKitSettings(JSON.stringify({ pass_score: bad }))).toEqual({})
  for (const good of [1, 90, 100]) expect(parseKitSettings(JSON.stringify({ pass_score: good }))).toEqual({ pass_score: good })
  expect(parseKitSettings('{"pass_score":"90"}')).toEqual({ pass_score: 90 })
  expect(parseKitSettings('{"pass_score":"090"}')).toEqual({ pass_score: 90 })
})

test('a file that is absent, blank, not JSON, not an object or over the size cap gives no kit data', () => {
  for (const text of ['', '  \n', '{ not json', '[1]', '7', 'null', '"on"']) expect(parseKitSettings(text)).toBeNull()
  expect(parseKitSettings(`{"auto_run":"on","pad":"${'a'.repeat(KIT_FILE_MAX_CHARS)}"}`)).toBeNull()
})

test('a name such as __proto__ is never read, and never becomes the prototype', () => {
  const values = parseKitSettings('{"__proto__":{"auto_run":"on"},"scoring":"on"}')
  expect(values).toEqual({ scoring: 'on' })
  expect(Object.getPrototypeOf(values)).toBe(Object.prototype)
})

test('the on value reads as on, any other as off', () => {
  expect(isKitOn(KIT_VALUES, 'auto_run')).toBe(true)
  expect(isKitOn(KIT_VALUES, 'plan_model')).toBe(false)
  expect(isKitOn(KIT_VALUES, 'missing')).toBe(false)
  expect(isKitOn({ auto_run: 'off' }, 'auto_run')).toBe(false)
})

test('the pass score counts only while scoring is on', () => {
  expect(kitPassScore({ scoring: 'on', pass_score: 90 })).toBe(90)
  expect(kitPassScore({ scoring: 'off', pass_score: 90 })).toBeNull()
  expect(kitPassScore({ pass_score: 90 })).toBeNull()
  expect(kitPassScore({ scoring: 'on' })).toBeNull()
})

test('the file lives under the session root', () => {
  expect(kitPathOf('/w')).toBe('/w/.claude/kit/settings.json')
  expect(kitPathOf('/w/')).toBe('/w/.claude/kit/settings.json')
  expect(kitPathOf('C:\\w\\')).toBe('C:\\w/.claude/kit/settings.json')
})

const FILE = `/w/${SETTINGS_PATH}`
async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  const values = (): unknown => (state.get('kit') as { values: unknown } | undefined)?.values ?? null
  const reads = (): number => kit.files.reads.filter(path => path.endsWith(SETTINGS_PATH)).length
  const writes = (): number => state.writes.filter(write => write.includes('"shape":"kit-2"')).length
  return { ...kit, state, values, reads, writes }
}
const turn = async ($: Engine, turnId: string): Promise<void> => {
  await $.turn.start({ text: 'q', turnId })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
}
const kitFile = (fields: Record<string, unknown>) => ({ text: JSON.stringify(fields), mtimeMs: 0 })

test('a session start reads the kit file under the session root', async ($, on) => {
  const { values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  expect(values()).toEqual(KIT_VALUES)
})

test('the root the session names is where the file is looked for, not the working folder', async ($, on) => {
  const { values } = await start($, on, { cwd: '/elsewhere', root: '/proj', files: { '/proj/.claude/kit/settings.json': kitFile(SETTINGS), '/elsewhere/.claude/kit/settings.json': kitFile({ auto_run: 'off' }) } })
  expect(values()).toEqual(KIT_VALUES)
})

test('no file, a file that does not parse and one that is no object leave no kit data, with no toast and no error', async ($, on) => {
  const { values, toasts } = await start($, on, { files: { [FILE]: { text: '{ not json', mtimeMs: 0 } } })
  expect(values()).toBeNull()
  expect(toasts).toEqual([])
})

test('a missing file draws nothing and tells nothing', async ($, on) => {
  const { values, toasts, writes } = await start($, on)
  expect(values()).toBeNull()
  expect(toasts).toEqual([])
  expect(writes()).toBe(0)
})

test('a start-over reads the file again at once', async ($, on) => {
  const { files, session, values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  files.current[FILE] = kitFile({ auto_run: 'off', scoring: 'on', pass_score: 70 })
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(values()).toEqual({ auto_run: 'off', scoring: 'on', pass_score: 70 })
})

test('a start-over that finds the file gone shows no kit data again', async ($, on) => {
  const { files, session, values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  delete files.current[FILE]
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(values()).toBeNull()
})

test("a main turn's end reads the file off the hook, on the clock's next turn", async ($, on) => {
  const { clock, files, values, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  expect(reads()).toBe(1)
  files.current[FILE] = kitFile({ auto_run: 'off' })
  await turn($, 't1')
  expect(reads()).toBe(1)
  expect(values()).toEqual(KIT_VALUES)
  await clock.advance(0)
  expect(reads()).toBe(2)
  expect(values()).toEqual({ auto_run: 'off' })
})

test('a sub-agent turn does not read the file', async ($, on) => {
  const { clock, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'u1', reason: 'answer', agentId: 'unknown-agent' })
  await clock.advance(0)
  expect(reads()).toBe(1)
})

test('an unchanged file writes nothing again, whatever the key order or spacing', async ($, on) => {
  const { clock, files, writes, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  const atStart = writes()
  files.current[FILE] = { text: `\n${JSON.stringify(Object.fromEntries(Object.entries(SETTINGS).reverse()), null, 4)}\n`, mtimeMs: 5 }
  await turn($, 't1')
  await clock.advance(0)
  expect(reads()).toBe(2)
  expect(writes()).toBe(atStart)
})

// claude-kit's modes line (the user, 2026-11-25): its auto-run, and scoring with its pass score and its loop's 3 rounds,
// then its models; auto-approve stays in the Now tab's CLAUDE-KIT section
test("the band draws claude-kit's modes and models on its own labelled line from the file", async ($, on) => {
  await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  const props = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8, bodyColumns: 200, scroll: { offset: 0, bodyRows: 8 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props })
  const lines = await rows(ui, { keepOrg: true })
  expect(lines[0]).toBe('org | unknown')
  expect(lines).toContain('claude-kit: auto-run · scoring 90 6 · plan opus | audit opus | review opus | implement sonnet | search haiku')
  expect(lines.some(line => line.includes('auto-approve'))).toBe(false)
})

const HOOK = { type: 'hook_additional_context', text: 'added', origin: { kind: 'hook' as const, event: 'UserPromptSubmit' } }

test('a UserPromptSubmit hook attachment reads the file at once, off the hook, so the mode the kit just wrote shows this turn', async ($, on) => {
  const { clock, files, values, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  files.current[FILE] = kitFile({ auto_run: 'off' })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.prompt.attachment(HOOK)
  expect(reads()).toBe(1)
  await clock.advance(0)
  expect(reads()).toBe(2)
  expect(values()).toEqual({ auto_run: 'off' })
})

test('an attachment of another origin, a subagent\'s or another hook event reads nothing', async ($, on) => {
  const { clock, files, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  files.current[FILE] = kitFile({ auto_run: 'off' })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.prompt.attachment({ type: 'date', text: 'today', origin: { kind: 'engine' as const } })
  await $.prompt.attachment({ ...HOOK, origin: { kind: 'hook' as const, event: 'SessionStart' } })
  await $.prompt.attachment({ ...HOOK, agentId: 'a1' })
  await clock.advance(0)
  expect(reads()).toBe(1)
})

test('a read that fails for a reason other than a missing file keeps the values as they were', async ($, on) => {
  const { clock, files, values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  files.current[FILE] = { text: '{}', mtimeMs: 1, size: 5 * 1024 * 1024 }
  await turn($, 't1')
  await clock.advance(0)
  expect(values()).toEqual(KIT_VALUES)
})

test('a missing file whose check is refused keeps the values', async ($, on) => {
  const { clock, files, values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) }, refuseExists: [FILE] })
  delete files.current[FILE]
  await turn($, 't1')
  await clock.advance(0)
  expect(values()).toEqual(KIT_VALUES)
})

test('a missing file clears the values at a turn\'s end', async ($, on) => {
  const { clock, files, values } = await start($, on, { files: { [FILE]: kitFile(SETTINGS) } })
  delete files.current[FILE]
  await turn($, 't1')
  await clock.advance(0)
  expect(values()).toBeNull()
})

test('when the session root cannot be had, the values stay as they were and no other folder is read', async ($, on) => {
  const { files, session, values, reads } = await start($, on, { files: { [FILE]: kitFile(SETTINGS), [SETTINGS_PATH]: kitFile({ auto_run: 'off' }) } })
  expect(values()).toEqual(KIT_VALUES)
  session.root = null
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(values()).toEqual(KIT_VALUES)
  expect(reads()).toBe(1)
  expect(files.exists.some(path => path === SETTINGS_PATH)).toBe(false)
})
