// The band tests' shared input: the full band's idle session with one reading, and an account unless a test says none
import type { BandInput } from '../../hooks/band/types'
import type { Cache } from '../../hooks/cache/types'
import type { Line, Seg } from '../../hooks/core/types'
import type { Usage } from '../../hooks/session/types'

export const NOW = Date.parse('2026-10-28T14:00:00Z')
export const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, isIdleCompactOff: false, idleMinTokens: 200_000, isIdleSurface: false },
  ratePerToken: null, rateModel: null, lastRequestAt: null, lastRequest: null, sessionCounts: { read: 0, write: 0, input: 0 }, toastedForRequestAt: null,
}
export const USAGE: Usage = {
  contextTokens: 60_000, contextWindow: 200_000, contextPercent: 30, startedAt: NOW - 59 * 60_000, costUsd: 1.29, todayUsd: 10.46, readingAt: NOW,
  rateWindows: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' }],
}
export const PLACE = { project: 'Example', folder: 'Frontend/src/app', branch: 'develop', sync: { ahead: 1, behind: 2 }, changes: { added: 12, removed: 3 } }
export const REC = { level: 'on' as const, words: 0 }
export const STRICT = { level: 'strict' as const, words: 0 }
export const IDLE = { turnId: null, startedAt: null, toolCalls: 0, toolFailures: 0, runningCalls: [], promptAt: null }

// The full band's idle session with one reading, and an account unless a test says none
export function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full', live: IDLE, usage: USAGE,
    session: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: NOW - 73 * 60_000, lastReplyAt: NOW - 120_000, turnCount: 1,
      waitingPrompts: [], mainToolCalls: 19, place: PLACE,
    },
    turns: [{
      turnNumber: 1, turnId: 't1', promptAt: NOW - 73 * 60_000, replyAt: NOW - 120_000, durationMs: 3000, tokensIn: 0, tokensOut: 0, toolCalls: 19, toolFailures: 0,
      contextPercent: null, endReason: 'answer',
    }],
    newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, isPlanInvalid: false, score: null, account: { org: 'Personal' },
    ...o,
  }
}
// Before any reading: no turn, no context percent and no model, so the band has no body
export const NO_READING: Partial<BandInput> = { turns: [], usage: { ...USAGE, contextPercent: null, rateWindows: [] }, session: { ...input().session, model: null } }

export const text = (line: readonly object[]): string => line.map(seg => ('text' in seg && typeof seg.text === 'string' ? seg.text : '')).join('')
export const texts = (lines: Line[]): string[] => lines.map(text)
