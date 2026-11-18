import { expect, test } from 'claude-code/testing'

import { resetAtOf, windowLabel } from '../../hooks/band/gauges'

test('a window kind with no short name keeps its own', () => {
  expect(windowLabel('five_hour')).toBe('5h')
  expect(windowLabel('seven_day')).toBe('7d')
  expect(windowLabel('spend_limit')).toBe('spend_limit')
})

test('a window with no reset, or one that does not parse, resets at no known time', () => {
  expect(resetAtOf({ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-28T17:00:00Z' })).toBe(Date.parse('2026-10-28T17:00:00Z'))
  expect(resetAtOf({ kind: 'five_hour', percentUsed: 40, resetsAt: null })).toBeNull()
  expect(resetAtOf({ kind: 'seven_day', percentUsed: 40, resetsAt: 'soon' })).toBeNull()
})
