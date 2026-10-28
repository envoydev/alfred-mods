import { expect, test } from 'claude-code/testing'

import { bar, duration, elapsed, oneLine, printable, tokens, usd, when } from '../hooks/format.ts'

test('a bar is 10 cells of 10%, a cell filled only when its share is reached', () => {
  expect(bar(45)).toEqual(['▰▰▰▰', '▱▱▱▱▱▱'])
  expect(bar(7).join('')).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(bar(10).join('')).toBe('▰▱▱▱▱▱▱▱▱▱')
  expect(bar(100).join('')).toBe('▰▰▰▰▰▰▰▰▰▰')
  expect(bar(-3).join('')).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(bar(130).join('')).toBe('▰▰▰▰▰▰▰▰▰▰')
})

// Local times: within 24 hours the clock, else the day and month
test('a reset reads as its clock, or its date and clock past 24 hours', () => {
  const now = new Date(2026, 9, 28, 14, 0).getTime()
  expect(when(new Date(2026, 9, 28, 17, 0).getTime(), now)).toBe('17:00')
  expect(when(new Date(2026, 9, 31, 11, 0).getTime(), now)).toBe('31.10 11:00')
  expect(when(new Date(2026, 10, 5, 9, 30).getTime(), now)).toBe('05.11 09:30')
})

test('token counts read as the mockups do', () => {
  expect([54, 900, 2100, 8000, 12000, 412000, 1_900_000].map(tokens))
    .toEqual(['54', '0.9k', '2.1k', '8k', '12k', '412k', '1.9M'])
})

test('durations and money', () => {
  expect([48_000, 190_000, 120_000, 4_320_000].map(duration)).toEqual(['48s', '3m 10s', '2m', '1h 12m'])
  expect(elapsed(12_000)).toBe('0:12')
  expect(usd(3.124)).toBe('$3.12')
})

test('a long multi-line text is one line', () => {
  expect(oneLine('\n  Exit code 1\nmore', 80)).toBe('Exit code 1')
  const cut = oneLine('x'.repeat(2000), 80)
  expect(cut.length).toBe(80)
  expect(cut.endsWith('…')).toBe(true)
})

test('drawn text keeps tab and newline as its only control characters', () => {
  expect(printable('\x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b[1;31mred\x1b[0m\tok')).toBe('link red\tok')
  expect(printable('a\r\nb\rc\x00\x7f\x9b')).toBe('a\nb\nc')
})
