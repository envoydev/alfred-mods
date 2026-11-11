// /band: the full band with its info line, or calm, its two lines; every session's from `settings:band`
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PRESENTATION, START, engine, stubAll, watchState } from './kit.ts'

const USAGE = 'Usage: /band [full|calm]'

const band = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ command: 'band', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''

test('/band calm and full set it and read it first', async ($, on) => {
  const { store } = stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(await band($, 'calm')).toBe('Band: calm')
  expect(store.get('settings:band')).toBe('calm')
  expect(state.get('band')).toEqual({ mode: 'calm' })
  expect(await band($, ' FULL ')).toBe('Band: full')
  expect(store.get('settings:band')).toBe('full')
  expect(state.get('band')).toEqual({ mode: 'full' })
  // Another session set it calm; this one has not polled yet, and its bare /band reads the store
  store.set('settings:band', 'calm')
  expect(await band($, '')).toBe(`Band: calm\n${USAGE}`)
  expect(state.get('band')).toEqual({ mode: 'calm' })
})

test('bare /band prints the state and usage, full with nothing stored', async ($, on) => {
  const { store } = stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band')).toEqual({ mode: 'full' })
  expect(await band($, '')).toBe(`Band: full\n${USAGE}`)
  expect(await band($, 'maybe')).toBe(`Band: full\n${USAGE}`)
  expect(store.get('settings:band')).toBe(undefined)
})

for (const value of [true, 'CALM', 'off']) {
  test(`a stored ${JSON.stringify(value)} reads as full`, async ($, on) => {
    stubAll(on, { store: { 'settings:band': value, 'settings:band-tools': 'closed' } })
    const state = watchState(on)
    engine(on)
    await $.session.start(START)
    expect(state.get('band')).toEqual({ mode: 'full' })
  })
}

test('another session picks it up on its poll', async ($, on) => {
  const { clock, store } = stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  store.set('settings:band', 'calm')
  await clock.advance(30_000)
  expect(state.get('band')).toEqual({ mode: 'calm' })
})

test('/band calm, then /clear: calm holds', async ($, on) => {
  stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await band($, 'calm')
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('band')).toEqual({ mode: 'calm' })
})

test('a test that stores nothing reads calm, as every test before /band was written for', async ($, on) => {
  stubAll(on, { store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band') ?? { mode: 'calm' }).toEqual({ mode: 'calm' })
})
