// /alfred-mods:update: plan and scores files moved into the chosen root, the .gitignore line and what old versions left
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { FileStub } from '../kit'
import { START, engine, fileAt, stubAll, watchState } from '../kit'
import { isPlanRunning, shownPlan } from '../../hooks/plan/plan'
import type { Plans } from '../../hooks/plan/types'
import { PLAN_JSON, planText } from '../plans'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000
const OLD = NOW - 100 * HOUR
const OLD_PLANS = '.claude/session-inspector/plans'
const OLD_SCORES = '.claude/session-inspector/scores'
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
const PENDING = planText({ S1: 'done' })
const SCORES = '{"version":1,"slug":"p"}'
const LEFT = 'left in place: p - its writer still uses it; run /alfred-mods:update after it finishes'
const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })
const stub = (text: string, mtimeMs = OLD): FileStub => ({ text, mtimeMs })

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, ...o })
  engine(on)
  await $.session.start(START)
  return kit
}
const alfred = async ($: Engine, verb: string, args = ''): Promise<string[]> =>
  ((await $.command.run({ command: `alfred-mods:${verb}`, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? '').split('\n')

test('a plan in the old folder moves to the chosen root and one rm gets its path', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) } })
  expect(await alfred($, 'update')).toEqual(['moved 1 plan or scores file to .alfred-mods/', 'update done'])
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(DONE)
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/p.json`]])
  expect(rm.timeoutMs).toBe(3000)
})

test('a plan and its scores move together, one rm for both', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_SCORES}/p.json`]: stub(SCORES) } })
  expect((await alfred($, 'update'))[0]).toBe('moved 2 plan and scores files to .alfred-mods/')
  expect(fileAt(files, '.alfred-mods/scores/p.json')).toBe(SCORES)
  expect(rm.calls).toHaveLength(1)
  expect(rm.calls[0]).toEqual(['rm', '-f', '--', `${OLD_PLANS}/p.json`, `${OLD_SCORES}/p.json`])
})

test('a live plan and its scores stay, and the left in place line prints', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES) } })
  expect(await alfred($, 'update')).toEqual([LEFT, 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes).toEqual([])
})

test('an unfinished plan 25 hours old moves', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - 25 * HOUR) } })
  expect((await alfred($, 'update'))[0]).toBe('moved 1 plan or scores file to .alfred-mods/')
  expect(rm.calls).toHaveLength(1)
})

test('a plan that does not parse counts as live inside the window and stays', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub('{ not json', NOW - HOUR) } })
  expect(await alfred($, 'update')).toEqual([LEFT, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a copy whose read-back differs is named, its destination is left as found and never in the rm, and its source stays', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_PLANS}/q.json`]: stub(DONE) }, mangleWrite: ['.alfred-mods/plans/p.json'],
  })
  expect(await alfred($, 'update')).toEqual([
    'not moved: p - its copy did not read back equal; check .alfred-mods/plans/', 'moved 1 plan or scores file to .alfred-mods/', 'update done',
  ])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(`${DONE}\n#`)
})

test('a write that throws is named, leaves no destination in the rm and keeps the source', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, refuseWrite: ['.alfred-mods/plans/p.json'] })
  expect(await alfred($, 'update')).toEqual(['not moved: p - its copy did not read back equal; check .alfred-mods/plans/', 'update done'])
  expect(rm.calls).toEqual([])
})

test('a plan whose copy did not read back equal keeps its scores in place too', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_SCORES}/p.json`]: stub(SCORES) }, mangleWrite: ['.alfred-mods/plans/p.json'],
  })
  expect(await alfred($, 'update')).toEqual(['not moved: p - its copy did not read back equal; check .alfred-mods/plans/', 'update done'])
  expect(rm.calls).toEqual([])
})

test('a check of the destination that rejects is not moved for that name, and the others still move', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_PLANS}/q.json`]: stub(DONE) }, refuseExists: ['.alfred-mods/plans/p.json'],
  })
  expect(await alfred($, 'update')).toEqual(['not moved: p - could not check the destination', 'moved 1 plan or scores file to .alfred-mods/', 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
})

