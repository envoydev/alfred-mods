import { expect, test } from 'claude-code/testing'

import { DEFAULTS, FIELDS, SOURCES, holdRec, holdToast, legacyOf, movedToast, nameOf, resolve, skippedToast } from '../hooks/settings.ts'
import type { Field, Resolved, Skip, Source, Values } from '../hooks/settings.ts'

// A valid value for each field that differs from its default, and a second one that differs from both
const ONE: Values = { band: 'calm', bandPlace: 'under', bandRows: false, quiet: false, rec: 'on', handoff: 'auto', handoffAt: 70 }
const TWO: Values = { band: 'full', bandPlace: 'above', bandRows: true, quiet: true, rec: 'strict', handoff: 'off', handoffAt: 60 }

// The first skip a resolve listed
function skipOf(r: Resolved): Skip {
  const skip = r.skipped[0]
  if (skip === undefined) throw new Error('nothing skipped')
  return skip
}

test('the fields in their order, the sources highest first', () => {
  expect([...FIELDS]).toEqual(['band', 'bandPlace', 'bandRows', 'quiet', 'rec', 'handoff', 'handoffAt'])
  expect([...SOURCES]).toEqual(['policy', 'flag', 'local', 'project', 'user'])
})

test('each field from each source', () => {
  for (const field of FIELDS) {
    const alone = resolve({ user: { [field]: ONE[field] } }, {})
    expect(alone.values[field]).toEqual(ONE[field])
    expect(alone.from[field]).toBe('user')
    const pairs: [Source, Source][] = [['local', 'user'], ['flag', 'local'], ['policy', 'flag'], ['project', 'user']]
    for (const [high, low] of pairs) {
      const r = resolve({ [high]: { [field]: TWO[field] }, [low]: { [field]: ONE[field] } }, {})
      expect(r.values[field]).toEqual(TWO[field])
      expect(r.from[field]).toBe(high)
    }
  }
})

test('a bad value falls to the file below', () => {
  const r = resolve({ local: { band: 'compact' }, user: { band: 'calm' } }, {})
  expect(r.values.band).toBe('calm')
  expect(r.from.band).toBe('user')
  expect(r.skipped).toEqual([{ field: 'band', source: 'local' }])
  for (const bad of [100, 9, 80.5, '80']) {
    const b = resolve({ user: { handoffAt: bad } }, {})
    expect(b.values.handoffAt).toBe(80)
    expect(b.from.handoffAt).toBe('default')
    expect(b.skipped).toEqual([{ field: 'handoffAt', source: 'user' }])
  }
  const rows = resolve({ project: { bandRows: 'no' } }, {})
  expect(rows.values.bandRows).toBe(true)
  expect(rows.skipped).toEqual([{ field: 'bandRows', source: 'project' }])
})

test('a bad value under the one in use is not told', () => {
  const r = resolve({ local: { band: 'calm' }, user: { band: 'compact' } }, {})
  expect(r.values.band).toBe('calm')
  expect(r.skipped).toEqual([])
})

test('a non-object key gives that file nothing', () => {
  for (const local of ['on', ['x'], null, 3, true]) {
    const r = resolve({ local, user: { band: 'calm', rec: 'on' } }, {})
    expect(r.values.band).toBe('calm')
    expect(r.from.band).toBe('user')
    expect(r.values.rec).toBe('on')
    expect(r.skipped).toEqual([])
  }
})

test('unknown fields are ignored', () => {
  const r = resolve({ user: { rows: false, Band: 'calm' } }, {})
  expect(r.values).toEqual(DEFAULTS)
  expect(r.skipped).toEqual([])
  expect(r.userFields).toEqual([])
})

test('the old layer sits under the user file', () => {
  const alone = resolve({}, { rec: 'strict' })
  expect(alone.values.rec).toBe('strict')
  expect(alone.from.rec).toBe('legacy')
  const under = resolve({ user: { rec: 'off' } }, { rec: 'strict' })
  expect(under.values.rec).toBe('off')
  expect(under.from.rec).toBe('user')
})

