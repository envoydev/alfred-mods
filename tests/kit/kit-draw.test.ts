import { expect, test } from 'claude-code/testing'

import { kitPassScore } from '../../hooks/kit/kit'
import { kitLines } from '../../hooks/kit/kitlines'
import { scoreSeg } from '../../hooks/plan/planlines'
import type { Line, Seg } from '../../hooks/core/types'
import type { KitState } from '../../hooks/kit/types'
import type { ScoresView } from '../../hooks/plan/types'
import { KIT_VALUES } from './settings'

const kitOf = (values: Record<string, string | number> = KIT_VALUES): KitState => ({ values })
const NO_KIT: KitState = { values: null }

const text = (line: readonly Seg[]): string => line.map(seg => ('text' in seg ? seg.text : 'button' in seg ? `[ ${seg.button.label} ]` : '')).join('')
const texts = (lines: Line[]): string[] => lines.map(text)

const view = (total: number): ScoresView => ({
  scale: 100, totals: [{ round: 1, total }], delta: null, shown: { round: 1, total }, isGrading: false, criteria: [], severities: [],
  fixed: [], improved: [], open: [], hasStatus: false,
})

test("the score takes the kit's pass level: ok at or over it, warn under it", () => {
  const level = kitPassScore(KIT_VALUES)
  expect(level).toBe(90)
  expect(scoreSeg(view(91), level)[0]).toMatchObject({ text: 'score 91', tone: 'ok' })
  expect(scoreSeg(view(85), level)[0]).toMatchObject({ text: 'score 85', tone: 'warn' })
})

test('the score takes whichever level it is given: ok at 80 and warn at 90 for a total of 85', () => {
  expect(scoreSeg(view(85), 80)[0]).toMatchObject({ tone: 'ok' })
  expect(scoreSeg(view(85), 90)[0]).toMatchObject({ tone: 'warn' })
})
