// The band's input and setting
import type { AgentRow } from '../agents/types'
import type { PlanView, ScoresView } from '../plan/types'
import type { Live, Session, Pace, Totals, Turn, Usage } from '../session/types'
import type { Cache } from '../cache/types'
import type { RuleEntry, SkillListing } from '../context/types'
import type { Runway } from '../stack/types'
import type { ToolStat } from '../tools/types'
import type { RecLevel } from '../rec/types'
import type { Line, Seg } from '../core/types'
import type { AccountKind, BandMode, BandSetting } from '../../types'
export type { BandMode, BandSetting }

// `plan`: the shown plan or task list while it runs, or for 10 minutes after it finished; `isPlanInvalid`: the shown
// plan's file failed its last read; `score`: the shown plan's scores, else the newest scores file's; `rec`: REC's level
// and how many private words it hides
export type BandInput = {
  now: number; columns: number; isWorking: boolean; live: Live; usage: Usage; session: Session; turns: Turn[]
  newFailures: number; pace: Pace; agents: AgentRow[]; cache: Cache
  plan: PlanView | null; isPlanInvalid: boolean; score: ScoresView | null; rec?: { level: RecLevel; words: number }
  // Alfred Code's scoring level while scoring is on, which colours the score; null or absent, no colour
  scoreLevel?: number | null
  // `score` is the drawn plan's own, so the plan row carries it; false, it is another output's and stays on line 1
  isPlanScore?: boolean
  // What the forecast counts turns to: `at` over the window, and `label` as the Usage tab names it, F8's threshold
  // (`80%`) or the stack's resume trigger (`150k`)
  forecast?: { at: number; label: string }
  // The step F8's ask is up for, or null
  handoffAskStep?: number | null
  // The skip ask (spec 2026-11-23, D3) is up: a managed plugin skipped the mod's hooks and the option is off
  isSkipAskUp?: boolean
  // Alfred Code's runway, which the ctx item measures against while it applies
  runway?: Runway | null
  // The "band" setting: `full` adds the info line, the turn's tool count and today's cost; absent or `calm`, today's two
  // lines. `totals` and `stats` feed the info line's output speed and tool calls.
  mode?: BandMode
  // The rows the band may take (the AbovePrompt site's `maxRows`); absent, as many as it draws
  maxRows?: number
  totals?: Totals
  stats?: Record<string, ToolStat>
  // The full band's rows of every tool and the skills are open (spec: the user, 2026-11-11); the skill listing from
  // the context's last breakdown, or null before one
  isToolsOpen?: boolean
  skillListing?: SkillListing | null
  // The rules row (spec 2026-11-11, D4): the always-on rules from the breakdown, the ones loaded by path, and whether
  // by-path loads are tracked (false with leave_out_skipped_hooks on); absent, none known and tracked
  rules?: RulesInput
  // The band drawn under the input (spec 2026-11-11 band-under, U2 and U3): its action row after the gauges, and its
  // buttons pressed by a click (fullscreen) or drawn as the commands that do their jobs (the main screen)
  under?: { buttons: 'click' | 'text' }
  // What line 1's account mark shows for the signed-in account: 'Personal', a company's name, or null while unknown, and its
  // plan kind. The mark draws '<name> | <kind>', 'org | Personal' or 'org | unknown' after REC; absent, no mark
  account?: { org: string | null; kind?: AccountKind | null }
  // The MCP item (spec 2026-11-23, D5), on line 1 after the identity (the user, 2026-11-24); absent or empty, none
  mcp?: Seg[]
  // The modes line under the identity (the user, 2026-11-24): Alfred Code's and claude-kit's modes on; absent or empty, none
  modes?: Line
}

// Where the modes line goes: a line of its own under the identity, or after it on line 1 where the two fit (short of rows)
export type ModesKeep = 'own' | 'joined'

// `isSinceResume` false where the transcript counts the by-path rules from before a resume; absent, as true
export type RulesInput = { always: RuleEntry[]; byPath: RuleEntry[]; isTracked: boolean; note?: 'unread' | 'not-found'; isSinceResume?: boolean }
