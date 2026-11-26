// The effort folder's effects: reads what decides the effort and hands the session the level the next request should
// carry. It owns no state: the session's atom holds the level. A /model and a /effort reach it here too, where a managed
// guard keeps classic.PostModelSwitch and classic.ConfigChange from the mod: the model is read at the tick, and a
// /effort is the command it is.
import type { EngineInterface } from 'claude-code'
import { SOURCES } from '../settings/settings'
import { readSession, releaseEffort, setEffortGuess, setModel } from '../session/effects'
import type { HookInput, HookNext } from '../core/types'
import { REREAD_WINDOW_MS } from './constants'
import { pickOf, predictedEffort } from './effort'
import type { EffortLayers, EffortLevel } from './types'

// The level a /effort kept for the session alone (max), on any model; the model `$.session.model()` last answered;
// until when the tick reads the settings again after a /effort; and, after a /effort that named no level, the level
// the settings gave then, so only a pick the picker saves moves a level a request told
const effortMemory = {
  sessionLevel: null as EffortLevel | null,
  lastModel: null as string | null,
  rereadUntil: 0,
  pickerBase: undefined as EffortLevel | null | undefined,
}

// The level the sources give `model` now, a level typed in a /effort that just ran first. A refused read counts as a
// file or a variable that sets nothing.
async function predictFor($: EngineInterface, model: string, typed?: EffortLevel): Promise<EffortLevel | null> {
  const layers: EffortLayers = {}
  for (const source of SOURCES) layers[source] = await $.settings.read({ source }).catch(() => ({}))
  const envLevel = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined)
  return predictedEffort({ model, envLevel, layers, picked: typed ?? effortMemory.sessionLevel ?? undefined })
}

// Nothing to do once a request has told the effort, or before the model is known. It never rejects: a failure leaves
// the effort as it was.
export async function guessEffort($: EngineInterface, typed?: EffortLevel): Promise<void> {
  try {
    const { model, effortFrom } = await readSession($)
    if (model === null || effortFrom === 'step') return
    await setEffortGuess($, model, await predictFor($, model, typed))
  } catch {
    // No effort until a request tells it
  }
}

// The session's model as /model left it: a change since the last read is a switch, whatever reported it. The first
// read only sets the mark. A request answered on a fallback keeps its model while the session's stands.
export async function followModel($: EngineInterface): Promise<void> {
  try {
    const model = await $.session.model()
    const last = effortMemory.lastModel
    effortMemory.lastModel = model
    if (last === null || last === model) return
    await setModel($, model)
    await guessEffort($)
  } catch {
    // The next tick reads it again
  }
}

// A /effort, observed and passed on. A level it names replaces the last request's at once: max is kept for the
// session, a saved level replaces that, and auto drops it. With no level (the picker), the last request's level holds
// unless the picker saves another, which the tick reads each second for a while, as the save comes after the command
// answers.
export async function trackEffortCommand($: EngineInterface, e: HookInput<'command.run'>, next: HookNext<'command.run'>) {
  const done = await next(e)
  try {
    const pick = pickOf(e.args)
    effortMemory.rereadUntil = (await $.clock.now()) + REREAD_WINDOW_MS
    const { model } = await readSession($)
    if (pick.kind === 'none') {
      effortMemory.pickerBase = model === null ? undefined : await predictFor($, model)
      await guessEffort($)
      return done
    }
    effortMemory.pickerBase = undefined
    effortMemory.sessionLevel = pick.kind === 'session' ? pick.level : null
    await releaseEffort($)
    await guessEffort($, pick.kind === 'clear' ? undefined : pick.level)
  } catch {
    // The band keeps the last level; the command has run
  }
  return done
}

// Each second while a /effort is recent: a level the picker saved since then replaces a request's
export async function rereadEffortIfDue($: EngineInterface, now: number): Promise<void> {
  if (now >= effortMemory.rereadUntil) return
  try {
    const { model, effortFrom } = await readSession($)
    const base = effortMemory.pickerBase
    if (model !== null && effortFrom === 'step' && base !== undefined && (await predictFor($, model)) !== base) {
      effortMemory.pickerBase = undefined
      await releaseEffort($)
    }
  } catch {
    // The next tick reads it again
  }
  await guessEffort($)
}
