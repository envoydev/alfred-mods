import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { START, emptyState, engine, stubAll } from '../kit'
import { EMPTY_RECORD, MAX_PARTS } from '../../hooks/prompt/constants'
import type { PromptRecord } from '../../hooks/prompt/types'

// Any hook's added context: the record keeps it as a part, whatever it says
const HOOK_TEXT = 'a hook added this context'
const FLUSH_MS = 250

const engineAttachment = (text: string, type = 'date') => ({ type, text, origin: { kind: 'engine' as const } })
const hookAttachment = (text: string) => ({ type: 'hook_additional_context', text, origin: { kind: 'hook' as const, event: 'UserPromptSubmit' } })
const startTurn = ($: Engine, text: string, turnId = 't1') => $.turn.start({ text, turnId })

test('a main turn starts a record, and its attachments join it', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(hookAttachment(HOOK_TEXT))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record.typedChars).toBe(5)
  expect(record.parts.map(part => part.type)).toEqual(['date', 'hook_additional_context'])
  expect(record.parts[1]).toMatchObject({ origin: 'hook', event: 'UserPromptSubmit', isLeftOut: false })
})

test('a subagent\'s turn and attachments leave the main record', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await clock.advance(FLUSH_MS)
  const before = JSON.stringify(state.get('prompt'))
  const writes = state.writes.length
  await $.turn.start({ text: 'x', turnId: 't2', agentId: 'a1' })
  await $.prompt.attachment({ ...engineAttachment('sub part'), agentId: 'a1' })
  await $.prompt.attachment({ ...hookAttachment(HOOK_TEXT), agentId: 'a1' })
  await clock.advance(FLUSH_MS)
  expect(JSON.stringify(state.get('prompt'))).toBe(before)
  expect(state.writes.slice(writes).some(write => write.includes('"shape":"prompt-1"'))).toBe(false)
})

test('the answer is the engine\'s, untouched', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on, ['prompt.attachment'])
  on('prompt.attachment', () => ({ text: null }))
  await $.session.start(START)
  await startTurn($, 'hello')
  expect(await $.prompt.attachment(engineAttachment('Today is a day'))).toEqual({ text: null })
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts[0]).toMatchObject({ isLeftOut: true, chars: 0, text: '' })
})

test('the cap drops the parts past it and counts them', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(hookAttachment(HOOK_TEXT))
  for (let i = 0; i < MAX_PARTS + 10; i++) await $.prompt.attachment(engineAttachment(`part ${i}`))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record.dropped).toBe(11)
  expect(record.parts.some(part => part.type === 'hook_additional_context')).toBe(false)
})

test('two hook attachments are both recorded', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(hookAttachment(HOOK_TEXT))
  await $.prompt.attachment(hookAttachment(`${HOOK_TEXT} again`))
  await clock.advance(FLUSH_MS)
  const record = state.get('prompt') as PromptRecord
  expect(record.parts.filter(part => part.type === 'hook_additional_context')).toHaveLength(2)
})

test('before the first turn', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
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
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  const promptWrites = () => state.writes.filter(write => write.includes('"shape":"prompt-1"')).length
  const atStart = promptWrites()
  for (let i = 0; i < 30; i++) await $.prompt.attachment(engineAttachment(`part ${i}`))
  expect(promptWrites() - atStart).toBeLessThanOrEqual(1)
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts).toHaveLength(30)
})

test('start-over: a /clear empties the record', async ($, on) => {
  const { clock } = stubAll(on)
  const state = emptyState(on, ['prompt'])
  engine(on)
  await $.session.start(START)
  await startTurn($, 'hello')
  await $.prompt.attachment(engineAttachment('Today is a day'))
  await $.prompt.attachment(hookAttachment(HOOK_TEXT))
  await clock.advance(FLUSH_MS)
  expect((state.get('prompt') as PromptRecord).parts).toHaveLength(2)
  state.empty()
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('prompt')).toEqual(EMPTY_RECORD)
})

test('a recording failure after the engine answered returns that answer once and asks the engine once', async ($, on) => {
  stubAll(on)
  engine(on, ['prompt.attachment'])
  let asked = 0
  on('prompt.attachment', (_, e) => {
    asked += 1
    return { text: `${e.text}!` }
  })
  await $.session.start(START)
  await startTurn($, 'hello')
  // No origin: reading it throws inside the mod's own recording, after the engine answered
  const broken = { type: 'date', text: 'Today is a day' } as unknown as Parameters<Engine['prompt']['attachment']>[0]
  const answer = await $.prompt.attachment(broken)
  expect(answer).toEqual({ text: 'Today is a day!' })
  expect(asked).toBe(1)
})
