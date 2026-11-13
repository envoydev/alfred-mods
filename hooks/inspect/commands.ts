// The /inspect command's words: its help, the tab names, and the numbering of failures and reports
import type { Tab } from './types'
import { oneLine, printable } from '../core/format'

// The commands for what a click or a key does in the pane (the user, 2026-11-12: in iTerm's main screen, with tabs,
// neither reaches the mod). Each answers with what it did, masked while REC is on.
export const INSPECT_HELP = 'Usage: /inspect [now|usage|agents|tools|cache|timeline|plan [name]] opens a tab, /inspect close closes the pane. ' +
  '/inspect show [n] and copy [n] act on tool failure n (1 the newest), report [n] on agent report n (1 the top), ' +
  "fill fills Alfred Code's resume prompt, band off|calm|full sets \"band\" in ~/.claude/settings.json."

export const BAND_HELP = '/inspect band off, calm or full sets "band" in ~/.claude/settings.json.'

export const COPY_WHY = { 'no-surface': 'no screen to copy on', 'no-clipboard': 'this terminal has no clipboard path', refused: 'the terminal refused it' } as const

// '2' as 2; left out, 1; anything else, 0, which no item has
export const ordinal = (word: string | undefined): number => (word === undefined ? 1 : /^\d+$/.test(word) ? Number(word) : 0)

export const outOf = (what: string, word: string | undefined, count: number, first: string): string =>
  `No ${what} ${oneLine(printable(word ?? ''), 20)}: there ${count === 1 ? 'is 1' : `are ${count}`}, 1 the ${first}.`

export const TABS: Tab[] = ['now', 'usage', 'agents', 'tools', 'cache', 'timeline', 'plan']
