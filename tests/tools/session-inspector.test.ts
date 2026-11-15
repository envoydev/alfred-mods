import { expect, test } from 'claude-code/testing'

test('a tool call reaches Claude Code untouched', async ($, on) => {
  // Answer the tool call in Claude Code's place, so no tool runs
  on('tool.call', () => ({ result: 'claude code answered' }))

  // The mod observes tool calls and never approves, denies or rewrites one
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out).toEqual({ result: 'claude code answered' })
})
