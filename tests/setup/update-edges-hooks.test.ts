// /alfred-mods:update edge cases: what counts toward the cap, a file that is not text, equal copies, a destination that
// cannot be checked, scores beside a plan that stays, a CRLF .gitignore and two moves in one session
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
const MOVED_ONE = 'moved 1 plan and scores files to .alfred-mods/'
const KEPT_P = 'kept both: p (the newer one shows)'
const KEPT_Q = 'kept both: q (the newer one shows)'
const stub = (text: string, mtimeMs = OLD): FileStub => ({ text, mtimeMs })
const PROBE = '.alfred-mods-probe-'
const isProbe = (path: string): boolean => path.includes(PROBE)
// The rm argv without the probe files that ride along, which have random names
const sourcesIn = (call: readonly string[] | undefined): string[] => (call ?? []).slice(3).filter(path => !isProbe(path))
const probesIn = (call: readonly string[] | undefined): string[] => (call ?? []).slice(3).filter(isProbe)

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, ...o })
  engine(on)
  await $.session.start(START)
  return kit
}
const alfred = async ($: Engine, verb: string, args = ''): Promise<string[]> =>
  ((await $.command.run({ command: `alfred-mods:${verb}`, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? '').split('\n')

test('50 movable plans and one live plan print no more line: a file that will not move is not counted', async ($, on) => {
  const files: Record<string, FileStub> = { [`${OLD_PLANS}/live.json`]: stub(PENDING, NOW - HOUR) }
  for (let i = 0; i < 50; i++) files[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  const { rm } = await start($, on, { files })
  expect(await alfred($, 'update')).toEqual([
    'left in place: live - its writer still uses it; run /alfred-mods:update after it finishes', 'moved 50 plan and scores files to .alfred-mods/', 'update done',
  ])
  expect(rm.calls[0]).toHaveLength(3 + 50)
})

test('50 movable plans and the scores of a live plan print no more line', async ($, on) => {
  const files: Record<string, FileStub> = { [`${OLD_PLANS}/live.json`]: stub(PENDING, NOW - HOUR), [`${OLD_SCORES}/live.json`]: stub(SCORES) }
  for (let i = 0; i < 50; i++) files[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  await start($, on, { files })
  expect((await alfred($, 'update')).join('\n')).not.toContain('more to move')
})

test('a source whose size differs from its text is not UTF-8 text: not copied, not removed, and its scores stay', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: { text: DONE, mtimeMs: OLD, size: DONE.length + 1 }, [`${OLD_SCORES}/p.json`]: stub(SCORES) },
  })
  expect(await alfred($, 'update')).toEqual(['not moved: p - not UTF-8 text', 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes).toEqual([])
})

test('a plan whose text has a multi-byte character moves when its size is the UTF-8 length', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE.replace('S1', 'Sé')) } })
  expect((await alfred($, 'update'))[0]).toBe(MOVED_ONE)
  expect(rm.calls).toHaveLength(1)
})

test('a name whose chosen copy is byte-equal has its source removed, with the scores moving beside it', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE), [`${OLD_SCORES}/p.json`]: stub(SCORES) },
  })
  expect(await alfred($, 'update')).toEqual(['moved 2 plan and scores files to .alfred-mods/', 'update done'])
  expect(rm.calls).toHaveLength(1)
  expect(rm.calls[0]?.slice(0, 3)).toEqual(['rm', '-f', '--'])
  expect(sourcesIn(rm.calls[0]).sort()).toEqual([`${OLD_PLANS}/p.json`, `${OLD_SCORES}/p.json`])
  // Only the plans folder holds an equal copy; the scores moved, so no probe goes into the scores folder
  expect(probesIn(rm.calls[0]).map(path => path.slice(0, path.indexOf(PROBE)))).toEqual(['.alfred-mods/plans/'])
  expect(files.writes.filter(isProbe)).toHaveLength(1)
})

