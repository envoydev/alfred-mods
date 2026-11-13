import { expect, test } from 'claude-code/testing'

import { classify, fold, targetOf, toolKey } from '../hooks/outcome.js'
import type { CallFacts } from '../hooks/outcome.js'
import type { Failure } from '../types'

// Each fixture is a Phase 0 shape (the brief's question 12)
const base: CallFacts = { tool: 'Bash', checked: null, checkReason: null, asked: false, failedInTool: false, interrupted: false, classifierReason: null, hookDeny: null, result: null, aborted: false, autoMode: false }

test('a Bash exit is a new error with its first line', () => {
  expect(classify({ ...base, checked: 'allow', failedInTool: true, result: { isError: true, deny: null, text: 'Exit code 1\nboom' } }))
    .toEqual({ outcome: 'error', reason: 'Exit code 1', isNew: true, by: null })
})

test("Claude Code's own refusal before the check is an error, by the ruling", () => {
  expect(classify({ ...base, result: { isError: true, deny: null, text: 'Blocked: sleep 25 ...' } }).outcome).toBe('error')
})

// The text Claude Code hands the model wraps an input error in a tag the person has no use for (Task 8, live)
test("an input error's reason drops the tool_use_error tag", () => {
  expect(classify({ ...base, tool: 'Edit', failedInTool: true, result: { isError: true, deny: null, text: '<tool_use_error>String to replace not found in file.</tool_use_error>' } }).reason)
    .toBe('String to replace not found in file.')
})

test('a guard hook deny is blocked and never new', () => {
  expect(classify({ ...base, checked: 'deny', checkReason: 'guard: marked command', result: { isError: true, deny: null, text: 'x' } }))
    .toEqual({ outcome: 'blocked', reason: 'guard: marked command', isNew: false, by: null })
})

// A plugin's hook names its own command first, which filled the row before the message (Task 8, with Alfred Code); the
// row names its script in place of the command (spec C6)
test("a plugin hook's block reads its message on one line, by its script, without the hook's command", () => {
  const checkReason = 'PreToolUse:Bash hook error: [node "/p/stack/hooks/shell-guards.js"]: Blocked: this discards uncommitted work\n   M notes.txt'
  expect(classify({ ...base, checked: 'deny', checkReason, result: { isError: true, deny: null, text: 'x' } }))
    .toEqual({ outcome: 'blocked', reason: 'blocked by shell-guards.js: this discards uncommitted work', isNew: false, by: 'shell-guards.js' })
  // A command with no script keeps the message alone
  expect(classify({ ...base, checked: 'deny', checkReason: 'PreToolUse:Bash hook error: [grep -q x]: Blocked: no', result: { isError: true, deny: null, text: 'x' } }).reason)
    .toBe('PreToolUse:Bash hook error: Blocked: no')
})

// A hook command that holds its own brackets ends at the first ']: ', not the first ']' (release 3 review)
test('a hook command with brackets of its own keeps the message and no path', () => {
  const checkReason = 'PreToolUse:Bash hook error: [[ -x "/Users/jane/p/.claude/hooks/guard.sh" ] && "/Users/jane/p/.claude/hooks/guard.sh"]: Blocked: use Monitor'
  expect(classify({ ...base, checked: 'deny', checkReason, result: { isError: true, deny: null, text: 'x' } }))
    .toEqual({ outcome: 'blocked', reason: 'blocked by guard.sh: use Monitor', isNew: false, by: 'guard.sh' })
  const unnamed = 'PreToolUse:Bash hook error: [[ -f /Users/jane/x ] && exit 2]: Blocked: no'
  expect(classify({ ...base, checked: 'deny', checkReason: unnamed, result: { isError: true, deny: null, text: 'x' } }).reason)
    .toBe('PreToolUse:Bash hook error: Blocked: no')
})

test("the person's No is denied", () => {
  expect(classify({ ...base, checked: 'ask', asked: true, result: { isError: true, deny: null, text: 'rejected' } }))
    .toEqual({ outcome: 'denied', reason: 'denied by you', isNew: true, by: null })
})

test('a classifier block is blocked once PermissionDenied names the call', () => {
  expect(classify({ ...base, checked: 'ask', classifierReason: 'destructive git', result: { isError: true, deny: null, text: 'x' } }).reason).toBe('auto mode: destructive git')
})

