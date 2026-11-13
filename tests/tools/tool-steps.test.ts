// With "quiet", every call names what it worked on and draws its steps under it, as the web rows do (the user,
// 2026-11-12: 'What agent ... what job is done; What skill; What and where writing; What and where searching; What is
// asking and what is the responce; What doc mcp queryng; What monitoring'), and a repeat says what its count means
import { expect, test } from 'claude-code/testing'

import { DROPS_RESULT, callLine, groupLines } from '../../hooks/tools/compact'
import type { Line } from '../../hooks/core/types'
import type { CompactCall } from '../../hooks/tools/types'

const text = (lines: Line[]): string[] => lines.map(l => l.map(s => ('text' in s ? s.text : '')).join(''))
const CALL: CompactCall = { tool: 'Bash', input: {}, output: undefined, isErrored: false, isInterrupted: false, outcome: null, reason: null }
const call = (tool: string, input: unknown, output?: unknown, more: Partial<CompactCall> = {}): CompactCall => ({ ...CALL, tool, input, output, ...more })
const CWD = '/w/app'

const agentDone = (o: Record<string, unknown> = {}) => ({
  status: 'completed', agentId: 'a1', agentType: 'alfred-code:output-scorer', prompt: 'p', totalToolUseCount: 12, totalTokens: 31_200,
  totalDurationMs: 80_000, content: [{ type: 'text', text: '## Verdict\n\nC1.1 yes - the plan names every file it touches\nmore' }], ...o,
})

test('an Agent names its type, then what it was asked, what it found and what it took', () => {
  const c = call('Agent', { description: 'Review plan round 1', prompt: 'p', subagent_type: 'alfred-code:output-scorer' }, agentDone())
  expect(text(callLine(c, 120))).toEqual([
    '⏺ Agent · alfred-code:output-scorer · ✓',
    '  ⎿ asked: Review plan round 1',
    '  ⎿ result: C1.1 yes - the plan names every file it touches',
    '  ⎿ 12 tool uses · 31k tokens · 1m 20s',
  ])
})

test('an Agent with no type is general-purpose; one sent to the background says so', () => {
  const bg = call('Agent', { description: 'Watch CI', prompt: 'p' }, { status: 'async_launched', agentId: 'a2', description: 'Watch CI', prompt: 'p', outputFile: '/t/o' })
  expect(text(callLine(bg, 120))).toEqual(['⏺ Agent · general-purpose · ✓', '  ⎿ asked: Watch CI', '  ⎿ running in the background'])
})

test('a Skill names the skill and what it was given', () => {
  expect(text(callLine(call('Skill', { skill: 'superpowers:brainstorming' }, { success: true, commandName: 'brainstorming' }), 120)))
    .toEqual(['⏺ Skill · superpowers:brainstorming · ✓'])
  expect(text(callLine(call('Skill', { skill: 'solve-task', args: 'Move the switches into settings' }), 120)))
    .toEqual(['⏺ Skill · solve-task · ✓', '  ⎿ with: Move the switches into settings'])
})

test('a Write says what it wrote and where, from the project folder', () => {
  const made = call('Write', { file_path: `${CWD}/docs/plan.md`, content: 'a\nb\nc\n' }, { type: 'create', filePath: `${CWD}/docs/plan.md`, content: 'a\nb\nc\n', structuredPatch: [] })
  expect(text(callLine(made, 120, { cwd: CWD }))).toEqual(['⏺ Write · plan.md · ✓', '  ⎿ created docs/plan.md · 3 lines'])
  const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]
  const over = call('Write', { file_path: '/elsewhere/x.ts', content: 'a\nc\nd' }, { type: 'update', filePath: '/elsewhere/x.ts', content: 'a\nc\nd', structuredPatch: patch })
  expect(text(callLine(over, 120, { cwd: CWD }))).toEqual(['⏺ Write · x.ts · ✓', '  ⎿ rewrote /elsewhere/x.ts · +2 −1'])
})

test('an Edit says where and how many lines it added and removed', () => {
  const patch = [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 3, lines: ['-x', '+y', '+z', '+w'] }]
  const c = call('Edit', { file_path: `${CWD}/src/a.ts`, old_string: 'x', new_string: 'y' }, { filePath: `${CWD}/src/a.ts`, structuredPatch: patch, replaceAll: false })
  expect(text(callLine(c, 120, { cwd: CWD }))).toEqual(['⏺ Edit · a.ts · ✓', '  ⎿ changed src/a.ts · +3 −1'])
  expect(text(callLine({ ...c, output: { ...(c.output as object), replaceAll: true } }, 120, { cwd: CWD }))[1]).toBe('  ⎿ changed src/a.ts · +3 −1 · every match')
})

