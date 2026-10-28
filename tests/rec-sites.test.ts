import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement, RenderInput, RenderPropsOf } from 'claude-code'

import { EMAILS, KEYS } from '../hooks/samples.ts'
import { maskDeep, maskDialog, maskResult, resultLines } from '../hooks/sites.ts'
import { PRESENTATION, SPINNER, START, engine, rows, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const EMAIL = EMAILS[0]!.text
const KEY = KEYS[0]!
const PEM = KEYS.find(k => k.text.includes('BEGIN'))!.text.split('\n')
const HOME = { HOME: '/Users/jane' }

const rec = ($: Engine, args: string) => $.command.run({ command: 'rec', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

// The dialog's props as handed beneath the mod, newest last: its tree must hold Claude Code's own node, so the stub
// passes it on rather than drawing them
const asked: unknown[] = []

// Claude Code's own drawing of each site, beneath the mod: the props it was handed, as JSON
function sites(on: On): void {
  const json = (h$: EngineInterface, e: RenderInput): RenderElement => {
    const { Text } = h$.ui.resolve(e)
    return h(Text, null, JSON.stringify(e.props)) as RenderElement
  }
  on('ui.render', { component: 'UserMessage' }, json)
  on('ui.render', { component: 'AssistantMessage' }, json)
  on('ui.render', { component: 'CommandOutput' }, json)
  on('ui.render', { component: 'ToolUse' }, json)
  on('ui.render', { component: 'ToolResult' }, json)
  on('ui.render', { component: 'ToolGroup' }, json)
  on('ui.render', { component: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.props)
    return { type: 'engine', ref: 0 } as RenderElement
  })
  on('ui.render', { component: 'Spinner' }, json)
}

async function start($: Engine, on: On, level: 'off' | 'on' | 'strict', words: string[] = []): Promise<void> {
  stubAll(on, { env: HOME, store: { 'settings:rec': level, 'rec:words': words } })
  sites(on)
  engine(on)
  await $.session.start(START)
}

// What a site drew: the props handed down as an object when Claude Code drew it, else the mod's own lines
async function draw<C extends keyof RenderPropsOf>($: Engine, surface: (typeof SURFACES)[number], component: C, props: RenderPropsOf[C]): Promise<{ props: Record<string, unknown> | null; lines: string[] }> {
  const ui = await $.ui.mount({ plugin: 'session-inspector', surface, component, props })
  const lines = await rows(ui)
  await ui.unmount()
  if (component === 'AskUserQuestion') return { props: asked.at(-1) as Record<string, unknown>, lines }
  const only = lines.length === 1 ? lines[0]! : ''
  return { props: only.startsWith('{') ? JSON.parse(only) as Record<string, unknown> : null, lines }
}

const USE = { tool_use_id: 'c1', isRunning: false, isErrored: false, isInterrupted: false } as const
const BASH_OUT = { stdout: `line one\nmail ${EMAIL}\nline three`, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }
const READ_OUT = { type: 'text', file: { filePath: '/w/notes.md', content: `# Notes\n${KEY.text}\nend`, numLines: 3, startLine: 1, totalLines: 3 } }
const QUESTION = (header: string, labels: string[]) => ({
  question: 'Which address?', header, multiSelect: false, options: labels.map(label => ({ label, description: 'pick it' })),
})

for (const surface of SURFACES) {
  test(`UserMessage, AssistantMessage and CommandOutput text are masked when on and passed when off (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const user = await draw($, surface, 'UserMessage', { text: `mail ${EMAIL}`, origin: { kind: 'composer' }, isExpanded: false })
    expect(user.props?.text).toBe('mail ‹email›')
    const said = await draw($, surface, 'AssistantMessage', { text: `Use ${KEY.text}`, isFirstOfReply: true })
    expect(said.props?.text).toBe(`Use ${KEY.masked}`)
    const out = await draw($, surface, 'CommandOutput', { command: 'cost', args: '', text: `billed to ${EMAIL}`, isErrored: false })
    expect(out.props).toEqual({ command: 'cost', args: '', text: 'billed to ‹email›', isErrored: false })
    await rec($, 'off')
    expect((await draw($, surface, 'UserMessage', { text: `mail ${EMAIL}`, origin: { kind: 'composer' }, isExpanded: false })).props?.text).toBe(`mail ${EMAIL}`)
  })

  test(`a ToolUse input and output and a ToolResult output keep every key and type, and their lines without a sample (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const use = await draw($, surface, 'ToolUse', { ...USE, tool: 'Bash', input: { command: `echo ${EMAIL}`, timeout: 5000 }, output: BASH_OUT })
    expect(use.props?.input).toEqual({ command: 'echo ‹email›', timeout: 5000 })
    expect(use.props?.output).toEqual({ ...BASH_OUT, stdout: 'line one\nmail ‹email›\nline three' })
    const bash = await draw($, surface, 'ToolResult', { tool_use_id: 'c1', tool: 'Bash', output: BASH_OUT, isErrored: false })
    expect(bash.props?.output).toEqual({ ...BASH_OUT, stdout: 'line one\nmail ‹email›\nline three' })
    const read = await draw($, surface, 'ToolResult', { tool_use_id: 'c2', tool: 'Read', output: READ_OUT, isErrored: false })
    expect(read.props?.output).toEqual({ ...READ_OUT, file: { ...READ_OUT.file, content: `# Notes\n${KEY.masked}\nend` } })
  })

  test(`a Read image's base64 is handed on as it came (${surface})`, async ($, on) => {
    await start($, on, 'on', ['Acme'])
    const image = { type: 'image', file: { base64: `iVBORw0KGgoAcme${'A'.repeat(64)}`, type: 'image/png', originalSize: 120 } }
    const result = await draw($, surface, 'ToolResult', { tool_use_id: 'c5', tool: 'Read', output: image, isErrored: false })
    expect(result.props?.output).toEqual(image)
  })

  test(`an unfolded group row's inline output is masked (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const row = await draw($, surface, 'ToolUse', { ...USE, tool: 'Read', input: { file_path: '/w/notes.md' }, output: READ_OUT, isExpanded: true })
    expect(JSON.stringify(row.props?.output)).toContain(KEY.masked)
    expect(JSON.stringify(row.props)).not.toContain(KEY.text)
  })

  test(`a ToolGroup is drawn expanded while REC is on and /quiet is off (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const calls = [{ tool_use_id: 'g1', tool: 'Grep', input: { pattern: EMAIL }, isRunning: false, isErrored: false, isInterrupted: false }]
    const group = await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: true })
    expect(group.props?.isExpanded).toBe(true)
    expect(group.props?.calls).toEqual(calls)
    await rec($, 'off')
    expect((await draw($, surface, 'ToolGroup', { calls, isActive: false, isExpanded: false, isCallsOnly: true })).props?.isExpanded).toBe(false)
  })

  // Claude Code 2.1.312 draws the original dialog, unmasked, when a rewrite changes an option's label (debug log, live)
  test(`option labels draw as asked, and two emails elsewhere in the dialog draw numbered tokens (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const [a, b] = [EMAILS[0]!.text, EMAILS[2]!.text]
    const asked = {
      question: `Mail ${a} or ${b}?`, header: 'Address', multiSelect: false,
      options: [{ label: `Use ${a}`, description: `Sends to ${a}` }, { label: `Use ${b}`, description: `Sends to ${b}` }],
    }
    const dialog = await draw($, surface, 'AskUserQuestion', { tool: 'AskUserQuestion', questions: [asked] })
    const q = (dialog.props?.questions as (typeof asked)[])[0]!
    expect(q.options.map(o => o.label)).toEqual([`Use ${a}`, `Use ${b}`])
    expect(q.options.map(o => o.description)).toEqual(['Sends to ‹email 1›', 'Sends to ‹email 2›'])
    expect(q.question).toBe('Mail ‹email 1› or ‹email 2›?')
    expect(q.header).toBe('Address')
  })

  test(`a header Acme API with the word Acme draws ‹private› A… (${surface})`, async ($, on) => {
    await start($, on, 'on', ['Acme'])
    const dialog = await draw($, surface, 'AskUserQuestion', { tool: 'AskUserQuestion', questions: [QUESTION('Acme API', ['Yes', 'No'])] })
    const q = (dialog.props?.questions as ReturnType<typeof QUESTION>[])[0]!
    expect(q.header).toBe('‹private› A…')
    expect(q.header.length).toBe(12)
  })

  test(`the Spinner word and message are masked (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const spun = await draw($, surface, 'Spinner', { ...SPINNER, word: `Mailing ${EMAIL}`, message: `Asking ${EMAIL}` })
    expect(spun.props?.word).toBe('Mailing ‹email›')
    expect(spun.props?.message).toBe('Asking ‹email›')
  })

  test(`a hook passes next(e) untouched when masking changes nothing (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const plain = { ...USE, tool: 'Bash', input: { command: 'ls' }, output: { ...BASH_OUT, stdout: 'a\nb' } }
    expect((await draw($, surface, 'ToolUse', plain)).props).toEqual(plain)
    const dialog = { tool: 'AskUserQuestion', questions: [QUESTION('Library', ['date-fns', 'luxon'])] }
    expect((await draw($, surface, 'AskUserQuestion', dialog)).props).toEqual(dialog)
    const group = { calls: [], isActive: true, isExpanded: true }
    expect((await draw($, surface, 'ToolGroup', group)).props).toEqual(group)
  })

  test(`with REC on, an errored ToolResult whose error text holds a fake key draws the mod's own masked text tree (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const failed = await draw($, surface, 'ToolResult', { tool_use_id: 'c3', tool: 'Bash', output: `Exit code 1\n${KEY.text} rejected`, isErrored: true })
    expect(failed.props).toBe(null)
    expect(failed.lines.join('\n')).toContain(`${KEY.masked} rejected`)
    expect(failed.lines.join('\n')).not.toContain(KEY.text)
    // An error with no sample draws as Claude Code draws it
    const plain = await draw($, surface, 'ToolResult', { tool_use_id: 'c4', tool: 'Bash', output: 'Exit code 1', isErrored: true })
    expect(plain.props?.output).toBe('Exit code 1')
  })

  // Claude Code draws an errored result's error text, not its `output`, which live is no string (2026-10-28)
  test(`with REC on, an errored ToolResult draws the error text Claude read, masked, whatever its output holds (${surface})`, async ($, on) => {
    stubAll(on, { env: HOME, store: { 'settings:rec': 'on' } })
    sites(on)
    on('tool.call', () => ({ isError: true as const, result: `Exit code 3\nTOKEN=${KEY.text}`, text: `Exit code 3\nTOKEN=${KEY.text}` }))
    engine(on, ['tool.call'])
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'grep TOKEN .env; exit 3', tool_use_id: 'c6' })
    const empty = { ...BASH_OUT, stdout: '' }
    const failed = await draw($, surface, 'ToolResult', { tool_use_id: 'c6', tool: 'Bash', output: empty, isErrored: true })
    expect(failed.props).toBe(null)
    expect(failed.lines.join('\n')).toContain(`TOKEN=${KEY.masked}`)
    expect(failed.lines.join('\n')).not.toContain(KEY.text)
  })

  // An unfolded group's errored row draws its error text inline, and Claude Code draws that text, not `output`
  // (live, fullscreen, 2026-10-28)
  test(`with REC on, an errored ToolUse row whose error text holds a fake key draws its compact head and the masked text, and its ToolResult nothing (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const row = { ...USE, tool_use_id: 'c7', tool: 'Bash', input: { command: 'grep TOKEN .env; exit 3', description: 'Search .env' }, isErrored: true }
    const use = await draw($, surface, 'ToolUse', { ...row, output: `Error: Exit code 3\nTOKEN=${KEY.text}` })
    expect(use.props).toBe(null)
    expect(use.lines[0]).toBe('⏺ Bash · Search .env · ✗')
    expect(use.lines.join('\n')).toContain(`TOKEN=${KEY.masked}`)
    expect(use.lines.join('\n')).not.toContain(KEY.text)
    const result = await draw($, surface, 'ToolResult', { tool_use_id: 'c7', tool: 'Bash', output: undefined, isErrored: true })
    expect([result.props, result.lines.join('')]).toEqual([null, ''])
    // A known error with no sample draws as Claude Code draws it, row and result
    expect((await draw($, surface, 'ToolUse', { ...row, tool_use_id: 'c8', output: 'Exit code 1' })).props).not.toBe(null)
    expect((await draw($, surface, 'ToolResult', { tool_use_id: 'c8', tool: 'Bash', output: undefined, isErrored: true })).props).not.toBe(null)
  })

  // A diff holds one string per line, and the key class needs the BEGIN and END lines in one string
  test(`with REC on, a private key's lines in an Edit diff draw as ‹key› from its BEGIN line through its END line, the count kept (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const [begin, body, end] = PEM
    const hunk = (lines: string[]) => ({ oldStart: 1, oldLines: 2, newStart: 1, newLines: lines.length, lines })
    const edit = (lines: string[]) => ({ filePath: '/w/id', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [hunk(lines)], userModified: false, replaceAll: false })
    const lines = async (id: string, diff: string[]) => {
      const out = (await draw($, surface, 'ToolResult', { tool_use_id: id, tool: 'Edit', output: edit(diff), isErrored: false })).props?.output
      return (out as ReturnType<typeof edit>).structuredPatch[0]!.lines
    }
    expect(await lines('p1', [' a', `+${begin}`, `+${body}`, '+QUJDREVGR0g=', `+${end}`, ' b']))
      .toEqual([' a', '+‹key›', '+‹key›', '+‹key›', '+‹key›', ' b'])
    // A key whose END line is past the hunk hides to the hunk's end
    expect(await lines('p2', [' a', `-${begin}`, `-${body}`, ` ${body}`])).toEqual([' a', '-‹key›', '-‹key›', ' ‹key›'])
  })

  test(`with REC on, an errored ToolResult whose error text the mod never saw draws a line saying REC hid it (${surface})`, async ($, on) => {
    await start($, on, 'on')
    const failed = await draw($, surface, 'ToolResult', { tool_use_id: 'c9', tool: 'Bash', output: undefined, isErrored: true })
    expect(failed.props).toBe(null)
    expect(failed.lines.join('\n')).toContain('Error · text hidden while REC is on')
  })
}

