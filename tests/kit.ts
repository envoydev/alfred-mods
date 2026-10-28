// Test helpers: stubs for every $ call the mod makes, a reader of the $.state it writes, and the drawn rows as text.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type {
  AgentInfo, ClassicResult, On, RenderElement, SessionUsage, Settings, TurnStepInput, TurnStepResult, TurnUsage, UiPane,
} from 'claude-code'

export const NO_READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

// `unplaced` is the reason a surface gives for leaving an opened pane undrawn; `store` is what earlier sessions kept
type Options = {
  usage?: SessionUsage; sessionId?: string; cwd?: string; env?: Record<string, string>; now?: number; unplaced?: string
  store?: Record<string, unknown>
  // `agents` is what `$.agent.list()` answers; `preSwitch` what the hooks beneath answer a PreModelSwitch with, such
  // as a deny; `settings` the merged settings object a read projects its key from
  agents?: AgentInfo[]; preSwitch?: ClassicResult; settings?: Record<string, unknown>
  // The project's files by the path the mod passes, such as `.claude/session-inspector/plans/p.json`
  files?: Record<string, FileStub>
}

// A file the mod lists and reads; `size` stands in for the text's length when given
export type FileStub = { text: string; mtimeMs: number; size?: number }

export function stubAll(on: On, o: Options = {}): {
  clock: MockClock; toasts: string[]; opened: string[]; copied: string[]; usage: { current: SessionUsage }; panes: UiPane[]
  listed: { current: AgentInfo[]; calls: number }; files: { current: Record<string, FileStub>; reads: string[] }
  store: { get(key: string): unknown; keys(): string[] }
} {
  const toasts: string[] = []
  const opened: string[] = []
  // The engine's record of the open panes; a test places a waiting one by replacing its entry
  const panes: UiPane[] = []
  const copied: string[] = []
  // A test changes the reading mid-test through `usage.current`
  const usage = { current: o.usage ?? NO_READING }
  on('session.usage', () => ({ value: usage.current }))
  on('session.id', () => ({ value: o.sessionId ?? 's1' }))
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
  const files = { current: { ...(o.files ?? {}) }, reads: [] as string[] }
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
  on('fs.read', (_, e) => {
    const found = Object.entries(files.current).find(([path]) => at(e.path, path))
    if (found !== undefined) files.reads.push(found[0])
    return found === undefined ? { deny: `ENOENT: no such file, ${e.path}` } : { value: found[1].text }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
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
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  const store = { get: (key: string): unknown => stored.get(key), keys: (): string[] => [...stored.keys()] }
  mock.env(on, o.env ?? {})
  return { clock, toasts, opened, copied, usage, panes, listed, files, store }
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

// The latest value the mod wrote under each key, read beneath the plugin as the write lands
export function watchState(on: On): { get(key: string): unknown } {
  const latest = new Map<string, unknown>()
  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (r.value?.isSet === true) {
      const v = e.value as { shape?: string; value?: unknown } | number
      latest.set(e.key, typeof v === 'object' && v !== null && 'shape' in v ? v.value : v)
    }
    return r
  })
  return { get: key => latest.get(key) }
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
