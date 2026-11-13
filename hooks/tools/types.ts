// The tool calls' types: outcomes, failures, compact rows
import type { Failure, Outcome, Quiet, ToolStat } from '../../types'
export type { Failure, Outcome, Quiet, ToolStat }

export type CallFacts = {
  tool: string
  checked: 'allow' | 'ask' | 'deny' | null
  checkReason: string | null
  asked: boolean
  failedInTool: boolean
  interrupted: boolean
  classifierReason: string | null
  hookDeny: string | null
  result: { isError: boolean; deny: string | null; text: string } | null
  // The mod's own tool.call dispatch was abandoned when the call errored (types `Next.signal`): the person's Esc, or a
  // hook above that settled first
  aborted: boolean
  // The session's last seen permission mode was 'auto' when the call started
  autoMode: boolean
}

// `outcome` and `reason`: a call the person denied or a rule, a hook or the classifier blocked, as Phase 1 settled it
// `isAutoAllowed`: auto mode's classifier let the call run, no one asked
export type CompactCall = {
  tool: string; input: unknown; output: unknown; isErrored: boolean; isInterrupted: boolean
  outcome: 'denied' | 'blocked' | null; reason: string | null; isAutoAllowed?: boolean
}

// What a row knows besides the call: the project folder, so a path reads from it, and how many times it ran in a row
export type RowContext = { cwd?: string | null; times?: number }

// What the events said about one call. Never drawn, so a reload losing the calls in flight costs only those.
// `pendingMs`: a call the person was asked about, settled before its `duration_ms` arrived, waits for it.
export type ToolCall = {
  facts: CallFacts; key: string; tool: string; target: string; agentId: string | null
  // `blockedBy`: the hook script its last settle counted a block for
  isSettled: boolean; outcome: Outcome | null; failureId: string | null; blockedBy: string | null
  startedAt: number | null; durationMs: number | null; pendingMs: number | null
  // A Skill call whose skill runs forked, in a subagent of its own: never in the main context
  isFork?: boolean
}
