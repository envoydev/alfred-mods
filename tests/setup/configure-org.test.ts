// /alfred-mods:configure expectOrg [name]: the project's "expectOrg" written into .claude/settings.json, or the org the
// band shows pinned there; the other arguments of configure are plansFolder's, in setup-hooks.test.ts
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PRESENTATION, START, engine, fileAt, stubAll } from '../kit'

const PROJECT = '.claude/settings.json'
const CONFIG = '/cfg/.claude.json'
const configOf = (org: string) => ({ [CONFIG]: { text: JSON.stringify({ oauthAccount: { organizationName: org, emailAddress: 'person@example.com' } }), mtimeMs: 0 } })
const mod = (fields: Record<string, unknown>): Record<string, unknown> => ({ 'alfred-mods': fields })
const USAGE = 'Usage: /alfred-mods:init [.alfred-mods|.alfred|default] | /alfred-mods:configure [.alfred-mods|.alfred|default] | /alfred-mods:configure expectOrg [name] | /alfred-mods:update'

async function start($: Engine, on: On, o: Parameters<typeof stubAll>[1] = {}) {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', env: { CLAUDE_CONFIG_DIR: '/cfg' }, ...o })
  engine(on)
  await $.session.start(START)
  return kit
}
const configure = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ command: 'alfred-mods:configure', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''
const fieldIn = (text: string | undefined): unknown => (JSON.parse(text ?? '{}') as Record<string, Record<string, unknown>>)['alfred-mods']?.expectOrg

test('configure expectOrg with a name writes it to the project file and says what the band does', async ($, on) => {
  const { files } = await start($, on)
  expect(await configure($, 'expectOrg Acme Inc')).toBe('expectOrg is "Acme Inc" in .claude/settings.json - the band warns when the signed-in organization differs')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Acme Inc')
})

test('the keyword takes any case and the name keeps its own', async ($, on) => {
  const { files } = await start($, on)
  await configure($, '  ExpectORG   Acme Inc  ')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Acme Inc')
})

test('a name is written beside the other keys of the project file', async ($, on) => {
  const { files } = await start($, on, { files: { [PROJECT]: { text: '{"permissions":{"allow":["Bash"]}}\n', mtimeMs: 0 } } })
  await configure($, 'expectOrg Acme')
  const written = JSON.parse(fileAt(files, PROJECT) ?? '{}') as Record<string, unknown>
  expect(written.permissions).toEqual({ allow: ['Bash'] })
  expect(written['alfred-mods']).toEqual({ expectOrg: 'Acme' })
})

test('with no name, configure expectOrg pins the org the band shows', async ($, on) => {
  const { files } = await start($, on, { files: configOf('Pinned Co') })
  expect(await configure($, 'expectOrg')).toBe('expectOrg is "Pinned Co" in .claude/settings.json - the band warns when the signed-in organization differs')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Pinned Co')
})

test('with the org unknown, configure expectOrg writes nothing and says to type a name', async ($, on) => {
  const { files } = await start($, on)
  expect(await configure($, 'expectOrg')).toBe('The signed-in organization is unknown - type /alfred-mods:configure expectOrg <name>')
  expect(files.writes).toEqual([])
})

test('a name over 100 characters prints the usage line and writes nothing', async ($, on) => {
  const { files } = await start($, on)
  expect(await configure($, `expectOrg ${'x'.repeat(101)}`)).toBe(USAGE)
  expect(files.writes).toEqual([])
})

test('a higher file that gives expectOrg wins, and the answer names it', async ($, on) => {
  const { files } = await start($, on, { sources: { local: mod({ expectOrg: 'Local Co' }) } })
  expect(await configure($, 'expectOrg Acme Inc')).toBe('expectOrg is "Local Co" in .claude/settings.local.json, which wins over the value written')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Acme Inc')
})

test('a project file that does not parse is refused and nothing is written', async ($, on) => {
  const { files } = await start($, on, { files: { [PROJECT]: { text: '{ bad', mtimeMs: 0 } } })
  expect(await configure($, 'expectOrg Acme')).toBe('.claude/settings.json does not parse - expectOrg not written')
  expect(files.writes).toEqual([])
})

test('a refused write is told as the write failing', async ($, on) => {
  await start($, on, { refuseWrite: [PROJECT] })
  expect(await configure($, 'expectOrg Acme')).toBe('.claude/settings.json refused the write - expectOrg not written')
})

test('the folder values of configure still reach the plans folder command', async ($, on) => {
  const { files } = await start($, on)
  expect(await configure($, '.alfred')).toContain('plansFolder is ".alfred"')
  expect(JSON.parse(fileAt(files, PROJECT) ?? '{}')['alfred-mods']).toEqual({ plansFolder: '.alfred' })
})

const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8, bodyColumns: 160, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const STRICT = { user: mod({ rec: 'strict' }) }

test('under REC strict the reply shows ‹org› for the name written, and the file keeps the real name', async ($, on) => {
  const { files } = await start($, on, { sources: STRICT })
  expect(await configure($, 'expectOrg Acme Inc')).toBe('expectOrg is "‹org›" in .claude/settings.json - the band warns when the signed-in organization differs')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Acme Inc')
})

test('under REC strict the pinned name is not shown, and the file keeps it', async ($, on) => {
  const { files } = await start($, on, { files: configOf('Pinned Co'), sources: STRICT })
  const reply = await configure($, 'expectOrg')
  expect(reply).toBe('expectOrg is "‹org›" in .claude/settings.json - the band warns when the signed-in organization differs')
  expect(reply).not.toContain('Pinned')
  expect(fieldIn(fileAt(files, PROJECT))).toBe('Pinned Co')
})

test("under REC strict the shadow line hides the higher file's name too", async ($, on) => {
  await start($, on, { sources: { ...STRICT, local: mod({ expectOrg: 'Local Co' }) } })
  const reply = await configure($, 'expectOrg Acme Inc')
  expect(reply).toBe('expectOrg is "‹org›" in .claude/settings.local.json, which wins over the value written')
})

// The first read of the settings files is held at the store key it ends on, and the project file changes meanwhile, as an
// edit between the command's two reads would: only a read after the write shows the new value
test('the settings are read again after the write, so the band follows at once', async ($, on) => {
  const hold = { key: 'settings:handoff', until: null as Promise<void> | null }
  const kit = await start($, on, {
    band: 'full', model: 'claude-sonnet-5-5', version: '2.1.322', repo: { root: '/w' }, holdStore: hold,
    files: { ...configOf('Acme Inc'), '.git/HEAD': { text: 'ref: refs/heads/develop\n', mtimeMs: 0 } },
  })
  let release: () => void = () => undefined
  hold.until = new Promise<void>(resolve => {
    release = resolve
  })
  const done = configure($, 'expectOrg Other Co')
  await kit.clock.settle()
  kit.sources.project['alfred-mods'] = { expectOrg: 'Other Co' }
  hold.until = null
  release()
  await done
  const tree = JSON.stringify(await (await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })).drawn())
  expect(tree).toContain('"warning"')
})
