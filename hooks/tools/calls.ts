// A tool call's record, kept from its first event to its settle
import type { ToolCall, CallFacts } from './types'

// A tool call's record, made on its first event; the newest 100 are kept
export function rememberCall(calls: Map<string, ToolCall>, id: string, tool: string): ToolCall {
  let call = calls.get(id)
  if (call === undefined) {
    call = {
      facts: { tool, ...NO_FACTS }, key: tool, tool, target: '', agentId: null, isSettled: false, outcome: null, failureId: null, blockedBy: null,
      startedAt: null, durationMs: null, pendingMs: null,
    }
    calls.set(id, call)
    if (calls.size > 100) calls.delete(calls.keys().next().value as string)
  }
  return call
}

export const NO_FACTS: Omit<CallFacts, 'tool'> = {
  checked: null, checkReason: null, asked: false, failedInTool: false, interrupted: false, classifierReason: null, hookDeny: null, result: null,
  aborted: false, autoMode: false,
}
