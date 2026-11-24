// The account folder's pure logic: where Claude Code's global config lives, and the one text the band shows read out of
// it - 'Personal' for a free, Pro or Max account, the company's name for any other
import { expect, test } from 'claude-code/testing'

import { configPathOf, kindOf, orgOf } from '../../hooks/account/account'

const configWith = (account: unknown): string => JSON.stringify({ numStartups: 3, oauthAccount: account })

test('the config is in CLAUDE_CONFIG_DIR when it is set, else in the home folder', () => {
  expect(configPathOf({ configDir: '/cfg', home: '/home/u' })).toBe('/cfg/.claude.json')
  expect(configPathOf({ configDir: '', home: '/home/u' })).toBe('/home/u/.claude.json')
  expect(configPathOf({ configDir: '', home: '' })).toBeNull()
})

test('trailing separators of the folder are dropped, a backslash one too', () => {
  expect(configPathOf({ configDir: '/cfg//', home: '' })).toBe('/cfg/.claude.json')
  expect(configPathOf({ configDir: '', home: 'C:\\Users\\u\\' })).toBe('C:\\Users\\u/.claude.json')
})

test('orgOf takes the organization name of the signed-in account', () => {
  expect(orgOf(configWith({ organizationName: 'Acme Inc', emailAddress: 'a@b.c' }))).toBe('Acme Inc')
})

test('orgOf trims the name and removes control characters', () => {
  expect(orgOf(configWith({ organizationName: '  Acme\u0007 Inc \n' }))).toBe('Acme Inc')
  expect(orgOf(configWith({ organizationName: '\u001b[31mAcme\u001b[0m' }))).toBe('Acme')
})

test('a token login has no oauthAccount: the organization is unknown', () => {
  expect(orgOf(JSON.stringify({ numStartups: 3 }))).toBeNull()
})

test('orgOf is null for an oauthAccount that is no object, or a name that is no text or is blank', () => {
  for (const account of [null, 'Acme', 7, ['Acme'], {}, { organizationName: 5 }, { organizationName: null }, { organizationName: '  ' }, { organizationName: '\u0007' }]) {
    expect(orgOf(configWith(account))).toBeNull()
  }
})

test('orgOf is null for text that is no JSON object', () => {
  for (const text of ['', '{ bad', '[]', '"Acme"', 'null', '7']) expect(orgOf(text)).toBeNull()
})

test('a free, Pro or Max account shows as Personal, whatever its organization is called', () => {
  for (const organizationType of ['claude_free', 'claude_pro', 'claude_max']) {
    expect(orgOf(configWith({ organizationType, organizationName: 'jane@example.com\'s Organization' }))).toBe('Personal')
  }
})

test('a personal account shows as Personal even with no organization name', () => {
  expect(orgOf(configWith({ organizationType: 'claude_max' }))).toBe('Personal')
  expect(orgOf(configWith({ organizationType: 'claude_pro', organizationName: '  ' }))).toBe('Personal')
})

test('a Team or Enterprise account, an unknown type or none shows the organization name', () => {
  for (const organizationType of ['claude_team', 'claude_enterprise', 'claude_other', 7, null]) {
    expect(orgOf(configWith({ organizationType, organizationName: 'Acme Inc' }))).toBe('Acme Inc')
  }
  expect(orgOf(configWith({ organizationName: 'Acme Inc' }))).toBe('Acme Inc')
})

test('a company account with no usable name is unknown', () => {
  for (const organizationType of ['claude_team', 'claude_enterprise']) expect(orgOf(configWith({ organizationType }))).toBeNull()
})

test('kindOf names the plan: Team, Enterprise, or Personal for a free, Pro or Max account', () => {
  expect(kindOf(configWith({ organizationType: 'claude_team', organizationName: 'Acme Inc' }))).toBe('Team')
  expect(kindOf(configWith({ organizationType: 'claude_enterprise', organizationName: 'Acme Inc' }))).toBe('Enterprise')
  for (const organizationType of ['claude_free', 'claude_pro', 'claude_max']) expect(kindOf(configWith({ organizationType }))).toBe('Personal')
})

test('kindOf is null for any other type, none, no account or text that is no JSON object', () => {
  for (const organizationType of ['claude_other', 7, null, undefined]) expect(kindOf(configWith({ organizationType, organizationName: 'Acme Inc' }))).toBeNull()
  expect(kindOf(JSON.stringify({ numStartups: 3 }))).toBeNull()
  for (const text of ['', '{ bad', '[]', 'null']) expect(kindOf(text)).toBeNull()
})
