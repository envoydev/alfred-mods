// The account folder's logic: where the global config is and the one text the band shows, read out of the config's text.
// Pure: effects.ts reads the file.
import { isRecord } from '../core/guards'
import { printable } from '../core/format'
import { CONFIG_FILE_NAME, PERSONAL, PERSONAL_ORG_TYPES, TEAM_TYPES } from './constants'
import type { AccountKind, ConfigLocation } from './types'

const withoutTrailingSeparators = (folder: string): string => folder.replace(/[\\/]+$/, '')

// CLAUDE_CONFIG_DIR's folder when it is set and not empty, else the home folder; null with neither
export function configPathOf(location: ConfigLocation): string | null {
  const folder = location.configDir === '' ? location.home : location.configDir
  return folder === '' ? null : `${withoutTrailingSeparators(folder)}/${CONFIG_FILE_NAME}`
}

// The config's oauthAccount, or null for text that is no JSON object or holds none
function oauthAccountOf(text: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return isRecord(parsed) && isRecord(parsed.oauthAccount) ? parsed.oauthAccount : null
}

// The text the band shows for the signed-in account, as the Claude mobile app does (the owner, 2026-11-21): 'Personal'
// for a free, Pro or Max account, which wins even with no organization name, else the organization's name, trimmed and
// with no control character. A token login has no oauthAccount; text that is no JSON object, a company account with no
// usable name and no usable field give null. Nothing else of the text is returned.
export function orgOf(text: string): string | null {
  const account = oauthAccountOf(text)
  if (account === null) return null
  const { organizationType, organizationName } = account
  if (typeof organizationType === 'string' && PERSONAL_ORG_TYPES.includes(organizationType)) return PERSONAL
  if (typeof organizationName !== 'string') return null
  const clean = printable(organizationName).replace(/[\t\n]+/g, ' ').trim()
  return clean === '' ? null : clean
}

// The plan kind the band names beside the company's name, from the account's organizationType: Team, Enterprise, or
// Personal for a free, Pro or Max account; null for any other type, none, or no account
export function kindOf(text: string): AccountKind | null {
  const type = oauthAccountOf(text)?.organizationType
  if (typeof type !== 'string') return null
  if (PERSONAL_ORG_TYPES.includes(type)) return PERSONAL
  return TEAM_TYPES[type] ?? null
}
