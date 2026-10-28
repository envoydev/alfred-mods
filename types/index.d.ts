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
export type Tab = 'now' | 'usage' | 'agents' | 'tools' | 'cache' | 'timeline'
export type View = { tab: Tab; shown: string[] }
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

declare module 'claude-code' {
  interface PluginState {
    'session-inspector': {
      stats: Shaped<Record<string, ToolStat>>; failures: Shaped<Failure[]>; turns: Shaped<Turn[]>
      live: Shaped<Live>; usage: Shaped<Usage>; totals: Shaped<Totals>; meta: Shaped<Meta>
      view: Shaped<View>; pace: Shaped<Pace>; agents: Shaped<AgentRow[]>; cache: Shaped<Cache>; tick: number
    }
  }
}