test('the scores stay with a live plan of their own root, whatever plan of that name is newer elsewhere', async ($, on) => {
  const { rm } = await start($, on, {
    files: {
      [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - 2 * HOUR), '.alfred/alfred-mods/plans/p.json': stub(DONE, NOW - HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES),
    },
  })
  const lines = await alfred($, 'update')
  expect(lines).toContain(LEFT)
  expect(rm.calls).toEqual([['rm', '-f', '--', '.alfred/alfred-mods/plans/p.json']])
})

test('a live clashing plan prints left in place and not kept both', async ($, on) => {
  await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - HOUR), '.alfred-mods/plans/p.json': stub(PENDING, NOW - HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES) },
  })
  expect(await alfred($, 'update')).toEqual([LEFT, 'update done'])
})

test('a source whose stat changes between the copy and the delete is not in the rm', async ($, on) => {
  let writes: () => number = () => 0
  const changing: FileStub = { text: DONE, get mtimeMs() { return writes() > 0 ? OLD + 1 : OLD } }
  const kit = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: changing, [`${OLD_PLANS}/q.json`]: stub(DONE) } })
  writes = () => kit.files.writes.length
  // Listed before the copy, both at OLD; the first copy's write moves p.json's mtime on
  expect(await alfred($, 'update')).toEqual(['moved 1 plan or scores file to .alfred-mods/', 'update done'])
  expect(kit.rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
})

test('rm denied prints the by-hand line and the sources stay', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, rm: { deny: true } })
  expect(await alfred($, 'update')).toEqual([
    'copied 1 file to .alfred-mods/ - remove the old copy in .claude/session-inspector/plans/ by hand', 'update done',
  ])
  expect(rm.calls).toHaveLength(1)
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(DONE)
})

test('rm that exits non-zero prints the by-hand line', async ($, on) => {
  await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, rm: { exitCode: 1 } })
  expect((await alfred($, 'update'))[0]).toContain('copied 1 file to .alfred-mods/ - remove the old copy in')
})

test('a name the chosen root already holds, with other text, prints kept both and moves nothing', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(PENDING) } })
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(rm.calls).toEqual([])
})

