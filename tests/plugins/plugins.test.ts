// The plugins the settings files turn on or off (code.claude.com/docs/en/plugins/loading, 'Find where a plugin is
// enabled', read 2026-11-25): per id, the highest source that names it decides; installed or not from the install record
import { expect, test } from 'claude-code/testing'

import { pluginLines, pluginRows } from '../../hooks/plugins/plugins'
import type { Line } from '../../hooks/core/types'

const ROOT = '/work/app'
const text = (line: Line): string => line.map(seg => ('text' in seg ? seg.text : '')).join('')
const installed = (entries: Record<string, { scope: string; projectPath?: string }[]>): string => JSON.stringify({ version: 2, plugins: entries })

test('per plugin the highest source that names it decides: local over project over user, managed over all', () => {
  const rows = pluginRows({
    layers: {
      user: { enabledPlugins: { 'a@m': true, 'b@m': false, 'c@m': true } }, project: { enabledPlugins: { 'a@m': false, 'b@m': true } },
      local: { enabledPlugins: { 'a@m': true } }, policy: { enabledPlugins: { 'c@m': false } },
    },
    installedText: null, root: ROOT,
  })
  expect(rows.map(row => [row.id, row.isOn, row.from])).toEqual([['a@m', true, 'local'], ['b@m', true, 'project'], ['c@m', false, 'policy']])
})

test('the envoydev stack comes first, then the rest by name; a value that is no boolean is ignored', () => {
  const rows = pluginRows({
    layers: { user: { enabledPlugins: { 'zeta@m': true, 'alfred-tools@envoydev': true, 'alfred-code@envoydev': true, 'alfred-mods@envoydev': true, 'bad@m': 'yes' } } },
    installedText: null, root: ROOT,
  })
  expect(rows.map(row => row.id)).toEqual(['alfred-code@envoydev', 'alfred-tools@envoydev', 'alfred-mods@envoydev', 'zeta@m'])
})

test('installed: a user install anywhere, a project or local install of this project only; unknown with no record or for @inline', () => {
  const record = installed({ 'u@m': [{ scope: 'user' }], 'p@m': [{ scope: 'project', projectPath: '/work/app/' }], 'o@m': [{ scope: 'local', projectPath: '/work/other' }] })
  const rows = pluginRows({ layers: { project: { enabledPlugins: { 'u@m': true, 'p@m': true, 'o@m': true, 'n@m': true, 'dev@inline': true } } }, installedText: record, root: ROOT })
  expect(Object.fromEntries(rows.map(row => [row.id, row.isInstalled]))).toEqual({ 'dev@inline': null, 'n@m': false, 'o@m': false, 'p@m': true, 'u@m': true })
  expect(pluginRows({ layers: { user: { enabledPlugins: { 'u@m': true } } }, installedText: '{ bad', root: ROOT })[0]?.isInstalled).toBeNull()
})

test('the Now tab section: a head, what the rows mean, each plugin with its value and the file that decides', () => {
  const rows = pluginRows({
    layers: { project: { enabledPlugins: { 'alfred-code@envoydev': true } }, local: { enabledPlugins: { 'alfred-tools@envoydev': false } } },
    installedText: installed({ 'alfred-code@envoydev': [{ scope: 'user' }] }), root: ROOT,
  })
  expect(pluginLines(rows, 120).map(text)).toEqual([
    'PLUGINS',
    'Set in settings files; a plugin with no entry follows its default, and --plugin-dir copies are not listed',
    'alfred-code@envoydev on · .claude/settings.json',
    'alfred-tools@envoydev off · .claude/settings.local.json',
  ])
})

test('one turned on but not installed here says so; past 12 rows the rest are counted', () => {
  const ids = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${String(i).padStart(2, '0')}@m`, true]))
  const lines = pluginLines(pluginRows({ layers: { user: { enabledPlugins: ids } }, installedText: installed({}), root: ROOT }), 120).map(text)
  expect(lines[2]).toBe('p00@m on · ~/.claude/settings.json · not installed here')
  expect(lines).toHaveLength(2 + 12 + 1)
  expect(lines[lines.length - 1]).toBe('3 more')
  expect(pluginLines([], 120)).toEqual([])
})

test('a project install counts for a session started in a folder under that project', () => {
  const record = installed({ 'p@m': [{ scope: 'project', projectPath: '/work/app' }] })
  const rows = pluginRows({ layers: { project: { enabledPlugins: { 'p@m': true } } }, installedText: record, root: '/work/app/web' })
  expect(rows[0]?.isInstalled).toBe(true)
  expect(pluginRows({ layers: { project: { enabledPlugins: { 'p@m': true } } }, installedText: record, root: '/work/application' })[0]?.isInstalled).toBe(false)
})

test('a plugin id from a file is drawn with no control character', () => {
  const rows = pluginRows({ layers: { project: { enabledPlugins: { 'evil\u001b[31m@m': true } } }, installedText: null, root: ROOT })
  expect(pluginLines(rows, 120).map(text)[2]).not.toContain('\u001b')
})
