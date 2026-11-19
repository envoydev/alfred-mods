import { expect, test } from 'claude-code/testing'

import { addPart, partOf, startRecord } from '../../hooks/prompt/record'
import { EMPTY_RECORD, MAX_PARTS, MAX_PART_CHARS } from '../../hooks/prompt/constants'

test('a new record holds the time and the typed length, and no parts', () => {
  expect(startRecord(30, 1000)).toEqual({ startedAt: 1000, typedChars: 30, parts: [], dropped: 0 })
  expect(EMPTY_RECORD).toEqual({ startedAt: null, typedChars: null, parts: [], dropped: 0 })
})

test('a part keeps at most 4000 characters and the full count', () => {
  const part = partOf('x', { kind: 'hook', event: 'UserPromptSubmit' }, 'a'.repeat(5000), 1)
  expect(part.chars).toBe(5000)
  expect(part.text.length).toBe(MAX_PART_CHARS)
  expect(part).toMatchObject({ type: 'x', origin: 'hook', event: 'UserPromptSubmit', isLeftOut: false, at: 1 })
})

test('a part the engine raised has no event', () => {
  expect(partOf('date', { kind: 'engine' }, 'today', 2)).toMatchObject({ origin: 'engine', event: null, chars: 5, text: 'today' })
})

test('a part with no text was left out by a plugin', () => {
  expect(partOf('x', { kind: 'engine' }, null, 1)).toMatchObject({ isLeftOut: true, chars: 0, text: '' })
})

test('the same part added twice stays once', () => {
  const part = partOf('date', { kind: 'engine' }, 'today', 1)
  const once = addPart(EMPTY_RECORD, part)
  expect(addPart(once, { ...part, at: 9 }).parts).toHaveLength(1)
  expect(addPart(once, partOf('date', { kind: 'engine' }, 'tomorrow', 1)).parts).toHaveLength(2)
})

test('past 60 parts the oldest goes and is counted', () => {
  let record = EMPTY_RECORD
  for (let i = 0; i < MAX_PARTS + 1; i++) record = addPart(record, partOf('x', { kind: 'engine' }, `part ${i}`, i))
  expect(record.parts).toHaveLength(MAX_PARTS)
  expect(record.dropped).toBe(1)
  expect(record.parts[0]!.text).toBe('part 1')
  expect(record.parts.at(-1)!.text).toBe(`part ${MAX_PARTS}`)
})
