// The account folder's logic: where the global config is, the organization name in its text, the check against a
// project's expectOrg and the arguments of /alfred-mods:configure expectOrg. Pure: effects.ts reads the file.
import { isRecord } from '../core/guards'
import { printable } from '../core/format'
import { EXPECT_ORG_KEYWORD, EXPECT_ORG_MAX, CONFIG_FILE_NAME, EXPECT_ORG_WARNS } from './constants'
import type { ConfigLocation, OrgArgs } from './types'

const withoutTrailingSeparators = (folder: string): string => folder.replace(/[\\/]+$/, '')

// CLAUDE_CONFIG_DIR's folder when it is set and not empty, else the home folder; null with neither
export function configPathOf(location: ConfigLocation): string | null {
  const folder = location.configDir === '' ? location.home : location.configDir
  return folder === '' ? null : `${withoutTrailingSeparators(folder)}/${CONFIG_FILE_NAME}`
}

// The organization name of the signed-in account in the config's text: trimmed, with no control character. A token login
// has no oauthAccount; text that is no JSON object, a name that is no text and a blank name give null. Nothing else
// of the text is returned.
export function orgOf(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed.oauthAccount)) return null
  const name = parsed.oauthAccount.organizationName
  if (typeof name !== 'string') return null
  const clean = printable(name).replace(/[\t\n]+/g, ' ').trim()
  return clean === '' ? null : clean
}

// A name of 1 to 100 characters once trimmed
export const isExpectOrg = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= EXPECT_ORG_MAX

// With no expectOrg there is no warning; with one, an org that is unknown or differs (trimmed, any case) warns
export function isOrgMismatch(org: string | null, expectOrg: string | null): boolean {
  if (expectOrg === null) return false
  return org === null || org.trim().toLowerCase() !== expectOrg.trim().toLowerCase()
}

// The arguments of /alfred-mods:configure: the keyword in any case, then the name as the rest, trimmed, in its own case
export function parseOrgArgs(args: string): OrgArgs {
  const match = /^\s*(\S+)(?:\s+([\s\S]*?))?\s*$/.exec(args)
  if (match === null || match[1]?.toLowerCase() !== EXPECT_ORG_KEYWORD.toLowerCase()) return { kind: 'other' }
  const name = (match[2] ?? '').trim()
  if (name === '') return { kind: 'pin' }
  return isExpectOrg(name) ? { kind: 'name', name } : { kind: 'usage' }
}

export const expectOrgLine = (name: string, file: string): string => `${EXPECT_ORG_KEYWORD} is "${name}" in ${file} - ${EXPECT_ORG_WARNS}`

export const expectOrgShadowLine = (name: string, file: string): string => `${EXPECT_ORG_KEYWORD} is "${name}" in ${file}, which wins over the value written`
