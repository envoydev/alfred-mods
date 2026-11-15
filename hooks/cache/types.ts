// The prompt cache's types
import type { Billing, Cache, CacheConfig, CacheCounts, CacheTier } from '../../types'
export type { Billing, Cache, CacheConfig, CacheCounts, CacheTier }

export type TierOf = { tier: CacheTier; from: 'pin' | 'switch' | 'default'; isEstimate: boolean }

export type CacheView = {
  tier: TierOf; state: 'warm' | 'cold'; leftMs: number | null; reuseLast: number | null; reuseSession: number | null
  cached: number; rewriteUsd: number | null; isClosing: boolean
}
