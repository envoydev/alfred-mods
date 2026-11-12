import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement, RenderInput, RenderSurface, SessionUsage } from 'claude-code'

import { mask, setRec, toast } from '../hooks/mask.ts'
import { REC_HELP } from '../hooks/rec.ts'
import { planView } from '../hooks/plan.ts'
import { planLine } from '../hooks/planlines.ts'
import { FIVE, FIVE_OVERHEAD, FIVE_TIMES, NOW } from './plans.ts'
import { PRESENTATION, SPINNER, START, engine, held, rows, setUser, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const SUBSCRIPTION: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 60_000, percent: 30 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-28T17:00:00Z' }],
  cost: { usd: 3.12 },
}
const HOME = { HOME: '/Users/jane' }
const ON = '● REC on · hiding keys · emails · phones'
const WORDS = ['Acme', 'Globex', 'Initech']

const rec = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ command: 'rec', args, origin: { kind: 'composer' }, presentation: PRESENTATION })).text ?? ''
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
// Each drawing is read once and unmounted, so the next mounts afresh
async function drawn(ui: { drawn: Parameters<typeof rows>[0]['drawn']; unmount: () => Promise<void> }): Promise<string[]> {
  const out = await rows(ui)
  await ui.unmount()
  return out
}
const band = async ($: Engine, surface: RenderSurface, more: Partial<typeof BAND> = {}) =>
  drawn(await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: { ...BAND, ...more } }))
const inspectPane = async ($: Engine, surface: RenderSurface) =>
  drawn(await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE }))
const recPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'rec', props: { ...PANE, title: 'REC words' } })

// Claude Code answers a `false` command with an error whose first line names an address
function failingCalls(on: On): void {
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command.startsWith('false')
      ? { isError: true as const, result: 'jane.doe@example.com: permission denied', text: 'jane.doe@example.com: permission denied' }
      : { result: 'ok', text: 'ok' })
}

async function failingTurn($: Engine): Promise<void> {
  await $.prompt.submit({ text: 'q', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'c1' })
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
}

// S5: bare /rec prints the level in force, its source and the help, and writes nothing
test('bare /rec over nothing stored prints off from the default and writes nothing', async ($, on) => {
  const { store, toasts } = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  expect(await rec($, '')).toBe(`REC off - from the default\n${REC_HELP}`)
  expect(store.get('settings:rec')).toBe(undefined)
  expect(toasts).toEqual([])
})

test('bare /rec over a stored on prints the status and writes nothing', async ($, on) => {
  const { store, toasts } = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'on' } })
  engine(on)
  await $.session.start(START)
  expect(await rec($, '')).toBe(`${ON} - from an earlier /rec\n${REC_HELP}`)
  expect(store.get('settings:rec')).toBe('on')
  expect(toasts).toEqual([])
})

test('a session that has not read a file set strict yet: bare /rec reads it and draws strict at once', async ($, on) => {
  const { sources } = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  expect((await band($, 'terminal')).join('\n')).toContain('$3.12')
  // The file changed; no ConfigChange or poll reached this session yet
  sources.user['alfred-mods'] = { rec: 'strict' }
  expect((await rec($, '')).split('\n')[0]).toBe('● REC strict · hiding keys · emails · phones · account · home paths · $ amounts - from ~/.claude/settings.json')
  const lines = await band($, 'terminal')
  expect(lines[0]!.startsWith('● REC')).toBe(true)
  expect(lines.join('\n')).toContain('$•.••')
  expect(lines.join('\n')).not.toContain('$3.12')
})

test('"rec" on, strict and off in the user file set the level, each change toasted once', async ($, on) => {
  const kit = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  await setUser($, kit, { rec: 'on' })
  await setUser($, kit, { rec: 'strict' })
  // The same level again changes nothing, so no toast
  await setUser($, kit, { rec: 'strict' })
  await setUser($, kit, { rec: 'off' })
  expect(kit.toasts).toEqual([ON, '● REC strict · hiding keys · emails · phones · account · home paths · $ amounts', 'REC off'])
  expect(kit.store.writes.filter(w => w.endsWith('settings:rec'))).toEqual([])
})

