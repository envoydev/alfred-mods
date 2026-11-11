// The band's detail rows (spec: docs/superpowers/specs/2026-11-11-band-detail-rows-design.md): `tools:`, `skills:`,
// `agents:` and `rules:` under the info line, open by default, items joined by ' │ '; the toggle counts all four
import { expect, test } from 'claude-code/testing'

import { toolRows } from '../hooks/band.ts'
import type { BandInput, Line } from '../hooks/band.ts'

import type { Cache, ToolStat, Turn } from '../types'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const P = NOW - 73 * 60_000
const R = NOW - 2 * 60_000

const stat = (calls: number): ToolStat => ({ calls, ok: calls, failed: 0, stopped: 0 })
const turn = (n: number, contextPercent: number | null = null): Turn => ({
  n, turnId: `t${n}`, promptAt: P, replyAt: R, durationMs: 3000, tokensIn: 0, tokensOut: 0, tools: 19, failures: 0, contextPercent, end: 'answer',
})
const CACHE: Cache = {
  tier: '1h', tierAt: null, tierBilling: 'plan', config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: NOW - 6 * 60_000, last: { read: 1000, write: 0, input: 10 },
  session: { read: 1000, write: 0, input: 10 }, toastedFor: null,
}
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-28T17:00:00Z' },
  { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-31T09:00:00Z' },
]

// The full band's mockup session, idle and healthy, at 200 columns (as tests/fullband.test.ts draws it)
function input(o: Partial<BandInput> = {}): BandInput {
  return {
    now: NOW, columns: 200, isWorking: false, mode: 'full',
    live: { turnId: null, startedAt: null, tools: 0, failures: 0, running: [], promptAt: null },
    usage: { tokens: 60_000, window: 200_000, percent: 30, startedAt: NOW - 59 * 60_000, windows: WINDOWS, costUsd: 1.29, todayUsd: 10.46, at: NOW },
    meta: {
      model: 'claude-sonnet-5-5', effort: 'medium', compactions: 0, lastCompactAt: null, lastPromptAt: P, lastReplyAt: R, turnCount: 1,
      waiting: [], mainCalls: 19,
    },
    turns: [turn(1)], newFailures: 0, pace: {}, agents: [], cache: CACHE, plan: null, planInvalid: false, score: null,
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stepOutput: 13_300, stepMs: 100_000 },
    stats: { AskUserQuestion: stat(13), Bash: stat(5), Grep: stat(1) },
    ...o,
  }
}

const text = (line: Line): string => line.map(s => ('text' in s ? s.text : 'button' in s ? `[ ${s.button.label} ]` : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

// The owner's target block, rows 4-7 (docs/superpowers/2026-11-11-band-detail-rows-prompt.md)
const TARGET_STATS = { Bash: stat(32), AskUserQuestion: stat(4), Read: stat(4), Write: stat(4), Grep: stat(1) }

test('the open rows read tools: and skills: with │ between items', () => {
  const b = input({
    isToolsOpen: true, stats: TARGET_STATS, listing: { listed: 57, total: 60, tokens: 3200 },
    meta: { ...input().meta, skills: { 'superpowers:brainstorming': 1, 'solve-task': 2 } },
  })
  expect(texts(toolRows(b)).slice(0, 2)).toEqual([
    'tools:   Bash ×32 │ AskUserQuestion ×4 │ Read ×4 │ Write ×4 │ Grep ×1',
    'skills:  superpowers:brainstorming ×1 │ solve-task ×2 │ 57 of 60 listed',
  ])
})

test('a row that wraps starts under its first item, at 48 columns', () => {
  const b = input({ isToolsOpen: true, columns: 48, stats: { AskUserQuestion: stat(13), Bash: stat(5), Read: stat(4), Write: stat(4), Grep: stat(1) } })
  expect(texts(toolRows(b)).slice(0, 2)).toEqual(['tools:   AskUserQuestion ×13 │ Bash ×5 │ Read ×4', '         Write ×4 │ Grep ×1'])
})
