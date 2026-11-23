import type { TranscriptReader } from '../../types'
export type { TranscriptReader }

export type ScanResult = {
  consumedBytes: number
  hasNewline: boolean
  paths: string[]
  isSkipNoticed: boolean
}

// Why the transcript is not counted: a read the engine refused, or no file where Claude Code writes it
export type TranscriptNote = 'unread' | 'not-found'
export type TranscriptState = { isKnown: boolean; note: TranscriptNote | null }
