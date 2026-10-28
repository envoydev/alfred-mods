import { expect, test } from 'claude-code/testing'

import { pace, spark, turnsLeft } from '../hooks/forecast.ts'

test('turns left to 80%', () => {
  expect(turnsLeft([10, 20, 30])).toBe(5)
  expect(turnsLeft([10, 20])).toBeNull()
  expect(turnsLeft([30, 30, 30])).toBeNull()
  expect(turnsLeft([70, 75, 82])).toBeNull()
  expect(turnsLeft([0, 1, 2, 3, 4, 5, 30])).toBe(9) // last 5 deltas 1,1,1,1,25: mean 5.8, ceil(50 / 5.8)
})

const MIN = 60_000

test('pace against the reset', () => {
  const pts = [{ at: 0, percent: 10 }, { at: 10 * MIN, percent: 20 }, { at: 20 * MIN, percent: 30 }]
  expect(pace('five_hour', pts, 100 * MIN, 20 * MIN)).toEqual({ limitAt: 90 * MIN }) // 20m + 70 points at 1 a minute
  expect(pace('five_hour', pts, 80 * MIN, 20 * MIN)).toBe('on-pace')
  expect(pace('five_hour', pts.slice(0, 2), 100 * MIN, 20 * MIN)).toBeNull()
})

// One whole-point step over a few minutes read as a steep rise and raised a false 'limit' (final review minor)
test('pace waits for readings over 5% of the window', () => {
  const step = [{ at: 0, percent: 54 }, { at: MIN, percent: 54 }, { at: 3 * MIN, percent: 55 }]
  expect(pace('five_hour', step, 180 * MIN, 3 * MIN)).toBeNull()
  const slow = [{ at: 0, percent: 54 }, { at: 8 * MIN, percent: 54 }, { at: 16 * MIN, percent: 55 }]
  expect(pace('five_hour', slow, 180 * MIN, 16 * MIN)).toBe('on-pace') // 45 points at 16 minutes each: after the reset
  const hours = [{ at: 0, percent: 30 }, { at: 240 * MIN, percent: 31 }, { at: 480 * MIN, percent: 32 }]
  expect(pace('seven_day', hours, 7200 * MIN, 480 * MIN)).toBeNull() // 8 hours of a week, under its 8.4
  expect(pace('other_window', slow, 180 * MIN, 16 * MIN)).toBeNull() // no known length to measure against
})

test('spark', () => {
  expect(spark([0, 14, 50, 100])).toBe('▁▁▄▇')
})