test('the defaults', () => {
  const r = resolve({}, {})
  expect(r.values).toEqual(DEFAULTS)
  expect(DEFAULTS).toEqual({ band: 'full', bandPlace: 'above', bandRows: true, quiet: true, rec: 'off', handoff: 'ask', handoffAt: 80 })
  for (const field of FIELDS) expect(r.from[field]).toBe('default')
  expect(r.skipped).toEqual([])
  expect(r.userFields).toEqual([])
})

test('rec follows the order', () => {
  const r = resolve({ project: { rec: 'off' }, user: { rec: 'on' } }, {})
  expect(r.values.rec).toBe('off')
  expect(r.from.rec).toBe('project')
})

test('userFields lists the fields the user file gives', () => {
  expect(resolve({ user: { band: 'calm', rec: 'bad' } }, {}).userFields).toEqual(['band'])
  const fields: Field[] = resolve({ local: { band: 'full' }, user: { band: 'calm', handoffAt: 70 } }, {}).userFields
  expect(fields).toEqual(['band', 'handoffAt'])
})

test('the skipped toast names the file, the values and the value in use', () => {
  const r = resolve({ local: { band: 'compact' }, user: { band: 'calm' } }, {})
  expect(skippedToast(skipOf(r), r)).toBe('"band" in .claude/settings.local.json takes "full" or "calm" - using "calm" from ~/.claude/settings.json')
  const at = resolve({ user: { handoffAt: 100 } }, {})
  const text = skippedToast(skipOf(at), at)
  expect(text).toBe('"handoffAt" in ~/.claude/settings.json takes a whole number from 10 to 95 - using 80 from the default')
  expect(text).not.toContain('100')
  const legacy = resolve({ flag: { rec: 'loud' } }, { rec: 'on' })
  expect(skippedToast(skipOf(legacy), legacy)).toBe('"rec" in --settings takes "off", "on" or "strict" - using "on" from an earlier command')
  const each: [Field, unknown, string][] = [
    ['bandPlace', 'below', '"above" or "under"'],
    ['bandRows', 'no', 'true or false'],
    ['quiet', 1, 'true or false'],
    ['handoff', 'never', '"ask", "auto" or "off"']
  ]
  for (const [field, bad, values] of each) {
    const b = resolve({ policy: { [field]: bad } }, {})
    expect(skippedToast(skipOf(b), b)).toBe(`"${field}" in managed settings takes ${values} - using ${JSON.stringify(DEFAULTS[field])} from the default`)
  }
})

test('nameOf names each source', () => {
  expect(nameOf('user')).toBe('~/.claude/settings.json')
  expect(nameOf('project')).toBe('.claude/settings.json')
  expect(nameOf('local')).toBe('.claude/settings.local.json')
  expect(nameOf('flag')).toBe('--settings')
  expect(nameOf('policy')).toBe('managed settings')
  expect(nameOf('legacy')).toBe('an earlier command')
  expect(nameOf('default')).toBe('the default')
})

// The old commands' store keys, as 0.7 and the branches since wrote them (S7)
const RAW = { band: undefined, place: undefined, tools: undefined, quiet: undefined, rec: undefined, handoff: undefined }

test('legacyOf maps each stored choice', () => {
  expect(legacyOf(RAW)).toEqual({})
  expect(legacyOf({ ...RAW, band: 'calm' })).toEqual({ band: 'calm' })
  expect(legacyOf({ ...RAW, band: 'full' })).toEqual({ band: 'full' })
  expect(legacyOf({ ...RAW, place: 'under' })).toEqual({ bandPlace: 'under' })
  expect(legacyOf({ ...RAW, tools: 'open' })).toEqual({ bandRows: true })
  expect(legacyOf({ ...RAW, tools: 'closed' })).toEqual({ bandRows: false })
  expect(legacyOf({ ...RAW, quiet: true })).toEqual({ quiet: true })
  expect(legacyOf({ ...RAW, quiet: false })).toEqual({ quiet: false })
  for (const level of ['off', 'on', 'strict'] as const) expect(legacyOf({ ...RAW, rec: level })).toEqual({ rec: level })
  expect(legacyOf({ ...RAW, handoff: { mode: 'auto', threshold: 70 } })).toEqual({ handoff: 'auto', handoffAt: 70 })
  expect(legacyOf({ ...RAW, handoff: { mode: 'off' } })).toEqual({ handoff: 'off' })
  expect(legacyOf({ ...RAW, handoff: { threshold: 60 } })).toEqual({ handoffAt: 60 })
})

