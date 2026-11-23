// The skip ask's effects (spec 2026-11-23, D3): its $.state atom, the listener that raises the ask when the transcript
// reader finds a skip notice, and the two answers
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { SkipAsk } from './types'
import { INITIAL_SKIP_ASK, LEFT_OUT_TEXT, NEVER_TEXT, NEVER_UNSAVED_TEXT, OPTION_KEY, OPTION_TITLE, SKIP_ASK_KEY } from './constants'
import { isAnswered } from './skip'
import { toast } from '../core/effects'
import { onSkipNotice } from '../transcript/effects'

const skipAtom = atom({ plugin: 'alfred-mods', key: 'skip' } as const, INITIAL_SKIP_ASK as SkipAsk, { shape: 'skip-1' })
export function readSkipAsk($: EngineInterface) {
  return read($, skipAtom)
}
function updateSkipAsk($: EngineInterface, change: (value: SkipAsk) => SkipAsk) {
  return update($, skipAtom, change)
}

function closeAsk($: EngineInterface) {
  return updateSkipAsk($, current => (current.isAskUp ? { ...current, isAskUp: false } : current))
}

// The first notice of the session raises the ask unless the person answered 'never' before; a later notice changes
// nothing, so an ask closed stays closed
async function raiseAsk($: EngineInterface): Promise<void> {
  if ((await readSkipAsk($)).isSkipped) return
  if (isAnswered(await $.store.get(SKIP_ASK_KEY).catch(() => null))) return
  await updateSkipAsk($, () => ({ isSkipped: true, isAskUp: true }))
}

// With the option on the hooks are left out already and no notice comes: nothing listens
export function watchSkipNotices($: EngineInterface, isLeftOut: boolean): void {
  if (isLeftOut) return
  onSkipNotice(() => {
    raiseAsk($).catch(() => undefined)
  })
}

// 'Leave out': the option is written through `/config`, which reloads the mod without the hooks; a refusal toasts its
// reason and the row, and the ask stays up
export async function leaveOutSkipped($: EngineInterface): Promise<string> {
  let reason: string | undefined
  try {
    reason = (await $.config.set({ key: OPTION_KEY, value: true })).deny
  } catch (err) {
    // A build without `$.config` throws where the call is made, and a press runs unawaited: the person is told here
    reason = err instanceof Error ? err.message : String(err)
  }
  if (reason !== undefined) {
    const text = `Could not leave out the skipped hooks: ${reason}. Set '${OPTION_TITLE}' in /config.`
    toast($, text)
    return text
  }
  await closeAsk($)
  return LEFT_OUT_TEXT
}

// 'Don't ask again': the answer is stored, and the ask closes even where the store refuses it
export async function neverAskSkip($: EngineInterface): Promise<string> {
  const isStored = await $.clock.now().then(answeredAt => $.store.set(SKIP_ASK_KEY, { answeredAt })).then(() => true, () => false)
  await closeAsk($)
  return isStored ? NEVER_TEXT : NEVER_UNSAVED_TEXT
}
