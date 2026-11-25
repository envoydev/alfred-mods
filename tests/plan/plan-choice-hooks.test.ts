// plansFolder picks whose plans show, one source each (the user, 2026-11-25): .alfred-mods claude-kit's plan files,
// .alfred Alfred Code's plan folders (alfred-plan-hooks.test.ts) and no root of the mod's, default none
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PRESENTATION, START, engine, stubAll, watchState } from '../kit'
import { STATUS_JSON } from '../plans'
import { PLAN_JSON, SCORES_JSON, planText } from '../plans'
import type { Plans } from '../../hooks/plan/types'

const PLAN_PATH = '.claude/session-inspector/plans/token-refresh.json'
const SCORES_PATH = '.claude/session-inspector/scores/token-refresh.json'
const NEW_PLAN_PATH = '.alfred-mods/plans/token-refresh.json'
const NEW_SCORES_PATH = '.alfred-mods/scores/token-refresh.json'
const ALFRED_PLAN_PATH = '.alfred/alfred-mods/plans/token-refresh.json'
const ALFRED_SCORES_PATH = '.alfred/alfred-mods/scores/token-refresh.json'
const SCORES_ONE_ROUND = JSON.stringify({ ...JSON.parse(SCORES_JSON), rounds: JSON.parse(SCORES_JSON).rounds.slice(0, 1) })

async function readFiles($: Engine, on: On, files: Record<string, { text: string; mtimeMs: number }>, plansFolder: string): Promise<Plans> {
  const { clock } = stubAll(on, { files, sources: { project: { 'alfred-mods': { plansFolder } } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await clock.advance(300)
  return state.get('plans') as Plans
}

const EVERY_ROOT = {
  [ALFRED_PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 9 }, [ALFRED_SCORES_PATH]: { text: SCORES_JSON, mtimeMs: 9 },
  [PLAN_PATH]: { text: PLAN_JSON, mtimeMs: 9 }, [SCORES_PATH]: { text: SCORES_JSON, mtimeMs: 9 },
  [NEW_PLAN_PATH]: { text: planText({ S4: 'done' }), mtimeMs: 1 }, [NEW_SCORES_PATH]: { text: SCORES_ONE_ROUND, mtimeMs: 1 },
}

test('with plansFolder .alfred no plan or scores file of the mod\'s folders is read: Alfred Code\'s plans only', async ($, on) => {
  const p = await readFiles($, on, EVERY_ROOT, '.alfred')
  expect(p.planFiles).toEqual([])
  expect(p.scoreFiles).toEqual([])
})

test('with plansFolder .alfred-mods only claude-kit\'s .alfred-mods folder is read, even where another root is newer', async ($, on) => {
  const p = await readFiles($, on, EVERY_ROOT, '.alfred-mods')
  expect(p.planFiles.map(file => file.path)).toEqual([NEW_PLAN_PATH])
  expect(p.scoreFiles.map(file => file.path)).toEqual([NEW_SCORES_PATH])
})

test('with plansFolder default no plan or scores file is read', async ($, on) => {
  const p = await readFiles($, on, EVERY_ROOT, 'default')
  expect(p.planFiles).toEqual([])
  expect(p.scoreFiles).toEqual([])
})

const STATUS = '.claude/session-inspector/status/s1.json'
const FOLDER = '.alfred/docs/work/plans/waste-bin'
const NAMED = JSON.stringify({ schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-11-13T11:40:00Z', plan: FOLDER })

test('a switch from .alfred to default mid-session clears the Alfred Code plan it showed', async ($, on) => {
  const kit = stubAll(on, {
    files: { [STATUS]: { text: NAMED, mtimeMs: 1 }, [`${FOLDER}/status.json`]: { text: STATUS_JSON, mtimeMs: 2 } },
    sources: { project: { 'alfred-mods': { plansFolder: '.alfred' } } }, now: 1000,
  })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  expect((state.get('plans') as Plans).planFiles.map(file => file.name)).toEqual(['waste-bin'])
  kit.sources.project['alfred-mods'] = { plansFolder: 'default' }
  await $.classic.ConfigChange({ source: 'project_settings' })
  await kit.clock.advance(30_000)
  expect((state.get('plans') as Plans).planFiles).toEqual([])
  expect((state.get('plans') as Plans).alfredFolder).toBeNull()
})

test('a choice made with /alfred-mods:configure shows at once and holds until a read of the settings shows it', async ($, on) => {
  const kit = stubAll(on, {
    files: { [STATUS]: { text: NAMED, mtimeMs: 1 }, [`${FOLDER}/status.json`]: { text: STATUS_JSON, mtimeMs: 2 } },
    sources: { project: { 'alfred-mods': { plansFolder: '.alfred' } } }, now: 1000,
  })
  const state = watchState(on)
  const names = (): string[] => (state.get('plans') as Plans).planFiles.map(file => file.name)
  engine(on)
  await $.session.start(START)
  await kit.clock.advance(300)
  expect(names()).toEqual(['waste-bin'])
  await $.command.run({ command: 'alfred-mods:configure', args: 'default', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await kit.clock.advance(0)
  expect(names()).toEqual([])
  // The poll reads settings Claude Code has not reloaded yet, and the choice holds
  await kit.clock.advance(30_000)
  expect(names()).toEqual([])
  // Claude Code loads the file the command wrote, and then a hand edit back: the files speak again
  kit.sources.project['alfred-mods'] = { plansFolder: 'default' }
  await $.classic.ConfigChange({ source: 'project_settings' })
  await kit.clock.advance(30_000)
  expect(names()).toEqual([])
  kit.sources.project['alfred-mods'] = { plansFolder: '.alfred' }
  await $.classic.ConfigChange({ source: 'project_settings' })
  await kit.clock.advance(30_000)
  expect(names()).toEqual(['waste-bin'])
})