test('legacyOf leaves out what the old commands never wrote', () => {
  expect(legacyOf({ ...RAW, band: 'x', tools: 'maybe', rec: 'loud', handoff: 'ask' })).toEqual({})
  expect(legacyOf({ ...RAW, place: 'above', quiet: 'off', handoff: { mode: 'loud', threshold: 96 } })).toEqual({})
})

// S3's one departure: mid-session, REC never falls because the file that set it went quiet
test('holdRec takes the next level unless a lower source lowers it', () => {
  expect(holdRec(null, { level: 'off', from: 'user' })).toEqual({ level: 'off', from: 'user', isHeld: false })
  // A raise, from any source
  expect(holdRec({ level: 'on', from: 'local' }, { level: 'strict', from: 'default' })).toEqual({ level: 'strict', from: 'default', isHeld: false })
  // A lower level from the same source, or from one above it
  expect(holdRec({ level: 'strict', from: 'local' }, { level: 'off', from: 'local' })).toEqual({ level: 'off', from: 'local', isHeld: false })
  expect(holdRec({ level: 'on', from: 'user' }, { level: 'off', from: 'local' })).toEqual({ level: 'off', from: 'local', isHeld: false })
  expect(holdRec({ level: 'on', from: 'legacy' }, { level: 'off', from: 'user' })).toEqual({ level: 'off', from: 'user', isHeld: false })
  // A lower level from a lower source: held
  expect(holdRec({ level: 'on', from: 'local' }, { level: 'off', from: 'user' })).toEqual({ level: 'on', from: 'local', isHeld: true })
  expect(holdRec({ level: 'strict', from: 'project' }, { level: 'on', from: 'user' })).toEqual({ level: 'strict', from: 'project', isHeld: true })
  expect(holdRec({ level: 'on', from: 'policy' }, { level: 'off', from: 'default' })).toEqual({ level: 'on', from: 'policy', isHeld: true })
  // The same level is no hold
  expect(holdRec({ level: 'on', from: 'local' }, { level: 'on', from: 'user' })).toEqual({ level: 'on', from: 'user', isHeld: false })
})

// The review's #1: a toast box shows three lines of 40 cells, so the line to act on comes first and the common cases
// fit in 120 characters
test('the toasts put what to do first and fit the box', () => {
  expect(movedToast({ rec: 'strict', bandRows: false }).startsWith('Add "alfred-mods": { ')).toBe(true)
  expect(holdToast('strict', 'local').length).toBeLessThanOrEqual(120)
  const r = resolve({ local: { bandPlace: 'below' }, user: { bandPlace: 'under' } }, {})
  expect(skippedToast(skipOf(r), r).length).toBeLessThanOrEqual(120)
})

test('holdToast names the level and the file', () => {
  expect(holdToast('on', 'local')).toBe('REC stays on: .claude/settings.local.json no longer gives "rec" - fix the file, or set "rec": "off" in it')
  expect(holdToast('strict', 'project')).toBe('REC stays strict: .claude/settings.json no longer gives "rec" - fix the file, or set "rec": "off" in it')
})

// S7: the line to paste, the fields in S2's order
test('movedToast gives the line to paste', () => {
  expect(movedToast({ rec: 'strict', bandRows: false })).toBe('Add "alfred-mods": { "bandRows": false, "rec": "strict" } to ~/.claude/settings.json - the choices your earlier commands made')
  expect(movedToast({ handoffAt: 70, band: 'calm' })).toBe('Add "alfred-mods": { "band": "calm", "handoffAt": 70 } to ~/.claude/settings.json - the choices your earlier commands made')
})
