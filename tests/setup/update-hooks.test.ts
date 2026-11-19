// /alfred-mods update: plan and scores files moved into the chosen root, the .gitignore line and what old versions left
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { FileStub } from '../kit'
import { START, engine, fileAt, stubAll } from '../kit'
import { planText } from '../plans'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000
const OLD = NOW - 100 * HOUR
const OLD_PLANS = '.claude/session-inspector/plans'
const OLD_SCORES = '.claude/session-inspector/scores'
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
const PENDING = planText({ S1: 'done' })
const SCORES = '{"version":1,"slug":"p"}'
const LEFT = 'left in place: p - its writer still uses it; run /alfred-mods update after it finishes'
const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })
const stub = (text: string, mtimeMs = OLD): FileStub => ({ text, mtimeMs })

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, ...o })
  engine(on)
  await $.session.start(START)
  return kit
}
const alfred = async ($: Engine, args: string): Promise<string[]> =>
  ((await $.command.run({ command: 'alfred-mods', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? '').split('\n')

test('a plan in the old folder moves to the chosen root and one rm gets its path', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) } })
  expect(await alfred($, 'update')).toEqual(['moved 1 plan and scores files to .alfred-mods/', 'update done'])
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
  expect((await alfred($, 'update'))[0]).toBe('moved 1 plan and scores files to .alfred-mods/')
  expect(rm.calls).toHaveLength(1)
})

test('a plan that does not parse counts as live and stays', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub('{ not json') } })
  expect(await alfred($, 'update')).toEqual([LEFT, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a copy whose read-back differs is not in the rm', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, mangleWrite: ['.alfred-mods/plans/p.json'] })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
  expect(rm.calls).toEqual([])
})

test('a source whose stat changes between the copy and the delete is not in the rm', async ($, on) => {
  let writes: () => number = () => 0
  const changing: FileStub = { text: DONE, get mtimeMs() { return writes() > 0 ? OLD + 1 : OLD } }
  const kit = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: changing, [`${OLD_PLANS}/q.json`]: stub(DONE) } })
  writes = () => kit.files.writes.length
  // Listed before the copy, both at OLD; the first copy's write moves p.json's mtime on
  expect(await alfred($, 'update')).toEqual(['moved 1 plan and scores files to .alfred-mods/', 'update done'])
  expect(kit.rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
})

test('rm denied prints the by-hand line and the sources stay', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, rm: { deny: true } })
  expect(await alfred($, 'update')).toEqual([
    'copied 1 files to .alfred-mods/ - remove the old copies in .claude/session-inspector/ by hand', 'update done',
  ])
  expect(rm.calls).toHaveLength(1)
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(DONE)
})

test('rm that exits non-zero prints the by-hand line', async ($, on) => {
  await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE) }, rm: { exitCode: 1 } })
  expect((await alfred($, 'update'))[0]).toContain('copied 1 files to .alfred-mods/ - remove the old copies in')
})

test('a name the chosen root already holds prints kept both and moves nothing', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) } })
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(rm.calls).toEqual([])
})

test('51 files print the cap line and move 50', async ($, on) => {
  const many: Record<string, FileStub> = {}
  for (let i = 0; i < 51; i++) many[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  const { rm } = await start($, on, { files: many })
  expect(await alfred($, 'update')).toEqual(['moved 50 plan and scores files to .alfred-mods/', 'more to move - run /alfred-mods update again', 'update done'])
  expect(rm.calls[0]).toHaveLength(3 + 50)
})

test('the files of every other root move, whichever root is chosen', async ($, on) => {
  const { rm } = await start($, on, {
    sources: { project: mod({ plansFolder: '.alfred' }) },
    files: { [`${OLD_PLANS}/a.json`]: stub(DONE), '.alfred-mods/plans/b.json': stub(DONE) },
  })
  expect((await alfred($, 'update'))[0]).toBe('moved 2 plan and scores files to .alfred/alfred-mods/')
  expect(rm.calls[0]?.slice(3).sort()).toEqual([`${OLD_PLANS}/a.json`, '.alfred-mods/plans/b.json'].sort())
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

test('an enabledPlugins key for the old install prints the uninstall line', async ($, on) => {
  await start($, on, { sources: { user: { enabledPlugins: { 'session-inspector@envoydev': true, 'alfred-mods@envoydev': true } } } })
  expect(await alfred($, 'update')).toEqual([
    'an old session-inspector install is still on - claude plugin uninstall session-inspector@envoydev', 'update done',
  ])
})

test('an old install key set false prints nothing', async ($, on) => {
  await start($, on, { sources: { project: { enabledPlugins: { 'session-inspector@envoydev': false } } } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
})

test('old Alfred Code status files print their count while the new folder exists', async ($, on) => {
  await start($, on, {
    files: {
      '.alfred/state/sessions/status/s.json': stub('{}'),
      '.claude/session-inspector/status/a.json': stub('{}'), '.claude/session-inspector/status/b.json': stub('{}'),
    },
  })
  expect(await alfred($, 'update')).toEqual([
    '2 status files from Alfred Code 3.12.1 or older in .claude/session-inspector/status/ - safe to delete', 'update done',
  ])
})

test('old status files print nothing while the new folder is missing', async ($, on) => {
  await start($, on, { files: { '.claude/session-inspector/status/a.json': stub('{}') } })
  expect(await alfred($, 'update')).toEqual(['nothing to update'])
})

test('an earlier choice from before 0.8 is written to the user file', async ($, on) => {
  const { files } = await start($, on, { env: { HOME: '/home/u' }, store: { 'settings:rec': 'on' } })
  expect(await alfred($, 'update')).toEqual(['wrote your earlier choices to ~/.claude/settings.json: rec', 'update done'])
  expect(JSON.parse(fileAt(files, '/home/u/.claude/settings.json') ?? '{}')).toEqual({ 'alfred-mods': { rec: 'on' } })
})

test('init .alfred moves into the folder just written and adds that root to .gitignore, whatever the settings in force say', async ($, on) => {
  const { files, rm } = await start($, on, {
    sources: { project: mod({ plansFolder: 'default' }) }, files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.gitignore': stub('x\n') },
  })
  const lines = await alfred($, 'init .alfred')
  expect(lines).toContain('moved 1 plan and scores files to .alfred/alfred-mods/')
  expect(lines).toContain('added .alfred/alfred-mods/ to .gitignore')
  expect(fileAt(files, '.alfred/alfred-mods/plans/p.json')).toBe(DONE)
  expect(fileAt(files, '.gitignore')).toBe('x\n.alfred/alfred-mods/\n')
  expect(rm.calls).toHaveLength(1)
})
