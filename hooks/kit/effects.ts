// The kit folder's $.state atom, made, read and updated here alone: `claude plugin validate` refuses an atom handed to
// another module. Change the shape tag when the stored fields change: it declines what an earlier version stored.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { KitState } from './types'
import { KIT_SEEN_REFRESH_MS } from './constants'
import { kitPassScore, parseKitStatus } from './kit'

const INITIAL_KIT: KitState = { status: null, seenAt: null }
const kitAtom = atom({ plugin: 'alfred-mods', key: 'kit' } as const, INITIAL_KIT, { shape: 'kit-1' })

// `last`, the value this module wrote: Claude Code resets $.state itself on a /clear, a resume or a branch
// (`hooks/lifecycle/effects.ts`, the comment above `startOver`), and `restoreKit` writes it back
const kitMemory = { last: null as KitState | null }

export function readKit($: EngineInterface): Promise<KitState> {
  return read($, kitAtom)
}

// A turn's kit line into the atom. A text with no kit line changes nothing. The same line noted again within
// `KIT_SEEN_REFRESH_MS` writes nothing, so a re-asked attachment draws no extra frame.
export async function noteKitLine($: EngineInterface, text: string, now: number): Promise<void> {
  const status = parseKitStatus(text)
  if (status === null) return
  const held = kitMemory.last
  const isSame = held !== null && JSON.stringify(held.status) === JSON.stringify(status)
  const isFresh = held?.seenAt != null && now - held.seenAt < KIT_SEEN_REFRESH_MS
  if (isSame && isFresh) return
  const next: KitState = { status, seenAt: now }
  kitMemory.last = next
  await update($, kitAtom, () => next)
}

// The pass score while the kit's scoring is on, which colours the band's score
export async function readKitScoreLevel($: EngineInterface): Promise<number | null> {
  const { status } = await readKit($)
  return status === null ? null : kitPassScore(status)
}

// Writes the value kept in memory back into the atom after Claude Code's own reset; with none kept, nothing
export async function restoreKit($: EngineInterface): Promise<void> {
  const last = kitMemory.last
  if (last === null) return
  await update($, kitAtom, stored => (JSON.stringify(stored) === JSON.stringify(last) ? stored : last))
}