test('51 files print the cap line and move 50', async ($, on) => {
  const many: Record<string, FileStub> = {}
  for (let i = 0; i < 51; i++) many[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  const { rm } = await start($, on, { files: many })
  expect(await alfred($, 'update')).toEqual(['moved 50 plan and scores files to .alfred-mods/', 'more to move - run /alfred-mods:update again', 'update done'])
  expect(rm.calls[0]).toHaveLength(3 + 50)
})

test('the files of both other roots move into claude-kit\'s .alfred-mods', async ($, on) => {
  const { rm } = await start($, on, {
    sources: { project: mod({ plansFolder: '.alfred-mods' }) },
    files: { [`${OLD_PLANS}/a.json`]: stub(DONE), '.alfred/alfred-mods/plans/b.json': stub(DONE) },
  })
  expect((await alfred($, 'update'))[0]).toBe('moved 2 plan and scores files to .alfred-mods/')
  expect(rm.calls[0]?.slice(3).sort()).toEqual([`${OLD_PLANS}/a.json`, '.alfred/alfred-mods/plans/b.json'].sort())
})

test('a .gitignore without a line for the root gets one, and the line prints', async ($, on) => {
  const { files } = await start($, on, { files: { '.gitignore': stub('node_modules') } })
  expect(await alfred($, 'update')).toEqual(['added .alfred-mods/ to .gitignore', 'update done'])
  expect(fileAt(files, '.gitignore')).toBe('node_modules\n.alfred-mods/\n')
})

test('no .gitignore makes none', async ($, on) => {
  const { files } = await start($, on)
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(files.writes).not.toContain('.gitignore')
})

test('a .gitignore with /.alfred/ adds nothing for .alfred', async ($, on) => {
  const { files } = await start($, on, { sources: { project: mod({ plansFolder: '.alfred' }) }, files: { '.gitignore': stub('/.alfred/\n') } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(files.writes).toEqual([])
})

test('the default folder adds no .gitignore line', async ($, on) => {
  const { files } = await start($, on, { sources: { project: mod({ plansFolder: 'default' }) }, files: { '.gitignore': stub('node_modules\n') } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(fileAt(files, '.gitignore')).toBe('node_modules\n')
})

const OLD_KEY = 'session-inspector@envoydev'
const USER_FILE = '/home/u/.claude/settings.json'
const HOME = { HOME: '/home/u' }
const withKey = (value: boolean, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ theme: 'dark', enabledPlugins: { 'alfred-mods@envoydev': true, [OLD_KEY]: value }, ...extra }, null, 2)}\n`
const turnedOff = (file: string): string => `turned off the old session-inspector install in ${file} - claude plugin uninstall ${OLD_KEY} removes its files`
const OLD_LINE = `an old session-inspector install is still on - claude plugin uninstall ${OLD_KEY}`

test('an old install key set true in the user file is turned off there, every other key kept', async ($, on) => {
  const { files } = await start($, on, { env: HOME, sources: { user: { enabledPlugins: { [OLD_KEY]: true } } }, files: { [USER_FILE]: stub(withKey(true)) } })
  expect(await alfred($, 'update')).toEqual([turnedOff(USER_FILE), 'update done'])
  expect(fileAt(files, USER_FILE)).toBe(withKey(false))
})

test('an old install key set true in the project and local files is turned off in each', async ($, on) => {
  const { files } = await start($, on, {
    sources: { project: { enabledPlugins: { [OLD_KEY]: true } }, local: { enabledPlugins: { [OLD_KEY]: true } } },
    files: { '.claude/settings.json': stub(withKey(true)), '.claude/settings.local.json': stub(withKey(true, { model: 'opus' })) },
  })
  expect(await alfred($, 'update')).toEqual([turnedOff('.claude/settings.json'), turnedOff('.claude/settings.local.json'), 'update done'])
  expect(fileAt(files, '.claude/settings.json')).toBe(withKey(false))
  expect(fileAt(files, '.claude/settings.local.json')).toBe(withKey(false, { model: 'opus' }))
})

test('the user file under CLAUDE_CONFIG_DIR is the one turned off when that folder is set, and the line names that path', async ($, on) => {
  const { files } = await start($, on, { env: { ...HOME, CLAUDE_CONFIG_DIR: '/cfg' }, sources: { user: { enabledPlugins: { [OLD_KEY]: true } } }, files: { '/cfg/settings.json': stub(withKey(true)) } })
  expect(await alfred($, 'update')).toEqual([turnedOff('/cfg/settings.json'), 'update done'])
  expect(fileAt(files, '/cfg/settings.json')).toBe(withKey(false))
})

test('an old install key set false, or in no file, prints nothing and writes nothing', async ($, on) => {
  const { files } = await start($, on, { sources: { project: { enabledPlugins: { [OLD_KEY]: false } } }, files: { '.claude/settings.json': stub(withKey(false)) } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(files.writes).toEqual([])
})

test('a key set true by policy only keeps the uninstall line and writes nothing', async ($, on) => {
  const { files } = await start($, on, { sources: { policy: { enabledPlugins: { [OLD_KEY]: true } } } })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(files.writes).toEqual([])
})

test('a key set true by a flag only keeps the uninstall line and writes nothing', async ($, on) => {
  const { files } = await start($, on, { sources: { flag: { enabledPlugins: { [OLD_KEY]: true } } } })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(files.writes).toEqual([])
})

test('a key set true in the user file and by policy is turned off in the file and still named, as policy keeps it on', async ($, on) => {
  await start($, on, {
    env: HOME, sources: { user: { enabledPlugins: { [OLD_KEY]: true } }, policy: { enabledPlugins: { [OLD_KEY]: true } } }, files: { [USER_FILE]: stub(withKey(true)) },
  })
  expect(await alfred($, 'update')).toEqual([turnedOff(USER_FILE), OLD_LINE, 'update done'])
})

test('a committed file keeps its own formatting: only the one value changes', async ($, on) => {
  const text = `{\r\n    "model":"opus",\r\n    "enabledPlugins":{ "a@x":true,\r\n      "${OLD_KEY}":   true },\r\n    "hooks": {}\r\n}`
  const { files } = await start($, on, { sources: { project: { enabledPlugins: { [OLD_KEY]: true } } }, files: { '.claude/settings.json': stub(text) } })
  expect(await alfred($, 'update')).toEqual([turnedOff('.claude/settings.json'), 'update done'])
  expect(fileAt(files, '.claude/settings.json')).toBe(text.replace('true }', 'false }'))
})

test('a file that names the key set true twice is not written, and keeps the uninstall line', async ($, on) => {
  const text = `{ "enabledPlugins": { "${OLD_KEY}": true }, "extra": { "${OLD_KEY}": true } }\n`
  const { files } = await start($, on, { sources: { project: { enabledPlugins: { [OLD_KEY]: true } } }, files: { '.claude/settings.json': stub(text) } })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(files.writes).toEqual([])
})

test('a write that fails keeps the uninstall line', async ($, on) => {
  const { files } = await start($, on, { env: HOME, sources: { user: { enabledPlugins: { [OLD_KEY]: true } } }, files: { [USER_FILE]: stub(withKey(true)) }, refuseWrite: [USER_FILE] })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(fileAt(files, USER_FILE)).toBe(withKey(true))
})

test('a file that does not parse, or whose enabledPlugins is no object, is never rewritten', async ($, on) => {
  const { files } = await start($, on, {
    sources: { project: { enabledPlugins: { [OLD_KEY]: true } }, local: { enabledPlugins: { [OLD_KEY]: true } } },
    files: { '.claude/settings.json': stub('{ not json'), '.claude/settings.local.json': stub('{ "enabledPlugins": [true] }') },
  })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(files.writes).toEqual([])
})

test('the file is read right before the write: a key that is no longer true there is not written', async ($, on) => {
  const { files } = await start($, on, { sources: { project: { enabledPlugins: { [OLD_KEY]: true } } }, files: { '.claude/settings.json': stub(withKey(false)) } })
  expect(await alfred($, 'update')).toEqual([OLD_LINE, 'update done'])
  expect(files.writes).toEqual([])
})

const UPDATE_STACK = 'this session\'s Alfred Code still writes .claude/session-inspector/status/ - update Alfred Code to 3.13 or later'
const OLD_STATUS = '.claude/session-inspector/status'
const NEW_STATUS = '.alfred/state/sessions/status'
const REMOVED = (count: number): string => `removed ${count} status file${count === 1 ? '' : 's'} from Alfred Code 3.12.1 or older`
const BY_HAND = (count: number): string =>
  `${count} status file${count === 1 ? '' : 's'} from Alfred Code 3.12.1 or older in .claude/session-inspector/status/ - delete ${count === 1 ? 'it' : 'them'} by hand`

test('old Alfred Code status files are removed by the one rm while the new folder exists', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/b.json`]: stub('{}') },
    rm: { removes: [`${OLD_STATUS}/a.json`, `${OLD_STATUS}/b.json`] },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(2), 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_STATUS}/a.json`, `${OLD_STATUS}/b.json`]])
  expect(rm.timeoutMs).toBe(3000)
  expect(fileAt(files, `${NEW_STATUS}/s.json`)).toBe('{}')
})

test('one status file removed reads in the singular', async ($, on) => {
  await start($, on, { files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}') }, rm: { removes: [`${OLD_STATUS}/a.json`] } })
  expect(await alfred($, 'update')).toEqual([REMOVED(1), 'update done'])
})

test('only *.json files directly in the old status folder go; HANDOFF.md, other files and a folder stay', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: {
      [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/notes.txt`]: stub('x'), [`${OLD_STATUS}/deep/c.json`]: stub('{}'),
      '.claude/session-inspector/HANDOFF.md': stub('# handoff'), '.claude/session-inspector/other.json': stub('{}'),
    },
    rm: { removes: [`${OLD_STATUS}/a.json`] },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(1), 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_STATUS}/a.json`]])
  for (const kept of [`${OLD_STATUS}/notes.txt`, `${OLD_STATUS}/deep/c.json`, '.claude/session-inspector/HANDOFF.md', '.claude/session-inspector/other.json']) {
    expect(fileAt(files, kept)).toBeDefined()
  }
})

test('files the rm left are named to delete by hand', async ($, on) => {
  await start($, on, { files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/b.json`]: stub('{}') } })
  expect(await alfred($, 'update')).toEqual([BY_HAND(2), 'update done'])
})

