// The project row counts the repository's uncommitted changes (the user, 2026-11-12: 'project: alfred-mods │
// git:(web-steps) +5323 -123 | folder: folder name'): lines added and removed against HEAD, a new untracked file's
// lines as added, read off the hooks by one `git diff` and one `git ls-files`, each with a 2 s timeout
import { expect, test } from 'claude-code/testing'

import { aheadBehind, numstatTotals, untrackedNames } from '../../hooks/place/changes'
import { START, engine, stubAll, watchState } from '../kit'
import type { Session } from '../../hooks/session/types'

const metaOf = (state: { get(key: string): unknown }): Session => state.get('session') as Session

test('numstat totals sum added and removed lines, a binary file counting none', () => {
  expect(numstatTotals('3\t1\ta.ts\n-\t-\tlogo.png\n10\t0\tdocs/b.md\n')).toEqual({ added: 13, removed: 1 })
  expect(numstatTotals('')).toEqual({ added: 0, removed: 0 })
})

test('untracked names split on NUL, an empty listing none', () => {
  expect(untrackedNames('new.ts\0docs/a b.md\0')).toEqual(['new.ts', 'docs/a b.md'])
  expect(untrackedNames('')).toEqual([])
})

const REPO = { now: 0, repo: { root: '/w' }, files: { '.git/HEAD': { text: 'ref: refs/heads/main\n', mtimeMs: 0 }, '/w/new.ts': { text: 'a\nb\nc\n', mtimeMs: 0 } } }

test('session start counts the changes off the hook, from the repository folder, with a 2 s timeout', async ($, on) => {
  const kit = stubAll(on, { ...REPO, diff: '3\t1\ta.ts\n', untracked: 'new.ts\0' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(0)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main', changes: { added: 6, removed: 1 } })
  expect(kit.changes.argv[0]).toEqual(['git', '--no-optional-locks', 'diff', '--numstat', 'HEAD'])
  expect(kit.changes.argv[1]).toEqual(['git', '--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z'])
  expect([kit.changes.cwd, kit.changes.timeoutMs]).toEqual(['/w', 2000])
})

test('an edit counts again; a refused diff leaves the place without changes', async ($, on) => {
  const kit = stubAll(on, { ...REPO, diff: '1\t0\ta.ts\n', untracked: '' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(0)
  expect(metaOf(state).place?.changes).toEqual({ added: 1, removed: 0 })
  kit.changes.diff = '4\t2\ta.ts\n'
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'x', new_string: 'y', tool_use_id: 'e1' })
  await kit.clock.advance(0)
  expect(metaOf(state).place?.changes).toEqual({ added: 4, removed: 2 })
  kit.changes.diff = undefined
  await kit.clock.advance(30_000)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main' })
})

// Commits ahead of and behind the upstream (the user, 2026-11-12: 'git:(band-order) arrow-up-symbol 1
// arrow-down-symbol 2'): `git rev-list --left-right --count @{upstream}...HEAD` prints behind, a tab, then ahead
test('rev-list counts read as behind then ahead; anything else is none', () => {
  expect(aheadBehind('2\t1\n')).toEqual({ ahead: 1, behind: 2 })
  expect(aheadBehind('0\t0\n')).toEqual({ ahead: 0, behind: 0 })
  for (const bad of ['', 'x\t1\n', '1\n', '1 2\n']) expect(aheadBehind(bad)).toBe(null)
})

test('the count reads ahead and behind from the repository folder, with a 2 s timeout, and never fetches', async ($, on) => {
  const kit = stubAll(on, { ...REPO, diff: '3\t1\ta.ts\n', untracked: '', revList: '2\t1\n' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(0)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main', changes: { added: 3, removed: 1 }, sync: { ahead: 1, behind: 2 } })
  const revList = kit.changes.argv.find(a => a.includes('rev-list'))
  expect(revList).toEqual(['git', '--no-optional-locks', 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  expect(kit.changes.argv.some(a => a.includes('fetch'))).toBe(false)
  // A branch with no upstream, or a refused call, leaves them out; the changes stay
  kit.changes.revList = undefined
  await kit.clock.advance(30_000)
  expect(metaOf(state).place).toEqual({ project: 'w', branch: 'main', changes: { added: 3, removed: 1 } })
})
