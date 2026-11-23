// The band's named values
import type { Seg } from '../core/types'
import { KIT_BANNER_LABEL } from '../kit/constants'

// The labels' width, so the items of every row line up
export const ROW_LABEL = 9

// The band's org mark: its label, the bar before the kind, the cap of a company name in cells and what shows for no known
// account
export const ORG_LABEL = 'org'

export const ORG_JOIN = ' | '

export const ORG_MAX_CELLS = 40

export const ORG_UNKNOWN = 'unknown'

// The joiner between the band's items on a row, drawn dim
export const ROW_JOIN = ' │ '

// A rate window's short name in the band and its toasts
export const WINDOW_LABEL: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d' }

// claude-kit's banner as the narrow band shortens it
export const KIT_SHORT: Seg[] = [{ text: KIT_BANNER_LABEL, tone: 'dim' }]

// What ends the rules row's counts where the transcript reader cannot count by path
export const TRANSCRIPT_NOTE = { unread: 'transcript unread', 'not-found': 'transcript not found' } as const