test('an rm that removed some and exited non-zero names the removed and the left', async ($, on) => {
  await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/b.json`]: stub('{}') },
    rm: { exitCode: 1, removes: [`${OLD_STATUS}/a.json`] },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(1), BY_HAND(1), 'update done'])
})

test('where rm does not run, the old status files are named to delete by hand and no rm of them is tried', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/b.json`]: stub('{}') }, rm: { deny: true },
  })
  expect(await alfred($, 'update')).toEqual([BY_HAND(2), 'update done'])
  expect(rm.calls).toEqual([])
})

test('past the cap of 100 old status files a run, the rest wait for the next run', async ($, on) => {
  const names = Array.from({ length: 103 }, (_, i) => `a${String(i).padStart(3, '0')}.json`)
  const { rm } = await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), ...Object.fromEntries(names.map(name => [`${OLD_STATUS}/${name}`, stub('{}')])) },
    rm: { removes: names.slice(0, 100).map(name => `${OLD_STATUS}/${name}`) },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(100), '3 more old status files - run /alfred-mods:update again', 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', ...names.slice(0, 100).map(name => `${OLD_STATUS}/${name}`)]])
})

test('an old status file changed in the last 24 hours is left in place and named, the others go', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/live.json`]: stub('{}', NOW - HOUR) },
    rm: { removes: [`${OLD_STATUS}/a.json`] },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(1), '1 status file from Alfred Code 3.12.1 or older changed in the last 24 hours - left in place', 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_STATUS}/a.json`]])
  expect(fileAt(files, `${OLD_STATUS}/live.json`)).toBe('{}')
})

