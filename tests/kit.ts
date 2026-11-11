// Test helpers: stubs for every $ call the mod makes, a reader of the $.state it writes, and the drawn rows as text.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type {
  AgentInfo, ClassicResult, EngineInterface, On, ProcessRunResult, RenderElement, RenderInput, SessionUsage, Settings, SettingsSource, TurnStepInput, TurnStepResult,
  TurnUsage, UiPane,
} from 'claude-code'

export const NO_READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

// `unplaced` is the reason a surface gives for leaving an opened pane undrawn; `store` is what earlier sessions kept
type Options = {
  usage?: SessionUsage; sessionId?: string; cwd?: string; env?: Record<string, string>; now?: number; unplaced?: string
  // The session's project root (`$.session.root()`); absent, the folder `cwd` names at each call, as a session that
  // never moved off its root
  root?: string
  store?: Record<string, unknown>
  // A read of `key` waits for `until` while it is set, as a slow store would
  holdStore?: { key: string; until: Promise<void> | null }
  // Store keys whose reads are refused, as a store that fails would
  refuseStore?: string[]
  // `agents` is what `$.agent.list()` answers; `preSwitch` what the hooks beneath answer a PreModelSwitch with, such
  // as a deny; `settings` the merged settings object a read projects its key from
  agents?: AgentInfo[]; preSwitch?: ClassicResult; settings?: Record<string, unknown>
  // The project's files by the path the mod passes, such as `.claude/session-inspector/plans/p.json`
  files?: Record<string, FileStub>
  // Symbolic links by the path the mod passes, such as `.claude/rules/shared`, each to the absolute path it lands on:
  // a folder when a file lies under that path, else a file
  links?: Record<string, string>
  // The files the SessionStart hooks beneath the mod write, as the stack's own hook writes its status file
  writtenBeneath?: Record<string, FileStub>
  // What `git status` answers, or a reason that rejects the call; the prompt box's draft; what `prompt.fill` answers,
  // filled by default. A refusal's cause cannot be staged: the site strips one a hook writes (types, PromptFillResult)
  git?: ProcessRunResult | string; draft?: string; fill?: { isFilled: boolean }
  // What a read of `settings:band` answers while the test stored none: 'calm' by default, the band every test before
  // /band was written for; 'unset' answers nothing, as a fresh install's store does. The key is never added to the store.
  band?: 'full' | 'calm' | 'unset'
  // What `$.session.model()`, `.version()` and `.repo()` answer; each absent refuses, so a test before the band read
  // them at session start draws as it was written for. `repo` null is a folder outside any repository.
  model?: string; version?: string; repo?: { root: string } | null
  // The same for `settings:quiet`: false (off) by default, the tool rows every test before /quiet was on by default
  // was written for; 'unset' answers nothing, as a fresh install's store does
  quiet?: 'on' | 'off' | 'unset'
  // Claude Code's settings files by source, each the file's object: a read with a `source` answers that file's key,
  // absent when the file or the key is; `refuseSource` denies those sources' reads, as a build without them would
  sources?: Partial<Record<SettingsSource, Record<string, unknown>>>; refuseSource?: string[]
}

