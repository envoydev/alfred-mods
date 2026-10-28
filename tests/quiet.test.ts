import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PRESENTATION, START, engine, stubAll, watchState } from './kit.ts'

const USAGE = 'Usage: /quiet [on|off]'

const quiet = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ command: 'quiet', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

test('/quiet on and off set it and read it first', async ($, on) => {
  const { store } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(await quiet($, 'on')).toBe('Compact tool rows: on')
  expect(store.get('settings:quiet')).toBe(true)
  expect(state.get('quiet')).toEqual({ isOn: true })
  expect(await quiet($, 'off')).toBe('Compact tool rows: off')
  expect(store.get('settings:quiet')).toBe(false)
  expect(state.get('quiet')).toEqual({ isOn: false })
  // Another session turned it on; this one has not polled yet, and its bare /quiet reads the store
  store.set('settings:quiet', true)
  expect(await quiet($, '')).toBe(`Compact tool rows: on\n${USAGE}`)
  expect(state.get('quiet')).toEqual({ isOn: true })
})

test('bare /quiet prints the state and usage', async ($, on) => {
  const { store } = stubAll(on)
  engine(on)
  await $.session.start(START)
  expect(await quiet($, '')).toBe(`Compact tool rows: off\n${USAGE}`)
  expect(store.get('settings:quiet')).toBe(undefined)
  expect(await quiet($, 'maybe')).toBe(`Compact tool rows: off\n${USAGE}`)
  expect(store.get('settings:quiet')).toBe(undefined)
})

test('a stored value other than true reads as off', async ($, on) => {
  stubAll(on, { store: { 'settings:quiet': 'yes' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(await quiet($, '')).toBe(`Compact tool rows: off\n${USAGE}`)
  expect(state.get('quiet') ?? { isOn: false }).toEqual({ isOn: false })
})

test('another session picks it up on its poll', async ($, on) => {
  const { clock, store } = stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  store.set('settings:quiet', true)
  await clock.advance(30_000)
  expect(state.get('quiet')).toEqual({ isOn: true })
})

test('/quiet on, then /clear: quiet reads on when the SessionStart hook returns', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await quiet($, 'on')
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('quiet')).toEqual({ isOn: true })
})
