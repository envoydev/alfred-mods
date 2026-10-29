// The session-inspector's $.state contract: every value the hooks module keeps for the session.
export type Outcome = 'ok' | 'error' | 'denied' | 'blocked' | 'refused'
export type ToolStat = { calls: number; ok: number; failed: number; stopped: number }
export type Failure = {
  id: string; at: number; tool: string; target: string
  outcome: Exclude<Outcome, 'ok'>; reason: string; detail: string; count: number; isNew: boolean
}
export type TurnEnd = 'answer' | 'aborted' | 'refusal' | 'error'
export type Turn = {
  n: number; turnId: string; promptAt: number | null; replyAt: number; durationMs: number
  tokensIn: number; tokensOut: number; tools: number; failures: number
  contextPercent: number | null; end: TurnEnd
}
// Every main-loop call in flight, oldest first
export type Running = { id: string; tool: string; label: string; startedAt: number }
export type Live = {
  turnId: string | null; startedAt: number | null; tools: number; failures: number; running: Running[]; promptAt: number | null
}
export type Window = { kind: string; percentUsed: number; resetsAt: string | null }
export type Usage = {
  tokens: number | null; window: number | null; percent: number | null; startedAt: number | null
  windows: Window[]; costUsd: number | null; todayUsd: number | null; at: number
}
export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number; stepOutput: number; stepMs: number }
// A prompt the person entered that no turn has answered yet, by a fingerprint of its text, never the text
export type Waiting = { at: number; key: string }
export type Meta = {
  model: string | null; effort: string | null; compactions: number; lastCompactAt: number | null
  lastPromptAt: number | null; lastReplyAt: number | null; turnCount: number; waiting: Waiting[]
  // The main loop's settled tool calls this session
  mainCalls: number
}
export type Tab = 'now' | 'usage' | 'agents' | 'tools' | 'cache' | 'timeline' | 'plan'
// `planSlug`: the plan `/inspect plan <name>` pinned, shown while its file parses
export type View = { tab: Tab; shown: string[]; planSlug: string | null }
export type PacePoint = { at: number; percent: number }
export type Pace = Record<string, { resetsAt: string | null; points: PacePoint[]; toasted: number[] }>
// The engine's AgentStatus, copied: a contract imports nothing
export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
// An agent seen at its spawn. Its prompt is never kept: only the values of its `plan:` and `task:` lines.
export type AgentRow = {
  id: string; parentId: string | null; type: string; description: string
  plan: string | null; task: string | null; isTeammate: boolean
  model: string; effort: string | null; status: AgentStatus; isListed: boolean
  startedAt: number; endedAt: number | null
  action: string | null; report: string | null; contextTokens: number | null
  tools: Record<string, ToolStat>
}
export type CacheTier = '5m' | '1h'
// Read off the 5h and 7d windows: within the plan's usage, on usage credits, or neither window (off a subscription)
export type Billing = 'plan' | 'credits' | 'other'
export type CacheCounts = { read: number; write: number; input: number }
// What the variables and settings choose; `from` names the variable or key that pinned the tier.
// `isTerminal`: the session started in the terminal's REPL, the one place idle compaction runs for every account.
export type CacheConfig = { pin: { tier: CacheTier; from: string } | null; idleOff: boolean; idleMinTokens: number; isTerminal: boolean }
export type Cache = {
  // The last model switch's report, and the billing it was made under
  tier: CacheTier | null; tierAt: number | null; tierBilling: Billing | null
  config: CacheConfig
  ratePerToken: number | null; rateModel: string | null
  lastAt: number | null; last: CacheCounts | null; session: CacheCounts
  toastedFor: number | null
}

