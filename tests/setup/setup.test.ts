import { expect, test } from 'claude-code/testing'

import { choiceLines, parseFolderValue, writerNote } from '../../hooks/setup/setup'
import { SETUP_USAGE } from '../../hooks/setup/constants'

const CHOICES = [
  '/alfred-mods:init .alfred-mods (recommended - no permission asks)',
  "/alfred-mods:init .alfred (beside Alfred Code's state)",
  '/alfred-mods:init default (.claude/session-inspector - Claude Code asks before each write)',
]

test('parseFolderValue reads a folder, or nothing', () => {
  expect(parseFolderValue('.alfred')).toEqual({ ok: true, folder: '.alfred' })
  expect(parseFolderValue('  default ')).toEqual({ ok: true, folder: 'default' })
  expect(parseFolderValue('.ALFRED-MODS')).toEqual({ ok: true, folder: '.alfred-mods' })
  expect(parseFolderValue('')).toEqual({ ok: true, folder: null })
  expect(parseFolderValue('   ')).toEqual({ ok: true, folder: null })
})

test('parseFolderValue refuses an unknown folder or an extra word', () => {
  expect(parseFolderValue('bogus')).toEqual({ ok: false })
  expect(parseFolderValue('.alfred default')).toEqual({ ok: false })
})

test('the usage line names the three commands', () => {
  expect(SETUP_USAGE).toBe(
    'Usage: /alfred-mods:init [.alfred-mods|.alfred|default] | /alfred-mods:configure [.alfred-mods|.alfred|default] | /alfred-mods:update',
  )
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
  const note = 'new plans land there once each writer reads plansFolder - claude-kit does from its 0b09406 sync'
  expect(writerNote('.alfred')).toBe(note)
  expect(writerNote('default')).toBe(note)
})
