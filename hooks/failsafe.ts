// What a draw hook's .catch draws when the hook itself failed: texts only, so the handlers in register.ts stay
// one line each and read nothing that can fail again.

import { printable } from './format.js'

// A REC site whose hook failed: its row is not drawn at all, as REC could not mask it
export const REC_HIDDEN = '‹row hidden: REC could not mask it›'

// The spinner's word while REC is on and its hook failed: the engine's own word can name a file
export const SPINNER_WORD = 'Working'

export type FailKind = 'throw' | 'timeout'

export function bandFailed(kind: FailKind): string {
  return `alfred-mods: the band failed to draw (${kind})`
}

// The pane names its failure, with the error's message on one printable line of at most 120 characters; while REC
// is on the message is dropped, as it can quote what REC hides.
export function paneFailed(kind: FailKind, message: string | undefined, isRec: boolean): string {
  const head = `alfred-mods: the pane failed to draw (${kind})`
  const text = Array.from(printable(message ?? '').replace(/\s+/g, ' ').trim()).slice(0, 120).join('')
  return isRec || text === '' ? head : `${head}: ${text}`
}
