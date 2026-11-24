import { expect, test } from 'claude-code/testing'

import { derivedTranscriptPath, firstNewlineByte, ruleTypeOf, scanChunk, utf8Length } from '../../hooks/transcript/lines'

const memoryLine = (path: string) =>
  JSON.stringify({ type: 'attachment', attachment: { type: 'nested_memory', path, displayPath: 'x', content: 'c' } })
const noticeLine = JSON.stringify({
  type: 'system',
  subtype: 'informational',
  content: 'alfred-mods: its classic.SessionStart hook was skipped. "p" runs first and sent the event on past it.',
})

test('whole lines only: the unfinished tail is not consumed', () => {
  const text = `${memoryLine('/a/.claude/rules/x.md')}\n{"type":"user","mess`
  const result = scanChunk(text)
  expect(result.paths).toEqual(['/a/.claude/rules/x.md'])
  expect(result.consumedBytes).toBe(utf8Length(memoryLine('/a/.claude/rules/x.md')) + 1)
})
test('multibyte text keeps the offset on line starts', () => {
  const lead = JSON.stringify({ type: 'user', message: '▱ é 🙂' })
  expect(scanChunk(`${lead}\n${memoryLine('/a/.claude/rules/y.md')}\n`).consumedBytes)
    .toBe(utf8Length(lead) + 1 + utf8Length(memoryLine('/a/.claude/rules/y.md')) + 1)
})
test('utf8Length counts one to four bytes per code point', () => {
  expect(utf8Length('a')).toBe(1)
  expect(utf8Length('é')).toBe(2)
  expect(utf8Length('▱')).toBe(3)
  expect(utf8Length('🙂')).toBe(4)
  expect(utf8Length('\ud800')).toBe(3)
})
test('a chunk with no newline consumes nothing and says so', () => {
  expect(scanChunk('x'.repeat(100))).toEqual({ consumedBytes: 0, hasNewline: false, paths: [], isSkipNoticed: false })
})
test('the first newline is found by byte, whatever the bytes before it', () => {
  expect(firstNewlineByte('\xa9tail\n{"a":1}\n')).toBe(5)
  expect(firstNewlineByte('\xc3\xa9\xc3')).toBe(-1)
})
test('a skip notice counts only on a system informational line', () => {
  expect(scanChunk(`${noticeLine}\n`).isSkipNoticed).toBe(true)
  const quoted = JSON.stringify({ type: 'user', message: { content: 'alfred-mods: its x hook was skipped.' } })
  expect(scanChunk(`${quoted}\n`).isSkipNoticed).toBe(false)
})
// The notice as Claude Code 2.1.331 wrote it in a real transcript (seen 2026-11-24 under a managed plugin), and the
// task notification that repeats its text on a queue-operation line, which is no notice of its own
test('the notice as Claude Code writes it counts, and a queue-operation line with its text does not', () => {
  const text = 'alfred-mods: its classic.SessionStart hook was skipped. "managed-sec" runs first and sent the event on past it.'
  const notice = JSON.stringify({ type: 'system', subtype: 'informational', content: text, level: 'notice', isMeta: false, timestamp: '2026-11-24T09:07:00.000Z' })
  const queued = JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: `<task-notification>${text}</task-notification>` })
  expect(scanChunk(`${notice}\n`).isSkipNoticed).toBe(true)
  expect(scanChunk(`${queued}\n`).isSkipNoticed).toBe(false)
})

test('several rule paths and a skip notice in one chunk give the paths in order and the notice', () => {
  const unrelated = JSON.stringify({ type: 'user', message: 'hi' })
  const text = [memoryLine('/a/.claude/rules/one.md'), unrelated, noticeLine, memoryLine('/a/.claude/rules/two.md'), memoryLine('/a/.claude/rules/one.md')]
    .map(line => `${line}\n`).join('')
  const result = scanChunk(text)
  expect(result.paths).toEqual(['/a/.claude/rules/one.md', '/a/.claude/rules/two.md', '/a/.claude/rules/one.md'])
  expect(result.isSkipNoticed).toBe(true)
  expect(result.consumedBytes).toBe(utf8Length(text))
})
test('crlf lines parse', () => {
  expect(scanChunk(`${memoryLine('/a/.claude/rules/w.md')}\r\n`).paths).toEqual(['/a/.claude/rules/w.md'])
})
test('a line that is no JSON is skipped', () => {
  expect(scanChunk('{"nested_memory" broken\n').paths).toEqual([])
})
test('a nested_memory attachment with no string path is skipped', () => {
  const noPath = JSON.stringify({ type: 'attachment', attachment: { type: 'nested_memory', path: 3 } })
  const otherType = JSON.stringify({ type: 'attachment', attachment: { type: 'other', path: '/a/b.md', note: 'nested_memory' } })
  expect(scanChunk(`${noPath}\n${otherType}\n`).paths).toEqual([])
})
test('the derived path replaces every character outside A-Z a-z 0-9 with -', () => {
  expect(derivedTranscriptPath('/Users/jane/.claude', '/Users/jane/work/my.app', 'abc'))
    .toBe('/Users/jane/.claude/projects/-Users-jane-work-my-app/abc.jsonl')
  expect(derivedTranscriptPath('C:/Users/jane/.claude', 'C:\\work\\app', 'abc'))
    .toBe('C:/Users/jane/.claude/projects/C--work-app/abc.jsonl')
})

test('a rule under the config folder is User, any other is Project', () => {
  expect(ruleTypeOf('/home/u/.claude/rules/a.md', '/home/u/.claude')).toBe('User')
  expect(ruleTypeOf('/home/u/.claude/rules/a.md', '/home/u/.claude/')).toBe('User')
  expect(ruleTypeOf('/home/u/app/.claude/rules/a.md', '/home/u/.claude')).toBe('Project')
  expect(ruleTypeOf('/home/u/.claude-other/rules/a.md', '/home/u/.claude')).toBe('Project')
  expect(ruleTypeOf('/home/u/.claude/rules/a.md', '')).toBe('Project')
})

test('the config folder compares with either slash, and a drive path without case', () => {
  expect(ruleTypeOf('C:\\Users\\U\\.claude\\rules\\a.md', 'c:/users/u/.claude')).toBe('User')
  expect(ruleTypeOf('C:/Users/U/work/.claude/rules/a.md', 'C:\\Users\\U\\.claude')).toBe('Project')
  expect(ruleTypeOf('/Home/U/.claude/rules/a.md', '/home/u/.claude')).toBe('Project')
})
