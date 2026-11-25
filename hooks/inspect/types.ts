// The inspect pane's types
import type { Runway, Stack } from '../stack/types'
import type { KitState } from '../kit/types'
import type { PluginRow } from '../plugins/types'
import type { HandoffView } from '../handoff/types'
import type { Totals } from '../session/types'
import type { Failure, ToolStat } from '../tools/types'
import type { Parts } from '../context/types'
import type { BandInput } from '../band/types'
import type { Loop } from '../agents/types'
import type { Tab, View } from '../../types'
export type { Tab, View }

// `stack`: Alfred Code's status as last read, its resume prompt from module memory, the runway and the session's model
export type TabInput = BandInput & {
  failures: Failure[]; stats: Record<string, ToolStat>; totals: Totals; view: View; handoff?: HandoffView
  // Blocks per hook script (spec C6); what fills the context (spec C1); loops no spawn announced (spec C3)
  blockers?: Record<string, number>; parts?: Parts; loops?: Loop[]
  // claude-kit's status as last read, or none seen
  kit?: KitState
  // The plugins the settings files turn on or off
  plugins?: PluginRow[]
  stack?: { view: Stack; prompt: string | null; runway: Runway | null; sessionModel: string | null }
}
