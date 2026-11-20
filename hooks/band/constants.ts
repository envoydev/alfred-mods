// The band's named values
import type { Seg } from '../core/types'
import { KIT_BANNER_LABEL } from '../kit/constants'

// The labels' width, so the items of every row line up
export const ROW_LABEL = 9

// The project row's org segment: its label, the cap of the name in cells and what shows for no known org
export const ORG_LABEL = 'org '

export const ORG_MAX_CELLS = 40

export const ORG_UNKNOWN = 'unknown'

// A project or branch name is cut down to this many cells before the project row gives up the other name's width
export const NAME_FLOOR_CELLS = 8

// The joiner between the band's items on a row, drawn dim
export const ROW_JOIN = ' │ '

// A rate window's short name in the band and its toasts
export const WINDOW_LABEL: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d' }

// claude-kit's banner as the narrow band shortens it
export const KIT_SHORT: Seg[] = [{ text: KIT_BANNER_LABEL, tone: 'dim' }]
