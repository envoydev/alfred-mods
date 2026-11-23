// The skip ask's types: its atom's value is declared in types/index.d.ts, with the mod's other $.state values
import type { SkipAsk } from '../../types'
export type { SkipAsk }

// What `$.store` keeps under `skip-ask` once the person answers
export type SkipAnswer = { answeredAt: number }
