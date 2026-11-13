// The agents' types: rows, loops and lanes
import type { AgentRow, AgentStatus, Loop } from '../../types'
export type { AgentRow, AgentStatus, Loop }

// A lane's text widths at `columns` (spec C2): a glyph and a space, the label and a space, the bar, a space and the time. The time
// cell is as wide as the longest lane's, never cut; the label as wide as the longest, from 6 to 40 cells, giving way
// down to 6 so the bar keeps 10; the bar takes the rest up to 40, so a wide pane is not a row of dots (the user,
// 2026-11-12). Null where even that does not fit: the pane draws no lanes.
export type LaneFit = { label: number; bar: number; time: number }

export type TreeRow = { row: AgentRow; depth: number; isLast: boolean; prefix: string }
