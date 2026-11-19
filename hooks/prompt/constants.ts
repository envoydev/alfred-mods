import type { PromptRecord } from './types'

// A record keeps the newest parts, each cut to a length: 60 parts of 4,000 characters are under 250 KB a session
export const MAX_PARTS = 60
export const MAX_PART_CHARS = 4000

// Attachments raised back to back, as a resume re-asks them, write the atom once a window
export const FLUSH_MS = 250

export const EMPTY_RECORD: PromptRecord = { startedAt: null, typedChars: null, parts: [], dropped: 0 }
