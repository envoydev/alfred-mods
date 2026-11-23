// The account folder's effects: the signed-in organization read from Claude Code's global config. The atom is made, read
// and updated here alone: `claude plugin validate` refuses an atom or a ref handed to another module. Change the shape
// tag when its fields change.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { configPathOf, kindOf, orgOf } from './account'
import { READ_EVERY_MS } from './constants'
import type { Account } from './types'

// Unknown until the first read
const INITIAL_ACCOUNT: Account = { org: null, kind: null }
const accountAtom = atom({ plugin: 'alfred-mods', key: 'account' } as const, INITIAL_ACCOUNT, { shape: 'account-2' })

// When the config was last read, from the clock; null before the first read
const accountMemory = { lastReadAt: null as number | null }

// The text the band shows for the account and its plan kind: null while unknown
export function readAccount($: EngineInterface) {
  return read($, accountAtom)
}

// The config's text, or null where there is no folder to look in or the read fails (a missing file, a refused call, over
// 4 MiB): each leaves the org unknown
async function configText($: EngineInterface): Promise<string | null> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? ''
  // Claude Code's home folder is os.homedir(): USERPROFILE on Windows, HOME elsewhere; an empty value is unset
  const profile = (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const home = profile === '' ? ((await $.env.get('HOME').catch(() => undefined)) ?? '') : profile
  const path = configPathOf({ configDir, home })
  return path === null ? null : $.fs.read(path).catch(() => null)
}

// Reads the config and keeps the shown text alone, written only when it changes. Forced at a start and a start-over; else
// at most once in READ_EVERY_MS. It never rejects: a failure of any step leaves the org as it was or unknown.
export async function refreshAccount($: EngineInterface, isForced: boolean): Promise<void> {
  const now = await $.clock.now().catch(() => null)
  if (now === null) return
  if (!isForced && accountMemory.lastReadAt !== null && now - accountMemory.lastReadAt < READ_EVERY_MS) return
  accountMemory.lastReadAt = now
  const text = await configText($)
  const org = text === null ? null : orgOf(text)
  const kind = text === null ? null : kindOf(text)
  await update($, accountAtom, account => (account.org === org && account.kind === kind ? account : { org, kind })).catch(() => undefined)
}