test('a byte-equal scores copy has its source removed too', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_SCORES}/p.json`]: stub(SCORES), '.alfred-mods/scores/p.json': stub(SCORES) } })
  expect(await alfred($, 'update')).toEqual([MOVED_ONE, 'update done'])
  expect(sourcesIn(rm.calls[0])).toEqual([`${OLD_SCORES}/p.json`])
  expect(probesIn(rm.calls[0])).toHaveLength(1)
})

test('an equal copy of a live plan stays, and a clash that differs keeps both', async ($, on) => {
  const { rm } = await start($, on, {
    files: {
      [`${OLD_PLANS}/p.json`]: stub(PENDING, NOW - HOUR), '.alfred-mods/plans/p.json': stub(PENDING, NOW - HOUR),
      [`${OLD_PLANS}/q.json`]: stub(DONE), '.alfred-mods/plans/q.json': stub('written by a writer'),
    },
  })
  const lines = await alfred($, 'update')
  expect(lines).toContain('kept both: q (the newer one shows)')
  expect(lines.join('\n')).not.toContain('moved')
  expect(rm.calls).toEqual([])
})

test('an equal copy that is not UTF-8 text keeps both', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: { text: DONE, mtimeMs: OLD, size: DONE.length + 2 }, '.alfred-mods/plans/p.json': stub(DONE) },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a source that changes between the equal check and the rm is not removed', async ($, on) => {
  let writes: () => number = () => 0
  const racing: FileStub = { text: DONE, get mtimeMs() { return writes() > 0 ? OLD + 1 : OLD } }
  const kit = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: racing, [`${OLD_PLANS}/q.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) } })
  writes = () => kit.files.writes.length
  expect(await alfred($, 'update')).toEqual([MOVED_ONE, 'update done'])
  expect(sourcesIn(kit.rm.calls[0])).toEqual([`${OLD_PLANS}/q.json`])
})

