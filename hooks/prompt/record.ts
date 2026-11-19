// The turn record: pure values in, values out
import type { PromptOrigin, PromptPart, PromptRecord } from './types'
import { MAX_PARTS, MAX_PART_CHARS, WHITESPACE } from './constants'

export function startRecord(typedChars: number, at: number): PromptRecord {
  return { startedAt: at, typedChars, parts: [], dropped: 0 }
}

// Any kind but a hook's or a plugin's is the engine's own
function originOf(kind: string): PromptOrigin {
  return kind === 'hook' || kind === 'plugin' ? kind : 'engine'
}

// The cut backs up to a whitespace, so a secret or a private word never ends mid-token: REC masks a part at draw time, and
// half a key has lost the pattern that finds it. Only a text with no whitespace in its first MAX_PART_CHARS has the plain cut
function cutText(text: string): string {
  if (text.length <= MAX_PART_CHARS) return text
  const head = text.slice(0, MAX_PART_CHARS)
  if (WHITESPACE.test(text.charAt(MAX_PART_CHARS))) return head
  for (let at = head.length - 1; at >= 0; at--) {
    if (WHITESPACE.test(head.charAt(at))) return head.slice(0, at)
  }
  return head
}

// A `null` text is an attachment a plugin left out: it has no length and no text
export function partOf(type: string, origin: { kind: string; event?: string }, text: string | null, at: number): PromptPart {
  const kept = text ?? ''
  return {
    type, origin: originOf(origin.kind), event: origin.event ?? null, chars: kept.length, text: cutText(kept),
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
