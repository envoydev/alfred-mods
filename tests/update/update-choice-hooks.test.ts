// /alfred-mods:update under the choices that read no plan file of the mod's (the user, 2026-11-25): .alfred and
// default make no folder, add no .gitignore line and move nothing
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { FileStub } from '../kit'
import { START, engine, stubAll } from '../kit'
import { planText } from '../plans'

const NOW = 1_800_000_000_000
const OLD = NOW - 100 * 3_600_000
const OLD_PLANS = '.claude/session-inspector/plans'
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
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

for (const folder of ['.alfred', 'default']) {
  test(`with plansFolder ${folder} update makes no folder, adds no .gitignore line and moves nothing`, async ($, on) => {
    const { files, rm } = await start($, on, {
      sources: { project: mod({ plansFolder: folder }) },
      files: { [`${OLD_PLANS}/a.json`]: stub(DONE), '.alfred-mods/plans/b.json': stub(DONE), '.gitignore': stub('node_modules\n') },
    })
    expect(await alfred($, 'update')).toEqual([
      `1 plan or scores file in .claude/session-inspector/ is not shown under plansFolder "${folder}" - /alfred-mods:init .alfred-mods moves it`,
      'update done',
    ])
    expect(files.writes).toEqual([])
    expect(rm.calls).toEqual([])
  })
}

test('under .alfred each old folder that still holds plan or scores files is named, with its count', async ($, on) => {
  await start($, on, {
    sources: { project: mod({ plansFolder: '.alfred' }) },
    files: { '.alfred/alfred-mods/plans/a.json': stub(DONE), '.alfred/alfred-mods/scores/a.json': stub('{}'), '.alfred/alfred-mods/plans/note.md': stub('x') },
  })
  expect(await alfred($, 'update')).toEqual([
    '2 plan and scores files in .alfred/alfred-mods/ are not shown under plansFolder ".alfred" - /alfred-mods:init .alfred-mods moves them',
    'update done',
  ])
})

test('init .alfred never makes .alfred/alfred-mods: nothing moves and .gitignore stays', async ($, on) => {
  const { files, rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.gitignore': stub('x\n') } })
  const lines = await alfred($, 'init', '.alfred')
  expect(lines.some(line => line.startsWith('moved') || line.startsWith('added'))).toBe(false)
  expect(files.writes.filter(path => !path.endsWith('.claude/settings.json'))).toEqual([])
  expect(rm.calls).toEqual([])
})

test('a linked old root is counted once, and one that is claude-kit\'s folder under another name is not named', async ($, on) => {
  await start($, on, {
    sources: { project: mod({ plansFolder: 'default' }) },
    files: { '.alfred-mods/plans/k.json': stub(DONE), '.claude/session-inspector/plans/a.json': stub(DONE) },
    aliases: { '.alfred/alfred-mods': '.alfred-mods' },
  })
  expect(await alfred($, 'update')).toEqual([
    '1 plan or scores file in .claude/session-inspector/ is not shown under plansFolder "default" - /alfred-mods:init .alfred-mods moves it',
    'update done',
  ])
})

test('two old roots that are one folder are named once', async ($, on) => {
  await start($, on, {
    sources: { project: mod({ plansFolder: '.alfred' }) },
    files: { '.alfred/alfred-mods/plans/a.json': stub(DONE) },
    aliases: { '.claude/session-inspector': '.alfred/alfred-mods' },
  })
  expect(await alfred($, 'update')).toEqual([
    '1 plan or scores file in .claude/session-inspector/ is not shown under plansFolder ".alfred" - /alfred-mods:init .alfred-mods moves it',
    'update done',
  ])
})
