// The account folder's pure logic: where Claude Code's global config lives, the one organization name read out of its
// text, the check against a project's expectOrg and the words of /alfred-mods:configure expectOrg
import { expect, test } from 'claude-code/testing'

import { configPathOf, isExpectOrg, isOrgMismatch, orgOf, parseOrgArgs } from '../../hooks/account/account'

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

test('no expectOrg means no warning', () => {
  expect(isOrgMismatch('Acme', null)).toBe(false)
  expect(isOrgMismatch(null, null)).toBe(false)
})

test('the shown organization is compared to expectOrg trimmed and without case', () => {
  expect(isOrgMismatch('Acme Inc', 'acme inc')).toBe(false)
  expect(isOrgMismatch(' Acme Inc ', 'ACME INC')).toBe(false)
  expect(isOrgMismatch('Acme Inc', 'Other Co')).toBe(true)
})

test('an unknown organization is a mismatch when expectOrg is set', () => {
  expect(isOrgMismatch(null, 'Acme')).toBe(true)
})

test('expectOrg is a name of 1 to 100 characters once trimmed', () => {
  expect(isExpectOrg('Acme')).toBe(true)
  expect(isExpectOrg(' a ')).toBe(true)
  expect(isExpectOrg('x'.repeat(100))).toBe(true)
  for (const bad of ['', '   ', 'x'.repeat(101), 5, null, undefined, ['Acme']]) expect(isExpectOrg(bad)).toBe(false)
})

test('parseOrgArgs reads the keyword in any case and the name as the rest, case kept', () => {
  expect(parseOrgArgs('expectOrg Acme Inc')).toEqual({ kind: 'name', name: 'Acme Inc' })
  expect(parseOrgArgs('  EXPECTORG   Acme  Inc  ')).toEqual({ kind: 'name', name: 'Acme  Inc' })
  expect(parseOrgArgs('expectOrg')).toEqual({ kind: 'pin' })
  expect(parseOrgArgs(' expectorg  ')).toEqual({ kind: 'pin' })
})

test('parseOrgArgs refuses a name over 100 characters, and leaves other arguments to the folder command', () => {
  expect(parseOrgArgs(`expectOrg ${'x'.repeat(101)}`)).toEqual({ kind: 'usage' })
  expect(parseOrgArgs(`expectOrg ${'x'.repeat(100)}`)).toEqual({ kind: 'name', name: 'x'.repeat(100) })
  for (const args of ['', '.alfred', 'default', 'expectOrgs Acme', 'bogus expectOrg']) expect(parseOrgArgs(args)).toEqual({ kind: 'other' })
})
