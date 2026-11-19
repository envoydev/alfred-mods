// The core folder's effects: what it reads and writes through $
import type { EngineInterface } from 'claude-code'
import { mask } from '../rec/mask'
import { printable } from './format'

export async function readTextFile($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// '/inspect close' and '/rec words close': a pane closes from the prompt, as the main screen takes no click on its mark
export async function closePane($: EngineInterface, id: 'inspect' | 'rec', name: string): Promise<string> {
  const panes = await $.ui.panes().catch(() => [])
  if (!panes.some(p => p.id === id)) return `The ${name} is not open.`
  await $.ui.close({ id })
  return `Closed the ${name}.`
}

export async function isNoColor($: EngineInterface): Promise<boolean> {
  return ((await $.env.get('NO_COLOR')) ?? '') !== ''
}

// Every toast of the mod goes through here, so it is filtered and masked like any drawn string: a toast can carry
// text read from a file. `timeoutMs` keeps it up longer than the default 4 s.
export function toast($: EngineInterface, text: string, timeoutMs?: number): void {
  const shown = mask(printable(text))
  if (timeoutMs === undefined) $.ui.toast(shown)
  else $.ui.toast(shown, { timeoutMs })
}
