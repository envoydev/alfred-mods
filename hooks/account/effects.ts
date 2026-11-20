// The account folder's effects: the signed-in organization read from Claude Code's global config, and the command that
// writes a project's expectOrg. The atom is made, read and updated here alone: `claude plugin validate` refuses an atom
// or a ref handed to another module. Change the shape tag when its fields change.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { MatchedInput } from '../core/types'
import { readRec } from '../rec/effects'
import { loadSettings, settingsInForce, writeProjectField } from '../settings/effects'
import { sourceFileName } from '../settings/settings'
import { SETUP_USAGE } from '../setup/constants'
import { configPathOf, expectOrgLine, expectOrgShadowLine, orgOf, parseOrgArgs } from './account'
import { EXPECT_ORG_UNKNOWN, ORG_STRICT, READ_EVERY_MS } from './constants'
import type { Account } from './types'

// Unknown until the first read
const INITIAL_ACCOUNT: Account = { org: null }
const accountAtom = atom({ plugin: 'alfred-mods', key: 'account' } as const, INITIAL_ACCOUNT, { shape: 'account-1' })

// When the config was last read, from the clock; null before the first read
const accountMemory = { lastReadAt: null as number | null }

// The org the band shows: null while unknown
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

// Reads the config and keeps the org name alone, written only when it changes. Forced at a start and a start-over; else
// at most once in READ_EVERY_MS. It never rejects: a failure of any step leaves the org as it was or unknown.
export async function refreshAccount($: EngineInterface, isForced: boolean): Promise<void> {
  const now = await $.clock.now().catch(() => null)
  if (now === null) return
  if (!isForced && accountMemory.lastReadAt !== null && now - accountMemory.lastReadAt < READ_EVERY_MS) return
  accountMemory.lastReadAt = now
  const text = await configText($)
  const org = text === null ? null : orgOf(text)
  await update($, accountAtom, account => (account.org === org ? account : { org })).catch(() => undefined)
}

// What the command answers with an org to write: the value written, or the higher file's that wins; the name is
// '‹org›' under REC strict, the file still gets the real one. The settings are read again after the write, so the band
// follows at once.
async function writeExpectOrg($: EngineInterface, name: string): Promise<string> {
  const result = await writeProjectField($, 'expectOrg', name)
  if (!result.ok) return result.why
  const isStrict = (await readRec($)).level === 'strict'
  const shown = (value: string): string => (isStrict ? ORG_STRICT : value)
  const reply = result.shadow === null ? expectOrgLine(shown(name), sourceFileName('project'))
    : expectOrgShadowLine(shown(settingsInForce().expectOrg ?? name), sourceFileName(result.shadow))
  await loadSettings($).catch(() => undefined)
  return reply
}

// /alfred-mods:configure expectOrg [name]: a name is written; none pins the org the band shows, read afresh. Any other
// argument goes to `others`, the plans folder command.
export async function runConfigureOrg(
  $: EngineInterface, e: MatchedInput<'command.run', { command: 'alfred-mods:configure' }>,
  others: (input: MatchedInput<'command.run', { command: 'alfred-mods:configure' }>) => Promise<{ text: string }>,
): Promise<{ text: string }> {
  const asked = parseOrgArgs(e.args)
  if (asked.kind === 'other') return others(e)
  if (asked.kind === 'usage') return { text: SETUP_USAGE }
  if (asked.kind === 'name') return { text: await writeExpectOrg($, asked.name) }
  await refreshAccount($, true)
  const { org } = await readAccount($)
  return { text: org === null ? EXPECT_ORG_UNKNOWN : await writeExpectOrg($, org) }
}
