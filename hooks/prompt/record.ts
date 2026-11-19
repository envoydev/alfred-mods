// The turn record: pure values in, values out
import type { PromptOrigin, PromptPart, PromptRecord } from './types'
import { MAX_PARTS, MAX_PART_CHARS } from './constants'

export function startRecord(typedChars: number, at: number): PromptRecord {
  return { startedAt: at, typedChars, parts: [], dropped: 0 }
}

// Any kind but a hook's or a plugin's is the engine's own
function originOf(kind: string): PromptOrigin {
  return kind === 'hook' || kind === 'plugin' ? kind : 'engine'
}

// A `null` text is an attachment a plugin left out: it has no length and no text
export function partOf(type: string, origin: { kind: string; event?: string }, text: string | null, at: number): PromptPart {
  const kept = text ?? ''
  return {
    type, origin: originOf(origin.kind), event: origin.event ?? null, chars: kept.length, text: kept.slice(0, MAX_PART_CHARS),
    isLeftOut: text === null, at,
  }
}

// A part equal to one held in `type`, `chars` and `text` is not added again; past the cap the oldest go and are counted
export function addPart(record: PromptRecord, part: PromptPart): PromptRecord {
  const isHeld = record.parts.some(held => held.type === part.type && held.chars === part.chars && held.text === part.text)
  if (isHeld) return record
  const parts = [...record.parts, part]
  const over = Math.max(0, parts.length - MAX_PARTS)
  return { ...record, parts: parts.slice(over), dropped: record.dropped + over }
}
