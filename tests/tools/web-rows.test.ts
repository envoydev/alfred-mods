// With "quiet", a web call names its source and each step under it (the user, 2026-11-12: 'In web fetching I want to
// see what source is agent fatching ... ⎿ is a new step as single line of chain of actions'): WebFetch the page it read,
// what came back and what it took from it; WebSearch the query and the sites its results came from
import { expect, test } from 'claude-code/testing'

import { DROPS_RESULT, callLine, groupLines } from '../../hooks/tools/compact'
import type { Line } from '../../hooks/core/types'
import type { CompactCall } from '../../hooks/tools/types'

const text = (lines: Line[]): string[] => lines.map(l => l.map(s => ('text' in s ? s.text : '')).join(''))
const CALL: CompactCall = { tool: 'WebFetch', input: {}, output: undefined, isErrored: false, isInterrupted: false, outcome: null, reason: null }
const URL = 'https://code.claude.com/docs/en/plugins/mods/overview'
const fetched = (o: Record<string, unknown> = {}) => ({ bytes: 43_110, code: 200, codeText: 'OK', result: 'r', durationMs: 1_400, url: URL, ...o })
const fetch = (input: Record<string, unknown> = {}, more: Partial<CompactCall> = {}): CompactCall =>
  ({ ...CALL, input: { url: URL, prompt: 'List the hook events and their limits', ...input }, output: fetched(), ...more })
const search = (urls: string[], query = 'claude code mods api'): CompactCall => ({
  ...CALL, tool: 'WebSearch', input: { query, mode: 'standard' },
  output: { query, durationSeconds: 2, results: [{ tool_use_id: 's1', content: urls.map((url, i) => ({ title: `t${i}`, url })) }, 'commentary'] },
})

test('a WebFetch names the page, then what came back and what it took', () => {
  expect(text(callLine(fetch(), 120))).toEqual([
    '⏺ WebFetch · code.claude.com/docs/en/plugins/mods/overview · ✓',
    '  ⎿ fetched 42.1 KB · 200 OK · 1s',
    '  ⎿ took: List the hook events and their limits',
  ])
})

test('a redirect names the page it ended on', () => {
  const c = fetch({ url: 'http://www.example.com/a' }, { output: fetched({ url: 'https://example.org/b', bytes: 512 }) })
  expect(text(callLine(c, 120)).slice(0, 2)).toEqual(['⏺ WebFetch · example.com/a · ✓', '  ⎿ fetched 512 B from example.org/b · 200 OK · 1s'])
})

test('a running WebFetch names the page and what it will take, nothing fetched yet', () => {
  expect(text(callLine(fetch({}, { output: undefined }), 120))).toEqual([
    '⏺ WebFetch · code.claude.com/docs/en/plugins/mods/overview · ✓',
    '  ⎿ took: List the hook events and their limits',
  ])
})

test('a failed WebFetch keeps its error lines and no fetched step', () => {
  const lines = text(callLine(fetch({}, { isErrored: true, output: 'Request failed with status code 404' }), 120))
  expect(lines[0]).toBe('⏺ WebFetch · code.claude.com/docs/en/plugins/mods/overview · ✗')
  expect(lines.some(l => l.includes('fetched'))).toBe(false)
  expect(lines.some(l => l.includes('Request failed with status code 404'))).toBe(true)
})

test('a WebSearch names its query and the sites its results came from', () => {
  const urls = ['https://code.claude.com/docs/a', 'https://github.com/x', 'https://code.claude.com/docs/b', 'https://www.anthropic.com/news', 'https://dev.to/p', 'https://news.ycombinator.com/item']
  expect(text(callLine(search(urls), 120))).toEqual([
    '⏺ WebSearch · "claude code mods api" · ✓',
    '  ⎿ 6 results · code.claude.com, github.com, anthropic.com +2 more',
  ])
  expect(text(callLine(search([]), 120))).toEqual(['⏺ WebSearch · "claude code mods api" · ✓', '  ⎿ no results'])
})

test('a long URL and a long ask are cut to the width', () => {
  const lines = text(callLine(fetch({ url: `https://example.com/${'p/'.repeat(80)}`, prompt: 'x '.repeat(100) }, { output: undefined }), 60))
  expect(lines.every(l => [...l].length <= 60)).toBe(true)
  expect(lines[0]?.endsWith('… · ✓')).toBe(true)
})

test('in a group each web call keeps its steps', () => {
  expect(text(groupLines([fetch(), fetch({ url: 'https://example.com/x' }, { output: undefined })], 120))).toEqual([
    '⏺ WebFetch · code.claude.com/docs/en/plugins/mods/overview · ✓',
    '  ⎿ fetched 42.1 KB · 200 OK · 1s',
    '  ⎿ took: List the hook events and their limits',
    '⏺ WebFetch · example.com/x · ✓',
    '  ⎿ took: List the hook events and their limits',
  ])
})

test('their own result block gives way to the steps', () => {
  expect(DROPS_RESULT.includes('WebFetch')).toBe(true)
  expect(DROPS_RESULT.includes('WebSearch')).toBe(true)
})

test('a site reads in lower case, one entry per host', () => {
  expect(text(callLine(search(['https://en.Wikipedia.org/a', 'https://en.wikipedia.org/b']), 120))[1]).toBe('  ⎿ 2 results · en.wikipedia.org')
})
