// The prompt cache (F4): its tier by Claude Code's own rule, its warmth, reuse and rewrite cost, the line the band and
// the Cache tab draw, the warning's window and whether Claude Code compacts an idle conversation itself.
// The rule: https://code.claude.com/docs/en/prompt-caching.md; idle compaction: settings-reference, `idleCompaction`.
import type { ModelUsage } from 'claude-code'

import type { Line, Tone } from './band.ts'
import { bar, toneOf, tokens, usd } from './format.ts'
import type { Billing, Cache, CacheConfig, CacheTier, Window } from '../types'

export const TTL_MS: Record<CacheTier, number> = { '5m': 300_000, '1h': 3_600_000 }
// The warning's window: a 1h cache's last 5 minutes, a 5m cache's last minute
export const CLOSE_MS: Record<CacheTier, number> = { '5m': 60_000, '1h': 300_000 }
// Claude Code compacts an idle 1h conversation after about 54 minutes
export const IDLE_COMPACT_MS = 3_240_000
// Where it should, the warning waits for a 1h cache's last 3 minutes: its compaction makes the cache cold first
export const SELF_CLOSE_MS = 180_000

// Within the plan's usage while a 5h or 7d window reads under 100; on usage credits once one reads 100 or more
export function billingOf(windows: Window[]): Billing {
  const plan = windows.filter(w => w.kind === 'five_hour' || w.kind === 'seven_day')
  if (plan.length === 0) return 'other'
  return plan.some(w => w.percentUsed >= 100) ? 'credits' : 'plan'
}

// The first pin in Claude Code's order: FORCE_PROMPT_CACHING_5M, the variable, the setting, ENABLE_PROMPT_CACHING_1H
export function pinOf(v: { force5m?: string; ttl?: string; setting?: unknown; enable1h?: string }): CacheConfig['pin'] {
  const tier = (x: unknown): CacheTier | null => (x === '5m' || x === '1h' ? x : null)
  if (v.force5m === '1') return { tier: '5m', from: 'FORCE_PROMPT_CACHING_5M' }
  const ttl = tier(v.ttl)
  if (ttl !== null) return { tier: ttl, from: 'CLAUDE_CODE_PROMPT_CACHE_TTL' }
  const setting = tier(v.setting)
  if (setting !== null) return { tier: setting, from: 'promptCacheTtl' }
  if (v.enable1h === '1') return { tier: '1h', from: 'ENABLE_PROMPT_CACHING_1H' }
  return null
}

// Idle compaction is off with either setting false or DISABLE_AUTO_COMPACT set; its threshold is raised to 100,000
export function idleOf(v: { idleCompaction?: unknown; autoCompactEnabled?: unknown; disableAutoCompact?: string; minTokens?: string }): Pick<CacheConfig, 'idleOff' | 'idleMinTokens'> {
  const idleOff = v.idleCompaction === false || v.autoCompactEnabled === false || (v.disableAutoCompact ?? '') !== ''
  const n = /^\d+$/.test(v.minTokens ?? '') ? Number(v.minTokens) : 0
  return { idleOff, idleMinTokens: n > 0 ? Math.max(100_000, n) : 200_000 }
}

export type TierOf = { tier: CacheTier; from: 'pin' | 'switch' | 'default'; isEstimate: boolean }

// A pin, else the last switch's report while the billing it was made under holds, else the default as an estimate
export function tierOf(c: Cache, billing: Billing): TierOf {
  if (c.config.pin !== null) return { tier: c.config.pin.tier, from: 'pin', isEstimate: false }
  if (c.tier !== null && c.tierBilling === billing) return { tier: c.tier, from: 'switch', isEstimate: false }
  return { tier: billing === 'plan' ? '1h' : '5m', from: 'default', isEstimate: true }
}

// A main-loop request: the cache's time runs from its start, if it read or wrote the cache at all (caching can be off)
export function addRequest(c: Cache, u: Pick<ModelUsage, 'input_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'>, at: number): Cache {
  const last = { read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, input: u.input_tokens }
  if (last.read === 0 && last.write === 0 && last.input === 0) return c
  const s = c.session
  const lastAt = last.read + last.write > 0 ? at : c.lastAt
  return { ...c, lastAt, last, session: { read: s.read + last.read, write: s.write + last.write, input: s.input + last.input } }
}

const rateOf = (usdCost: number, contextTokens: number): number | null => (contextTokens > 0 ? usdCost / contextTokens : null)

// A model switch's report: its tier under the billing now, and the rate its own estimate gives. Only a switch that
// happened (PostModelSwitch) forfeits the cache; one Claude Code may still ask to confirm leaves it warm.
export function takeSwitch(c: Cache, s: { ttl: CacheTier; contextTokens: number; usd: number; model: string; billing: Billing }, at: number, hasSwitched: boolean): Cache {
  const out: Cache = {
    ...c, tier: s.ttl, tierAt: at, tierBilling: s.billing, rateModel: s.model, ratePerToken: rateOf(s.usd, s.contextTokens),
  }
  return hasSwitched ? { ...out, lastAt: null } : out
}

