import { expect, test } from 'claude-code/testing'

import { parsePlan } from '../../hooks/plan/plan'
import {
  closeReport, copiedLine, copyFailureLine, coversRoot, earlierChoicesLine, gitignoreAppend, gitignoreLine, isLivePlan, isUtf8Text, keptBothLine, leftInPlaceLine, movedLine,
  moveQueue, notMovedLine, notUtf8Line, oldInstallKeys, oldInstallLine, statusFilesLine,
} from '../../hooks/setup/update'
import { MORE_LINE } from '../../hooks/setup/constants'
import { planText } from '../plans'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000
const PENDING = parsePlan(planText({ S1: 'done', S2: 'pending' }))
const FINISHED = parsePlan(planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' }))

test('isLivePlan: a plan that does not parse is live', () => {
  expect(isLivePlan(null, NOW - 100 * HOUR, NOW)).toBe(true)
})

test('isLivePlan: a pending step 1 h old is live, 25 h old is not', () => {
  expect(PENDING).not.toBeNull()
  expect(isLivePlan(PENDING, NOW - HOUR, NOW)).toBe(true)
  expect(isLivePlan(PENDING, NOW - 25 * HOUR, NOW)).toBe(false)
})

test('isLivePlan: a plan with every step done is not live', () => {
  expect(FINISHED).not.toBeNull()
  expect(isLivePlan(FINISHED, NOW - HOUR, NOW)).toBe(false)
})

test('coversRoot reads a line trimmed, with one leading and one trailing slash dropped', () => {
  expect(coversRoot('.alfred/\n', '.alfred/alfred-mods')).toBe(true)
  expect(coversRoot('node_modules\n/.alfred-mods\n', '.alfred-mods')).toBe(true)
  expect(coversRoot('.alfred-mods/', '.alfred-mods')).toBe(true)
  expect(coversRoot('  /.alfred/  \r\n', '.alfred/alfred-mods')).toBe(true)
  expect(coversRoot('.alfred/alfred-mods', '.alfred/alfred-mods')).toBe(true)
})

test('coversRoot refuses a comment, a longer name and a child of the root', () => {
  expect(coversRoot('# .alfred-mods\n', '.alfred-mods')).toBe(false)
  expect(coversRoot('.alfredx\n', '.alfred/alfred-mods')).toBe(false)
  expect(coversRoot('.alfred/alfred-mods/plans\n', '.alfred/alfred-mods')).toBe(false)
  expect(coversRoot('', '.alfred-mods')).toBe(false)
})

test('gitignoreAppend adds the root with a newline first only where the text lacks one', () => {
  expect(gitignoreAppend('node_modules\n', '.alfred-mods')).toBe('node_modules\n.alfred-mods/\n')
  expect(gitignoreAppend('node_modules', '.alfred-mods')).toBe('node_modules\n.alfred-mods/\n')
  expect(gitignoreAppend('', '.alfred/alfred-mods')).toBe('.alfred/alfred-mods/\n')
})

test('gitignoreAppend adds the root with the file\'s own line ending', () => {
  expect(gitignoreAppend('node_modules\r\n', '.alfred-mods')).toBe('node_modules\r\n.alfred-mods/\r\n')
  expect(gitignoreAppend('a\r\nb', '.alfred-mods')).toBe('a\r\nb\r\n.alfred-mods/\r\n')
  expect(gitignoreAppend('a\nb\n', '.alfred-mods')).toBe('a\nb\n.alfred-mods/\n')
})

test('isUtf8Text holds only when the text\'s UTF-8 length is the file\'s size', () => {
  expect(isUtf8Text('abc', 3)).toBe(true)
  expect(isUtf8Text('\u00e9', 2)).toBe(true)
  expect(isUtf8Text('\ufffd', 1)).toBe(false)
  expect(isUtf8Text('abc', 4)).toBe(false)
})

test('oldInstallKeys names the session-inspector keys set to true', () => {
  const enabled = { 'session-inspector@envoydev': true, 'session-inspector@other': false, 'alfred-mods@envoydev': true, 'session-inspector@x': 'yes' }
  expect(oldInstallKeys(enabled)).toEqual(['session-inspector@envoydev'])
  expect(oldInstallKeys(undefined)).toEqual([])
  expect(oldInstallKeys([true])).toEqual([])
})

test('moveQueue queues the newest file of a name once, oldest first, the earlier folder on a tie, and sets aside a name the chosen root holds', () => {
  const file = (name: string, folder: string, mtimeMs: number) => ({ name, root: folder, path: `${folder}/${name}.json`, mtimeMs, diskMtimeMs: mtimeMs, size: 1 })
  const { queue, clashed } = moveQueue(
    new Set(['held']),
    [[file('a', 'one', 5), file('held', 'one', 5), file('tie', 'one', 7)], [file('a', 'two', 9), file('held', 'two', 1), file('tie', 'two', 7)]],
  )
  expect(queue.map(entry => entry.path)).toEqual(['one/tie.json', 'two/a.json'])
  expect(clashed.map(entry => entry.path)).toEqual(['one/held.json'])
})

test('the report lines read as the spec gives them', () => {
  expect(movedLine(3, '.alfred-mods')).toBe('moved 3 plan and scores files to .alfred-mods/')
  expect(copiedLine(2, '.alfred-mods', ['.claude/session-inspector/plans', '.claude/session-inspector/scores'])).toBe(
    'copied 2 files to .alfred-mods/ - remove the old copies in .claude/session-inspector/plans/, .claude/session-inspector/scores/ by hand',
  )
  expect(notMovedLine('p', '.alfred-mods', 'plans')).toBe('not moved: p - its copy did not read back equal; check .alfred-mods/plans/')
  expect(leftInPlaceLine('p')).toBe('left in place: p - its writer still uses it; run /alfred-mods:update after it finishes')
  expect(notUtf8Line('p')).toBe('not moved: p - not UTF-8 text')
  expect(copyFailureLine('unchecked', 'p', '.alfred-mods', 'plans')).toBe('not moved: p - could not check the destination')
  expect(copyFailureLine('unstatted', 'p', '.alfred-mods', 'plans')).toBe('not moved: p - could not check the copy')
  expect(copyFailureLine('differs', 'p', '.alfred-mods', 'plans')).toBe(notMovedLine('p', '.alfred-mods', 'plans'))
  expect(keptBothLine('p')).toBe('kept both: p (the newer one shows)')
  expect(MORE_LINE).toBe('more to move - run /alfred-mods:update again')
  expect(gitignoreLine('.alfred-mods')).toBe('added .alfred-mods/ to .gitignore')
  expect(earlierChoicesLine(['band', 'rec'])).toBe('wrote your earlier choices to ~/.claude/settings.json: band, rec')
  expect(oldInstallLine('session-inspector@envoydev')).toBe(
    'an old session-inspector install is still on - claude plugin uninstall session-inspector@envoydev',
  )
  expect(statusFilesLine(4)).toBe('4 status files from Alfred Code 3.12.1 or older in .claude/session-inspector/status/ - safe to delete')
})

test('closeReport ends on update done, or nothing to update when no step printed', () => {
  expect(closeReport([])).toEqual(['nothing to update'])
  expect(closeReport(['x'])).toEqual(['x', 'update done'])
})