export const gitResult = (stdout: string, exitCode = 0, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

// A file the mod lists and reads; `size` stands in for the text's length when given
export type FileStub = { text: string; mtimeMs: number; size?: number }

export function stubAll(on: On, o: Options = {}): {
  clock: MockClock; toasts: string[]; opened: string[]; copied: string[]; usage: { current: SessionUsage; breakdowns: number; refuse: boolean; fail: boolean }; panes: UiPane[]
  listed: { current: AgentInfo[]; calls: number }; files: { current: Record<string, FileStub>; reads: string[]; writes: string[]; exists: string[]; lists: string[] }
  // `git.current` and `git.calls`; the draft a test types and the texts the mod filled
  git: { current: ProcessRunResult | string; calls: number; argv: readonly string[] | null; timeoutMs: number | null }; prompt: { draft: string; fills: string[] }
  // Each `$.ui.invalidate` event the mod raised, in order
  invalidates: string[]
  // Each `$.ui.status` text the mod set, in order; undefined is a clear
  statuses: (string | undefined)[]
  // `set` writes as another session would, beneath the mod; `writes` lists the mod's own sets and deletes, in order, as
  // `set <key>` and `delete <key>`
  store: { get(key: string): unknown; keys(): string[]; set(key: string, value: unknown): void; writes: string[] }
  // A test changes the session id mid-test, as a /clear does, through `session.id`; `turns` is how many prompts the
  // session's transcript holds, 1 right after a /clear (its own row) and more after a resume
  session: { id: string; turns: number }
  // Each settings file by source, which a test changes mid-test, as an edit would: `sources.local['alfred-mods'] = ...`
  sources: Record<SettingsSource, Record<string, unknown>>
} {
  const toasts: string[] = []
  const opened: string[] = []
  // The engine's record of the open panes; a test places a waiting one by replacing its entry
  const panes: UiPane[] = []
  const copied: string[] = []
  // A test changes the reading mid-test through `usage.current`; `breakdowns` counts the reads asking for a breakdown,
  // `refuse` makes those reads fail, and `fail` every read
  const usage = { current: o.usage ?? NO_READING, breakdowns: 0, refuse: false, fail: false }
  on('session.usage', (_, e) => {
    if (usage.fail) return { deny: 'test: usage read failed' }
    if (e.breakdown === undefined) return { value: usage.current }
    usage.breakdowns++
    return usage.refuse ? { deny: 'test: usage refused' } : { value: usage.current }
  })
  const session = { id: o.sessionId ?? 's1', turns: 0 }
  on('session.id', () => ({ value: session.id }))
  on('session.turns', () => ({ value: session.turns }))
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
  on('session.root', () => ({ value: o.root ?? o.cwd ?? '/w' }))
  on('session.model', () => (o.model === undefined ? { deny: 'test: no model' } : { value: o.model }))
  on('session.version', () => (o.version === undefined ? { deny: 'test: no version' } : { value: { version: o.version } }))
  on('session.repo', () => (o.repo === undefined ? { deny: 'test: no repo' } : { value: (o.repo === null ? null : { remote: null, internal: false, ...o.repo }) as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    const isPlaced = o.unplaced === undefined
    if (!panes.some(p => p.id === e.id)) panes.push({ id: e.id, title: e.title ?? e.id, isShown: isPlaced, isFocused: false, isPlaced })
    return { value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: o.unplaced ?? '' } }
  })
  on('ui.panes', () => ({ value: panes }))
  // A test changes the agents listed mid-test through `listed.current`
  const listed = { current: o.agents ?? [], calls: 0 }
  on('agent.list', () => {
    listed.calls++
    return { value: listed.current }
  })
  // A key's read answers that key's value; a read with no key, the whole object; a read with a source, that file's key
  const sources: Record<SettingsSource, Record<string, unknown>> = {
    user: { ...o.sources?.user }, project: { ...o.sources?.project }, local: { ...o.sources?.local },
    flag: { ...o.sources?.flag }, policy: { ...o.sources?.policy },
  }
  on('settings.read', (_, e) => {
    const key = e !== undefined && 'key' in e && typeof e.key === 'string' ? e.key : null
    const source = e !== undefined && 'source' in e && typeof e.source === 'string' ? (e.source as SettingsSource) : null
    if (source !== null) {
      if (o.refuseSource?.includes(source) === true) return { deny: `test: settings source refused, ${source}` }
      return { value: (key === null ? sources[source] : sources[source][key]) as Settings }
    }
    return { value: (key === null ? (o.settings ?? {}) : o.settings?.[key]) as Settings }
  })
  // A test changes the files mid-test through `files.current`; a folder with no file in it is missing. The kit hands a
  // hook the path resolved against the mod's folder, with Windows' separators on Windows, so a stub matches its end
  // after `\` reads as `/`; `{ deny }` rejects the mod's call.
  const files = { current: { ...(o.files ?? {}) }, reads: [] as string[], writes: [] as string[], exists: [] as string[], lists: [] as string[] }
  const links = o.links ?? {}
  const slashed = (path: string): string => path.replace(/\\/g, '/')
  const at = (full: string, path: string): boolean => slashed(full) === path || slashed(full).endsWith(`/${path}`)
  on('fs.list', (_, e) => {
    const dir = slashed(e.path).replace(/\/$/, '')
    files.lists.push(dir)
    const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
    const inDir = Object.entries(files.current).filter(([path]) => at(dir, parentOf(path)))
    const linksIn = Object.keys(links).filter(path => at(dir, parentOf(path)))
    // A folder holding a file or link at any depth below is listed as a folder
    const folders = (path: string): string[] => (path.includes('/') ? [parentOf(path), ...folders(parentOf(path))].filter(f => f.includes('/')) : [])
    const dirsIn = [...new Set([...Object.keys(files.current), ...Object.keys(links)].flatMap(path => folders(path).filter(f => at(dir, parentOf(f)))))]
    if (inDir.length === 0 && linksIn.length === 0 && dirsIn.length === 0) return { deny: `ENOENT: no such directory, ${e.path}` }
    return {
      value: [
        ...dirsIn.map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
        ...inDir.map(([path, f]) => ({
          name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: f.size ?? f.text.length, mtimeMs: f.mtimeMs, isLink: false,
        })),
        ...linksIn.map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })),
      ],
    }
  })
  // A link stats as what it leads to, with `realPath` its target when asked; a file as itself, its path its real one
  on('fs.stat', (_, e) => {
    const link = Object.entries(links).find(([path]) => at(e.path, path))
    if (link !== undefined) {
      const isDir = Object.keys(files.current).some(path => path.startsWith(`${link[1]}/`))
      return { value: { kind: isDir ? 'dir' as const : 'file' as const, size: 0, mtimeMs: 0, isLink: true, ...(e.resolve ? { realPath: link[1] } : {}) } }
    }
    const found = Object.entries(files.current).find(([path]) => at(e.path, path))
    if (found === undefined) return { deny: `ENOENT: no such file, ${e.path}` }
    return { value: { kind: 'file' as const, size: found[1].size ?? found[1].text.length, mtimeMs: found[1].mtimeMs, isLink: false, ...(e.resolve ? { realPath: slashed(e.path) } : {}) } }
  })
  // A read rejects over 4 MiB, as Claude Code's does (types, `$.fs.read`)
  on('fs.read', (_, e) => {
    const found = Object.entries(files.current).find(([path]) => at(e.path, path))
    if (found !== undefined) files.reads.push(found[0])
    if (found === undefined) return { deny: `ENOENT: no such file, ${e.path}` }
    return (found[1].size ?? 0) > 4 * 1024 * 1024 ? { deny: `EFBIG: over 4 MiB, ${e.path}` } : { value: found[1].text }
  })
  // Each path asked, so a test counts the reads of a missing file
  on('fs.exists', (_, e) => {
    files.exists.push(slashed(e.path))
    return { value: Object.keys(files.current).some(path => at(e.path, path)) }
  })
  // A write lands at the path of a file the test gave, else at the path the mod passed
  on('fs.write', (_, e) => {
    const key = Object.keys(files.current).find(path => at(e.path, path)) ?? slashed(e.path)
    files.current[key] = { text: e.text, mtimeMs: o.now ?? 0 }
    files.writes.push(key)
    return { value: undefined }
  })
  const git = { current: o.git ?? gitResult('## main\n'), calls: 0, argv: null as readonly string[] | null, timeoutMs: null as number | null }
  on('process.run', (_, e) => {
    git.calls++
    git.argv = e.argv
    git.timeoutMs = e.init?.timeoutMs ?? null
    return typeof git.current === 'string' ? { deny: git.current } : { value: git.current }
  })
  const prompt = { draft: o.draft ?? '', fills: [] as string[] }
  on('prompt.read', () => ({ value: { text: prompt.draft, cursor: prompt.draft.length } }))
  on('prompt.fill', (_, e) => {
    if (o.fill !== undefined && !o.fill.isFilled) return o.fill
    prompt.fills.push(e.text)
    prompt.draft = e.text
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const invalidates: string[] = []
  on('ui.invalidate', (_, e) => {
    invalidates.push(e.event)
    return { value: undefined }
  })
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // The classic events the mod hooks have nothing beneath them in a test
  on('classic.PostToolUseFailure', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.SessionStart', () => {
    Object.assign(files.current, o.writtenBeneath ?? {})
    return {}
  })
  on('classic.PostModelSwitch', () => ({}))
  on('classic.PreModelSwitch', () => o.preSwitch ?? {})
  on('classic.InstructionsLoaded', () => ({}))
  const clock = mock.clock(on, { now: o.now ?? 0 })
  // The store, kept here rather than by the kit's mock so a test can read what the mod wrote: a test's `$` has no
  // store of its own. Values go through JSON as the real store's do; keys keep their insertion order.
  const stored = new Map<string, unknown>(Object.entries(o.store ?? {}))
  const writes: string[] = []
  on('store.get', async (_, e) => {
    if (o.refuseStore?.includes(e.key) === true) return { deny: `test: store read refused, ${e.key}` }
    if (o.holdStore?.until && e.key === o.holdStore.key) await o.holdStore.until
    if (e.key === 'settings:band' && !stored.has(e.key) && o.band !== 'unset') return { value: o.band ?? 'calm' }
    if (e.key === 'settings:quiet' && !stored.has(e.key) && o.quiet !== 'unset') return { value: o.quiet === 'on' }
    return { value: stored.get(e.key) }
  })
  on('store.set', (_, e) => {
    writes.push(`set ${e.key}`)
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    writes.push(`delete ${e.key}`)
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  const store = {
    get: (key: string): unknown => stored.get(key), keys: (): string[] => [...stored.keys()],
    set: (key: string, value: unknown): void => void stored.set(key, JSON.parse(JSON.stringify(value)) as unknown),
    writes,
  }
  mock.env(on, o.env ?? {})
  return { clock, toasts, opened, copied, usage, panes, listed, files, store, session, git, prompt, invalidates, statuses, sources }
}

// Claude Code's own answers to the events a session raises, for a test that drives a whole turn. A test hooks an
// event without a matcher once, so one that answers an event itself names it in `except`.
export function engine(on: On, except: string[] = []): void {
  const has = (name: string): boolean => !except.includes(name)
  if (has('session.start')) on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (has('prompt.submit')) on('prompt.submit', (_, e) => ({ text: e.text }))
  if (has('turn.start')) on('turn.start', (_, e) => ({ turnId: e.turnId }))
  if (has('turn.complete')) on('turn.complete', () => ({ text: '' }))
  if (has('tool.call')) on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  if (has('session.measure')) on('session.measure', (_, e) => ({ changed: e.changed }))
  if (has('session.compact')) on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  if (has('agent.spawn')) on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
}

export const START = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
export const SPAWN = {
  tool_use_id: 'sp1', prompt: 'look', description: 'a look', subagentType: 'general-purpose',
  provider: { plugin: 'claude-code', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false,
} as const
export const PRESENTATION = { isFullscreen: false, columns: 120 } as const
export const SWITCH = {
  from_model: 'claude-haiku-5-5', to_model: 'claude-opus-5-5', requested_model: 'opus', source: 'command',
  context_tokens: 100_000, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 0.8, pricing: 'catalog',
} as const
export const SPINNER = { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' } as const

// Claude Code's answer to each step at once, with the usage a test gives it
export function stepEngine(on: On, usageOf: (e: TurnStepInput) => TurnUsage | null): void {
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: usageOf(e) }
  })
}

// One step through every hook, its stream drained
export async function step($: Engine, e: TurnStepInput): Promise<TurnStepResult> {
  const stream = $.turn.step(e)
  for await (const _ of stream) { /* drain the stream */ }
  return stream.result
}

// Claude Code's answer to each spawn, by its description; one not in the table is `a1`
export function spawns(on: On, table: Record<string, { agentId: string; model?: string }>): void {
  on('agent.spawn', (_, e) => {
    const t = table[e.description]
    return { model: t?.model ?? 'claude-haiku-5-5', agentId: e.resume?.agentId ?? t?.agentId ?? 'a1' }
  })
}

// The latest value the mod wrote under each key, read beneath the plugin as the write lands, and every write in order
// as JSON, so a test can look for text in any value the mod ever wrote
export function watchState(on: On): { get(key: string): unknown; writes: string[] } {
  const latest = new Map<string, unknown>()
  const writes: string[] = []
  on('state.set', async ($, e, next) => {
    writes.push(JSON.stringify(e.value))
    const r = await next(e)
    if (r.value?.isSet === true) {
      const v = e.value as { shape?: string; value?: unknown } | number
      latest.set(e.key, typeof v === 'object' && v !== null && 'shape' in v ? v.value : v)
    }
    return r
  })
  return { get: key => latest.get(key), writes }
}

function textOf(n: unknown): string {
  if (typeof n === 'string') return n
  if (typeof n !== 'object' || n === null) return ''
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (el.type === 'Button') return String(el.props?.label ?? '')
  if (el.type === 'Code') return String(el.props?.source ?? '')
  if (el.type === 'Svg') return String(el.props?.alt ?? '')
  return (el.children ?? []).map(textOf).join('')
}

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isLine = (n: unknown): boolean => {
  const el = n as El | null
  return el?.type === 'Box' && typeof el.props?.['key'] === 'string' && (el.props['key'] as string).startsWith('line-')
}
const spaces = (v: unknown): string => ' '.repeat(typeof v === 'number' ? v : 0)

// A piece of a fitted line as the terminal draws it: its margins as spaces, an empty Box of width n as n spaces, a
// cell padded to its width on its align side (cut with '…' when longer, as truncate-end draws it)
function pieceOf(n: unknown): string {
  if (typeof n !== 'object' || n === null) return textOf(n)
  const el = n as El
  if (el.type !== 'Box') return textOf(el)
  const p = el.props ?? {}
  const kids = el.children ?? []
  const inner = kids.map(pieceOf).join('')
  let body = inner
  if (typeof p['width'] === 'number') {
    const width = p['width']
    const cells = [...inner]
    body = kids.length === 0 ? ' '.repeat(width)
      : cells.length > width ? `${cells.slice(0, Math.max(0, width - 1)).join('')}…`
      : p['justifyContent'] === 'flex-end' ? inner.padStart(width) : inner.padEnd(width)
  }
  return spaces(p['marginLeft']) + body + spaces(p['marginRight'])
}

// One string per drawn line. A tree of fitted lines (Boxes keyed `line-*`) gives one row per such Box, its pieces
// joined; any other tree, one row per innermost Box (one holding no Box), its texts and button labels in order.
export async function rows(ui: { drawn: () => Promise<RenderElement> }): Promise<string[]> {
  const tree = await ui.drawn()
  const lines: El[] = []
  const find = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    if (isLine(n)) lines.push(n as El)
    else ((n as El).children ?? []).forEach(find)
  }
  find(tree)
  if (lines.length > 0) return lines.map(l => (l.children ?? []).map(pieceOf).join(''))
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const el = n as El
    const kids = el.children ?? []
    if (el.type === 'Box' && kids.some(k => (k as El | null)?.type === 'Box')) kids.forEach(walk)
    else out.push(textOf(el))
  }
  walk(tree)
  return out
}

// Claude Code's own drawing of each site the mod rewrites, beneath the mod: the props it was handed, as JSON. The
// dialog's tree must hold Claude Code's own node, so its stub keeps the props it was handed, newest last, and passes
// the node on rather than drawing them.
export function engineSites(on: On): { asked: unknown[] } {
  const asked: unknown[] = []
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
  on('ui.render', { component: 'PromptHint' }, json)
  return { asked }
}

// Refuses the mod's read of one atom while `key` is set, as a store that fails would: every render hook reads an
// atom before it draws, so this makes any of them throw
export function failState(on: On): { key: string | null } {
  const fail = { key: null as string | null }
  on('state.get', (_, e, next) => (fail.key !== null && e.key === fail.key ? { deny: 'test: state read refused' } : next(e)))
  return fail
}

// A call a test leaves held past its end: the kit rejects it once the test's stubs are gone, which is expected, so the
// rejection is caught rather than left for the file's end
export function held(call: Promise<unknown>): void {
  void call.catch(() => undefined)
}
