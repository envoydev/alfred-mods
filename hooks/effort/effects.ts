// The effort folder's effects: reads what decides the effort and hands the session the level the next request should
// carry. It owns no state: the session's atom holds the level.
import type { EngineInterface } from 'claude-code'
import { SOURCES } from '../settings/settings'
import { readSession, setEffortGuess } from '../session/effects'
import { predictedEffort } from './effort'
import type { EffortLayers } from './types'

// Nothing to do once a request has told the effort, or before the model is known. A refused read counts as a file or a
// variable that sets nothing. It never rejects: a failure leaves the effort as it was.
export async function guessEffort($: EngineInterface): Promise<void> {
  try {
    const { model, effortFrom } = await readSession($)
    if (model === null || effortFrom === 'step') return
    const layers: EffortLayers = {}
    for (const source of SOURCES) layers[source] = await $.settings.read({ source }).catch(() => ({}))
    const envLevel = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined)
    await setEffortGuess($, model, predictedEffort({ model, envLevel, layers }))
  } catch {
    // No effort until a request tells it
  }
}