for (const surface of SURFACES) {
  test(`words are added in the pane, and a short, a 101st and a duplicate word are refused with the reason (${surface})`, async ($, on) => {
    const { store, opened } = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
    engine(on)
    await $.session.start(START)
    expect(await rec($, 'words')).toBe('Opened the REC words pane.')
    expect(opened).toContain('rec')
    const ui = await recPane($, surface)
    await ui.input({ key: 'word', text: '  Acme  ' })
    expect(store.get('rec:words')).toEqual(['Acme'])
    expect((await rows(ui)).some(l => l.includes('Acme') && l.includes('remove'))).toBe(true)
    await ui.input({ key: 'word', text: 'ab' })
    expect((await rows(ui)).join('\n')).toContain('A word needs 3 to 64 characters.')
    await ui.input({ key: 'word', text: 'ACME' })
    expect((await rows(ui)).join('\n')).toContain('That word is already in the list.')
    // The next submit takes the reason down
    await ui.input({ key: 'word', text: 'Globex' })
    expect((await rows(ui)).join('\n')).not.toContain('already in the list')
    store.set('rec:words', Array.from({ length: 100 }, (_, i) => `word${i}`))
    await ui.input({ key: 'word', text: 'Initech' })
    expect((await rows(ui)).join('\n')).toContain('The list holds 100 words at most.')
    expect((store.get('rec:words') as string[]).length).toBe(100)
  })

  test(`an add made where memory lacks a stored word keeps both (${surface})`, async ($, on) => {
    const { store } = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'rec:words': ['Acme'] } })
    engine(on)
    await $.session.start(START)
    store.set('rec:words', ['Acme', 'Globex'])
    const ui = await recPane($, surface)
    await ui.input({ key: 'word', text: 'Initech' })
    expect(store.get('rec:words')).toEqual(['Acme', 'Globex', 'Initech'])
    // The list is drawn from the store after the write
    expect((await rows(ui)).filter(l => l.includes('remove'))).toHaveLength(3)
  })

  test(`remove in the pane drops only that word, and a word another session added survives (${surface})`, async ($, on) => {
    const { store } = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'rec:words': ['Acme', 'Globex'] } })
    engine(on)
    await $.session.start(START)
    const ui = await recPane($, surface)
    store.set('rec:words', ['Acme', 'Globex', 'Initech'])
    await ui.press({ key: 'remove-0' })
    expect(store.get('rec:words')).toEqual(['Globex', 'Initech'])
  })

  test(`with REC on the pane shows only the count (${surface})`, async ($, on) => {
    stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'on', 'rec:words': WORDS } })
    engine(on)
    await $.session.start(START)
    const lines = await rows(await recPane($, surface))
    expect(lines).toContain('3 private words · turn REC off to see or remove them')
    expect(lines.some(l => l.endsWith('remove'))).toBe(false)
    expect(lines.join('\n')).not.toContain('Globex')
    expect(lines.join('\n')).not.toContain('‹private›')
  })

  test(`the band leads with ● REC in every state, the narrow form included (${surface})`, async ($, on) => {
    stubAll(on, { env: HOME, store: { 'settings:rec': 'on' } })
    engine(on)
    await $.session.start(START)
    // No reading yet: the mark alone
    expect(await band($, surface)).toEqual(['● REC'])
    await $.session.measure({ context: SUBSCRIPTION.context, rateLimits: SUBSCRIPTION.rateLimits, changed: ['context'] })
    for (const more of [{}, { bodyColumns: 80 }, { isWorking: true }, { isWorking: true, bodyColumns: 80 }]) {
      const lines = await band($, surface, more)
      expect(lines[0]!.startsWith('● REC │ ')).toBe(true)
    }
  })

  test(`the Now tab's first row is the status, strict's with account, home paths and $ amounts (${surface})`, async ($, on) => {
    const kit = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'on', 'rec:words': WORDS } })
    engine(on)
    await $.session.start(START)
    await inspect($, 'now')
    expect(await inspectPane($, surface)).toContain(`${ON} · 3 private words`)
    await setUser($, kit, { rec: 'strict' })
    expect(await inspectPane($, surface)).toContain('● REC strict · hiding keys · emails · phones · 3 private words · account · home paths · $ amounts')
    await setUser($, kit, { rec: 'off' })
    expect((await inspectPane($, surface)).join('\n')).not.toContain('● REC')
  })

  test(`with REC on the band, the pane and the spinner draw no sample in clear (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'strict' } })
    // A `false` fails at once; any other call runs for a minute, so the spinner shows it
    on('tool.call', async (_, e) => {
      if (e.tool === 'Bash' && e.command.startsWith('false')) return { isError: true as const, result: 'jane.doe@example.com: permission denied', text: 'jane.doe@example.com: permission denied' }
      await clock.sleep(60_000)
      return { result: 'ok', text: 'ok' }
    })
    on('ui.render', { component: 'Spinner' }, (h$, e) => {
      const { Text } = h$.ui.resolve(e)
      return h(Text, null, e.props.word + e.props.suffix) as RenderElement
    })
    engine(on, ['tool.call'])
    await $.session.start(START)
    await failingTurn($)
    await inspect($, 'now')
    const seen = [...await band($, surface), ...await inspectPane($, surface)].join('\n')
    expect(seen).toContain('‹email›')
    expect(seen).toContain('$•.••')
    expect(seen).not.toContain('@example.com')
    expect(seen).not.toContain('$3.12')
    await $.turn.start({ text: 'q', turnId: 't2' })
    held($.tool.call({ tool: 'Bash', command: 'cat /Users/jane/notes-jane.doe@example.com', tool_use_id: 'c2' }))
    await clock.settle()
    const spun = (await drawn(await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Spinner', requestId: 'main', props: SPINNER }))).join('\n')
    expect(spun).toContain('Bash')
    expect(spun).not.toContain('@example.com')
    expect(spun).not.toContain('/Users/jane')
  })

  test(`a failure recorded while REC is on draws in clear after "rec": "off" (${surface})`, async ($, on) => {
    const kit = stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'on' } })
    failingCalls(on)
    engine(on, ['tool.call'])
    await $.session.start(START)
    await failingTurn($)
    await inspect($, 'now')
    expect((await inspectPane($, surface)).join('\n')).not.toContain('jane.doe@example.com')
    await setUser($, kit, { rec: 'off' })
    expect((await inspectPane($, surface)).join('\n')).toContain('jane.doe@example.com')
  })
}

test('/rec test prints the table, a failed private word by position only', async ($, on) => {
  stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'rec:words': ['Acme', '‹user›'] } })
  engine(on)
  await $.session.start(START)
  const lines = (await rec($, 'test')).split('\n')
  expect(lines[0]).toBe('/rec test · level on')
  expect(lines).toContain('✓ keys           19/19 hidden')
  expect(lines).toContain('✓ emails           3/3 hidden')
  expect(lines).toContain('✓ phones           6/6 hidden')
  expect(lines).toContain('✗ private words    1/2 hidden (not shown)')
  expect(lines).toContain('  ✗ private word 2 shown')
  expect(lines.some(l => l.startsWith('✓ left alone     22/22 shown'))).toBe(true)
  expect(lines).toContain('strict: ✓ home path 2/2 · ✓ account 1/1 · ✓ $ amounts 3/3')
  expect(lines.join('\n')).not.toContain('Acme')
})

test('/rec help and an unknown argument print the usage and what REC cannot hide', async ($, on) => {
  stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  for (const arg of ['help', 'bogus']) {
    const text = await rec($, arg)
    expect(text.startsWith('REC off - from the default\nUsage: /rec [on|strict|off|test|words [close]]')).toBe(true)
    expect(text).toContain('REC cannot hide:')
    expect(text).toContain('what you type in the prompt box\n- a prompt the mod fills into the prompt box\n')
    expect(text).toContain('the option labels of a question Claude asks')
    expect(text).toContain("a private key's middle lines in a diff that does not show its BEGIN line")
    expect(text).toContain('anything the model reads')
  }
})

test('a session reloads the level and words on its 30-second poll', async ($, on) => {
  const { clock, store } = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  expect((await band($, 'terminal'))[0]!.startsWith('● REC')).toBe(false)
  store.set('settings:rec', 'on')
  store.set('rec:words', ['Acme'])
  await clock.advance(30_000)
  expect((await band($, 'terminal'))[0]!.startsWith('● REC')).toBe(true)
  await inspect($, 'now')
  expect(await inspectPane($, 'terminal')).toContain(`${ON} · 1 private word`)
})

// The test loads its own copy of mask.ts beside the mod's, so a toast's masking is checked on this copy
test('a toast is masked like any drawn string', () => {
  setRec('on', [], null)
  try {
    const seen: string[] = []
    toast({ ui: { toast: (text: string) => void seen.push(text) } } as never, 'mail ops@example.io')
    expect(seen).toEqual(['mail ‹email›'])
  } finally {
    setRec('off', [], null)
  }
})

test('REC strict, then /clear: the first redraw is strict', async ($, on) => {
  const kit = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  engine(on)
  await $.session.start(START)
  await setUser($, kit, { rec: 'strict' })
  await $.classic.SessionStart({ source: 'clear' })
  const lines = await band($, 'terminal')
  expect(lines[0]!.startsWith('● REC')).toBe(true)
  expect(lines.join('\n')).toContain('$•.••')
  await setUser($, kit, { rec: 'off' })
})

test('a row drawn while /resume resets the session is masked at the level before it', async ($, on) => {
  stubAll(on, { usage: SUBSCRIPTION, env: HOME, store: { 'settings:rec': 'strict' } })
  on('ui.render', { component: 'UserMessage' }, (h$: EngineInterface, e: RenderInput) => {
    const { Text } = h$.ui.resolve(e)
    return h(Text, null, (e.props as { text: string }).text) as RenderElement
  })
  // Beneath the mod: once the reset writes the rec atom off, a resumed row draws before the stored level is read again
  let isArmed = false
  let seen = ''
  on('state.set', async (_, e, next) => {
    const out = await next(e)
    const value = e.value as { value?: { level?: string } } | undefined
    if (isArmed && e.key === 'rec' && value?.value?.level === 'off') {
      isArmed = false
      const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: { text: 'mail ops@example.io', origin: { kind: 'composer' }, isExpanded: false } })
      seen = (await rows(ui)).join('\n')
      await ui.unmount()
    }
    return out
  })
  engine(on)
  await $.session.start(START)
  isArmed = true
  await $.classic.SessionStart({ source: 'resume' })
  expect(seen).toBe('mail ‹email›')
  await rec($, 'off')
})

test('the 30-second poll redraws every site only when the level or the words change', async ($, on) => {
  const kit = stubAll(on, { usage: SUBSCRIPTION, env: HOME })
  const { clock, store, invalidates } = kit
  engine(on)
  await $.session.start(START)
  const before = invalidates.length
  await setUser($, kit, { rec: 'on' })
  expect(invalidates.length).toBe(before + 1)
  await clock.advance(30_000)
  expect(invalidates.length).toBe(before + 1)
  // Another session swaps one word for another: the count stays, the rows still redraw
  store.set('rec:words', ['Acme'])
  await clock.advance(30_000)
  store.set('rec:words', ['Globex'])
  await clock.advance(30_000)
  expect(invalidates.slice(before)).toEqual(['ui.render', 'ui.render', 'ui.render'])
  await setUser($, kit, { rec: 'off' })
})

test('REC on with a private word longer once masked: a plan row cut to its columns measures the masked title', () => {
  setRec('on', ['Acme'], null)
  try {
    const v = planView({ ...FIVE, title: 'Acme Acme Acme token refresh across services' }, FIVE_TIMES, FIVE_OVERHEAD, {}, NOW)
    for (const columns of [45, 60, 80]) {
      const drawn = planLine(v, columns).map(s => ('text' in s ? mask(s.text) : '')).join('')
      expect(drawn.length).toBeLessThanOrEqual(columns)
      expect(drawn).not.toContain('Acme')
      expect(/‹[^›]*$/.test(drawn.split('…')[0]!)).toBe(false)
    }
  } finally {
    setRec('off', [], null)
  }
})
