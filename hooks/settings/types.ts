// The settings values' types
import type { BandMode } from '../band/types'
import type { HandoffMode } from '../handoff/types'
import type { Level } from '../rec/types'

export type Field = 'band' | 'bandPlace' | 'bandRows' | 'quiet' | 'rec' | 'handoff' | 'handoffAt'

export type Source = 'policy' | 'flag' | 'local' | 'project' | 'user'

export type From = Source | 'legacy' | 'default'

export type Values = {
  band: BandMode; bandPlace: 'above' | 'under'; bandRows: boolean; quiet: boolean; rec: Level
  handoff: HandoffMode; handoffAt: number
}

export type Skip = { field: Field; source: Source }

// `userFields`: the fields the user's own file gives a valid value, the ones whose old store key retires (S7)
export type Resolved = { values: Values; from: Record<Field, From>; skipped: Skip[]; userFields: Field[] }
