import { expect, test } from 'claude-code/testing'

import { bar, duration, elapsed, mins, oneLine, printable, tokens, usd, when } from '../hooks/format.ts'

test('a bar is 5 cells of 20%, one character each, a cell filled only when its share is reached', () => {
  expect(bar(45)).toEqual(['▰▰', '▱▱▱'])
  expect(bar(19).join('')).toBe('▱▱▱▱▱')
  expect(bar(20).join('')).toBe('▰▱▱▱▱')
  expect(bar(100).join('')).toBe('▰▰▰▰▰')
  expect(bar(-3).join('')).toBe('▱▱▱▱▱')
  expect(bar(130).join('')).toBe('▰▰▰▰▰')
})

// Local times, always with the day and month (the user, 2026-10-28)
test('a reset reads as its date and clock', () => {
  expect(when(new Date(2026, 9, 28, 17, 0).getTime())).toBe('28.10 17:00')
  expect(when(new Date(2026, 9, 31, 11, 0).getTime())).toBe('31.10 11:00')
  expect(when(new Date(2026, 10, 5, 9, 30).getTime())).toBe('05.11 09:30')
})

test('token counts read as the mockups do', () => {
  expect([54, 900, 2100, 8000, 12000, 412000, 1_900_000].map(tokens))
    .toEqual(['54', '0.9k', '2.1k', '8k', '12k', '412k', '1.9M'])
  // 999,600 rounded to '1000k' (final review minor)
  expect(tokens(999_400)).toBe('999k')
  expect(tokens(999_600)).toBe('1.0M')
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

test('plan times are whole minutes', () => {
  expect([30_000, 720_000, 5_820_000, 7_200_000].map(mins)).toEqual(['<1m', '12m', '1h 37m', '2h'])
})
