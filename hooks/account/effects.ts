// The account folder's effects: the signed-in organization read from Claude Code's global config. The atom is made, read
// and updated here alone: `claude plugin validate` refuses an atom or a ref handed to another module. Change the shape
// tag when its fields change.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { configPathOf, kindOf, orgOf } from './account'
import { READ_EVERY_MS } from './constants'
import type { Account, ConfigLocation } from './types'

// Unknown until the first read
const INITIAL_ACCOUNT: Account = { org: null, kind: null }
const accountAtom = atom({ plugin: 'alfred-mods', key: 'account' } as const, INITIAL_ACCOUNT, { shape: 'account-2' })

// When the config was last read, from the clock; null before the first read. `cached` keeps the text another folder read
// last, with the file's mtime, so a poll reads the file again only when it changed.
const accountMemory = { lastReadAt: null as number | null, cached: null as { path: string; mtimeMs: number; text: string } | null }

// The text the band shows for the account and its plan kind: null while unknown
export function readAccount($: EngineInterface) {
  return read($, accountAtom)
}

// Where Claude Code keeps its own files: CLAUDE_CONFIG_DIR and the home folder, each empty when unset
export async function readConfigLocation($: EngineInterface): Promise<ConfigLocation> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? ''
  // Claude Code's home folder is os.homedir(): USERPROFILE on Windows, HOME elsewhere; an empty value is unset
  const profile = (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
  const home = profile === '' ? ((await $.env.get('HOME').catch(() => undefined)) ?? '') : profile
  return { configDir, home }
}

// The config's text, read now and kept with the mtime it had, or null where it cannot be read
async function readAndKeep($: EngineInterface, path: string, mtimeMs: number | null): Promise<string | null> {
  const text = await $.fs.read(path).catch(() => null)
  accountMemory.cached = text === null || mtimeMs === null ? null : { path, mtimeMs, text }
  return text
}

// The config's text, or null where there is no folder to look in or the read fails (a missing file, a refused call, over
// 4 MiB): each leaves the org unknown
async function configText($: EngineInterface): Promise<string | null> {
  const path = configPathOf(await readConfigLocation($))
  if (path === null) return null
  const stat = await $.fs.stat(path).catch(() => null)
  return readAndKeep($, path, stat?.mtimeMs ?? null)
}

// The config's text for a reader that polls: the text last read while the file's mtime has not moved, else a new read.
// Null where it cannot be read.
export async function readConfigTextCached($: EngineInterface): Promise<string | null> {
  const path = configPathOf(await readConfigLocation($))
  if (path === null) return null
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null) return null
  const cached = accountMemory.cached
  if (cached !== null && cached.path === path && cached.mtimeMs === stat.mtimeMs) return cached.text
  return readAndKeep($, path, stat.mtimeMs)
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
