import { expect, test } from 'claude-code/testing'

import { isRecord } from '../../hooks/core/guards'

test('a plain record is an object, not null and not an array', () => {
  expect(isRecord({ field: 1 })).toBe(true)
  expect(isRecord({})).toBe(true)
  expect(isRecord(null)).toBe(false)
  expect(isRecord(['field'])).toBe(false)
  expect(isRecord('field')).toBe(false)
  expect(isRecord(undefined)).toBe(false)
})
