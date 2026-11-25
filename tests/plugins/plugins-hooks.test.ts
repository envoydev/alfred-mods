// The Now tab's PLUGINS section, from the settings sources and the install record under CLAUDE_CONFIG_DIR
import { expect, test } from 'claude-code/testing'

import { START, engine, rows, stubAll } from '../kit'

const PANE = { title: 'inspect', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }

test('the Now tab lists alfred-code and alfred-tools as the settings set them, and one not installed here', async ($, on) => {
  stubAll(on, {
    root: '/work/app', cwd: '/work/app', env: { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' },
    sources: { project: { enabledPlugins: { 'alfred-code@envoydev': true, 'alfred-tools@envoydev': true } }, local: { enabledPlugins: { 'alfred-tools@envoydev': false } } },
    files: { '/cfg/plugins/installed_plugins.json': { text: JSON.stringify({ version: 2, plugins: { 'alfred-tools@envoydev': [{ scope: 'user' }] } }), mtimeMs: 1 } },
  })
  engine(on)
  await $.session.start(START)
  const lines = await rows(await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'Pane', requestId: 'inspect', props: PANE }))
  const at = lines.indexOf('PLUGINS')
  expect(at).toBeGreaterThan(-1)
  expect(lines.slice(at + 2, at + 4)).toEqual([
    'alfred-code@envoydev on · .claude/settings.json · not installed here',
    'alfred-tools@envoydev off · .claude/settings.local.json',
  ])
})
