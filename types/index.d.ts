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
export type Running = { id: string; label: string; startedAt: number }
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
}
export type Tab = 'now' | 'usage' | 'tools' | 'timeline'
export type View = { tab: Tab; shown: string[] }
export type PacePoint = { at: number; percent: number }
export type Pace = Record<string, { resetsAt: string | null; points: PacePoint[]; toasted: number[] }>

declare module 'claude-code' {
  interface PluginState {
    'session-inspector': {
      stats: Shaped<Record<string, ToolStat>>; failures: Shaped<Failure[]>; turns: Shaped<Turn[]>
      live: Shaped<Live>; usage: Shaped<Usage>; totals: Shaped<Totals>; meta: Shaped<Meta>
      view: Shaped<View>; pace: Shaped<Pace>; agents: Shaped<string[]>; tick: number
    }
  }
}
