import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { PRESENTATION, rows, stubAll, watchState } from './kit.ts'
import { blockerOf } from '../hooks/outcome.ts'
import type { Failure } from '../types'

// Spec C6: a hook's block names the script that blocked it, and the Tools tab counts blocks per script
const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const answered = (text = 'ok') => ({ result: text, text })
const guard = (script: string, message: string) => `PreToolUse:Bash hook error: [node "/h/hooks/${script}"]: Blocked: ${message}`

// Every Bash call the person's guard hooks see: the reason a test sets for a command, else allowed
function guards(on: On, table: Record<string, string>): void {
  on('tool.check', (_, e, next) => {
    const command = String((e.input as { command?: unknown } | null)?.command ?? '')
    const reason = Object.entries(table).find(([k]) => command.startsWith(k))?.[1]
    return reason === undefined ? next(e) : { decision: 'deny', reason, hook: 'PreToolUse' }
  })
  on('tool.call', () => answered())
}

const toolsTab = async ($: Engine, surface: RenderSurface): Promise<string[]> => {
  await $.command.run({ command: 'inspect', args: 'tools', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
  const out = await rows(ui)
  await ui.unmount()
  return out
}

test('blockerOf names the script', () => {
  expect(blockerOf('hook error: [node "/h/guard-bash.js"]: Blocked: use Monitor')).toBe('guard-bash.js')
  expect(blockerOf('PreToolUse:Bash hook error: [bash ./guards/check.sh --strict]: Blocked: no')).toBe('check.sh')
  for (const ext of ['js', 'mjs', 'cjs', 'ts', 'sh', 'py', 'ps1', 'rb']) expect(blockerOf(`hook error: [run /h/g.${ext}]: x`)).toBe(`g.${ext}`)
  expect(blockerOf("hook error: ['/h/q.py']: x")).toBe('q.py')
  expect(blockerOf('hook error: [python3 "/h/a b/guard.py" --mode strict]: x')).toBe('guard.py')
})

// Review Focus 5
test('a Windows command names its script only', () => {
  const name = blockerOf('PreToolUse:Bash hook error: [node "C:\\Users\\me\\.claude\\hooks\\guard-bash.js"]: Blocked: use Monitor')
  expect(name).toBe('guard-bash.js')
  expect(blockerOf('hook error: [powershell -File C:\\Users\\me\\hooks\\Check-Shell.ps1]: no')).toBe('Check-Shell.ps1')
})

test('no script, two brackets, a long name', () => {
  expect(blockerOf('hook error: [node -e "process.exit(2)"]: no')).toBeNull()
  expect(blockerOf("hook error: [grep -q probe-guard && { echo 'guard: marked' >&2; exit 2; }; exit 0]: guard: marked")).toBeNull()
  expect(blockerOf('hook error: [node /h/a.js]: Blocked: see [node /h/b.js]')).toBe('a.js')
  expect(blockerOf(`hook error: [node /h/${'g'.repeat(57)}.js]: x`)).toBeNull()
  expect(blockerOf(`hook error: [node /h/${'g'.repeat(37)}.js]: x`)).toBe(`${'g'.repeat(37)}.js`)
  expect(blockerOf('guard: marked')).toBeNull()
  expect(blockerOf('hook error: node /h/a.js: no bracket')).toBeNull()
})

for (const surface of SURFACES) {
  test(`a block reads blocked by <name> (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on)
    const state = watchState(on)
    guards(on, { 'git push': guard('guard-bash.js', 'use Monitor'), 'echo probe': 'guard: marked', 'rm ': 'PreToolUse:Bash hook error: [grep -q rm]: no rm' })

    await $.tool.call({ tool: 'Bash', command: 'git push --force', description: 'Push' })
    await $.tool.call({ tool: 'Bash', command: 'echo probe-guard', description: 'Probe' })
    await $.tool.call({ tool: 'Bash', command: 'rm a.txt', description: 'Remove' })

    expect((state.get('failures') as Failure[]).map(f => [f.reason, f.by])).toEqual([
      ['blocked by guard-bash.js: use Monitor', 'guard-bash.js'],
      ['guard: marked', null],
      ['PreToolUse:Bash hook error: no rm', null],
    ])
    const lines = await toolsTab($, surface)
    expect(lines.some(l => /^1 ⊘ \d\d:\d\d Bash +Push +blocked by guard-bash\.js: use Monitor/.test(l))).toBe(true)
    expect(lines.some(l => l.includes('/h/hooks'))).toBe(false)
  })

  test(`the Tools tab counts blocks by hook (${surface})`, { timeoutMs: 15_000 }, async ($, on) => {
    stubAll(on)
    const state = watchState(on)
    guards(on, { 'git ': guard('guard-bash.js', 'use Monitor'), 'cat ': guard('guard-sensitive-data.js', 'a secret file') })

    // Eleven blocks with as many targets: the failure list keeps 10, the count keeps every one
    for (let i = 0; i < 11; i++) await $.tool.call({ tool: 'Bash', command: `git reset --hard HEAD~${i}`, description: `Reset ${i}` })
    await $.tool.call({ tool: 'Bash', command: 'cat .env', description: 'Read env' })

    expect(state.get('failures')).toHaveLength(10)
    expect(state.get('blockers')).toEqual({ 'guard-bash.js': 11, 'guard-sensitive-data.js': 1 })
    const lines = await toolsTab($, surface)
    const at = lines.findIndex(l => l.startsWith('Blocked by hooks'))
    expect(lines[at]?.trimEnd()).toBe('Blocked by hooks  guard-bash.js ×11 · guard-sensitive-data.js ×1')
    // Under the table, before the failures
    expect(lines[at - 1]?.startsWith('Bash ')).toBe(true)
    expect(lines[at + 1]).toBe('Last failures and blocks')
  })
}

test("a PermissionRequest hook's deny is named too, and a later PermissionDenied moves the count", { timeoutMs: 15_000 }, async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'PermissionRequest hook error: [node /h/perm-guard.mjs]: Blocked: not on main' } }))
  on('tool.call', () => answered())

  await $.tool.call({ tool: 'Bash', command: 'git push', tool_use_id: 't1' })
  expect((state.get('failures') as Failure[])[0]).toMatchObject({ outcome: 'blocked', reason: 'blocked by perm-guard.mjs: not on main', by: 'perm-guard.mjs' })
  expect(state.get('blockers')).toEqual({ 'perm-guard.mjs': 1 })

  // The classifier is named the blocker after all: the count follows the row
  await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1', reason: 'pushes to main' })
  expect((state.get('failures') as Failure[])[0]).toMatchObject({ reason: 'auto mode: pushes to main', by: null })
  expect(state.get('blockers')).toEqual({})
})

// Spec 'Backward compatibility': a failure an earlier version kept has no `by`, and there is no blockers atom
test('an old failure without by reads as null, and no blockers atom draws no line', { timeoutMs: 15_000 }, async ($, on) => {
  const old = { id: 'f0', at: 0, tool: 'Bash', target: 'Push', outcome: 'blocked', reason: 'PreToolUse:Bash hook error: Blocked: use Monitor', detail: '', count: 1, isNew: false }
  const written = new Set<string>()
  on('state.set', async ($$, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', async ($$, e, next) => {
    const r = await next(e)
    if (e.key !== 'failures' || written.has(e.key) || r.value === undefined) return r
    return { value: { ...r.value, value: { shape: 'failures-1', value: [old] } } }
  })
  stubAll(on)

  for (const surface of SURFACES) {
    const lines = await toolsTab($, surface)
    expect(lines.some(l => /^1 ⊘ \d\d:\d\d Bash +Push +PreToolUse:Bash hook error: Blocked: use Monitor/.test(l))).toBe(true)
    expect(lines.some(l => l.startsWith('Blocked by hooks'))).toBe(false)
  }
})
