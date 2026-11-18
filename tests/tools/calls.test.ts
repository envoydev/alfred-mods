import { expect, test } from 'claude-code/testing'

import { rememberCall } from '../../hooks/tools/calls'
import type { ToolCall } from '../../hooks/tools/types'

test('past 100 calls the oldest record is dropped', () => {
  const calls = new Map<string, ToolCall>()
  for (let index = 0; index <= 100; index++) rememberCall(calls, `c${index}`, 'Bash')
  expect(calls.size).toBe(100)
  expect(calls.has('c0')).toBe(false)
  expect(calls.has('c100')).toBe(true)
})
