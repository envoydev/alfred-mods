// The transcript reader (spec 2026-11-23, D2): the rules Claude Code loaded on demand, read off the session's
// transcript file in chunks, counted once by key and merged with what the classic hook reports
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { ruleSegs } from '../../hooks/band/detail'
import type { Session } from '../../hooks/session/types'
import type { Line } from '../../hooks/core/types'
import { START, engine, rows, stubAll, until, watchState } from '../kit'
import { stubTranscript } from '../transcript-stubs'
import type { TranscriptOptions } from '../transcript-stubs'

const MIB = 1_048_576
const CONFIG = '/home/.claude'
const PATH = `${CONFIG}/projects/-work-app/s1.jsonl`
const S2_PATH = `${CONFIG}/projects/-work-app/s2.jsonl`
const NOW = Date.parse('2026-10-28T14:00:00Z')

const memory = (path: string): string =>
  `${JSON.stringify({ type: 'attachment', attachment: { type: 'nested_memory', path, displayPath: 'x', content: 'c' } })}\n`
const ruleAt = (folder: string, name: string): string => `${folder}/.claude/rules/${name}.md`
const file = (text: string) => ({ text, mtimeMs: 0 })
const unrelated = (text: string): string => `${JSON.stringify({ type: 'user', message: text })}\n`

type Setup = {
  files?: Record<string, ReturnType<typeof file>>; root?: string; transcript?: TranscriptOptions; usage?: SessionUsage
  holdRead?: { path: string; until: Promise<void> }
}

// A session on `/work/app` whose transcript, by default, is the derived path under the config folder
async function begin($: Engine, on: On, o: Setup = {}) {
  const kit = stubAll(on, {
    ...(o.holdRead === undefined ? {} : { holdRead: o.holdRead }),
    root: o.root ?? '/work/app', cwd: o.root ?? '/work/app', env: { CLAUDE_CONFIG_DIR: CONFIG }, now: NOW, band: 'full',
    files: o.files ?? { [PATH]: file(memory(ruleAt('/work/app', 'a'))) }, ...(o.usage === undefined ? {} : { usage: o.usage }),
  })
  stubTranscript(on, o.transcript ?? {})
  const state = watchState(on)
  engine(on)
  await $.session.start(START)
  return { kit, state }
}
const keysOf = (state: { get(key: string): unknown }): string[] =>
  ((state.get('session') as Session | undefined)?.pathRuleKeys ?? []).map(rule => rule.key)

test('a nested_memory rule counts once read twice', async ($, on) => {
  const { kit, state } = await begin($, on)
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
  kit.files.current[PATH] = file(memory(ruleAt('/work/app', 'a')).repeat(2))
  await kit.clock.advance(30_000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
  expect(kit.files.reads.filter(read => read === PATH).length).toBeGreaterThanOrEqual(2)
})

test('a clear counts none of the old', async ($, on) => {
  const { kit, state } = await begin($, on)
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
  kit.files.current[S2_PATH] = file(memory(ruleAt('/work/app', 'b')))
  kit.session.id = 's2'
  kit.session.turns = 1
  await $.classic.SessionStart({ source: 'clear' } as never)
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/b.md'])
})

test("a resume counts the file's rules once", async ($, on) => {
  const { kit, state } = await begin($, on)
  await kit.clock.advance(1000)
  kit.files.current[S2_PATH] = file(memory(ruleAt('/work/app', 'b')) + unrelated('hi') + memory(ruleAt('/work/app', 'b')))
  kit.session.id = 's2'
  kit.session.turns = 4
  await $.classic.SessionStart({ source: 'resume' } as never)
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/b.md'])
})

test('a run racing a start-over writes nothing and the rules are counted after it', async ($, on) => {
  let release = (): void => undefined
  const opened = new Promise<void>(resolve => { release = resolve })
  const { kit, state } = await begin($, on, { holdRead: { path: 's1.jsonl', until: opened } })
  const ticking = kit.clock.advance(1000)
  await until(kit.clock, () => kit.files.reads.includes(PATH))
  expect(kit.files.reads).toContain(PATH)
  await $.classic.SessionStart({ source: 'clear' } as never)
  release()
  await ticking
  await kit.clock.settle()
  expect(keysOf(state)).toEqual([])
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
})

test('a line past 1 MiB does not stall', async ($, on) => {
  const huge = `${JSON.stringify({ type: 'user', message: 'a'.repeat(1.5 * MIB) })}\n`
  const { kit, state } = await begin($, on, { files: { [PATH]: file(huge + memory(ruleAt('/work/app', 'a'))) } })
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
})

test('a chunk edge inside a multibyte character keeps the offset on a line start', async ($, on) => {
  const wide = `${'é'.repeat(MIB / 2)}x\n`
  const { kit, state } = await begin($, on, { files: { [PATH]: file(wide + memory(ruleAt('/work/app', 'a'))) } })
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
  const reader = state.get('transcript') as { offset: number }
  expect(reader.offset).toBe(new TextEncoder().encode(wide + memory(ruleAt('/work/app', 'a'))).length)
})

test('an unfinished last line is read once it is whole', async ($, on) => {
  const whole = memory(ruleAt('/work/app', 'a'))
  const { kit, state } = await begin($, on, { files: { [PATH]: file(whole.slice(0, 40)) } })
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual([])
  kit.files.current[PATH] = file(whole)
  await kit.clock.advance(30_000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
})

const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const breakdownOf = (path: string): SessionUsage => ({
  startedAt: NOW - 5 * 60_000, rateLimits: [],
  context: {
    window: 200_000, tokens: 20_000, percent: 10,
    breakdown: {
      categories: [], totalTokens: 0, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 0, gridRows: [], model: 'claude-opus-5-5',
      memoryFiles: [{ path, type: 'Project', tokens: 60 }], mcpTools: [], agents: [], isAutoCompactEnabled: true,
    } as never,
  },
})
const AWARENESS = 'alfred-awareness'

test('a root session counts the child\'s rule by path with the hook never run', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const text = memory(ruleAt('/work/app/web', AWARENESS)) + memory(ruleAt('/work/app', 'csharp-conventions'))
  const { kit } = await begin($, on, { files: { [PATH]: file(text) }, usage: breakdownOf(ruleAt('/work/app', AWARENESS)) })
  await kit.clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await rows(ui)).toContain(`rules:   ${AWARENESS} │ web:${AWARENESS} │ csharp-conventions │ 1 always-on · 2 by path`)
  await ui.unmount()
})