// A plan file and a scores file, as the README's 'Plan and score files' contract gives them; times in epoch ms
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'skipped'
export type PlanStep = { id: string; title: string; status: StepStatus; estimateMin: number | null; startedAt: number | null; doneAt: number | null }
export type PlanChange = {
  at: number | null; kind: 'created' | 'step_added' | 'step_changed' | 'step_removed' | 'integrated'
  source: 'user' | 'claude'; step: string | null; note: string | null
}
// A step's working time, every session's summed; shared when a turn was split among several running steps
export type StepTime = { ms: number; isShared: boolean }
// A loop's working time since its turn began: the main loop's, or an agent's by its id. `named`: the main slice's
// `<plan>:<step>` marks, one per agent naming a step that was live during the turn; `waits`: its all-wait calls still
// open, by call id, with their start
export type Slice = { at: number; waitMs: number; named: string[]; waits?: Record<string, number> }
// The open slices, and this session's step and overhead totals by their $.store key
export type Credit = { slices: Record<string, Slice>; mine: Record<string, StepTime> }
export type Plan = { title: string; updatedAt: number | null; steps: PlanStep[]; changes: PlanChange[] }
export type Severity = 'BLOCKER' | 'MATERIAL' | 'MINOR'
export type Finding = { id: string | null; text: string; severity: Severity | null; status: 'open' | 'fixed' | 'improved' | 'wontfix' | null; by: string | null }
export type ScoreRound = { round: number; at: number | null; total: number; criteria: Record<string, number>; findings: Finding[] }
export type Scores = { subject: { kind: 'plan' | 'diagnosis' | 'reply'; ref: string }; updatedAt: number | null; scale: number; rounds: ScoreRound[] }
// A file of the folder as last read: its last good parse, kept while a newer read fails
export type Watched<T> = { name: string; mtimeMs: number; size: number; value: T | null; isInvalid: boolean }
// The folder's plans and scores; every session's step times summed per plan; when each plan finished this session;
// the notes and finishes already seen; and when this session began, which a plan's file must be written after to run
export type Plans = {
  plans: Watched<Plan>[]; scores: Watched<Scores>[]
  times: Record<string, Record<string, StepTime>>; overhead: Record<string, number>
  finished: Record<string, number>; toasted: string[]; since: number | null
}
// A main-loop task list item, from TaskCreate, TaskUpdate or TodoWrite: its subject is a tool input, kept in $.state
// only; `ms`, the working time credited to it while in progress
export type TaskItem = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; ms: number }
// REC's level: off, on (keys, emails, phones, private words) or strict (also the account, home paths and $ amounts)
export type Level = 'off' | 'on' | 'strict'
// What surfaces redraw on: the level, the word count and the pane's last refusal, never the words themselves
export type RecState = { level: Level; count: number; note: string | null }
// /quiet: compact tool rows on or off, every session's from `settings:quiet`
export type Quiet = { isOn: boolean }
// F8: the stored mode and threshold; `point`, the tokens where Claude Code compacts by itself; `handled`, the highest
// step handled; `lastSave`, the last save's time and result; `alfred`, the stack's status file as last read
export type HandoffMode = 'ask' | 'auto' | 'off'
export type SaveResult = { at: number; isOk: boolean; reason: string | null }
export type Handoff = {
  mode: HandoffMode; threshold: number; point: number | null; handled: number | null; isAskUp: boolean
  lastSave: SaveResult | null; alfred: { state: 'none' | 'stood-down' | 'ignored'; reason: string | null }
}

// The stack's status file past Phase 4's fields (Phase 5): `state` none (no file), used, or ignored with `reason`;
// `null` is unknown, but a file's own `resumeAt: null` sets `noOffer`; `ignored`, the fields that failed their rule.
// The resume prompt's text is never here: module memory only, `hasPrompt` says whether it is known.
export type FullContext = 'fresh-session' | 'compact' | 'off'
export type StackScorer = { on: boolean; level: number; rounds: number }
export type Stack = {
  state: 'none' | 'used' | 'ignored'; reason: string | null
  fullContext: FullContext | null; model: string | null; window: number | null; resumeAt: number | null; noOffer: boolean
  autoRun: boolean | null; scorer: StackScorer | null; hasPrompt: boolean
  updatedAt: number | null; readAt: number | null; ignored: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-inspector': {
      stats: Shaped<Record<string, ToolStat>>; failures: Shaped<Failure[]>; turns: Shaped<Turn[]>
      live: Shaped<Live>; usage: Shaped<Usage>; totals: Shaped<Totals>; meta: Shaped<Meta>
      view: Shaped<View>; pace: Shaped<Pace>; agents: Shaped<AgentRow[]>; cache: Shaped<Cache>; tick: number
      plans: Shaped<Plans>; credit: Shaped<Credit>; tasks: Shaped<TaskItem[]>; rec: Shaped<RecState>; quiet: Shaped<Quiet>; handoff: Shaped<Handoff>
      stack: Shaped<Stack>
    }
  }
}
