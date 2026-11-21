// The kit folder's $.state atom, made, read and updated here alone: `claude plugin validate` refuses an atom handed to
// another module. Change the shape tag when the stored fields change: it declines what an earlier version stored.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { KitState } from './types'
import { kitPassScore, kitPathOf, parseKitSettings } from './kit'

// No kit data until the first read finds a file
const INITIAL_KIT: KitState = { values: null }
const kitAtom = atom({ plugin: 'alfred-mods', key: 'kit' } as const, INITIAL_KIT, { shape: 'kit-2' })

export function readKit($: EngineInterface): Promise<KitState> {
  return read($, kitAtom)
}

// The pass score while the kit's scoring is on, which colours the band's score
export async function readKitScoreLevel($: EngineInterface): Promise<number | null> {
  const { values } = await readKit($)
  return values === null ? null : kitPassScore(values)
}

// Reads `<session root>/.claude/kit/settings.json` into the atom, written only when the values change. The values clear only
// where the file is absent, or is no kit data (not an object, over the size cap): a failure of any other kind - a refused
// read or check, a file that is busy or too large to read, no session root - keeps them as they were. It never rejects
// and never tells the person. Called at a start, a start-over, a prompt's hook context and a main turn's end.
export async function refreshKit($: EngineInterface): Promise<void> {
  const root = await $.session.root().catch(() => null)
  if (root === null) return
  const path = kitPathOf(root)
  const read = await $.fs.read(path).then(text => ({ text }), () => null)
  if (read === null && (await $.fs.exists(path).catch(() => true))) return
  const next: KitState = { values: read === null ? null : parseKitSettings(read.text) }
  if (JSON.stringify(await readKit($).catch(() => null)) === JSON.stringify(next)) return
  await update($, kitAtom, () => next).catch(() => undefined)
}