test('old status files that all changed in the last 24 hours run no rm', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/live.json`]: stub('{}', NOW - HOUR) } })
  expect(await alfred($, 'update')).toEqual(['1 status file from Alfred Code 3.12.1 or older changed in the last 24 hours - left in place', 'update done'])
  expect(rm.calls).toEqual([])
})

test('a plan to move and old status files go in the same one rm', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}') },
    rm: { removes: [`${OLD_PLANS}/p.json`, `${OLD_STATUS}/a.json`] },
  })
  expect(await alfred($, 'update')).toEqual(['moved 1 plan or scores file to .alfred-mods/', REMOVED(1), 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/p.json`, `${OLD_STATUS}/a.json`]])
})

test('a stack that still writes this session\'s file to the old folder gets the update line, and nothing there is removed', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${NEW_STATUS}/s.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/s1.json`]: stub('{}') },
  })
  expect(await alfred($, 'update')).toEqual([UPDATE_STACK, 'update done'])
  expect(rm.calls).toEqual([])
})

test('an old stack in a project that never had the new folder still gets the update line', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_STATUS}/s1.json`]: stub('{}') } })
  expect(await alfred($, 'update')).toEqual([UPDATE_STACK, 'update done'])
  expect(rm.calls).toEqual([])
})

test('once the stack writes this session\'s file to the new folder, its old copy goes with the rest', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${NEW_STATUS}/s1.json`]: stub('{}'), [`${OLD_STATUS}/a.json`]: stub('{}'), [`${OLD_STATUS}/s1.json`]: stub('{}') },
    rm: { removes: [`${OLD_STATUS}/a.json`, `${OLD_STATUS}/s1.json`] },
  })
  expect(await alfred($, 'update')).toEqual([REMOVED(2), 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_STATUS}/a.json`, `${OLD_STATUS}/s1.json`]])
})

