// Each pane the mod opens closes from the prompt (the user, 2026-11-12: on the terminal's main screen nothing takes a
// click, so the pane's mark is out of reach): '/inspect close', '/rec words close', and Esc at an idle, empty prompt
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PRESENTATION, START, engine, stubAll } from './kit.js'

const run = async ($: Engine, command: string, args: string): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

async function start($: Engine, on: Parameters<typeof stubAll>[0]) {
  const kit = stubAll(on)
  engine(on)
  await $.session.start(START)
  return kit
}

test('/inspect close closes the inspect pane', async ($, on) => {
  const { closed, panes } = await start($, on)
  expect(await run($, 'inspect', '')).toBe('Opened the inspect pane.')
  expect(await run($, 'inspect', 'Close')).toBe('Closed the inspect pane.')
  expect(closed).toEqual(['inspect'])
  expect(panes.map(p => p.id)).toEqual([])
})

test('/inspect close with no pane open says so and closes nothing', async ($, on) => {
  const { closed, opened } = await start($, on)
  expect(await run($, 'inspect', 'close')).toBe('The inspect pane is not open.')
  expect(closed).toEqual([])
  expect(opened).toEqual([])
})

test('/rec words close closes the REC words pane and leaves the inspect pane', async ($, on) => {
  const { closed, panes } = await start($, on)
  await run($, 'inspect', '')
  expect(await run($, 'rec', 'words')).toBe('Opened the REC words pane.')
  expect(await run($, 'rec', 'words close')).toBe('Closed the REC words pane.')
  expect(closed).toEqual(['rec'])
  expect(panes.map(p => p.id)).toEqual(['inspect'])
  expect(await run($, 'rec', 'words close')).toBe('The REC words pane is not open.')
})

test('each pane opens so that Esc closes it', async ($, on) => {
  const { escapes } = await start($, on)
  await run($, 'inspect', 'tools')
  await run($, 'rec', 'words')
  expect(escapes).toEqual(['inspect', 'rec'])
})
