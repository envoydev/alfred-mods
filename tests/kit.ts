// Test helpers: stubs for every $ call the mod makes, a reader of the $.state it writes, and the drawn rows as text.
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On, RenderElement, SessionUsage, UiPane } from 'claude-code'

export const NO_READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

// `unplaced` is the reason a surface gives for leaving an opened pane undrawn; `store` is what earlier sessions kept
type Options = {
  usage?: SessionUsage; sessionId?: string; cwd?: string; env?: Record<string, string>; now?: number; unplaced?: string
  store?: Record<string, unknown>
}

export function stubAll(on: On, o: Options = {}): {
  clock: MockClock; toasts: string[]; opened: string[]; copied: string[]; usage: { current: SessionUsage }; panes: UiPane[]
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
  on('classic.PermissionDenied', () => ({}))
  on('classic.SessionStart', () => ({}))
  const clock = mock.clock(on, { now: o.now ?? 0 })
  mock.store(on, o.store ?? {})
  mock.env(on, o.env ?? {})
  return { clock, toasts, opened, copied, usage, panes }
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
