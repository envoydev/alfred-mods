// The cache folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage } from 'claude-code'
import type { Cache, CacheConfig } from './types'
import { addRequest, afterCompact, billingOf, cacheView, idleOf, minutes, pinOf, takeRate, takeSwitch, toastAt } from './cache'
import { noteCompaction, readLive, readUsage, setModel } from '../session/effects'
import type { Pending, HookInput, HookNext } from '../core/types'
import { toast } from '../core/effects'
import { retellRecNote } from '../rec/effects'
import { rearmAfterCompaction } from '../handoff/effects'
import { usd } from '../core/format'
import { readBreakdownSoon } from '../context/effects'

const INITIAL_CACHE: Cache = {
  tier: null, tierAt: null, tierBilling: null,
  config: { pin: null, idleOff: false, idleMinTokens: 200_000, isTerminal: false },
  ratePerToken: null, rateModel: null, lastAt: null, last: null, session: { read: 0, write: 0, input: 0 }, toastedFor: null,
}
const cacheAtom = atom({ plugin: 'alfred-mods', key: 'cache' } as const, INITIAL_CACHE, { shape: 'cache-1' })
export function readCache($: EngineInterface) {
  return read($, cacheAtom)
}
function updateCache($: EngineInterface, change: (value: Cache) => Cache) {
  return update($, cacheAtom, change)
}
export function resetCache($: EngineInterface) {
  return update($, cacheAtom, () => INITIAL_CACHE)
}

// The variables and settings that pin the cache's tier or turn idle compaction off, written only on a change
export async function readCacheConfig($: EngineInterface, pending: Pending): Promise<void> {
  const config: CacheConfig = {
    pin: pinOf({
      force5m: await $.env.get('FORCE_PROMPT_CACHING_5M'),
      ttl: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      setting: await $.settings.read({ key: 'promptCacheTtl' }),
      enable1h: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    }),
    ...idleOf({
      idleCompaction: await $.settings.read({ key: 'idleCompaction' }),
      autoCompactEnabled: await $.settings.read({ key: 'autoCompactEnabled' }),
      disableAutoCompact: await $.env.get('DISABLE_AUTO_COMPACT'),
      minTokens: await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'),
    }),
    isTerminal: pending.isTerminal,
  }
  if (JSON.stringify((await readCache($)).config) !== JSON.stringify(config)) await updateCache($, c => ({ ...c, config }))
}

// Sets the toast's timer afresh: due 5 minutes before a 1h cache goes cold, or 3 where Claude Code should compact it
// itself first
export async function armCacheClose($: EngineInterface, pending: Pending): Promise<void> {
  pending.cacheToast?.cancel()
  pending.cacheToast = null
  const c = await readCache($)
  const u = await readUsage($)
  const at = toastAt(c, billingOf(u.windows), u.tokens)
  if (at === null) return
  const now = await $.clock.now()
  pending.cacheToast = $.clock.after(Math.max(0, at - now), () => {
    cacheClose($).catch(() => undefined)
  })
}

// The toast, once per warm stretch, while the main loop is idle and the cache is still 1h and warm by then; a
// compaction of Claude Code's own has made it cold
export async function cacheClose($: EngineInterface): Promise<void> {
  const c = await readCache($)
  const u = await readUsage($)
  const v = cacheView(c, billingOf(u.windows), await $.clock.now(), u.tokens)
  if (v.tier.tier !== '1h' || !v.isClosing || c.toastedFor === c.lastAt) return
  if ((await readLive($)).turnId !== null) return
  const rewrite = v.rewriteUsd === null ? '' : ` (rewrite ≈ ${usd(v.rewriteUsd)})`
  toast($, `Cache cold in ${v.tier.isEstimate ? '≈' : ''}${minutes(v.leftMs ?? 0)}${rewrite}: press 3 to compact, or /inspect cache`)
  const lastAt = c.lastAt
  await updateCache($, x => ({ ...x, toastedFor: lastAt }))
}

// A main-loop compaction that stands: counted, and the cache cold, as its cached prefix is gone; a compaction can drop
// REC's note from the history, so the next prompt carries it again
export async function countCompaction($: EngineInterface, pending: Pending): Promise<void> {
  pending.compactionsCounted++
  retellRecNote()
  await rearmAfterCompaction($)
  const at = await $.clock.now()
  await noteCompaction($, at)
  await updateCache($, afterCompact)
  await armCacheClose($, pending)
}

// [Compact]: the call comes first, so the press counts as the person's. The compaction is counted once: by the mod's
// own session.compact hook when the call passes through it, else here, as a host may skip the calling plugin whole.
// A skip or a failure is said, and a second press while one runs starts none.
export async function compactNow($: EngineInterface, pending: Pending): Promise<void> {
  if (pending.isCompacting) {
    toast($, 'Compact is already running.')
    return
  }
  pending.isCompacting = true
  const seen = pending.compactionsCounted
  try {
    const done = await $.session.compact()
    if (done.skip !== undefined) toast($, `Compact skipped: ${done.skip}`)
    else if (pending.compactionsCounted === seen) await countCompaction($, pending)
  } catch (err) {
    toast($, `Compact did not run: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    pending.isCompacting = false
  }
}

export async function trackCompaction($: EngineInterface, e: HookInput<'session.compact'>, next: HookNext<'session.compact'>, pending: Pending) {
  const compacted = await next(e)
  if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) {
    await countCompaction($, pending)
    readBreakdownSoon($)
  }
  return compacted
}

export async function trackModelSwitch($: EngineInterface, e: HookInput<'classic.PostModelSwitch'>, next: HookNext<'classic.PostModelSwitch'>, pending: Pending) {
  const done = await next(e)
  // The band names the model before the first step does (the review, 2026-11-11)
  await setModel($, e.to_model)
  const billing = billingOf((await readUsage($)).windows)
  const now = await $.clock.now()
  const s = { ttl: e.cache_ttl, contextTokens: e.context_tokens, usd: e.estimated_cache_write_usd, model: e.to_model, billing }
  await updateCache($, c => takeSwitch(c, s, now, true))
  await armCacheClose($, pending)
  return done
}

export async function trackModelSwitchAsk($: EngineInterface, e: HookInput<'classic.PreModelSwitch'>, next: HookNext<'classic.PreModelSwitch'>, pending: Pending) {
  const done = await next(e)
  if (done.block !== undefined || done.permissionDecision === 'deny' || done.permissionDecision === 'ask') return done
  const billing = billingOf((await readUsage($)).windows)
  const now = await $.clock.now()
  const s = { ttl: e.cache_ttl, contextTokens: e.context_tokens, usd: e.estimated_cache_write_usd, model: e.to_model, billing }
  await updateCache($, c => takeSwitch(c, s, now, false))
  await armCacheClose($, pending)
  return done
}

// A main-loop request's cache figures, at the time its step started
export async function addCacheRequest($: EngineInterface, usage: Pick<ModelUsage, 'input_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'>, at: number): Promise<void> {
  await updateCache($, c => addRequest(c, usage, at))
}

// A resumed conversation's cache rate, from its SessionStart
export async function takeResumeRate($: EngineInterface, usd: number, tokens: number, model: string | null): Promise<void> {
  await updateCache($, c => takeRate(c, usd, tokens, model))
}