test('old status files are left alone while the new folder is missing', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_STATUS}/a.json`]: stub('{}') } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(rm.calls).toEqual([])
})

test('an earlier choice from before 0.8 is written to the user file', async ($, on) => {
  const { files } = await start($, on, { env: { HOME: '/home/u' }, store: { 'settings:rec': 'on' } })
  expect(await alfred($, 'update')).toEqual(['wrote your earlier choices to ~/.claude/settings.json: rec', 'update done'])
  expect(JSON.parse(fileAt(files, '/home/u/.claude/settings.json') ?? '{}')).toEqual({ 'alfred-mods': { rec: 'on' } })
})

test('init .alfred-mods moves into the folder just written and adds it to .gitignore, whatever the settings in force say', async ($, on) => {
  const { files, rm } = await start($, on, {
    sources: { project: mod({ plansFolder: 'default' }) }, files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.gitignore': stub('x\n') },
  })
  const lines = await alfred($, 'init', '.alfred-mods')
  expect(lines).toContain('moved 1 plan or scores file to .alfred-mods/')
  expect(lines).toContain('added .alfred-mods/ to .gitignore')
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(DONE)
  expect(fileAt(files, '.gitignore')).toBe('x\n.alfred-mods/\n')
  expect(rm.calls).toHaveLength(1)
})

test('the scores of a live plan stay when the chosen root holds the plan name too', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - HOUR), '.alfred-mods/plans/p.json': stub(PENDING, NOW - HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES) },
  })
  const lines = await alfred($, 'update')
  expect(lines).toContain(LEFT)
  expect(lines.join('\n')).not.toContain('moved')
  expect(rm.calls).toEqual([])
})

test('a name that appears in the chosen root between the listing and the write is kept both, never overwritten', async ($, on) => {
  let isArmed = false
  let appear: () => void = () => undefined
  const racing: FileStub = { get text() { if (isArmed) appear(); return DONE }, mtimeMs: OLD }
  const kit = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: racing } })
  appear = () => { kit.files.current['.alfred-mods/plans/p.json'] = stub('written by a writer') }
  isArmed = true
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(fileAt(kit.files, '.alfred-mods/plans/p.json')).toBe('written by a writer')
  expect(kit.rm.calls).toEqual([])
})

test('50 plans and one scores file past the cap print the more line', async ($, on) => {
  const many: Record<string, FileStub> = { [`${OLD_SCORES}/s.json`]: stub(SCORES) }
  for (let i = 0; i < 50; i++) many[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  const { rm } = await start($, on, { files: many })
  expect(await alfred($, 'update')).toEqual(['moved 50 plan and scores files to .alfred-mods/', 'more to move - run /alfred-mods:update again', 'update done'])
  expect(rm.calls[0]).not.toContain(`${OLD_SCORES}/s.json`)
})

test('files are copied oldest first, so the moved files keep their order', async ($, on) => {
  const { files } = await start($, on, {
    files: { [`${OLD_PLANS}/b.json`]: stub(DONE, OLD + 2 * HOUR), [`${OLD_PLANS}/a.json`]: stub(DONE, OLD + 3 * HOUR), [`${OLD_PLANS}/c.json`]: stub(DONE, OLD + HOUR) },
  })
  await alfred($, 'update')
  expect(files.writes.filter(path => path.includes('.alfred-mods/plans/')).map(path => path.slice(path.lastIndexOf('/') + 1))).toEqual(['c.json', 'b.json', 'a.json'])
})

const plansOf = (state: { get(key: string): unknown }): Plans => state.get('plans') as Plans

test('a moved unfinished plan keeps its old time, so it does not read as running in the session that moved it', async ($, on) => {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, files: { [`${OLD_PLANS}/token-refresh.json`]: stub(PLAN_JSON) } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  expect((await alfred($, 'update'))[0]).toBe('moved 1 plan or scores file to .alfred-mods/')
  await kit.clock.advance(30_000)
  const plans = plansOf(state)
  const moved = plans.planFiles.find(file => file.path === '.alfred-mods/plans/token-refresh.json')
  expect(moved?.mtimeMs).toBe(OLD)
  expect(plans.planFiles.every(file => !isPlanRunning(file, plans.watchedSince))).toBe(true)
})

test('two moved plans keep their old order for the newest fallback', async ($, on) => {
  const kit = stubAll(on, {
    band: 'unset', quiet: 'unset', now: NOW,
    files: { [`${OLD_PLANS}/older.json`]: stub(DONE, OLD), [`${OLD_PLANS}/newer.json`]: stub(DONE, OLD + 10 * HOUR) },
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  await alfred($, 'update')
  await kit.clock.advance(30_000)
  const plans = plansOf(state)
  const shown = shownPlan(plans, null, false)
  expect(shown !== null && shown !== 'tasks' ? shown.name : null).toBe('newer')
  expect(plans.planFiles.find(file => file.name === 'older')?.mtimeMs).toBe(OLD)
})

test('a later write to a moved file clears the old time', async ($, on) => {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, files: { [`${OLD_PLANS}/p.json`]: stub(DONE) } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  await alfred($, 'update')
  await kit.clock.advance(30_000)
  kit.files.current['.alfred-mods/plans/p.json'] = stub(PENDING, NOW + 5000)
  await kit.clock.advance(30_000)
  expect(plansOf(state).planFiles.find(file => file.path === '.alfred-mods/plans/p.json')?.mtimeMs).toBe(NOW + 5000)
})

test('a user file that does not parse is named and no earlier choice is reported written', async ($, on) => {
  await start($, on, { env: { HOME: '/home/u' }, store: { 'settings:rec': 'on' }, files: { '/home/u/.claude/settings.json': stub('{ bad') } })
  const lines = await alfred($, 'update')
  expect(lines[0]).toContain('Nothing was written')
  expect(lines.join('\n')).not.toContain('wrote your earlier choices')
})

test('a listing between the copy and the rm shows the source time, not the copy', async ($, on) => {
  let seen: number | undefined
  let clock: { advance(ms: number): Promise<void> } | undefined
  const state = { get: (_key: string): unknown => undefined } as { get(key: string): unknown }
  const kit = stubAll(on, {
    band: 'unset', quiet: 'unset', now: NOW, files: { [`${OLD_PLANS}/token-refresh.json`]: stub(PLAN_JSON) },
    beforeRm: async () => {
      await clock?.advance(30_000)
      seen = plansOf(state).planFiles.find(file => file.path === '.alfred-mods/plans/token-refresh.json')?.mtimeMs
    },
  })
  clock = kit.clock
  Object.assign(state, watchState(on))
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  await alfred($, 'update')
  expect(seen).toBe(OLD)
})

test('a later write with the same mtime but another size clears the stand-in', async ($, on) => {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, files: { [`${OLD_PLANS}/p.json`]: stub(DONE) } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  await alfred($, 'update')
  await kit.clock.advance(30_000)
  kit.files.current['.alfred-mods/plans/p.json'] = stub(`${DONE} `, NOW)
  await kit.clock.advance(30_000)
  expect(plansOf(state).planFiles.find(file => file.path === '.alfred-mods/plans/p.json')?.mtimeMs).toBe(NOW)
})
