// The "alfred-mods" key in Claude Code's settings files: each field read per file and settled in the order policy,
// flag, local, project, user, an earlier command's choice, the default (spec 2026-11-11 settings-values, S1-S4)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { BandSetting, Handoff, Quiet, RecState, Stack } from '../types'
import { START, engine, stubAll, watchState } from './kit.ts'
import type { FileStub } from './kit.ts'

const STATUS = '.claude/session-inspector/status/s1.json'
const STATUS_FILE: FileStub = {
  text: JSON.stringify({
    schema: 1, session: 's1', fullContext: 'fresh-session', updatedAt: '2026-10-29T14:03:00Z', model: 'claude-opus-5-5',
    window: 1000000, resumeAt: 150000, autoRun: false, scorer: { on: false, level: 80, rounds: 3 }, handoffPrompt: null,
  }),
  mtimeMs: 1,
}

// No earlier command's choice unless a test stores one: the kit's 'calm' band and quiet off would read as such
async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  return {
    ...kit, state,
    band: (): BandSetting => state.get('band') as BandSetting,
    quiet: (): Quiet => state.get('quiet') as Quiet,
    rec: (): RecState => state.get('rec') as RecState,
    handoff: (): Handoff => state.get('handoff') as Handoff,
  }
}

const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })

test('bandRows false in local closes the rows over the user file', async ($, on) => {
  const { band } = await start($, on, { sources: { local: mod({ bandRows: false }), user: mod({ bandRows: true }) } })
  expect(band().isToolsOpen).not.toBe(true)
  expect(band().mode).toBe('full')
})

test('bandPlace under in the user file alone draws under', async ($, on) => {
  const { band } = await start($, on, { sources: { user: mod({ bandPlace: 'under' }) } })
  expect(band().isUnder).toBe(true)
})

test('quiet false draws full tool rows', async ($, on) => {
  const { quiet } = await start($, on, { sources: { user: mod({ quiet: false }) } })
  expect(quiet()).toEqual({ isOn: false })
})

test('no file and no earlier choice: every field at its default', async ($, on) => {
  const { band, quiet, rec, handoff } = await start($, on)
  expect(band()).toEqual({ mode: 'full', isToolsOpen: true })
  expect(quiet()).toEqual({ isOn: true })
  expect(rec().level).toBe('off')
  expect(handoff()).toMatchObject({ mode: 'ask', threshold: 80 })
})

test('handoff and handoffAt reach the handoff state', async ($, on) => {
  const { handoff } = await start($, on, { sources: { project: mod({ handoff: 'auto', handoffAt: 70 }) } })
  expect(handoff()).toMatchObject({ mode: 'auto', threshold: 70 })
})

test('rec on masks', async ($, on) => {
  const { rec } = await start($, on, { sources: { user: mod({ rec: 'on' }) } })
  expect(rec().level).toBe('on')
})

test('a refused source counts as none', async ($, on) => {
  const { band } = await start($, on, { refuseSource: ['policy', 'flag'], sources: { local: mod({ band: 'calm' }) } })
  expect(band().mode).toBe('calm')
})

test('a file over an earlier command, the earlier command over the default', async ($, on) => {
  const { band, rec } = await start($, on, {
    store: { 'settings:band': 'calm', 'settings:rec': 'strict' }, sources: { user: mod({ band: 'full' }) },
  })
  expect(band().mode).toBe('full')
  expect(rec().level).toBe('strict')
})

test('the poll reads again', async ($, on) => {
  const { band, sources, clock } = await start($, on)
  expect(band().mode).toBe('full')
  sources.local['alfred-mods'] = { band: 'calm', bandRows: false }
  await clock.advance(29_000)
  expect(band().mode).toBe('full')
  await clock.advance(1_000)
  expect(band()).toEqual({ mode: 'calm' })
})

test('the poll still reads the status file', async ($, on) => {
  const { state, files, clock } = await start($, on)
  expect((state.get('stack') as Stack).state).toBe('none')
  files.current[STATUS] = STATUS_FILE
  await clock.advance(30_000)
  expect((state.get('stack') as Stack).state).not.toBe('none')
})
