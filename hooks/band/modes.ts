// The band's modes lines (the user, 2026-11-25): 'alfred-code: auto-run · auto-compact 400k · scoring 90 3' from Alfred
// Code's status file and 'claude-kit: auto-run · scoring 90 3' from claude-kit's settings file, each with its own values.
// Pure: values in, lines out.
import { tokensText, widthOf } from '../core/format'
import type { Line, Seg } from '../core/types'
import { isKitOn, kitPassScore } from '../kit/kit'
import { KIT_AUTO_RUN_ROUNDS, KIT_MODEL_ROLES, KIT_NAMES, KIT_SCORING_ROUNDS } from '../kit/constants'
import type { KitState } from '../kit/types'
import type { Stack } from '../stack/types'
import { MODE_WORDS, MODELS_JOIN, MODES_JOIN } from './constants'

// Alfred Code's modes on, in their order, from its status file alone: auto-run, auto-compact with Claude Code's
// compaction point where the file names it, and scoring with its level and the rounds `alfred-code:mode:scoring` set
function alfredItems(stack: Stack | null): Seg[] {
  const used = stack !== null && stack.state === 'used' ? stack : null
  if (used === null) return []
  const items: Seg[] = []
  if (used.autoRun === true) items.push({ text: MODE_WORDS.autoRun, tone: 'warn' })
  if (used.autoCompact?.on === true) {
    const at = used.autoCompact.at
    items.push({ text: at === null ? MODE_WORDS.autoCompact : `${MODE_WORDS.autoCompact} ${tokensText(at)}` })
  }
  if (used.scorer?.on === true) items.push({ text: `${MODE_WORDS.scoring} ${used.scorer.level} ${used.scorer.rounds}` })
  return items
}

// claude-kit's modes on, from its settings file alone: auto-run, and scoring with its pass score and the rounds its
// grading loop runs, which the file does not carry: more under its auto-run
function kitItems(kit: KitState | null): Seg[] {
  const values = kit?.values ?? null
  if (values === null) return []
  const items: Seg[] = []
  const isAutoRun = isKitOn(values, KIT_NAMES.autoRun)
  if (isAutoRun) items.push({ text: MODE_WORDS.autoRun, tone: 'warn' })
  if (isKitOn(values, KIT_NAMES.scoring)) {
    const pass = kitPassScore(values)
    const rounds = isAutoRun ? KIT_AUTO_RUN_ROUNDS : KIT_SCORING_ROUNDS
    items.push({ text: pass === null ? MODE_WORDS.scoring : `${MODE_WORDS.scoring} ${pass} ${rounds}` })
  }
  return items
}

// The items joined, within the width: the last goes first where the line would pass it. Empty with none.
function fittingLine(items: Seg[], separator: string, columns: number): Line {
  const join = (count: number): Line => items.slice(0, count).flatMap((item, i) => (i === 0 ? [item] : [{ text: separator, tone: 'dim' as const }, item]))
  for (let count = items.length; count > 0; count--) {
    const line = join(count)
    if (widthOf(line) <= columns) return line
  }
  return []
}

// Alfred Code's modes on, within the band's width
export function alfredModesLine(stack: Stack | null, columns: number): Line {
  return fittingLine(alfredItems(stack), MODES_JOIN, columns)
}

// claude-kit's modes on, within the band's width
export function kitModesLine(kit: KitState | null, columns: number): Line {
  return fittingLine(kitItems(kit), MODES_JOIN, columns)
}

// The model claude-kit's settings file names for each role, within the band's width
export function modelsLine(kit: KitState | null, columns: number): Line {
  const values = kit?.values ?? null
  const items = values === null ? [] : KIT_MODEL_ROLES.flatMap(([role, name]): Seg[] => {
    const model = values[name]
    return model === undefined ? [] : [{ text: `${role} ${model}`, tone: 'dim' }]
  })
  return fittingLine(items, MODELS_JOIN, columns)
}