test('a dialog whose only samples sit in option labels comes back unchanged', () => {
  const qs = [QUESTION('Address', [`Use ${EMAILS[0]!.text}`, 'None'])]
  expect(maskDialog(qs, spansOf)).toBe(qs)
})

test('every masked dialog keeps headers of 12 characters or fewer and its labels exactly as asked', () => {
  const qs = [
    QUESTION(`${EMAILS[0]!.text}`, [`Use ${EMAILS[0]!.text}`, `Use ${EMAILS[1]!.text}`]),
    QUESTION('Pay $3.12?', ['Pay $3.12', 'Pay $4.56', 'Pay $7.89']),
  ]
  const out = maskDialog(qs, s => spansOf(s).concat(amounts(s))) as ReturnType<typeof QUESTION>[]
  for (const q of out) expect(q.header.length <= 12).toBe(true)
  expect(out.map(q => q.options.map(o => o.label))).toEqual(qs.map(q => q.options.map(o => o.label)))
  expect(out[0]!.header).toBe('‹email›')
  expect(out[1]!.header).toBe('Pay $•.••?')
})

test("a tool on the refused list draws the mod's own masked text tree in place of the rewrite", () => {
  const fn = (s: string) => s.replaceAll(EMAIL, '‹email›')
  expect(maskResult({ tool: 'Bash', output: BASH_OUT, isErrored: false }, fn, ['Bash'])).toEqual({ kind: 'tree', text: 'line one\nmail ‹email›\nline three' })
  expect(maskResult({ tool: 'Bash', output: BASH_OUT, isErrored: false }, fn, [])).toEqual({ kind: 'output', output: { ...BASH_OUT, stdout: 'line one\nmail ‹email›\nline three' } })
  // Nothing to hide: the result draws as it came, refused or not
  expect(maskResult({ tool: 'Bash', output: { ...BASH_OUT, stdout: 'ok' }, isErrored: false }, fn, ['Bash'])).toEqual({ kind: 'same' })
})