// A resume's or fork's estimate gives the rate alone
export function takeRate(c: Cache, usdCost: number, contextTokens: number, model: string | null): Cache {
  return { ...c, ratePerToken: rateOf(usdCost, contextTokens), rateModel: model }
}

// The cached prefix is gone: the next request writes only the summary
export function afterCompact(c: Cache): Cache {
  return { ...c, lastAt: null, last: null }
}

export type CacheView = {
  tier: TierOf; state: 'warm' | 'cold'; leftMs: number | null; reuseLast: number | null; reuseSession: number | null
  cached: number; rewriteUsd: number | null; isClosing: boolean
}

const reuseOf = (n: { read: number; write: number; input: number } | null): number | null => {
  const all = n === null ? 0 : n.read + n.write + n.input
  return n === null || all === 0 ? null : (n.read / all) * 100
}

// With the context's tokens, the warning's window allows for Claude Code's own idle compaction
export function cacheView(c: Cache, billing: Billing, now: number, contextTokens: number | null = null): CacheView {
  const tier = tierOf(c, billing)
  const endsAt = c.lastAt === null ? null : c.lastAt + TTL_MS[tier.tier]
  const leftMs = endsAt === null || now >= endsAt ? null : endsAt - now
  const cached = c.last === null ? 0 : c.last.read + c.last.write
  return {
    tier, state: leftMs === null ? 'cold' : 'warm', leftMs, reuseLast: reuseOf(c.last), reuseSession: reuseOf(c.session), cached,
    rewriteUsd: c.ratePerToken !== null && cached > 0 ? cached * c.ratePerToken : null,
    isClosing: leftMs !== null && leftMs <= closeMs(c, billing, contextTokens),
  }
}

// Claude Code should compact the conversation itself at about 54 minutes idle: the terminal's REPL, the 1h tier, idle
// compaction not turned off, and a context at its threshold. A feature flag it fetches gates it too, which the mod
// cannot see, so this delays the warning and never withholds it.
export function selfCompacts(c: Cache, billing: Billing, contextTokens: number | null): boolean {
  return c.config.isTerminal && tierOf(c, billing).tier === '1h' && !c.config.idleOff && contextTokens !== null
    && contextTokens >= c.config.idleMinTokens
}

// How long before cold the warning comes: a 1h cache's last 5 minutes, or 3 where Claude Code should compact it first;
// a 5m cache's last minute
export function closeMs(c: Cache, billing: Billing, contextTokens: number | null): number {
  const tier = tierOf(c, billing).tier
  return tier === '1h' && selfCompacts(c, billing, contextTokens) ? SELF_CLOSE_MS : CLOSE_MS[tier]
}

// When a 1h cache's toast is due; a 5m cache gets none
export function toastAt(c: Cache, billing: Billing, contextTokens: number | null): number | null {
  return c.lastAt !== null && tierOf(c, billing).tier === '1h' ? c.lastAt + TTL_MS['1h'] - closeMs(c, billing, contextTokens) : null
}

// The clocks on screen redraw once a minute while warm, every second in the warning's window, and once as it goes cold
export function needsTick(c: Cache, billing: Billing, now: number): boolean {
  if (c.lastAt === null) return false
  const endsAt = c.lastAt + TTL_MS[tierOf(c, billing).tier]
  if (now >= endsAt) return now < endsAt + 1000
  return (now - c.lastAt) % 60_000 < 1000 || endsAt - now <= CLOSE_MS[tierOf(c, billing).tier]
}

export function minutes(ms: number): string {
  return `${Math.ceil(ms / 60_000)}m`
}

// The reuse bar is a ratio: it takes the miss rate's threshold colour, so 94% reused reads green
export function reuseTone(percent: number): Tone {
  return toneOf(100 - percent)
}

// 'warm 52m ▰▰▰▰▱ 94% reused · 180k cached · rewrite ≈ $1.44', each part only when known
export function cacheLine(v: CacheView): Line {
  const line: Line = v.state === 'warm'
    ? [{ text: `warm ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs ?? 0)}`, tone: 'ok' }]
    : [{ text: 'cold', tone: 'warn' }]
  if (v.reuseLast !== null) {
    const [filled, empty] = bar(v.reuseLast)
    const tone = reuseTone(v.reuseLast)
    line.push({ text: ' ' }, { text: filled, tone }, { text: empty, tone: 'dim' }, { text: ` ${Math.round(v.reuseLast)}% reused`, tone })
  }
  if (v.cached > 0) line.push({ text: ` · ${tokens(v.cached)} cached` })
  if (v.rewriteUsd !== null) line.push({ text: ` · rewrite ≈ ${usd(v.rewriteUsd)}` })
  return line
}
