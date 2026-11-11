// Compact tool rows as a settings value (spec 2026-11-11 settings-values, S2): "quiet" true or false; an earlier /quiet's
// stored choice reads under the user's file (S7)
import { expect, test } from 'claude-code/testing'

import { START, engine, setUser, stubAll, watchState } from './kit.ts'

test('"quiet" true and false set it, from the user file', async ($, on) => {
  const kit = stubAll(on, { quiet: 'unset' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await setUser($, kit, { quiet: false })
  expect(state.get('quiet')).toEqual({ isOn: false })
  await setUser($, kit, { quiet: true })
  expect(state.get('quiet')).toEqual({ isOn: true })
  expect(kit.store.writes.filter(w => w.endsWith('settings:quiet'))).toEqual([])
})

test('on with nothing stored and no file', async ($, on) => {
  stubAll(on, { quiet: 'unset' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('quiet')).toEqual({ isOn: true })
})

for (const value of ['yes', 'off', 0]) {
  test(`a stored ${JSON.stringify(value)} reads as on: only false is off`, async ($, on) => {
    stubAll(on, { store: { 'settings:quiet': value } })
    const state = watchState(on)
    engine(on)
    await $.session.start(START)
    expect(state.get('quiet')).toEqual({ isOn: true })
  })
}

test('a test that stores nothing reads off, as every test before /quiet was on by default was written for', async ($, on) => {
  stubAll(on)
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
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

test('"quiet": true, then /clear: quiet reads on when the SessionStart hook returns', async ($, on) => {
  stubAll(on, { sources: { user: { 'alfred-mods': { quiet: true } } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'clear' })
  expect(state.get('quiet')).toEqual({ isOn: true })
})
