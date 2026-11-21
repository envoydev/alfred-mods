// The signed-in organization, read from Claude Code's global config: at session start, at each start-over and at most
// every 5 minutes on a turn's end; only the name is kept, and any failure leaves it unknown
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { READ_EVERY_MS } from '../../hooks/account/constants'
import { START, engine, stubAll, watchState } from '../kit'
import type { FileStub } from '../kit'

const CONFIG = '/cfg/.claude.json'
const HOME_CONFIG = '/home/u/.claude.json'
const EMAIL = 'person@example.com'
const UUIDS = ['11111111-aaaa', '22222222-bbbb']
const configOf = (org: string): FileStub => ({
  text: JSON.stringify({
    numStartups: 9, oauthAccount: { emailAddress: EMAIL, accountUuid: UUIDS[0], organizationUuid: UUIDS[1], organizationName: org, displayName: 'Pat' },
  }),
  mtimeMs: 0,
})

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', ...o })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  const org = (): string | null => (state.get('account') as { org: string | null } | undefined)?.org ?? null
  const reads = (): number => kit.files.reads.filter(path => path.endsWith('.claude.json')).length
  return { ...kit, state, org, reads }
}
const turn = async ($: Engine, turnId: string): Promise<void> => {
  await $.turn.start({ text: 'q', turnId })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
}

test('with CLAUDE_CONFIG_DIR set, the org is read from the global config in that folder', async ($, on) => {
  const { org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' }, files: { [CONFIG]: configOf('Acme Inc'), [HOME_CONFIG]: configOf('Home Co') } })
  expect(org()).toBe('Acme Inc')
})

test('a Pro or Max account keeps Personal in the atom, never its organization name', async ($, on) => {
  const text = JSON.stringify({ oauthAccount: { organizationType: 'claude_pro', organizationName: `${EMAIL}'s Organization`, emailAddress: EMAIL } })
  const { state, org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: { text, mtimeMs: 0 } } })
  expect(org()).toBe('Personal')
  expect(state.get('account')).toEqual({ org: 'Personal' })
  expect(JSON.stringify(state.writes)).not.toContain(EMAIL)
})

test('a trailing separator on CLAUDE_CONFIG_DIR changes nothing', async ($, on) => {
  const { org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg/' }, files: { [CONFIG]: configOf('Acme Inc') } })
  expect(org()).toBe('Acme Inc')
})

test('with CLAUDE_CONFIG_DIR unset, the org is read from the global config in HOME', async ($, on) => {
  const { org } = await start($, on, { env: { HOME: '/home/u' }, files: { [HOME_CONFIG]: configOf('Home Co') } })
  expect(org()).toBe('Home Co')
})

test('an empty CLAUDE_CONFIG_DIR is no folder: HOME gives the config', async ($, on) => {
  const { org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '', HOME: '/home/u' }, files: { [HOME_CONFIG]: configOf('Home Co') } })
  expect(org()).toBe('Home Co')
})

test('an empty HOME is no home: USERPROFILE gives the config', async ($, on) => {
  const { org } = await start($, on, { env: { HOME: '', USERPROFILE: '/home/u' }, files: { [HOME_CONFIG]: configOf('Win Co') } })
  expect(org()).toBe('Win Co')
})

test('USERPROFILE comes before HOME, as the home folder does on Windows', async ($, on) => {
  const { org } = await start($, on, {
    env: { HOME: '/other', USERPROFILE: '/home/u' }, files: { [HOME_CONFIG]: configOf('Win Co'), '/other/.claude.json': configOf('Git Bash Co') },
  })
  expect(org()).toBe('Win Co')
})

test('with no HOME, USERPROFILE gives the config', async ($, on) => {
  const { org } = await start($, on, { env: { USERPROFILE: '/home/u' }, files: { [HOME_CONFIG]: configOf('Win Co') } })
  expect(org()).toBe('Win Co')
})

test('a token login has no oauthAccount: the org stays unknown and nothing is told', async ($, on) => {
  const { org, toasts } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: { text: JSON.stringify({ numStartups: 2 }), mtimeMs: 0 } } })
  expect(org()).toBeNull()
  expect(toasts).toEqual([])
})

test('a missing config leaves the org unknown, without a toast', async ($, on) => {
  const { org, toasts } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  expect(org()).toBeNull()
  expect(toasts).toEqual([])
})

test('no folder to look in leaves the org unknown', async ($, on) => {
  const { org, reads } = await start($, on, { env: {}, files: { [HOME_CONFIG]: configOf('Home Co') } })
  expect(org()).toBeNull()
  expect(reads()).toBe(0)
})

test('a config that does not parse leaves the org unknown, without a toast', async ($, on) => {
  const { org, toasts } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: { text: '{ "oauthAccount": ', mtimeMs: 0 } } })
  expect(org()).toBeNull()
  expect(toasts).toEqual([])
})

test('a config the read refuses for its size leaves the org unknown', async ($, on) => {
  const { org, toasts } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: { ...configOf('Acme Inc'), size: 5 * 1024 * 1024 } } })
  expect(org()).toBeNull()
  expect(toasts).toEqual([])
})

test('the atom holds the org name and nothing else of the config', async ($, on) => {
  const { state, store, toasts, org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  expect(state.get('account')).toEqual({ org: 'Acme Inc' })
  expect(org()).toBe('Acme Inc')
  const everything = JSON.stringify([state.writes, store.keys().map(key => store.get(key)), toasts])
  for (const secret of [EMAIL, ...UUIDS, 'Pat', 'numStartups']) expect(everything).not.toContain(secret)
})

test('a turn within 5 minutes of the last read does not read again, one after does', async ($, on) => {
  const { clock, files, org, reads } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  expect(reads()).toBe(1)
  files.current[CONFIG] = configOf('Other Co')
  await clock.advance(READ_EVERY_MS - 2000)
  await turn($, 't1')
  await clock.advance(0)
  expect(reads()).toBe(1)
  expect(org()).toBe('Acme Inc')
  await clock.advance(2000)
  await turn($, 't2')
  await clock.advance(0)
  expect(reads()).toBe(2)
  expect(org()).toBe('Other Co')
})

test("a turn's end reads the config off the hook, on the clock's next turn", async ($, on) => {
  const { clock, files, org, reads } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  files.current[CONFIG] = configOf('Other Co')
  await clock.advance(READ_EVERY_MS + 1000)
  await turn($, 't1')
  expect(reads()).toBe(1)
  expect(org()).toBe('Acme Inc')
  await clock.advance(0)
  expect(reads()).toBe(2)
  expect(org()).toBe('Other Co')
})

test('a sub-agent turn does not read the config', async ($, on) => {
  const { clock, reads } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  await clock.advance(READ_EVERY_MS + 1000)
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'u1', reason: 'answer', agentId: 'unknown-agent' })
  expect(reads()).toBe(1)
})

test('a start-over reads the config again at once, the 5 minutes not passed', async ($, on) => {
  const { files, session, org, reads } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  files.current[CONFIG] = configOf('Other Co')
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(reads()).toBe(2)
  expect(org()).toBe('Other Co')
})

test('a read that finds the account gone shows the org unknown again', async ($, on) => {
  const { files, session, org } = await start($, on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [CONFIG]: configOf('Acme Inc') } })
  files.current[CONFIG] = { text: JSON.stringify({ numStartups: 9 }), mtimeMs: 0 }
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(org()).toBeNull()
})
