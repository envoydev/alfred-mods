// The plansFolder a setup command writes is in force at once, while Claude Code's settings read back stale, and only
// until a read of the settings shows anything else: the value written, a hand edit or a higher file (the user,
// 2026-11-25: 'Do optional')
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PRESENTATION, START, engine, stubAll, watchState } from '../kit'
import type { FileStub } from '../kit'
import { planText } from '../plans'
import type { Plans } from '../../hooks/plan/types'

const NOW = 1_800_000_000_000
const DONE = planText({ S1: 'done', S2: 'done', S3: 'done', S4: 'done', S5: 'done' })
const KIT_PLAN: Record<string, FileStub> = { '.alfred-mods/plans/p.json': { text: DONE, mtimeMs: NOW - 100 * 3_600_000 } }
const mod = (plansFolder: string): Record<string, unknown> => ({ 'alfred-mods': { plansFolder } })

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1]) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', now: NOW, ...o })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  return { ...kit, names: (): string[] => ((state.get('plans') as Plans | undefined)?.planFiles ?? []).map(file => file.name) }
}
const alfred = async ($: Engine, verb: string, args: string): Promise<string> =>
  (await $.command.run({ command: `alfred-mods:${verb}`, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

test('with no ConfigChange hook a hand edit after a written choice still shows on the poll', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const kit = await start($, on, { files: KIT_PLAN, sources: { project: mod('.alfred-mods') } })
  expect(kit.names()).toEqual(['p'])
  await alfred($, 'configure', '.alfred')
  await kit.clock.advance(0)
  expect(kit.names()).toEqual([])
  kit.sources.local['alfred-mods'] = { plansFolder: '.alfred-mods' }
  await kit.clock.advance(30_000)
  await kit.clock.advance(30_000)
  expect(kit.names()).toEqual(['p'])
})

test('a write a higher file shadows names the higher value, not an earlier written choice', async ($, on) => {
  const kit = await start($, on, { files: KIT_PLAN, sources: { project: mod('.alfred-mods') } })
  await alfred($, 'configure', '.alfred')
  kit.sources.local['alfred-mods'] = { plansFolder: 'default' }
  expect(await alfred($, 'configure', '.alfred-mods')).toBe('plansFolder is "default" in .claude/settings.local.json, which wins over the value written')
})

test('init .alfred-mods reads the plans again after the update moved them in', async ($, on) => {
  const kit = await start($, on, {
    files: { '.claude/session-inspector/plans/p.json': { text: DONE, mtimeMs: NOW - 100 * 3_600_000 } }, sources: { project: mod('.alfred') },
  })
  expect(kit.names()).toEqual([])
  await alfred($, 'init', '.alfred-mods')
  await kit.clock.advance(0)
  expect(kit.names()).toEqual(['p'])
})
