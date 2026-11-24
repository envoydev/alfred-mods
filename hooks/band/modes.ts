// The band's modes line (the user, 2026-11-24): 'auto-run · auto-compact 400k · scoring 90 3', from what the session uses
// now - Alfred Code's status file and claude-kit's settings file. Pure: values in, lines out.
import { tokensText, widthOf } from '../core/format'
import type { Line, Seg } from '../core/types'
import { isKitOn, kitPassScore } from '../kit/kit'
import { KIT_NAMES, KIT_SCORING_ROUNDS } from '../kit/constants'
import type { KitState } from '../kit/types'
import type { Stack } from '../stack/types'
import { MODE_WORDS, MODES_JOIN } from './constants'

// Each mode on, in its order. auto-run shows while either source runs it; auto-compact is Alfred Code's alone, with
// Claude Code's compaction point where the status file names it; scoring takes Alfred Code's level and rounds while
// its scoring is on, else claude-kit's pass score and the rounds its loop runs.
function modeItems(stack: Stack | null, kit: KitState | null): Seg[] {
  const used = stack !== null && stack.state === 'used' ? stack : null
  const values = kit?.values ?? null
  const items: Seg[] = []
  if (used?.autoRun === true || (values !== null && isKitOn(values, KIT_NAMES.autoRun))) items.push({ text: MODE_WORDS.autoRun, tone: 'warn' })
  if (used?.autoCompact?.on === true) {
    const at = used.autoCompact.at
    items.push({ text: at === null ? MODE_WORDS.autoCompact : `${MODE_WORDS.autoCompact} ${tokensText(at)}` })
  }
  if (used?.scorer?.on === true) items.push({ text: `${MODE_WORDS.scoring} ${used.scorer.level} ${used.scorer.rounds}` })
  else if (values !== null && isKitOn(values, KIT_NAMES.scoring)) {
    const pass = kitPassScore(values)
    items.push({ text: pass === null ? MODE_WORDS.scoring : `${MODE_WORDS.scoring} ${pass} ${KIT_SCORING_ROUNDS}` })
  }
  return items
}

// The modes on, joined, within the band's width: the last mode goes first where the line would pass it. Empty with
// none on.
export function modesLine(stack: Stack | null, kit: KitState | null, columns: number): Line {
  const items = modeItems(stack, kit)
  const join = (count: number): Line => items.slice(0, count).flatMap((item, i) => (i === 0 ? [item] : [{ text: MODES_JOIN, tone: 'dim' as const }, item]))
  for (let count = items.length; count > 0; count--) {
    const line = join(count)
    if (widthOf(line) <= columns) return line
  }
  return []
}
