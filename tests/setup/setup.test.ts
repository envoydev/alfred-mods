import { expect, test } from 'claude-code/testing'

import { choiceLines, parseSetupArgs, writerNote } from '../../hooks/setup/setup'
import { SETUP_USAGE } from '../../hooks/setup/constants'

const CHOICES = [
  '/alfred-mods init .alfred-mods (recommended - no permission asks)',
  "/alfred-mods init .alfred (beside Alfred Code's state)",
  '/alfred-mods init default (.claude/session-inspector - Claude Code asks before each write)',
]

test('parseSetupArgs reads each verb, with or without a folder', () => {
  expect(parseSetupArgs('init')).toEqual({ verb: 'init', folder: null })
  expect(parseSetupArgs('configure')).toEqual({ verb: 'configure', folder: null })
  expect(parseSetupArgs('update')).toEqual({ verb: 'update', folder: null })
  expect(parseSetupArgs('configure .alfred')).toEqual({ verb: 'configure', folder: '.alfred' })
  expect(parseSetupArgs('  init   default ')).toEqual({ verb: 'init', folder: 'default' })
  expect(parseSetupArgs('INIT .alfred-mods')).toEqual({ verb: 'init', folder: '.alfred-mods' })
})

test('parseSetupArgs gives null for an unknown verb, folder or extra word', () => {
  expect(parseSetupArgs('init bogus')).toBeNull()
  expect(parseSetupArgs('')).toBeNull()
  expect(parseSetupArgs('frob')).toBeNull()
  expect(parseSetupArgs('update .alfred')).toBeNull()
  expect(parseSetupArgs('init .alfred default')).toBeNull()
})

test('the usage line names the three verbs', () => {
  expect(SETUP_USAGE).toBe('Usage: /alfred-mods init | configure [default|.alfred|.alfred-mods] | update')
})

test('choiceLines gives the three choices, the recommended one first', () => {
  expect(choiceLines(null)).toEqual(CHOICES)
})

test('choiceLines marks the current choice', () => {
  expect(choiceLines('.alfred')).toEqual([CHOICES[0], `${CHOICES[1]} (now)`, CHOICES[2]])
  expect(choiceLines('default')[2]).toBe(`${CHOICES[2]} (now)`)
})

test('writerNote is null for .alfred-mods and names the writers for the others', () => {
  expect(writerNote('.alfred-mods')).toBeNull()
  const note = 'new plans land there once each writer reads plansFolder - claude-kit from its next release'
  expect(writerNote('.alfred')).toBe(note)
  expect(writerNote('default')).toBe(note)
})
