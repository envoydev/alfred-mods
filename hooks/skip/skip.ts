// The skip ask's logic: no `$` here
import type { SkipAnswer } from './types'

// A value `$.store` gave back for the answer key: an answer holds the time it was given
export function isAnswered(stored: unknown): stored is SkipAnswer {
  return typeof stored === 'object' && stored !== null && typeof (stored as { answeredAt?: unknown }).answeredAt === 'number'
}
