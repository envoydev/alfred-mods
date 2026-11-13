// The types every folder shares: the band's drawn segments, a hook's held timers, and the hook helper types
import type { EventName, Hook, MatchedHook, Timer } from 'claude-code'
import type { AgentStatus } from '../agents/types'

// A hook's input, its next and its result, as a feature function takes them (the form probe P2 passed)
export type HookInput<E extends EventName> = Parameters<Hook<E>>[1]
export type HookNext<E extends EventName> = Parameters<Hook<E>>[2]
export type HookResult<E extends EventName> = ReturnType<Hook<E>>
// The same under a matcher, narrowed by it as on(event, matcher, hook) narrows them
export type MatchedInput<E extends EventName, M> = Parameters<MatchedHook<E, M>>[1]
export type MatchedNext<E extends EventName, M> = Parameters<MatchedHook<E, M>>[2]

export type Tone = 'ok' | 'warn' | 'fail' | 'dim' | 'usage' | 'skill' | 'agents' | 'cache' | 'plan' | 'handoff' | 'opus' | 'sonnet' | 'haiku' | 'fable' | 'git' | 'branch' | 'counts'

export type Seg =
  // With a `width`, a table cell: that many cells wide, its text cut with '…' when longer, at its end with `align: 'end'`
  | { text: string; tone?: Tone; bold?: boolean; width?: number; align?: 'start' | 'end' }
  // A toned button draws its label bold in the colour of the feature it acts on; a plain one draws `<hotkey>: <label>`;
  // `isText`, where nothing presses it, its label as dim text that keeps a button's place at the line's end
  | { button: { key: string; label: string; hotkey?: string; tone?: Tone; plain?: boolean; isText?: boolean } }
  | { code: string }
  | { chart: number[] }
  // Agents on one time axis (spec C2), alone on its line: text lanes on the terminal and mobile, one Svg elsewhere
  | { lanes: Lane[]; now: number }

export type Line = Seg[]

// One agent on the axis: its label (`task <id>` or its type), when it started, when it ended (null while it runs), its
// status and its time as the tree shows it
export type Lane = { label: string; startAt: number; endAt: number | null; status: AgentStatus; time: string }

export type FailKind = 'throw' | 'timeout'

export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable'

// What outlives one hook but is no $.state value: the cache's toast timer, a [Compact] in flight, the compactions the
// mod's own hook counted, whether the session started in the terminal's REPL, which only session.start says and
// /clear does not repeat, the plan folders' next read and the read running, one at a time, and the step-time writes,
// in order
export type Held = {
  close: Timer | null; compacting: boolean; counted: number; isTerminal: boolean; reload: Timer | null; reading: Promise<void>
  writes: Promise<void>
}
