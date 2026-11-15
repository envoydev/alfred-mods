import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SPAWN, START, SWITCH, engine, stubAll } from '../kit'

// The rules file Claude Code reports loaded, as tests/band-rows.test.ts raises it
const LOAD = { file_path: '/w/.claude/rules/web.md', memory_type: 'Project', load_reason: 'path_glob_match', globs: ['src/**/*.ts'], trigger_file_path: '/w/src/app.ts' } as never

// Each gating hook still answers with the answer beneath it while every state read and write is refused: the hooks
// restructure moves each body out of register.ts and must keep this. A lost .catch shows in the validate surface
// ('gating: <hook> catch=true'), not here: Claude Code passes such an event on by itself.
const CASES: [string, ($: Engine) => Promise<unknown>, unknown][] = [
  ['agent.spawn', $ => $.agent.spawn(SPAWN), { model: 'claude-haiku-5-5', agentId: 'a1' }],
  ['tool.call', $ => $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1' } as never), { result: 'ok', text: 'ok' }],
  ['tool.check', $ => $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'c1' }), { decision: 'allow' }],
  ['classic.UserPromptSubmit', $ => $.classic.UserPromptSubmit({ prompt: 'q', permission_mode: 'auto' } as never), {}],
  ['classic.PostToolUseFailure', $ => $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'c1', error: 'Exit code 1' } as never), {}],
  ['classic.PostToolUse', $ => $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'c1' } as never), {}],
  ['classic.PermissionRequest', $ => $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never), {}],
  ['classic.PermissionDenied', $ => $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'c1', reason: 'no' } as never), {}],
  ['classic.SessionStart', $ => $.classic.SessionStart({ source: 'clear' } as never), {}],
  ['classic.InstructionsLoaded', $ => $.classic.InstructionsLoaded(LOAD), {}],
  ['classic.ConfigChange', $ => $.classic.ConfigChange({ source: 'user_settings' } as never), {}],
  ['prompt.submit', $ => $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } }), { text: 'q' }],
  ['session.compact', $ => $.session.compact({ trigger: 'manual', messages: [{ role: 'user' as const, text: 'q', toolUses: [] }] } as never), { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }],
  ['classic.PostModelSwitch', $ => $.classic.PostModelSwitch(SWITCH as never), {}],
  ['classic.PreModelSwitch', $ => $.classic.PreModelSwitch(SWITCH as never), {}],
]
for (const [name, raise, answer] of CASES) {
  test(`${name}: with every state read and write refused, the event still gets the answer beneath`, async ($, on) => {
    const refuse = { isOn: false }
    on('state.get', (_, e, next) => (refuse.isOn ? { deny: 'test: state read refused' } : next(e)))
    on('state.set', (_, e, next) => (refuse.isOn ? { deny: 'test: state write refused' } : next(e)))
    stubAll(on)
    engine(on)
    on('classic.PermissionRequest', () => ({}))
    on('tool.check', () => ({ decision: 'allow' as const }))
    await $.session.start(START)
    refuse.isOn = true
    expect(await raise($)).toEqual(answer)
  })
}
