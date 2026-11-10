import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { REC_HIDDEN, bandFailed, paneFailed } from '../hooks/failsafe.ts'
import { neutralDialog } from '../hooks/sites.ts'
import { EMAILS, KEYS } from '../hooks/samples.ts'
import { SPINNER, START, engine, engineSites, failState, rows, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const KEY = KEYS[0]!.text
const EMAIL = EMAILS[0]!.text
const HOME = { HOME: '/Users/jane' }
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USE = { tool_use_id: 'c1', isRunning: false, isErrored: false, isInterrupted: false } as const
const BASH_OUT = { stdout: `key ${KEY}`, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }

async function start($: Engine, on: On, level: 'off' | 'on', words: string[] = []) {
  stubAll(on, { env: HOME, store: { 'settings:rec': level, 'rec:words': words } })
  const { asked } = engineSites(on)
  const fail = failState(on)
  engine(on)
  await $.session.start(START)
  return { asked, fail }
}

// Each site REC masks, with a fake key in what it draws
const SITES: { [C in 'UserMessage' | 'AssistantMessage' | 'CommandOutput' | 'ToolUse' | 'ToolResult' | 'ToolGroup']: RenderPropsOf[C] } = {
  UserMessage: { text: `use ${KEY}`, origin: { kind: 'composer' }, isExpanded: false },
  AssistantMessage: { text: `Use ${KEY}`, isFirstOfReply: true },
  CommandOutput: { command: 'cost', args: '', text: `key ${KEY}`, isErrored: false },
  ToolUse: { ...USE, tool: 'Bash', input: { command: `echo ${KEY}` }, output: BASH_OUT },
  ToolResult: { tool_use_id: 'c1', tool: 'Bash', output: BASH_OUT, isErrored: false },
  ToolGroup: {
    calls: [{ tool_use_id: 'g1', tool: 'Grep', input: { pattern: KEY }, isRunning: false, isErrored: false, isInterrupted: false }],
    isActive: false, isExpanded: false, isCallsOnly: true,
  },
}

async function drawSite($: Engine, surface: (typeof SURFACES)[number], component: keyof typeof SITES): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component, props: SITES[component] } as never)
  const lines = await rows(ui)
  await ui.unmount()
  return lines
}

for (const surface of SURFACES) {
  test(`a REC site that throws with REC on draws the placeholder (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'on')
    fail.key = 'rec'
    for (const component of Object.keys(SITES) as (keyof typeof SITES)[]) {
      const lines = await drawSite($, surface, component)
      expect({ component, lines }).toEqual({ component, lines: [REC_HIDDEN] })
      expect(lines.join('\n')).not.toContain(KEY)
    }
  })

  test(`a REC site that throws with REC off draws Claude Code's row (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'off')
    fail.key = 'rec'
    for (const component of Object.keys(SITES) as (keyof typeof SITES)[]) {
      const lines = await drawSite($, surface, component)
      expect({ component, props: JSON.parse(lines[0] ?? 'null') }).toEqual({ component, props: SITES[component] })
    }
  })

  test(`the spinner under REC keeps a neutral word (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'on', ['Zephyrine'])
    fail.key = 'live'
    const props = { ...SPINNER, word: 'Reading Zephyrine.md', message: 'Zephyrine' }
    const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Spinner', props })
    const drawn = JSON.parse((await rows(ui))[0] ?? 'null') as Record<string, unknown>
    expect(drawn).toEqual({ ...SPINNER, word: 'Working', message: null })
  })

  test(`the spinner that throws with REC off draws as given (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'off')
    fail.key = 'live'
    const props = { ...SPINNER, word: 'Reading notes.md', message: 'notes' }
    const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Spinner', props })
    expect(JSON.parse((await rows(ui))[0] ?? 'null')).toEqual(props)
  })

  test(`the dialog under REC keeps its node and hides its text (${surface})`, async ($, on) => {
    const { asked, fail } = await start($, on, 'on')
    fail.key = 'rec'
    const question = {
      question: `Mail ${EMAIL}?`, header: 'Address', multiSelect: false,
      options: [{ label: 'Yes', description: `Sends to ${EMAIL}` }, { label: 'No', description: 'Keeps it' }],
    }
    const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: [question] } })
    await rows(ui)
    const drawn = asked.at(-1) as { questions: typeof question[] }
    expect(JSON.stringify(drawn)).not.toContain(EMAIL)
    const q = drawn.questions[0]!
    expect(q.question).toBe('‹hidden›')
    expect(q.header).toBe('‹hidden›')
    expect(q.options.map(o => o.label)).toEqual(['Yes', 'No'])
    expect(q.options.map(o => o.description)).toEqual(['‹hidden›', '‹hidden›'])
  })

  test(`the band that throws names its failure (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'off')
    fail.key = 'tick'
    const ui = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'AbovePrompt', props: BAND })
    expect(await rows(ui)).toEqual(['alfred-mods: the band failed to draw (throw)'])
  })

  test(`a pane that throws names its failure, its message dropped while REC is on (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'off')
    fail.key = 'tick'
    const inspect = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
    const [line] = await rows(inspect)
    expect(line?.startsWith('alfred-mods: the pane failed to draw (throw): ')).toBe(true)
    expect(line).toContain('test: state read refused')
    fail.key = 'rec'
    const words = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'rec', props: { ...PANE, title: 'REC words' } })
    expect((await rows(words))[0]?.startsWith('alfred-mods: the pane failed to draw (throw): ')).toBe(true)
  })

  test(`a pane that throws with REC on ends at its kind (${surface})`, async ($, on) => {
    const { fail } = await start($, on, 'on')
    fail.key = 'tick'
    const inspect = await $.ui.mount({ plugin: 'alfred-mods', surface, component: 'Pane', requestId: 'inspect', props: PANE })
    expect(await rows(inspect)).toEqual(['alfred-mods: the pane failed to draw (throw)'])
  })
}

test('the failure texts', () => {
  expect(bandFailed('timeout')).toBe('alfred-mods: the band failed to draw (timeout)')
  expect(paneFailed('throw', undefined, false)).toBe('alfred-mods: the pane failed to draw (throw)')
  expect(paneFailed('throw', 'boom', true)).toBe('alfred-mods: the pane failed to draw (throw)')
  expect(paneFailed('timeout', 'boom', false)).toBe('alfred-mods: the pane failed to draw (timeout): boom')
})

test('a pane message is cut to 120 characters and printable', () => {
  const prefix = 'alfred-mods: the pane failed to draw (throw): '
  const text = paneFailed('throw', `${'x'.repeat(300)}\u0007`, false)
  expect(text.startsWith(prefix)).toBe(true)
  expect(text.slice(prefix.length).length).toBe(120)
  expect(/[\u0000-\u001f\u007f]/.test(text)).toBe(false)
})

test('two hidden questions are numbered and keep their labels', () => {
  const ask = (q: string, labels: string[]) => ({ question: q, header: q, multiSelect: false, options: labels.map(label => ({ label, description: `${label} ${EMAIL}` })) })
  const out = neutralDialog([ask('First?', ['Yes', 'No']), ask('Second?', ['Red', 'Blue'])]) as ReturnType<typeof ask>[]
  expect(out.map(q => q.question)).toEqual(['‹hidden 1›', '‹hidden 2›'])
  expect(out.map(q => q.header)).toEqual(['‹hidden›', '‹hidden›'])
  expect(out.map(q => q.options.map(o => o.label))).toEqual([['Yes', 'No'], ['Red', 'Blue']])
  expect(JSON.stringify(out)).not.toContain(EMAIL)
})