test('a destination whose check rejects is not moved, never named as kept both, and its scores stay', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_SCORES}/p.json`]: stub(SCORES), [`${OLD_PLANS}/q.json`]: stub(DONE) },
    refuseExists: ['.alfred-mods/plans/p.json'],
  })
  expect(await alfred($, 'update')).toEqual(['not moved: p - could not check the destination', MOVED_ONE, 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
})

test('a copy whose stat rejects after an equal read-back is not removed from its source, and is named', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_PLANS}/q.json`]: stub(DONE) }, refuseStat: ['.alfred-mods/plans/p.json'],
  })
  expect(await alfred($, 'update')).toEqual(['not moved: p - could not check the copy', MOVED_ONE, 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_PLANS}/q.json`]])
  expect(fileAt(files, '.alfred-mods/plans/p.json')).toBe(DONE)
})

test('the scores of a plan whose chosen root holds another plan of that name stay beside it', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub('written by a writer'), [`${OLD_SCORES}/p.json`]: stub(SCORES) },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a CRLF .gitignore gets its line with CRLF', async ($, on) => {
  const { files } = await start($, on, { files: { '.gitignore': stub('node_modules\r\n') } })
  expect(await alfred($, 'update')).toEqual(['added .alfred-mods/ to .gitignore', 'update done'])
  expect(fileAt(files, '.gitignore')).toBe('node_modules\r\n.alfred-mods/\r\n')
})

test('two moves in one session never report the first move\'s copy as live', async ($, on) => {
  const { files } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(PENDING) } })
  expect(await alfred($, 'init', '.alfred')).toContain('moved 1 plan and scores files to .alfred/alfred-mods/')
  expect(fileAt(files, '.alfred/alfred-mods/plans/p.json')).toBe(PENDING)
  const second = (await alfred($, 'init', '.alfred-mods')).join('\n')
  expect(second).not.toContain('left in place')
  expect(second).toContain(MOVED_ONE)
})

const SAME = (root: string, kind: string): string => `not moved: ${root}/${kind}/ is the same folder as .alfred-mods/${kind}/`
const WHICH = (root: string, kind: string): string => `not moved: ${root}/${kind}/ - could not tell if it is the same folder as .alfred-mods/${kind}/`

test('a root that is a link to the chosen root is skipped whole, and no file is removed', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { '.alfred-mods/plans/p.json': stub(DONE), '.alfred-mods/scores/p.json': stub(SCORES) }, aliases: { '.claude/session-inspector': '.alfred-mods' },
  })
  expect(await alfred($, 'update')).toEqual([SAME('.claude/session-inspector', 'plans'), SAME('.claude/session-inspector', 'scores'), 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes).toEqual([])
})

test('only the folder that is a link is skipped: the other folder of that root still moves', async ($, on) => {
  const { rm } = await start($, on, {
    files: { '.alfred-mods/plans/p.json': stub(DONE), [`${OLD_SCORES}/s.json`]: stub(SCORES) }, aliases: { [OLD_PLANS]: '.alfred-mods/plans' },
  })
  expect(await alfred($, 'update')).toEqual([SAME('.claude/session-inspector', 'plans'), MOVED_ONE, 'update done'])
  expect(rm.calls).toEqual([['rm', '-f', '--', `${OLD_SCORES}/s.json`]])
})

test('a source folder whose real path cannot be told is skipped too, while the chosen folder exists', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/q.json': stub(DONE) }, noRealPath: [OLD_PLANS],
  })
  expect(await alfred($, 'update')).toEqual([WHICH('.claude/session-inspector', 'plans'), 'update done'])
  expect(rm.calls).toEqual([])
})

test('a source that is a link to its chosen copy is kept, never removed as an equal copy', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, aliases: { [`${OLD_PLANS}/p.json`]: '.alfred-mods/plans/p.json' },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('an equal copy whose real path cannot be told is kept', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, noRealPath: [`${OLD_PLANS}/p.json`] })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('an equal-text copy whose size is not the source size is kept', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': { text: DONE, mtimeMs: OLD, size: DONE.length + 5 } },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a source that changed between the listing and the read is named as changed, not as not UTF-8 text', async ($, on) => {
  let readsSince: () => number = () => 0
  // Listed at its old size; once the update reads it, it is the size of the text the read returns
  const racing: FileStub = { text: DONE, mtimeMs: OLD, get size() { return readsSince() > 0 ? DONE.length : DONE.length - 3 } }
  const kit = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: racing } })
  const base = kit.files.reads.length
  readsSince = () => kit.files.reads.length - base
  expect(await alfred($, 'update')).toEqual(['not moved: p - it changed while the update ran; run /alfred-mods:update again', 'update done'])
  expect(kit.rm.calls).toEqual([])
})

test('a file past the cap that would be refused does not make the more line', async ($, on) => {
  const files: Record<string, FileStub> = {
    [`${OLD_PLANS}/z1.json`]: { text: DONE, mtimeMs: OLD + HOUR, size: DONE.length + 1 }, [`${OLD_PLANS}/z2.json`]: stub(DONE, OLD + 2 * HOUR),
  }
  for (let i = 0; i < 50; i++) files[`${OLD_PLANS}/f${String(i).padStart(2, '0')}.json`] = stub(DONE)
  await start($, on, { files, refuseExists: ['.alfred-mods/plans/z2.json'] })
  expect(await alfred($, 'update')).toEqual([
    'not moved: z1 - not UTF-8 text', 'not moved: z2 - could not check the destination', 'moved 50 plan and scores files to .alfred-mods/', 'update done',
  ])
})

test('the scores of a plan that stays are kept even when byte-equal to the chosen copy', async ($, on) => {
  const { rm } = await start($, on, {
    files: {
      [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub('written by a writer'),
      [`${OLD_SCORES}/p.json`]: stub(SCORES), '.alfred-mods/scores/p.json': stub(SCORES),
    },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a plan that does not read as a plan and is past the window has its own line, and stays', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub('{ not json', NOW - 72 * HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES) } })
  expect(await alfred($, 'update')).toEqual(['left in place: p - it does not read as a plan; fix or remove it', 'update done'])
  expect(rm.calls).toEqual([])
})

test('a plan that does not read as a plan and is inside the window keeps the writer line', async ($, on) => {
  await start($, on, { files: { [`${OLD_PLANS}/p.json`]: stub('{ not json', NOW - HOUR) } })
  expect(await alfred($, 'update')).toEqual(['left in place: p - its writer still uses it; run /alfred-mods:update after it finishes', 'update done'])
})

test('a run with no equal copy writes no probe', async ($, on) => {
  const { files } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), [`${OLD_PLANS}/q.json`]: stub(DONE), '.alfred-mods/plans/q.json': stub('written by a writer') },
  })
  expect(await alfred($, 'update')).toEqual([KEPT_Q, MOVED_ONE, 'update done'])
  expect(files.writes.some(isProbe)).toBe(false)
})

test('a root that is a link spelled in another case is the same folder: skipped whole, nothing removed', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { '.alfred-mods/plans/p.json': stub(DONE), '.alfred-mods/scores/p.json': stub(SCORES) },
    mirrors: { '.claude/session-inspector': { to: '.alfred-mods', as: '.Alfred-Mods' } },
  })
  expect(await alfred($, 'update')).toEqual([SAME('.claude/session-inspector', 'plans'), SAME('.claude/session-inspector', 'scores'), 'update done'])
  expect(rm.calls).toEqual([])
  expect(files.writes).toEqual([])
})

test('an alias the real path cannot show is found by the probe: every equal source stays, and only the probe is removed', async ($, on) => {
  const { rm, files } = await start($, on, {
    files: { '.alfred-mods/plans/p.json': stub(DONE) }, mirrors: { '.claude/session-inspector': { to: '.alfred-mods' } },
  })
  expect(await alfred($, 'update')).toEqual([SAME('.claude/session-inspector', 'plans'), 'update done'])
  expect(rm.calls).toHaveLength(1)
  expect(sourcesIn(rm.calls[0])).toEqual([])
  expect(probesIn(rm.calls[0])).toHaveLength(1)
  expect(probesIn(rm.calls[0])[0]?.startsWith('.alfred-mods/plans/')).toBe(true)
  expect(files.writes.filter(isProbe)).toHaveLength(1)
})

test('a probe write that fails keeps every equal source', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, refuseWrite: [`${PROBE}*`],
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(rm.calls).toEqual([])
})

test('a probe check that rejects keeps the equal sources of that folder, and the probe is removed', async ($, on) => {
  const { rm } = await start($, on, {
    files: { [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE) }, refuseExists: [`${PROBE}*`],
  })
  expect(await alfred($, 'update')).toEqual([KEPT_P, 'update done'])
  expect(sourcesIn(rm.calls[0])).toEqual([])
  expect(probesIn(rm.calls[0])).toHaveLength(1)
})

test('a plan that cannot be read has its own line and stays', async ($, on) => {
  const { rm } = await start($, on, { files: { [`${OLD_PLANS}/p.json`]: { text: DONE, mtimeMs: NOW - 72 * HOUR, size: 5 * 1024 * 1024 } } })
  expect(await alfred($, 'update')).toEqual(['left in place: p - could not read it', 'update done'])
  expect(rm.calls).toEqual([])
})

test('the scores stay with a live plan whose folder was skipped as the same folder', async ($, on) => {
  const { rm } = await start($, on, {
    files: { '.alfred-mods/plans/p.json': stub(PENDING, NOW - HOUR), [`${OLD_SCORES}/p.json`]: stub(SCORES) }, aliases: { [OLD_PLANS]: '.alfred-mods/plans' },
  })
  expect(await alfred($, 'update')).toEqual([
    'left in place: p - its writer still uses it; run /alfred-mods:update after it finishes', SAME('.claude/session-inspector', 'plans'), 'update done',
  ])
  expect(rm.calls).toEqual([])
})

test('equal plans and equal scores each get a probe in their own chosen folder, removed with the sources in one rm', async ($, on) => {
  const { rm } = await start($, on, {
    files: {
      [`${OLD_PLANS}/p.json`]: stub(DONE), '.alfred-mods/plans/p.json': stub(DONE), [`${OLD_SCORES}/p.json`]: stub(SCORES), '.alfred-mods/scores/p.json': stub(SCORES),
    },
  })
  expect(await alfred($, 'update')).toEqual(['moved 2 plan and scores files to .alfred-mods/', 'update done'])
  expect(rm.calls).toHaveLength(1)
  expect(probesIn(rm.calls[0]).map(path => path.slice(0, path.indexOf(PROBE))).sort()).toEqual(['.alfred-mods/plans/', '.alfred-mods/scores/'])
})
