import { expect, test } from 'claude-code/testing'

import { PRESENTATION, START, engine, rows, stubAll } from '../kit'
import { promptLines } from '../../hooks/prompt/promptlines'
import { EMPTY_RECORD } from '../../hooks/prompt/constants'
import { clockText } from '../../hooks/core/format'
import type { Line } from '../../hooks/core/types'
import type { PromptPart, PromptRecord } from '../../hooks/prompt/types'

const COLUMNS = 100
const STARTED_AT = Date.UTC(2026, 10, 19, 9, 30)

const part = (fields: Partial<PromptPart> & { chars: number }): PromptPart => ({
  type: 'hook_additional_context', origin: 'hook', event: 'UserPromptSubmit', text: 'x'.repeat(fields.chars), isLeftOut: false, at: STARTED_AT, ...fields,
})
const record = (fields: Partial<PromptRecord> = {}): PromptRecord => ({ startedAt: STARTED_AT, typedChars: 30, parts: [], dropped: 0, ...fields })
const HOOK_TEXT = `Keep going. ${'z'.repeat(186)}`
const HOOK = part({ chars: 198, text: HOOK_TEXT })
const PLUGIN_TEXT = `a plugin said this${'.'.repeat(856)}`
const PLUGIN = part({ chars: 874, origin: 'plugin', event: 'PostToolUse', type: 'plugin_note', text: PLUGIN_TEXT })
const ENGINE = part({ chars: 27, origin: 'engine', event: null, type: 'date', text: "Today's date is 2026-11-19." })

// A line as the screen reads it: its texts, its code blocks and its button labels
const textOf = (line: Line): string => line.map(seg => ('text' in seg ? seg.text : 'code' in seg ? seg.code : 'button' in seg ? seg.button.label : '')).join('')
const textsOf = (lines: Line[]): string[] => lines.map(textOf)

test('the header names the time, what the person typed, the parts and their characters', () => {
  const lines = textsOf(promptLines(record({ parts: [part({ chars: 874 }), part({ chars: 198, text: 'b' }), part({ chars: 27, text: 'c' })] }), COLUMNS))
  expect(lines[0]?.startsWith(`Last turn · ${clockText(STARTED_AT)} · `)).toBe(true)
  for (const want of ['you 30 chars', '3 parts', '1,099 chars']) expect(lines[0]).toContain(want)
})

test('a turn with no typed text, a record before the first turn and dropped parts read as such', () => {
  expect(textsOf(promptLines(record({ typedChars: 0, parts: [HOOK] }), COLUMNS))[0]).toContain('no typed text')
  expect(textsOf(promptLines(record({ startedAt: null, typedChars: null, parts: [HOOK] }), COLUMNS))[0]).toContain('before the first turn')
  const dropped = textsOf(promptLines(record({ dropped: 2, parts: [HOOK] }), COLUMNS))[0]
  expect(dropped?.endsWith('· 2 dropped')).toBe(true)
  expect(textsOf(promptLines(record({ parts: [HOOK] }), COLUMNS))[0]).not.toContain('dropped')
})

test('one part reads as 1 part', () => {
  expect(textsOf(promptLines(record({ parts: [HOOK] }), COLUMNS))[0]).toContain('· 1 part ·')
})

test('the groups come as hooks, plugins, Claude Code, each only with parts', () => {
  const all = textsOf(promptLines(record({ parts: [ENGINE, PLUGIN, HOOK] }), COLUMNS))
  const at = ['From hooks', 'From plugins', 'From Claude Code'].map(name => all.indexOf(name))
  expect(at.every(i => i > 0)).toBe(true)
  expect(at).toEqual([...at].sort((left, right) => left - right))
  const hooksOnly = textsOf(promptLines(record({ parts: [HOOK] }), COLUMNS))
  expect(hooksOnly).toContain('From hooks')
  expect(hooksOnly).not.toContain('From plugins')
  expect(hooksOnly).not.toContain('From Claude Code')
})

test('a hook part is a row of event, type and characters, then its whole text', () => {
  const lines = promptLines(record({ parts: [HOOK] }), COLUMNS)
  const all = textsOf(lines)
  const head = all.indexOf('UserPromptSubmit · hook_additional_context · 198 chars')
  expect(head).toBeGreaterThan(0)
  expect(lines[head + 1]).toEqual([{ code: HOOK_TEXT }])
})

test('a plugin part is a row of event and characters, then its text', () => {
  const lines = promptLines(record({ parts: [PLUGIN] }), COLUMNS)
  const head = textsOf(lines).indexOf('PostToolUse · 874 chars')
  expect(head).toBeGreaterThan(0)
  expect(lines[head + 1]).toEqual([{ code: PLUGIN_TEXT }])
})

test('an engine part is one row of type, characters and the first line of its text', () => {
  expect(textsOf(promptLines(record({ parts: [ENGINE] }), COLUMNS))).toContain("date · 27 chars · Today's date is 2026-11-19.")
})

test('an engine part cuts its first line to the width', () => {
  const text = `first ${'w'.repeat(250)}\nsecond`
  const long = part({ chars: text.length, origin: 'engine', event: null, type: 'note', text })
  const row = textsOf(promptLines(record({ parts: [long] }), 60)).find(line => line.startsWith('note · 263 chars · first'))
  expect(row).toBeDefined()
  expect([...row ?? ''].length).toBeLessThanOrEqual(60)
  expect(row?.endsWith('…')).toBe(true)
  expect(row).not.toContain('second')
})

test('a part kept shorter than its length ends with its length', () => {
  const cut = part({ chars: 5000, text: 'x'.repeat(4000) })
  const lines = promptLines(record({ parts: [cut] }), COLUMNS)
  const block = lines.flat().find((seg): seg is { code: string } => 'code' in seg)
  expect(block?.code.endsWith('x… (5,000 chars)')).toBe(true)
  const engineCut = part({ chars: 5000, origin: 'engine', event: null, type: 'date', text: 'short' })
  expect(textsOf(promptLines(record({ parts: [engineCut] }), COLUMNS))).toContain('date · 5,000 chars · short… (5,000 chars)')
})

test('a part a plugin left out reads left out and draws no text', () => {
  const left = part({ chars: 0, text: '', isLeftOut: true })
  const lines = promptLines(record({ parts: [left] }), COLUMNS)
  expect(textsOf(lines)).toContain('UserPromptSubmit · hook_additional_context · left out')
  expect(lines.flat().some(seg => 'code' in seg)).toBe(false)
})

test('the empty record is one dim row', () => {
  expect(promptLines(EMPTY_RECORD, COLUMNS)).toEqual([[{ text: 'No turn yet in this session.', tone: 'dim' }]])
})

test('/inspect prompt opens the Prompt tab on the last turn', async ($, on) => {
  const { clock } = stubAll(on)
  engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.prompt.attachment({ type: 'date', text: "Today's date is 2026-11-19.", origin: { kind: 'engine' } })
  await clock.advance(300)

  await $.command.run({ command: 'inspect', args: 'prompt', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await $.ui.mount({
    plugin: 'alfred-mods', surface: 'terminal', component: 'Pane', requestId: 'inspect',
    props: { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const lines = (await rows(ui)).map(text => text.replace(/ +/g, ' '))
  expect(lines.some(text => text.startsWith('Last turn · '))).toBe(true)
  expect(lines).toContain("date · 27 chars · Today's date is 2026-11-19.")
})
