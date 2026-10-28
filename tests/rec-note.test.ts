import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'

import { PRESENTATION, START, engine, stubAll } from './kit.ts'

const ON = 'Screen recording is on (session-inspector REC). Until told it is off, do not write secret values, API keys, tokens, passwords, email addresses or phone numbers in replies; refer to them by name, such as "the token in .env". Work on the task as usual.'
const STRICT = `${ON} Also leave out account names, home folder paths and dollar amounts.`
const OFF = 'Screen recording is off (session-inspector REC); the earlier limit on secret values no longer applies.'

const rec = ($: Engine, args: string) => $.command.run({ command: 'rec', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

// What the model read beside each prompt, as Claude Code received it beneath the mod
function prompts(on: On): (readonly string[])[] {
  const seen: (readonly string[])[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context ?? [])
    return { text: e.text }
  })
  return seen
}

async function ask($: Engine, origin: PromptOrigin = { kind: 'composer' }): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin })
}

async function start($: Engine, on: On): Promise<(readonly string[])[]> {
  stubAll(on)
  const seen = prompts(on)
  engine(on, ['prompt.submit'])
  await $.session.start(START)
  return seen
}

test('REC on adds the on note to the next composer prompt, once', async ($, on) => {
  const seen = await start($, on)
  await ask($)
  await rec($, 'on')
  await ask($)
  await ask($)
  expect(seen).toEqual([[], [ON], []])
})

test('strict adds its line', async ($, on) => {
  const seen = await start($, on)
  await rec($, 'strict')
  await ask($, { kind: 'bridge' })
  expect(seen).toEqual([[STRICT]])
})

test('off adds the off note', async ($, on) => {
  const seen = await start($, on)
  await rec($, 'on')
  await ask($)
  await rec($, 'off')
  await ask($)
  await ask($)
  expect(seen).toEqual([[ON], [OFF], []])
})

test('on and off again before a prompt adds nothing', async ($, on) => {
  const seen = await start($, on)
  await rec($, 'on')
  await rec($, 'off')
  await ask($)
  expect(seen).toEqual([[]])
})

const KEPT = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

test('a main-loop compaction while on arms the note again', async ($, on) => {
  const seen = await start($, on)
  await rec($, 'on')
  await ask($)
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  await ask($)
  // An agent's compaction leaves the main loop's history alone
  await $.session.compact({ trigger: 'auto', messages: KEPT, agentId: 'a1' })
  await ask($)
  expect(seen).toEqual([[ON], [ON], []])
})

test('a prompt from a task notice carries no note', async ($, on) => {
  const seen = await start($, on)
  await rec($, 'on')
  await ask($, { kind: 'task-notification' })
  await ask($)
  expect(seen).toEqual([[], [ON]])
})