test('an ask that errors with no prompt and no PermissionDenied is refused', () => {
  expect(classify({ ...base, checked: 'ask', result: { isError: true, deny: null, text: 'no' } }).outcome).toBe('refused')
})

test('in auto mode, an ask that errors with no prompt, no failure event and no PermissionDenied is a new error', () => {
  expect(classify({ ...base, checked: 'ask', autoMode: true, result: { isError: true, deny: null, text: 'Exit code 1' } }))
    .toEqual({ outcome: 'error', reason: 'Exit code 1', isNew: true, by: null })
})

test('an aborted call with no failure event is interrupted and not new', () => {
  expect(classify({ ...base, checked: 'allow', aborted: true, result: { isError: true, deny: null, text: 'Interrupted' } }))
    .toEqual({ outcome: 'error', reason: 'interrupted', isNew: false, by: null })
})

test("the person's No stays denied when its dispatch aborted", () => {
  expect(classify({ ...base, checked: 'ask', asked: true, aborted: true, result: { isError: true, deny: null, text: 'x' } }).outcome)
    .toBe('denied')
})

test("a failure event's own flags win over the abort", () => {
  expect(classify({ ...base, checked: 'allow', failedInTool: true, aborted: true, result: { isError: true, deny: null, text: 'Exit code 2' } }))
    .toEqual({ outcome: 'error', reason: 'Exit code 2', isNew: true, by: null })
})

test('an interrupted call is an error that is not new', () => {
  expect(classify({ ...base, checked: 'allow', failedInTool: true, interrupted: true, result: { isError: true, deny: null, text: '' } }))
    .toEqual({ outcome: 'error', reason: 'interrupted', isNew: false, by: null })
})

// An empty reason left the row with nothing after the target (final review minor)
test("an error with no text reads 'failed'", () => {
  expect(classify({ ...base, failedInTool: true, result: { isError: true, deny: null, text: '' } }).reason).toBe('failed')
  expect(classify({ ...base, result: { isError: true, deny: null, text: '  ' } }).reason).toBe('failed')
})

// A PermissionRequest hook's deny read 'refused' with no reason; the hook blocked it and said why (final review minor)
test("a permission hook's deny is blocked with its message", () => {
  expect(classify({ ...base, checked: 'ask', hookDeny: 'not on main', result: { isError: true, deny: null, text: 'not on main' } }))
    .toEqual({ outcome: 'blocked', reason: 'hook: not on main', isNew: false, by: null })
  expect(classify({ ...base, checked: 'ask', hookDeny: '', result: { isError: true, deny: null, text: '' } }).reason).toBe('blocked by a hook')
})

test('a long multi-line reason is one line of 80', () => {
  const r = classify({ ...base, failedInTool: true, result: { isError: true, deny: null, text: `${'e'.repeat(300)}\nstack` } })
  expect(r.reason.length).toBe(80)
})

test('keys and targets', () => {
  expect(toolKey('Skill', { skill: 'plan-builder' })).toBe('Skill: plan-builder')
  // An MCP tool by its server and its own name, a claude.ai connector's or a plugin's server without that prefix
  expect(toolKey('mcp__context7__get_docs', {})).toBe('context7:get_docs')
  expect(toolKey('mcp__claude_ai_Context7__query-docs', {})).toBe('Context7:query-docs')
  expect(toolKey('mcp__plugin_superpowers_chrome__use_browser', {})).toBe('superpowers_chrome:use_browser')
  expect(targetOf('Edit', { file_path: '/w/src/a.ts' }, '/w')).toBe('src/a.ts')
  expect(targetOf('Edit', { file_path: 'C:\\w\\src\\a.ts' }, 'C:\\w')).toBe('src\\a.ts')
  expect(targetOf('Bash', { command: 'npm test\n--x', description: 'Run tests' }, '/w')).toBe('Run tests')
})

test('repeats fold into ×N and the list keeps 10', () => {
  const row = (id: string, at: number): Failure => ({ id, at, tool: 'Bash', target: 'sleep 25', outcome: 'blocked', reason: 'r', detail: '', count: 1, isNew: false })
  expect(fold([row('a', 1)], row('b', 2))).toEqual([{ ...row('a', 2), count: 2 }])
  const many = Array.from({ length: 12 }, (_, i) => ({ ...row(String(i), i), target: String(i) }))
  expect(many.reduce((l, f) => fold(l, f), [] as Failure[])).toHaveLength(10)
})