test('a web-rooted session reads both plain', async ($, on) => {
  const text = memory(ruleAt('/work/app/web', AWARENESS)) + memory(ruleAt('/work/app', AWARENESS))
  const { kit, state } = await begin($, on, { root: '/work/app/web', files: { [PATH.replace('-work-app', '-work-app-web')]: file(text) } })
  await kit.clock.advance(1000)
  const labels = ((state.get('session') as Session).pathRuleKeys ?? []).map(rule => rule.label)
  expect(labels).toEqual([AWARENESS, AWARENESS])
})

test('a rewritten file starts over', async ($, on) => {
  const { kit, state } = await begin($, on, { files: { [PATH]: file(memory(ruleAt('/work/app', 'a')) + memory(ruleAt('/work/app', 'b'))) } })
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md', '.claude/rules/b.md'])
  kit.files.current[PATH] = file(memory(ruleAt('/work/app', 'c')))
  await kit.clock.advance(30_000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md', '.claude/rules/b.md', '.claude/rules/c.md'])
})

// The row the band draws for the rules, with the option on: `by path not tracked` where no transcript is known
async function rulesRow($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const row = (await rows(ui)).find(drawn => drawn.startsWith('rules:'))
  await ui.unmount()
  return row
}
const ALWAYS_RULE = breakdownOf(ruleAt('/work/app', 'always'))
const OPTION = { options: { leave_out_skipped_hooks: true } }

test('a vanished transcript notes unread', OPTION, async ($, on) => {
  const { kit } = await begin($, on, { transcript: { transcriptPath: PATH }, usage: ALWAYS_RULE })
  await kit.clock.advance(1000)
  await kit.clock.settle()
  expect(await rulesRow($)).toBe('rules:   always │ a │ 1 always-on · 1 by path')
  delete kit.files.current[PATH]
  await kit.clock.advance(30_000)
  await kit.clock.settle()
  expect(await rulesRow($)).toBe('rules:   always │ a │ 1 always-on · by path not tracked · transcript unread')
})

test('a throwing session.info falls back to the derived path', OPTION, async ($, on) => {
  const { kit, state } = await begin($, on, { transcript: { sessionInfoThrows: true }, usage: ALWAYS_RULE })
  await kit.clock.advance(1000)
  await kit.clock.settle()
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
  expect(await rulesRow($)).toBe('rules:   always │ a │ 1 always-on · 1 by path')
})

test('a throwing session.info with no file at the derived path notes not found', OPTION, async ($, on) => {
  const { kit } = await begin($, on, { transcript: { sessionInfoThrows: true }, files: {}, usage: ALWAYS_RULE })
  await kit.clock.advance(1000)
  await kit.clock.settle()
  expect(await rulesRow($)).toBe('rules:   always │ 1 always-on · by path not tracked · transcript not found')
})

test('the hook and the transcript merge by key', async ($, on) => {
  const { kit, state } = await begin($, on)
  await $.classic.InstructionsLoaded({
    file_path: ruleAt('/work/app', 'a'), memory_type: 'Project', load_reason: 'path_glob_match', globs: ['src/**/*.ts'], trigger_file_path: '/work/app/src/app.ts',
  } as never)
  await kit.clock.advance(1000)
  expect(keysOf(state)).toEqual(['.claude/rules/a.md'])
})

test('isTracked holds with the option on while a transcript is known', { options: { leave_out_skipped_hooks: true } }, async ($, on) => {
  const { kit } = await begin($, on, { usage: breakdownOf(ruleAt('/work/app', 'always')) })
  await kit.clock.advance(1000)
  await kit.clock.settle()
  const ui = await $.ui.mount({ plugin: 'alfred-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const drawn = (await rows(ui)).join('\n')
  expect(drawn).toContain('1 always-on · 1 by path')
  expect(drawn).not.toContain('not tracked')
  await ui.unmount()
})

test('no absolute path is stored', async ($, on) => {
  const { kit, state } = await begin($, on)
  await kit.clock.advance(1000)
  expect(state.get('transcript')).toEqual({ sessionId: 's1', offset: expect.any(Number), isInLongLine: false })
  expect(state.writes.join('\n')).not.toContain('/home/')
})

const text = (lines: Line[]): string[] => lines.map(line => line.map(seg => ('text' in seg ? seg.text : '')).join(''))

test('the counts line says why the transcript is not read', () => {
  const entry = { key: 'k', label: 'a' }
  expect(text(ruleSegs({ always: [entry], byPath: [], isTracked: true, note: 'unread' }, false)).at(-1)).toBe('1 always-on · 0 by path · transcript unread')
  expect(text(ruleSegs({ always: [entry], byPath: [], isTracked: true, note: 'not-found' }, false)).at(-1)).toBe('1 always-on · 0 by path · transcript not found')
  expect(text(ruleSegs({ always: [entry], byPath: [], isTracked: true }, false)).at(-1)).toBe('1 always-on · 0 by path')
})
