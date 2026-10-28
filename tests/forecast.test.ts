import { expect, test } from 'claude-code/testing'

import { pace, spark, turnsLeft } from '../hooks/forecast.ts'

test('turns left to 80%', () => {
  expect(turnsLeft([10, 20, 30])).toBe(5)
  expect(turnsLeft([10, 20])).toBeNull()
  expect(turnsLeft([30, 30, 30])).toBeNull()
  expect(turnsLeft([70, 75, 82])).toBeNull()
  expect(turnsLeft([0, 1, 2, 3, 4, 5, 30])).toBe(9) // last 5 deltas 1,1,1,1,25: mean 5.8, ceil(50 / 5.8)
})

test('pace against the reset', () => {
  const pts = [{ at: 0, percent: 10 }, { at: 1000, percent: 20 }, { at: 2000, percent: 30 }]
  expect(pace(pts, 9500, 2000)).toEqual({ limitAt: 9000 }) // 2000 + 70 / 0.01: the limit comes before the reset
  expect(pace(pts, 5000, 2000)).toBe('on-pace')
  expect(pace(pts.slice(0, 2), 5000, 2000)).toBeNull()
})

test('spark', () => {
  expect(spark([0, 14, 50, 100])).toBe('▁▁▄▇')
})
