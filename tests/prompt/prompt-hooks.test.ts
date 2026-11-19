import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { START, emptyState, engine, stubAll } from '../kit'
import { parseKitStatus } from '../../hooks/kit/kit'
import { EMPTY_RECORD, MAX_PARTS } from '../../hooks/prompt/constants'
import type { PromptRecord } from '../../hooks/prompt/types'
import type { KitState } from '../../hooks/kit/types'
import { LINE } from '../kit/lines'

const LINE_OFF = LINE.replace('auto_run=on', 'auto_run=off')
const FLUSH_MS = 250

const engineAttachment = (text: string, type = 'date') => ({ type, text, origin: { kind: 'engine' as const } })
const kitAttachment = (text: string) => ({ type: 'hook_additional_context', text, origin: { kind: 'hook' as const, event: 'UserPromptSubmit' } })
const startTurn = ($: Engine, text: string, turnId = 't1') => $.turn.start({ text, turnId })

test('a main turn starts a record, and its attachments join it', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(kitAttachment(LINE))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record.typedChars).toBe(5)
  expect(record.parts.map(part => part.type)).toEqual(['date', 'hook_additional_context'])
  expect(record.parts[1]).toMatchObject({ origin: 'hook', event: 'UserPromptSubmit', isLeftOut: false })
  expect((state.get('kit') as KitState).status).toEqual(parseKitStatus(LINE))
})

test('a subagent\'s turn and attachments leave the main record', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await clock.advance(FLUSH_MS)
  const before = JSON.stringify(state.get('prompt'))
  const writes = state.writes.length
  await $.turn.start({ text: 'x', turnId: 't2', agentId: 'a1' })
  await $.prompt.attachment({ ...engineAttachment('sub part'), agentId: 'a1' })
  await $.prompt.attachment({ ...kitAttachment(LINE_OFF), agentId: 'a1' })
  await clock.advance(FLUSH_MS)
  expect(JSON.stringify(state.get('prompt'))).toBe(before)
  expect(state.writes.slice(writes).some(write => write.includes('"shape":"prompt-1"'))).toBe(false)
  expect((state.get('kit') as KitState | undefined)?.status ?? null).toBe(null)
})

test('the answer is the engine\'s, untouched', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on, ['prompt.attachment'])
  on('prompt.attachment', () => ({ text: null }))
  await $.session.start(START)
  await startTurn($, 'hello')
  expect(await $.prompt.attachment(engineAttachment('Today is a day'))).toEqual({ text: null })
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts[0]).toMatchObject({ isLeftOut: true, chars: 0, text: '' })
})

test('the kit line is read before the cap drops anything', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(kitAttachment(LINE))
  for (let i = 0; i < MAX_PARTS + 10; i++) await $.prompt.attachment(engineAttachment(`part ${i}`))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record.dropped).toBe(11)
  expect(record.parts.some(part => part.type === 'hook_additional_context')).toBe(false)
  expect((state.get('kit') as KitState).status).toEqual(parseKitStatus(LINE))
})

test('on a resume the current line wins', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(kitAttachment(LINE))
  await $.prompt.attachment(kitAttachment(LINE_OFF))
  await clock.advance(FLUSH_MS)
  expect((state.get('kit') as KitState).status!.values['auto_run']!.value).toBe('off')
  const record = state.get('prompt') as PromptRecord
  expect(record.parts.filter(part => part.type === 'hook_additional_context')).toHaveLength(2)
})

test('before the first turn', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record).toMatchObject({ startedAt: null, typedChars: null })
  expect(record.parts).toHaveLength(1)
})

test('one write per flush', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  const promptWrites = () => state.writes.filter(write => write.includes('"shape":"prompt-1"')).length
  const kitWrites = () => state.writes.filter(write => write.includes('"shape":"kit-1"')).length
  const atStart = promptWrites()
  for (let i = 0; i < 30; i++) await $.prompt.attachment(engineAttachment(`part ${i}`))
  expect(promptWrites() - atStart).toBeLessThanOrEqual(1)
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts).toHaveLength(30)
  const kitBefore = kitWrites()
  for (let i = 0; i < 5; i++) await $.prompt.attachment(kitAttachment(LINE))
  expect(kitWrites() - kitBefore).toBe(1)
})

test('start-over: a /clear empties the record and keeps the kit line\'s values', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(kitAttachment(LINE))
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts).toHaveLength(2)
  state.empty()
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('prompt')).toEqual(EMPTY_RECORD)
  expect((state.get('kit') as KitState).status).toEqual(parseKitStatus(LINE))
})

test('start-over, then the same line at once: the kit values stay', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['kit', 'prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(kitAttachment(LINE))
  await clock.advance(FLUSH_MS)
  state.empty()
  await $.classic.SessionStart({ source: 'clear' })
  await $.prompt.attachment(kitAttachment(LINE))
  expect((state.get('kit') as KitState).status).toEqual(parseKitStatus(LINE))
})
