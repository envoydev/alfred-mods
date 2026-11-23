import { expect, test } from 'claude-code/testing'

import { ruleEntry } from '../../hooks/context/rules'

test('same level keeps the plain name', () => {
  expect(ruleEntry('/work/app/.claude/rules/alfred-awareness.md', 'Project', '/work/app'))
    .toEqual({ key: '.claude/rules/alfred-awareness.md', label: 'alfred-awareness' })
})
test('a child folder labels child:name', () => {
  expect(ruleEntry('/work/app/web/.claude/rules/alfred-awareness.md', 'Project', '/work/app'))
    .toEqual({ key: 'web/.claude/rules/alfred-awareness.md', label: 'web:alfred-awareness' })
  expect(ruleEntry('/work/app/apps/web/.claude/rules/x.md', 'Project', '/work/app')?.label).toBe('apps/web:x')
})
test('above the root keys by .. and keeps the plain name', () => {
  expect(ruleEntry('/work/app/.claude/rules/csharp.md', 'Project', '/work/app/web'))
    .toEqual({ key: '../.claude/rules/csharp.md', label: 'csharp' })
})
test('two same base names are two keys', () => {
  const root = ruleEntry('/work/app/.claude/rules/a.md', 'Project', '/work/app')
  const child = ruleEntry('/work/app/web/.claude/rules/a.md', 'Project', '/work/app')
  expect(root?.key).not.toBe(child?.key)
})
test('a user rule keys by type and name, never its folder', () => {
  expect(ruleEntry('/Users/jane/.claude/rules/voice.md', 'User', '/work/app'))
    .toEqual({ key: 'User:voice.md', label: 'voice' })
})
test('a user rule in an ancestor of the root still keys by type and name', () => {
  expect(ruleEntry('/Users/jane/.claude/rules/voice.md', 'User', '/Users/jane/work/app'))
    .toEqual({ key: 'User:voice.md', label: 'voice' })
})
test('two spellings of a windows path give one key, the label keeping the source case', () => {
  const upper = ruleEntry('C:\\work\\app\\Web\\.claude\\rules\\x.md', 'Project', 'c:/work/app')
  const lower = ruleEntry('C:\\work\\app\\web\\.claude\\rules\\x.md', 'Project', 'c:/work/app')
  expect(upper?.key).toBe(lower?.key)
  expect(upper).toEqual({ key: 'web/.claude/rules/x.md', label: 'Web:x' })
})
test('windows path keys without case', () => {
  expect(ruleEntry('C:\\work\\app\\web\\.claude\\rules\\x.md', 'Project', 'c:/work/app'))
    .toEqual({ key: 'web/.claude/rules/x.md', label: 'web:x' })
})
test('a linked rule reads plain', () => {
  expect(ruleEntry('/shared/rules/voice.md', 'Project', '/work/app', ['/shared/rules'])?.label).toBe('voice')
})
test('a file that is no rule gives null', () => {
  expect(ruleEntry('/work/app/CLAUDE.md', 'Project', '/work/app')).toBeNull()
})
test('a root that is empty, slash or a drive root keys every rule by type and name', () => {
  for (const root of ['', '/', 'C:\\']) {
    expect(ruleEntry('/work/app/web/.claude/rules/x.md', 'Project', root)).toEqual({ key: 'Project:x.md', label: 'x' })
  }
})
