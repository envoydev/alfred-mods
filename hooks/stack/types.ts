// Alfred Code's status file, as the mod reads it
import type { FullContext, Stack, StackAutoCompact, StackScorer } from '../../types'
export type { FullContext, Stack, StackAutoCompact, StackScorer }

export type StackFields = Omit<Stack, 'state' | 'reason' | 'hasPrompt' | 'readAt'>

export type StackRead = { state: 'ignored'; reason: string } | { state: 'used'; fields: StackFields; prompt: string | null }

// The context against the stack's resume trigger (spec 'The runway'): `percent` rounded down, past 100 past the
// trigger; `at`, the trigger over the session's window, which the forecast counts turns to, or null when unknown
export type Runway = { percent: number; resumeAt: number; at: number | null }
