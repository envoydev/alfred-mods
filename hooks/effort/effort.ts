// The effort the session's next request will carry, worked out from CLAUDE_CODE_EFFORT_LEVEL, the settings files and
// the model's default, for the time before a request tells it. `--effort`, a pick for this session alone and an
// organization's limit cannot be read, so the level is a guess. Pure: effects.ts reads the sources.
import { isRecord } from '../core/guards'
import { modelParts } from '../core/format'
import { SOURCES } from '../settings/settings'
import { CLEAR_PICK_WORD, EFFORT_LEVELS, EFFORT_MODELS, MODEL_DATE, NO_LEVEL_WORDS, SAVED_LEVELS } from './constants'
import type { EffortLayers, EffortLevel, EffortModel, EffortPick } from './types'

const nameOf = (model: string): string => {
  const parts = modelParts(model.replace(MODEL_DATE, ''))
  return parts === null ? '' : `${parts.family} ${parts.version}`
}

const levelIn = (levels: readonly EffortLevel[], value: unknown): EffortLevel | undefined => levels.find(level => level === value)

const rankOf = (level: EffortLevel): number => EFFORT_LEVELS.indexOf(level)

// The file's `modelSettings` entry for the model, under any spelling of its id
function entryOf(settings: Readonly<Record<string, unknown>>, name: string): Record<string, unknown> {
  const all = isRecord(settings.modelSettings) ? settings.modelSettings : {}
  const entry = Object.entries(all).find(([model]) => nameOf(model) === name)?.[1]
  return isRecord(entry) ? entry : {}
}

// The highest file that sets a level for the model decides: its entry for the model, else its top-level level
function savedLevel(layers: EffortLayers, name: string, model: EffortModel): EffortLevel | undefined {
  for (const source of SOURCES) {
    const settings = layers[source] ?? {}
    const top = source !== 'user' || model.readsUserTop ? settings.effortLevel : undefined
    const level = levelIn(SAVED_LEVELS, entryOf(settings, name).effortLevel) ?? levelIn(SAVED_LEVELS, top)
    if (level !== undefined) return level
  }
  return undefined
}

// The lowest cap any file sets for the model, where a file's entry for the model replaces its top-level cap
function capOf(layers: EffortLayers, name: string): EffortLevel {
  const caps = SOURCES.map(source => {
    const settings = layers[source] ?? {}
    return levelIn(EFFORT_LEVELS, entryOf(settings, name).maxEffortLevel) ?? levelIn(EFFORT_LEVELS, settings.maxEffortLevel) ?? 'max'
  })
  return caps.reduce((lowest, cap) => (rankOf(cap) < rankOf(lowest) ? cap : lowest), 'max')
}

// The level a /effort names, read as Claude Code reads it
export function pickOf(args: string): EffortPick {
  const word = args.trim().toLowerCase()
  if (word === CLEAR_PICK_WORD) return { kind: 'clear' }
  const level = levelIn(EFFORT_LEVELS, word)
  if (level === undefined) return { kind: 'none' }
  return { kind: SAVED_LEVELS.includes(level) ? 'saved' : 'session', level }
}

// A level kept for the session comes after CLAUDE_CODE_EFFORT_LEVEL and before the settings files
export function predictedEffort(input: { model: string; envLevel: string | undefined; layers: EffortLayers; picked?: EffortLevel | undefined }): EffortLevel | null {
  const name = nameOf(input.model)
  const model = EFFORT_MODELS[name]
  if (model === undefined) return null
  const cap = capOf(input.layers, name)
  const word = input.envLevel?.trim().toLowerCase() ?? ''
  const isNoLevel = NO_LEVEL_WORDS.includes(word)
  if (isNoLevel && cap === 'max') return null
  const wanted = isNoLevel ? model.fallback : levelIn(EFFORT_LEVELS, word) ?? input.picked ?? savedLevel(input.layers, name, model) ?? model.fallback
  const highest = Math.min(rankOf(wanted), rankOf(cap))
  return model.levels.filter(level => rankOf(level) <= highest).at(-1) ?? null
}