test('a TodoWrite counts its todos and names the one in progress', () => {
  const todos = [
    { content: 'a', status: 'completed', activeForm: 'Doing a' }, { content: 'b', status: 'completed', activeForm: 'Doing b' },
    { content: 'c', status: 'in_progress', activeForm: 'Writing the tests' }, { content: 'd', status: 'pending', activeForm: 'd' },
    { content: 'e', status: 'pending', activeForm: 'e' },
  ]
  expect(text(callLine(call('TodoWrite', { todos }), 120))).toEqual(['⏺ TodoWrite · 5 todos · 2 done, 1 in progress · ✓', '  ⎿ now: Writing the tests'])
})

test('a ToolSearch names its query and what it found', () => {
  expect(text(callLine(call('ToolSearch', { query: 'select:WebFetch', max_results: 5 }, { matches: ['WebFetch'], query: 'q', total_deferred_tools: 9 }), 120)))
    .toEqual(['⏺ ToolSearch · "select:WebFetch" · ✓', '  ⎿ found WebFetch'])
  expect(text(callLine(call('ToolSearch', { query: 'nothing', max_results: 5 }, { matches: [], query: 'q', total_deferred_tools: 9 }), 120))[1]).toBe('  ⎿ found nothing')
})

test('an AskUserQuestion draws each question, its options numbered, and the answer it got with its number', () => {
  const questions = [{ question: 'Which band mode?', header: 'Band', options: [{ label: 'Full', description: '' }, { label: 'Calm', description: '' }], multiSelect: false }]
  const c = call('AskUserQuestion', { questions }, { questions, answers: { 'Which band mode?': 'Calm' } })
  expect(text(callLine(c, 120))).toEqual(['⏺ AskUserQuestion · ✓', '  ⎿ Which band mode?', '  ⎿ options: 1. Full; 2. Calm', '  ⎿ answered: 2. Calm'])
  // Still open: the question and its options
  expect(text(callLine({ ...c, output: undefined }, 120))).toEqual(['⏺ AskUserQuestion · ✓', '  ⎿ Which band mode?', '  ⎿ options: 1. Full; 2. Calm'])
})

test('a multi-select answer numbers each option picked, in the answer\'s order', () => {
  const questions = [{ question: 'Which checks?', header: 'Checks', options: [{ label: 'Partial restore' }, { label: 'NF/PP restore' }, { label: 'Both' }], multiSelect: true }]
  const c = call('AskUserQuestion', { questions }, { questions, answers: { 'Which checks?': ['Partial restore', 'NF/PP restore'] } })
  expect(text(callLine(c, 120))).toContain('  ⎿ answered: 1. Partial restore, 2. NF/PP restore')
})

test('an answer that matches no option is drawn as typed, and a question with no options draws no options step', () => {
  const questions = [
    { question: 'Which database?', header: 'DB', options: [{ label: 'Postgres (Recommended)' }, { label: 'SQLite' }], multiSelect: false },
    { question: 'What name?', header: 'Name', multiSelect: false },
  ]
  const c = call('AskUserQuestion', { questions }, { questions, answers: { 'Which database?': 'MySQL', 'What name?': 'Alpha 2' } })
  expect(text(callLine(c, 120))).toEqual([
    '⏺ AskUserQuestion · ✓',
    '  ⎿ Which database?', '  ⎿ options: 1. Postgres (Recommended); 2. SQLite', '  ⎿ answered: MySQL',
    '  ⎿ What name?', '  ⎿ answered: Alpha 2',
  ])
})

test('two options with one label take the first one\'s number; an option with no label is left out but keeps the count', () => {
  const questions = [{ question: 'Pick', header: 'P', options: [{ label: 'Same' }, { description: 'no label' }, { label: 'Same' }], multiSelect: false }]
  const c = call('AskUserQuestion', { questions }, { questions, answers: { Pick: 'Same' } })
  expect(text(callLine(c, 120))).toEqual(['⏺ AskUserQuestion · ✓', '  ⎿ Pick', '  ⎿ options: 1. Same; 3. Same', '  ⎿ answered: 1. Same'])
})

test('a long options line is cut to the width', () => {
  const questions = [{ question: 'Q', header: 'Q', options: [{ label: 'Restart Invoker, then alpha checks (Recommended)' }, { label: 'Something else entirely' }], multiSelect: false }]
  const lines = text(callLine(call('AskUserQuestion', { questions }), 40))
  expect(lines.every(l => [...l].length <= 40)).toBe(true)
  expect(lines[2]?.startsWith('  ⎿ options: 1. Restart')).toBe(true)
})

