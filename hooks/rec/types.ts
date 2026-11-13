// Recording mode's types: levels, hits and samples
import type { Level, RecState } from '../../types'
export type { Level, RecState }

// One class of text REC hides: what it matches and the hit it makes
export type Klass = { re: RegExp; hit: (m: RegExpExecArray) => Hit | null }

// A match and the text it draws as: a token, or digits as dots
export type Hit = { start: number; end: number; text: string }

export type Compiled = { level: Level; classes: Klass[] }

// The fake samples REC's `/rec test` runs and the tests pin, one set per class (spec Acceptance). Every provider-shaped
// one is assembled from parts at runtime, so no file of this public repo holds a literal a secret scanner would flag.
export type Sample = { text: string; masked: string }

export type ResultMask = { kind: 'same' } | { kind: 'output'; output: unknown } | { kind: 'tree'; text: string }
