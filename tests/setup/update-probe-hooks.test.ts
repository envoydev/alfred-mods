// /alfred-mods:update's probe and what it leaves: the cap beside it, a name that is taken, an rm that fails part way,
// and a plan that cannot be read
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { FileStub } from '../kit'
import { START, engine, stubAll } from '../kit'
import { planText } from '../plans'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000
const OLD = NOW - 100 * HOUR
const OLD_PLANS = '.claude/session-inspector/plans'
const OLD_SCORES = '.claude/session-inspector/scores'
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
const SCORES = '{"version":1,"slug":"p"}'
const PROBE = '.alfred-mods-probe-'
const MORE = 'more to move - run /alfred-mods:update again'
const SAME_PLANS = 'not moved: .claude/session-inspector/plans/ is the same folder as .alfred-mods/plans/'
const stub = (text: string, mtimeMs = OLD): FileStub => ({ text, mtimeMs })
const isProbe = (path: string): boolean => path.includes(PROBE)
const unreadable = (text: string): FileStub => ({ text, mtimeMs: OLD, size: 5 * 1024 * 1024 })

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, ...o })
  engine(on)
  await $.session.start(START)
  return kit
}
const alfred = async ($: Engine, verb: string, args = ''): Promise<string[]> =>
  ((await $.command.run({ command: `alfred-mods:${verb}`, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? '').split('\n')
const plansNamed = (count: number, from = 0): Record<string, string> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${String(i + from).padStart(3, '0')}.json`, DONE]))

test('more than 50 equal plans in a folder the probe shows is the chosen one print no more line and name the folder', async ($, on) => {
  const files: Record<string, FileStub> = {}
  for (const name of Object.keys(plansNamed(51))) files[`.alfred-mods/plans/${name}`] = stub(DONE)
  const { rm } = await start($, on, { files, mirrors: { '.claude/session-inspector': { to: '.alfred-mods' } } })
  expect(await alfred($, 'update')).toEqual([SAME_PLANS, 'update done'])
  expect(rm.calls).toHaveLength(1)
  expect(rm.calls[0]?.slice(3).every(isProbe)).toBe(true)
})

test('equal plans that the probe proves separate fill the cap, and the rest wait behind a more line', async ($, on) => {
  const files: Record<string, FileStub> = {}
  for (const name of Object.keys(plansNamed(51))) {
    files[`${OLD_PLANS}/${name}`] = stub(DONE)
    files[`.alfred-mods/plans/${name}`] = stub(DONE)
  }
  const { rm } = await start($, on, { files })
  expect(await alfred($, 'update')).toEqual(['moved 50 plan and scores files to .alfred-mods/', MORE, 'update done'])
  expect(rm.calls[0]?.slice(3).filter(path => !isProbe(path))).toHaveLength(50)
})

test('an rm that fails part way names only the sources and probes that are still there', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE), [`${OLD_PLANS}/q.json`]: stub(DONE), '.alfred-mods/plans/q.json': stub(DONE) },
    rm: { exitCode: 1, removes: [`${PROBE}*`, `${OLD_PLANS}/p.json`] },
  })
  expect(await alfred($, 'update')).toEqual([
    'moved 1 plan or scores file to .alfred-mods/', 'copied 1 file to .alfred-mods/ - remove the old copy in .claude/session-inspector/plans/ by hand', 'update done',
  ])
  expect(rm.calls).toHaveLength(1)
})

test('a probe that the failed rm left is named, and a probe it removed is not', async ($, on) => {
  const kit = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, rm: { exitCode: 1, removes: [`${OLD_PLANS}/p.json`] },
  })
  const lines = await alfred($, 'update')
  const probe = kit.rm.calls[0]?.find(isProbe) ?? ''
  expect(probe.startsWith('.alfred-mods/plans/')).toBe(true)
  expect(lines).toEqual(['moved 1 plan or scores file to .alfred-mods/', `could not remove ${probe} - delete it by hand`, 'update done'])
})

test('a plan clash whose source cannot be read prints the could-not-read line, not kept both', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: unreadable(DONE), '.alfred-mods/plans/p.json': stub(DONE) } })
  expect(await alfred($, 'update')).toEqual(['left in place: p - could not read it', 'update done'])
  expect(rm.calls).toEqual([])
})

test('a scores clash whose source cannot be read prints the could-not-read line, not kept both', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_SCORES}/p.json`]: unreadable(SCORES), '.alfred-mods/scores/p.json': stub(SCORES) } })
  expect(await alfred($, 'update')).toEqual(['left in place: p - could not read it', 'update done'])
  expect(rm.calls).toEqual([])
})

test('an unreadable scores clash never hides the kept-both line of the plan of its name', async ($, on) => {
  const { rm } = await start($, on, {
    files: {
      [`${OLD_PLANS}/p.json`]: stub(planText({ S1: 'done' })), '.alfred-mods/plans/p.json': stub(DONE),
      [`${OLD_SCORES}/p.json`]: unreadable(SCORES), '.alfred-mods/scores/p.json': stub(SCORES),
    },
  })
  expect(await alfred($, 'update')).toEqual(['left in place: p - could not read it', 'kept both: p (the newer one shows)', 'update done'])
  expect(rm.calls).toEqual([])
})

test('where rm does not run, no probe is written and the equal copies are kept both, run after run', async ($, on) => {
  const { rm, files } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, rm: { deny: true } })
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(files.writes.some(isProbe)).toBe(false)
  expect(rm.calls).toEqual([])
  expect(rm.checks).toBe(2)
})

test('a probe name that is taken is replaced once, and the equal copy is then removed', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, taken: { [`.alfred-mods/plans/${PROBE}*`]: 1 },
  })
  expect(await alfred($, 'update')).toEqual(['moved 1 plan or scores file to .alfred-mods/', 'update done'])
  expect(rm.calls[0]?.slice(3)).toContain(`${OLD_PLANS}/p.json`)
  expect(files.writes.filter(isProbe)).toHaveLength(1)
})

test('a probe name taken twice keeps every equal copy and writes no probe', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, taken: { [`.alfred-mods/plans/${PROBE}*`]: 2 },
  })
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes.filter(isProbe)).toEqual([])
})

test('a check of the probe name that rejects keeps every equal copy and writes no probe', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, refuseExists: [`.alfred-mods/plans/${PROBE}*`],
  })
  expect(await alfred($, 'update')).toEqual(['kept both: p (the newer one shows)', 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes.filter(isProbe)).toEqual([])
})
