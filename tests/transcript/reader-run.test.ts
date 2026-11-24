// The transcript reader's run, driven on a `$` of the test's own (tests/transcript-fake.ts): a run that stops on its
// time, a plugin reload that keeps the atom and loses the module's memory, and a start-over that lands while the run
// waits for the session id
import { expect, test } from 'claude-code/testing'

import { readTranscriptIfDue, resetTranscript, transcriptState } from '../../hooks/transcript/effects'
import { RUN_MS } from '../../hooks/transcript/constants'
import type { TranscriptReader } from '../../hooks/transcript/types'
import type { Session } from '../../hooks/session/types'
import { fakeEngine } from '../transcript-fake'
import type { Fake } from '../transcript-fake'

const MIB = 1_048_576
const RULE = '/work/app/.claude/rules/a.md'
const memory = (path: string): string =>
  `${JSON.stringify({ type: 'attachment', attachment: { type: 'nested_memory', path, displayPath: 'x', content: 'c' } })}\n`
const FILLER = `${JSON.stringify({ type: 'user', message: 'x'.repeat(MIB - 100) })}\n`
const SHAPE = 'transcript-2'
const NOW = 1_000_000
const LATER = NOW + 60_000

const readerOf = (fake: Fake): TranscriptReader =>
  (fake.atoms.get('transcript') as { value: TranscriptReader } | undefined)?.value ?? { sessionId: null, offset: 0, isInLongLine: false, startedAtTail: false, hasReachedEnd: false }
const keysOf = (fake: Fake): string[] =>
  ((fake.atoms.get('session') as { value: Session } | undefined)?.value.pathRuleKeys ?? []).map(rule => rule.key)
const settled = async (isHeld: () => boolean): Promise<void> => {
  for (let step = 0; step < 1000 && !isHeld(); step++) await Promise.resolve()
}

test('a first read that stops on its time leaves since resume, and the next run that reaches the end drops it', async () => {
  const fake = fakeEngine({ text: FILLER + FILLER + memory(RULE) })
  await resetTranscript(fake.$)
  fake.slowNextRead(RUN_MS + 50)
  await readTranscriptIfDue(fake.$, NOW)
  expect(readerOf(fake)).toMatchObject({ hasReachedEnd: false, startedAtTail: false })
  expect(transcriptState()).toEqual({ isKnown: true, note: null, isCountedInFull: false })
  await readTranscriptIfDue(fake.$, LATER)
  expect(keysOf(fake)).toEqual(['.claude/rules/a.md'])
  expect(readerOf(fake)).toMatchObject({ hasReachedEnd: true, startedAtTail: false })
  expect(transcriptState()).toEqual({ isKnown: true, note: null, isCountedInFull: true })
})

test('a plugin reload keeps that the first read began at the tail, so since resume stays', async () => {
  const fake = fakeEngine({ text: FILLER.repeat(9) + memory(RULE) })
  await resetTranscript(fake.$)
  await readTranscriptIfDue(fake.$, NOW)
  expect(readerOf(fake)).toMatchObject({ startedAtTail: true, hasReachedEnd: true })
  expect(transcriptState().isCountedInFull).toBe(false)
  // The atom outlives the reload, the module's memory does not
  const kept = fake.atoms.get('transcript')
  await resetTranscript(fake.$)
  fake.atoms.set('transcript', kept)
  await readTranscriptIfDue(fake.$, LATER)
  expect(transcriptState()).toEqual({ isKnown: true, note: null, isCountedInFull: false })
})

test('a plugin reload keeps that a read from the first byte reached the end', async () => {
  const fake = fakeEngine({ text: memory(RULE) })
  await resetTranscript(fake.$)
  await readTranscriptIfDue(fake.$, NOW)
  expect(transcriptState().isCountedInFull).toBe(true)
  const kept = fake.atoms.get('transcript')
  await resetTranscript(fake.$)
  expect(transcriptState().isCountedInFull).toBe(false)
  fake.atoms.set('transcript', kept)
  await readTranscriptIfDue(fake.$, LATER)
  expect(transcriptState().isCountedInFull).toBe(true)
})

test('the atom carries the shape tag that holds the two flags, and no path', async () => {
  const fake = fakeEngine({ text: memory(RULE) })
  await resetTranscript(fake.$)
  await readTranscriptIfDue(fake.$, NOW)
  expect(fake.atoms.get('transcript')).toEqual({ shape: SHAPE, value: { sessionId: 's1', offset: expect.any(Number), isInLongLine: false, startedAtTail: false, hasReachedEnd: true } })
  expect(JSON.stringify([...fake.atoms.values()])).not.toContain('/cfg')
})

// The run's calls of `$.session.id()`: 1 at its start, 2 for the check after the first chunk's read, 3 for the one
// after the rules are added
test('a start-over that lands while the id is asked for the check before the rules adds none, and writes no offset', async () => {
  const fake = fakeEngine({ text: memory(RULE) })
  await resetTranscript(fake.$)
  const held = fake.hold('session.id', 2)
  const running = readTranscriptIfDue(fake.$, NOW)
  await settled(held.isHeld)
  expect(held.isHeld()).toBe(true)
  await resetTranscript(fake.$)
  held.release()
  await running
  expect(keysOf(fake)).toEqual([])
  expect(readerOf(fake).offset).toBe(0)
  expect(transcriptState()).toEqual({ isKnown: false, note: null, isCountedInFull: false })
})

test('a start-over that lands while the id is asked for the check after the rules writes no offset', async () => {
  const fake = fakeEngine({ text: memory(RULE) })
  await resetTranscript(fake.$)
  const held = fake.hold('session.id', 3)
  const running = readTranscriptIfDue(fake.$, NOW)
  await settled(held.isHeld)
  expect(held.isHeld()).toBe(true)
  await resetTranscript(fake.$)
  held.release()
  await running
  expect(readerOf(fake).offset).toBe(0)
  expect(transcriptState().isKnown).toBe(false)
})

test('a run for a file that is not there, passed over by a start-over, notes nothing', async () => {
  const fake = fakeEngine({ text: '', info: 'throws' })
  await resetTranscript(fake.$)
  const held = fake.hold('fs.exists', 1)
  const running = readTranscriptIfDue(fake.$, NOW)
  await settled(held.isHeld)
  expect(held.isHeld()).toBe(true)
  await resetTranscript(fake.$)
  held.release()
  await running
  expect(transcriptState()).toEqual({ isKnown: false, note: null, isCountedInFull: false })
})

test('a run whose stat is refused, passed over by a start-over, notes nothing', async () => {
  const fake = fakeEngine({ text: memory(RULE), refuseStat: true })
  await resetTranscript(fake.$)
  const held = fake.hold('fs.stat', 1)
  const running = readTranscriptIfDue(fake.$, NOW)
  await settled(held.isHeld)
  expect(held.isHeld()).toBe(true)
  await resetTranscript(fake.$)
  held.release()
  await running
  expect(transcriptState()).toEqual({ isKnown: false, note: null, isCountedInFull: false })
})

test('a run whose stat is refused notes unread when no start-over passed it', async () => {
  const fake = fakeEngine({ text: memory(RULE), refuseStat: true })
  await resetTranscript(fake.$)
  await readTranscriptIfDue(fake.$, NOW)
  expect(transcriptState()).toEqual({ isKnown: false, note: 'unread', isCountedInFull: false })
})
