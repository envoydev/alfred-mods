// Why a copy failed, for every reason a build can give - 'unanswered' arrived in Claude Code 2.1.329
import { expect, test } from 'claude-code/testing'

import { copyWhy } from '../../hooks/inspect/commands'

test('a copy the app left unanswered names the wait, not undefined', () => {
  expect(copyWhy('unanswered')).toBe('the app did not answer in time')
})

test('the reasons older builds give keep their words', () => {
  expect(copyWhy('no-surface')).toBe('no screen to copy on')
  expect(copyWhy('no-clipboard')).toBe('this terminal has no clipboard path')
  expect(copyWhy('refused')).toBe('the terminal refused it')
})

test('a reason this build does not know gets a plain line, never undefined', () => {
  expect(copyWhy('a-later-reason')).toBe('no reason given')
  expect(copyWhy('toString')).toBe('no reason given')
})
