// The /inspect command's words: its help, the tab names, and the numbering of failures and reports
import type { Tab } from './types'
import { oneLine, printable } from '../core/format'

// The commands for what a click or a key does in the pane (the user, 2026-11-12: in iTerm's main screen, with tabs,
// neither reaches the mod). Each answers with what it did, masked while REC is on.
export const INSPECT_HELP = 'Usage: /inspect [now|usage|agents|tools|cache|timeline|plan [name]|prompt] opens a tab, /inspect close closes the pane. ' +
  '/inspect show [n] and copy [n] act on tool failure n (1 the newest), report [n] on agent report n (1 the top), ' +
  "fill fills Alfred Code's resume prompt, skip leave|never answers the ask about hooks a managed plugin skips, band off|calm|full sets \"band\" in ~/.claude/settings.json."

export const BAND_HELP = '/inspect band off, calm or full sets "band" in ~/.claude/settings.json.'

// Keyed by the reasons `$.ui.copy` gives; 'unanswered' (a remote app silent for 5 s) arrived in Claude Code 2.1.329
export const COPY_WHY: ReadonlyMap<string, string> = new Map([
  ['no-surface', 'no screen to copy on'],
  ['no-clipboard', 'this terminal has no clipboard path'],
  ['refused', 'the terminal refused it'],
  ['unanswered', 'the app did not answer in time'],
])
export const COPY_WHY_UNKNOWN = 'no reason given'

// Why a copy failed, in words; a reason a later build adds reads as no reason, never undefined
export const copyWhy = (reason: string): string => COPY_WHY.get(reason) ?? COPY_WHY_UNKNOWN

// '2' as 2; left out, 1; anything else, 0, which no item has
export const ordinalOf = (word: string | undefined): number => (word === undefined ? 1 : /^\d+$/.test(word) ? Number(word) : 0)

export const outOfRange = (what: string, word: string | undefined, count: number, first: string): string =>
  `No ${what} ${oneLine(printable(word ?? ''), 20)}: there ${count === 1 ? 'is 1' : `are ${count}`}, 1 the ${first}.`

export const TAB_NAMES: Tab[] = ['now', 'usage', 'agents', 'tools', 'cache', 'timeline', 'plan', 'prompt']
