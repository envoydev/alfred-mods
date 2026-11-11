// The band's switches as settings values (spec 2026-11-11 settings-values, S2): "band" full or calm, "bandPlace" above
// or under, "bandRows" open or closed; an earlier /band's stored choice reads under the user's file (S7)
import { expect, test } from 'claude-code/testing'

import { START, engine, setUser, stubAll, watchState } from './kit.ts'

test('"band": "calm" and "full" set it, from the user file', async ($, on) => {
  const kit = stubAll(on, { band: 'unset', quiet: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await setUser($, kit, { band: 'calm' })
  expect(state.get('band')).toEqual({ mode: 'calm' })
  await setUser($, kit, { band: 'full' })
  expect(state.get('band')).toEqual({ mode: 'full' })
  expect(kit.store.writes.filter(w => w.endsWith('settings:band'))).toEqual([])
})

test('full with nothing stored and no file', async ($, on) => {
  stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band')).toEqual({ mode: 'full' })
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

test('"band": "calm", then /clear: calm holds', async ($, on) => {
  stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' }, sources: { user: { 'alfred-mods': { band: 'calm' } } } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
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

// The user's answer, 2026-11-11: 'Under, opt-in' - now "bandPlace": "under", for every project the file covers
test('"bandPlace": "under" draws under, "above" draws above, and nothing is stored', async ($, on) => {
  const kit = stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed' } })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  await setUser($, kit, { bandPlace: 'under' })
  expect(state.get('band')).toEqual({ mode: 'full', isUnder: true })
  await setUser($, kit, { bandPlace: 'above' })
  expect(state.get('band')).toEqual({ mode: 'full' })
  expect(kit.store.writes.filter(w => w.endsWith('settings:band-place'))).toEqual([])
})

test('"bandRows" opens and closes the rows', async ($, on) => {
  const kit = stubAll(on, { band: 'unset' })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band')).toEqual({ mode: 'full', isToolsOpen: true })
  await setUser($, kit, { bandRows: false })
  expect(state.get('band')).toEqual({ mode: 'full' })
  await setUser($, kit, { bandRows: true })
  expect(state.get('band')).toEqual({ mode: 'full', isToolsOpen: true })
})

test('a refused read of the place leaves the band above', async ($, on) => {
  stubAll(on, { band: 'unset', store: { 'settings:band-tools': 'closed', 'settings:band-place': 'under' }, refuseStore: ['settings:band-place'] })
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  expect(state.get('band')).toEqual({ mode: 'full' })
})
