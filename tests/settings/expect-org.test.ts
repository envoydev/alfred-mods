// The "expectOrg" field of "alfred-mods": the organization name the project expects the band to show; a string of 1 to
// 100 characters once trimmed, null (no check) when no file sets it
import { expect, test } from 'claude-code/testing'

import { DEFAULTS, FIELDS, resolveSettings, skippedToast } from '../../hooks/settings/settings'

test('expectOrg is a field and defaults to none', () => {
  expect([...FIELDS]).toContain('expectOrg')
  expect(DEFAULTS.expectOrg).toBeNull()
  expect(resolveSettings({}, {}).from.expectOrg).toBe('default')
})

test('a valid expectOrg resolves from each source in the order', () => {
  expect(resolveSettings({ user: { expectOrg: 'Acme Inc' } }, {}).values.expectOrg).toBe('Acme Inc')
  const r = resolveSettings({ project: { expectOrg: 'Project Co' }, user: { expectOrg: 'User Co' } }, {})
  expect(r.values.expectOrg).toBe('Project Co')
  expect(r.from.expectOrg).toBe('project')
  expect(resolveSettings({ project: { expectOrg: 'x'.repeat(100) } }, {}).values.expectOrg).toBe('x'.repeat(100))
})

test('an invalid expectOrg is skipped, and the file below gives its value', () => {
  for (const bad of ['', '   ', 'x'.repeat(101), 5, true, null, ['Acme']]) {
    const r = resolveSettings({ local: { expectOrg: bad }, user: { expectOrg: 'Acme Inc' } }, {})
    expect(r.values.expectOrg).toBe('Acme Inc')
    expect(r.skipped).toEqual([{ field: 'expectOrg', source: 'local' }])
  }
})

test('the skipped toast names the values expectOrg takes, never the bad one', () => {
  const r = resolveSettings({ project: { expectOrg: 'x'.repeat(101) } }, {})
  const skip = r.skipped[0]
  if (skip === undefined) throw new Error('nothing skipped')
  const toast = skippedToast(skip, r)
  expect(toast).toContain('"expectOrg" in .claude/settings.json takes a name of 1 to 100 characters')
  expect(toast).not.toContain('xxxx')
})
