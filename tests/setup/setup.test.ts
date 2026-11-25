import { expect, test } from 'claude-code/testing'

import { choiceLines, parseFolderValue } from '../../hooks/setup/setup'
import { SETUP_USAGE } from '../../hooks/setup/constants'

const CHOICES = [
  "/alfred-mods:init .alfred-mods (claude-kit's plan files - recommended)",
  "/alfred-mods:init .alfred (Alfred Code's plans in .alfred/docs/work/plans/)",
  "/alfred-mods:init default (Claude Code's own task list - no plan files)",
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