// Live, Claude Code's own result gutter sits two columns in, under its row's ⏺ (main screen, Ctrl+O, 2026-10-28)
test("the mod's own result block draws the terminal's gutter two columns in, as Claude Code's own does", () => {
  const text = (lines: ReturnType<typeof resultLines>) => lines.map(l => l.map(s => ('text' in s ? s.text : '')).join(''))
  expect(text(resultLines('Exit code 3\nTOKEN=‹key›', { isExpanded: false, isErrored: true, gutter: true }))).toEqual(['  ⎿  Exit code 3', '     TOKEN=‹key›'])
  expect(text(resultLines('a', { isExpanded: false, isErrored: false, gutter: false }))).toEqual(['a'])
})

test('maskDeep keeps every key, type and non-string value, and returns the same value when nothing changes', () => {
  const value = { a: 1, b: [true, null, 'x'], c: { d: 'y' } }
  expect(maskDeep(value, s => s)).toBe(value)
  expect(maskDeep(value, s => (s === 'x' ? 'X' : s))).toEqual({ a: 1, b: [true, null, 'X'], c: { d: 'y' } })
})

// The email spans of a text, as mask.ts's maskSpans gives them at REC on; and $ amounts, as strict adds
function spansOf(text: string): { start: number; end: number; text: string }[] {
  return [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map(m => ({ start: m.index, end: m.index + m[0].length, text: '‹email›' }))
}
function amounts(text: string): { start: number; end: number; text: string }[] {
  return [...text.matchAll(/\$\d+\.\d\d/g)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[0].replace(/\d/g, '•') }))
}
