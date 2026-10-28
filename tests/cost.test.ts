import { expect, test } from 'claude-code/testing'

import { baseWrites, dayUsd, recordWrites, staleKeys } from '../hooks/cost.ts'
import type { Entries } from '../hooks/cost.ts'
import { localDate } from '../hooks/forecast.ts'

// Local times, as the day the cost belongs to is the machine's
const at = (day: number, h: number, m: number): number => new Date(2026, 9, day, h, m).getTime()
const NOON = at(28, 12, 0)

// A store in memory: each reading's writes land on it, as the functions taking `$` do through $.store
const record = (store: Entries, id: string, usd: number, now: number): Entries => ({ ...store, ...recordWrites(store, id, usd, now) })

test('two sessions on one day add up', () => {
  const store = record(record({}, 's1', 1.0, NOON), 's2', 0.5, NOON)
  expect(dayUsd(store, NOON)).toBe(1.5)
})

test('a growing cost is not counted twice', () => {
  const store = record(record({}, 's1', 1.0, NOON), 's1', 1.4, NOON)
  expect(dayUsd(store, NOON)).toBe(1.4)
})

test('a cost that starts over adds, never subtracts', () => {
  const store = record(record({}, 's1', 1.4, NOON), 's1', 0.2, NOON)
  expect(dayUsd(store, NOON)).toBe(1.6)
})

test('midnight splits the day', () => {
  const store = record(record({}, 's1', 1.0, at(28, 23, 59)), 's1', 1.3, at(29, 0, 1))
  expect(dayUsd(store, at(29, 0, 1))).toBe(0.3)
  expect(store[`cost:${localDate(at(28, 23, 59))}:s1`]).toBe(1_000_000)
})

test("a cleared session's carried-over spend is not counted again", () => {
  const base = baseWrites({}, 's2', 2.0, NOON)
  expect(baseWrites(base, 's2', 2.1, NOON)).toEqual({})
  expect(dayUsd(record(base, 's2', 2.3, NOON), NOON)).toBe(0.3)
})

test('keys older than 7 days are dropped', () => {
  const day = 86_400_000
  const store = {
    [`cost:${localDate(NOON - 8 * day)}:old`]: 5,
    [`cost:${localDate(NOON - 6 * day)}:recent`]: 7,
    'cost-last:old': { micros: 5, at: NOON - 8 * day },
    'cost-last:recent': { micros: 7, at: NOON - 6 * day },
  }
  expect(staleKeys(store, NOON)).toEqual([`cost:${localDate(NOON - 8 * day)}:old`, 'cost-last:old'])
})
