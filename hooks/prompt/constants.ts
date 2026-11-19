import type { PromptRecord } from './types'

// A record keeps the newest parts, each cut to a length: 60 parts of 4,000 characters are under 250 KB a session
export const MAX_PARTS = 60
export const MAX_PART_CHARS = 4000
export const WHITESPACE = /\s/u

// Attachments raised back to back, as a resume re-asks them, write the atom once a window
export const FLUSH_MS = 250

export const EMPTY_RECORD: PromptRecord = { startedAt: null, typedChars: null, parts: [], dropped: 0 }

// The Prompt tab's words
export const NO_TURN_TEXT = 'No turn yet in this session.'
export const BEFORE_FIRST_TURN = 'before the first turn'
export const NO_TYPED_TEXT = 'no typed text'
export const LEFT_OUT_TEXT = 'left out'

// A group of the tab by where its parts came from, in the order drawn
export const PROMPT_GROUPS = [
  { origin: 'hook', title: 'From hooks' },
  { origin: 'plugin', title: 'From plugins' },
  { origin: 'engine', title: 'From Claude Code' },
] as const