test('an MCP call draws its arguments, one step each', () => {
  const c = call('mcp__context7__query-docs', { libraryId: '/vercel/next.js', query: 'app router caching', tokens: 2000, nested: { a: 1 } }, 'text\nmore')
  expect(text(callLine(c, 120))).toEqual([
    '⏺ mcp__context7__query-docs · 2 lines ✓',
    '  ⎿ libraryId: /vercel/next.js',
    '  ⎿ query: app router caching',
    '  ⎿ tokens: 2000',
  ])
})

test('a Monitor names what it watches', () => {
  expect(text(callLine(call('Monitor', { description: 'Watch the build', timeout_ms: 1, command: 'gh run watch 42\nsecond' }), 120)))
    .toEqual(['⏺ Monitor · Watch the build · ✓', '  ⎿ watches: gh run watch 42'])
  expect(text(callLine(call('Monitor', { description: 'Feed', timeout_ms: 1, ws: { url: 'wss://example.org/feed' } }), 120))[1]).toBe('  ⎿ watches: wss://example.org/feed')
})

test('a run of reads draws one step per thing read or searched, and where', () => {
  const lines = groupLines([
    call('Read', { file_path: `${CWD}/src/a.ts` }), call('Read', { file_path: `${CWD}/src/a.ts` }),
    call('Grep', { pattern: 'refreshToken', path: `${CWD}/src` }), call('Glob', { pattern: 'src/**/*.spec.ts' }),
  ], 120, { cwd: CWD })
  expect(text(lines)).toEqual([
    '⏺ 4 reads · ✓',
    '  ⎿ read src/a.ts · 2 times',
    '  ⎿ grep "refreshToken" in src',
    '  ⎿ glob src/**/*.spec.ts',
  ])
})

test('a long run of reads draws 4 steps and how many more', () => {
  const lines = text(groupLines(['a', 'b', 'c', 'd', 'e', 'f'].map(f => call('Read', { file_path: `${CWD}/${f}.ts` })), 120, { cwd: CWD }))
  expect(lines.slice(4)).toEqual(['  ⎿ read d.ts', '  ⎿ +2 more'])
})

test('a repeat says it ran N times in a row; two agents of one type with different jobs stay two rows', () => {
  const ls = call('Bash', { command: 'git status', description: 'Show working tree status' }, { stdout: 'x', stderr: '' })
  expect(text(groupLines([ls, ls, ls], 120))).toEqual(['⏺ Bash · Show working tree status · 1 line ✓ · 3 times in a row'])
  const a = (d: string) => call('Agent', { description: d, prompt: 'p' })
  expect(text(groupLines([a('One'), a('Two')], 120)).filter(l => l.startsWith('⏺'))).toEqual(['⏺ Agent · general-purpose · ✓', '⏺ Agent · general-purpose · ✓'])
})

test('Agent and AskUserQuestion results draw nothing under their steps', () => {
  expect(['Agent', 'AskUserQuestion'].every(t => DROPS_RESULT.includes(t))).toBe(true)
})

// With "quiet", a Bash result block draws nothing: emptied, it drew '(No output)' over a call that printed lines (live,
// 2026-11-12). What it carried besides the output, the auto-mode line and a background run, moves onto the row
const BASH_OUT = { stdout: 'a\nb', stderr: '', interrupted: false }

test('a Bash result draws nothing; its row says when auto mode allowed it', () => {
  expect(DROPS_RESULT.includes('Bash')).toBe(true)
  const c = call('Bash', { command: 'git status', description: 'Show status' }, BASH_OUT, { isAutoAllowed: true })
  expect(text(callLine(c, 120))).toEqual(['⏺ Bash · Show status · 2 lines ✓', '  ⎿ allowed by auto mode'])
  // A tool whose result block still draws keeps Claude Code's own line, so its row adds none
  expect(text(callLine(call('Read', { file_path: '/w/a.ts' }, { type: 'text' }, { isAutoAllowed: true }), 120))).toEqual(['⏺ Read · a.ts · ✓'])
})

test('a Bash run in the background, timed out or with a return-code note says so', () => {
  const bg = call('Bash', { command: 'npm run dev', description: 'Start dev server', run_in_background: true }, { ...BASH_OUT, stdout: '', backgroundTaskId: 'b1' })
  expect(text(callLine(bg, 120))).toEqual(['⏺ Bash · Start dev server · ✓', '  ⎿ running in the background'])
  const slow = call('Bash', { command: 'sleep 200' }, { ...BASH_OUT, timedOutAfterMs: 120_000 })
  expect(text(callLine(slow, 120))[1]).toBe('  ⎿ timed out after 2m')
  const none = call('Bash', { command: 'grep x f' }, { ...BASH_OUT, stdout: '', returnCodeInterpretation: 'No matches found' })
  expect(text(callLine(none, 120))).toEqual(['⏺ Bash · grep x f · ✓', '  ⎿ No matches found'])
})
