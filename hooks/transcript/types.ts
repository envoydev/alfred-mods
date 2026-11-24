import type { TranscriptReader } from '../../types'
import type { RULE_TYPE } from './constants'
export type { TranscriptReader }

export type ScanResult = {
  consumedBytes: number
  hasNewline: boolean
  paths: string[]
  isSkipNoticed: boolean
}

// Why the transcript is not counted: a read the engine refused, or no file where Claude Code writes it
export type TranscriptNote = 'unread' | 'not-found'
export type TranscriptState = { isKnown: boolean; note: TranscriptNote | null; isCountedInFull: boolean }
export type RuleType = (typeof RULE_TYPE)[keyof typeof RULE_TYPE]
