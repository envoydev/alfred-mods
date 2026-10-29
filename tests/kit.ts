// Test helpers: stubs for every $ call the mod makes, a reader of the $.state it writes, and the drawn rows as text.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type {
  AgentInfo, ClassicResult, On, ProcessRunResult, RenderElement, SessionUsage, Settings, TurnStepInput, TurnStepResult, TurnUsage, UiPane,
} from 'claude-code'

export const NO_READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

// `unplaced` is the reason a surface gives for leaving an opened pane undrawn; `store` is what earlier sessions kept
type Options = {
  usage?: SessionUsage; sessionId?: string; cwd?: string; env?: Record<string, string>; now?: number; unplaced?: string
  store?: Record<string, unknown>
  // A read of `key` waits for `until` while it is set, as a slow store would
  holdStore?: { key: string; until: Promise<void> | null }
  // `agents` is what `$.agent.list()` answers; `preSwitch` what the hooks beneath answer a PreModelSwitch with, such
  // as a deny; `settings` the merged settings object a read projects its key from
  agents?: AgentInfo[]; preSwitch?: ClassicResult; settings?: Record<string, unknown>
  // The project's files by the path the mod passes, such as `.claude/session-inspector/plans/p.json`
  files?: Record<string, FileStub>
  // What `git status` answers, or a reason that rejects the call; the prompt box's draft; what `prompt.fill` answers,
  // filled by default. A refusal's cause cannot be staged: the site strips one a hook writes (types, PromptFillResult)
  git?: ProcessRunResult | string; draft?: string; fill?: { isFilled: boolean }
}

export const gitResult = (stdout: string, exitCode = 0, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

// A file the mod lists and reads; `size` stands in for the text's length when given
export type FileStub = { text: string; mtimeMs: number; size?: number }

export function stubAll(on: On, o: Options = {}): {
  clock: MockClock; toasts: string[]; opened: string[]; copied: string[]; usage: { current: SessionUsage }; panes: UiPane[]
  listed: { current: AgentInfo[]; calls: number }; files: { current: Record<string, FileStub>; reads: string[]; writes: string[]; exists: string[] }
  // `git.current` and `git.calls`; the draft a test types and the texts the mod filled
  git: { current: ProcessRunResult | string; calls: number; argv: readonly string[] | null; timeoutMs: number | null }; prompt: { draft: string; fills: string[] }
  // Each `$.ui.invalidate` event the mod raised, in order
  invalidates: string[]
  // `set` writes as another session would, beneath the mod
  store: { get(key: string): unknown; keys(): string[]; set(key: string, value: unknown): void }
  // A test changes the session id mid-test, as a /clear does, through `session.id`
  session: { id: string }
} {
  const toasts: string[] = []
  const opened: string[] = []
  // The engine's record of the open panes; a test places a waiting one by replacing its entry
  const panes: UiPane[] = []
  const copied: string[] = []
  // A test changes the reading mid-test through `usage.current`
  const usage = { current: o.usage ?? NO_READING }
  on('session.usage', () => ({ value: usage.current }))
  const session = { id: o.sessionId ?? 's1' }
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
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
  on('settings.read', () => ({ value: (o.settings ?? {}) as Settings }))
  // A test changes the files mid-test through `files.current`; a folder with no file in it is missing. The kit hands a
  // hook the path resolved against the mod's folder, so a stub matches its end; `{ deny }` rejects the mod's call.
  const files = { current: { ...(o.files ?? {}) }, reads: [] as string[], writes: [] as string[], exists: [] as string[] }
  const at = (full: string, path: string): boolean => full === path || full.endsWith(`/${path}`)
  on('fs.list', (_, e) => {
    const dir = e.path.replace(/\/$/, '')
    const inDir = Object.entries(files.current).filter(([path]) => at(dir, path.slice(0, path.lastIndexOf('/'))))
    if (inDir.length === 0) return { deny: `ENOENT: no such directory, ${e.path}` }
    return {
      value: inDir.map(([path, f]) => ({
        name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: f.size ?? f.text.length, mtimeMs: f.mtimeMs, isLink: false,
      })),
    }
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
    files.exists.push(e.path)
    return { value: Object.keys(files.current).some(path => at(e.path, path)) }
  })
  // A write lands at the path of a file the test gave, else at the path the mod passed
  on('fs.write', (_, e) => {
    const key = Object.keys(files.current).find(path => at(e.path, path)) ?? e.path
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
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // The classic events the mod hooks have nothing beneath them in a test
  on('classic.PostToolUseFailure', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.PreModelSwitch', () => o.preSwitch ?? {})
  const clock = mock.clock(on, { now: o.now ?? 0 })
  // The store, kept here rather than by the kit's mock so a test can read what the mod wrote: a test's `$` has no
  // store of its own. Values go through JSON as the real store's do; keys keep their insertion order.
  const stored = new Map<string, unknown>(Object.entries(o.store ?? {}))
  on('store.get', async (_, e) => {
    if (o.holdStore?.until && e.key === o.holdStore.key) await o.holdStore.until
    return { value: stored.get(e.key) }
  })
  on('store.set', (_, e) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  const store = {
    get: (key: string): unknown => stored.get(key), keys: (): string[] => [...stored.keys()],
    set: (key: string, value: unknown): void => void stored.set(key, JSON.parse(JSON.stringify(value)) as unknown),
  }
  mock.env(on, o.env ?? {})
  return { clock, toasts, opened, copied, usage, panes, listed, files, store, session, git, prompt, invalidates }
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

// One string per drawn line: each innermost Box (one holding no Box) joins its texts and button labels in order
export async function rows(ui: { drawn: () => Promise<RenderElement> }): Promise<string[]> {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const el = n as { type?: string; children?: unknown[] }
    const kids = el.children ?? []
    if (el.type === 'Box' && kids.some(k => (k as { type?: string } | null)?.type === 'Box')) kids.forEach(walk)
    else out.push(textOf(el))
  }
  walk(await ui.drawn())
  return out
}

// A call a test leaves held past its end: the kit rejects it once the test's stubs are gone, which is expected, so the
// rejection is caught rather than left for the file's end
export function held(call: Promise<unknown>): void {
  void call.catch(() => undefined)
}
