// Test helpers: stubs for every $ call the mod makes, a reader of the $.state it writes, and the drawn rows as text.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type {
  AgentInfo, ClassicResult, EngineInterface, On, ProcessRunResult, RenderElement, RenderInput, RenderSurface, SessionUsage, Settings, SettingsSource,
  TurnStepInput, TurnStepResult, TurnUsage, UiPane,
} from 'claude-code'

import type { FileStub } from './fs-stubs'
import { stubFiles } from './fs-stubs'

export type { FileStub } from './fs-stubs'
export type { Drawn } from './drawn-rows'
export { isDrawn, rows } from './drawn-rows'
export { emptyState, failState, seedState, watchState } from './state-stubs'

export const NO_READING: SessionUsage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

// `unplaced` is the reason a surface gives for leaving an opened pane undrawn; `store` is what earlier sessions kept
export type Options = {
  usage?: SessionUsage; sessionId?: string; cwd?: string; env?: Record<string, string>; now?: number; unplaced?: string
  // The session's project root (`$.session.root()`); absent, the folder `cwd` names at each call, as a session that
  // never moved off its root; null, a root the call rejects
  root?: string | null
  // What `$.session.surfaces()` answers: absent, the terminal alone, as under the REPL; empty, a plain -p run
  surfaces?: RenderSurface[]
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
  // What `git diff --numstat HEAD` and `git ls-files --others` print for the project row's changes; each absent
  // refuses, so a test before the counts drew as it was written for
  diff?: string; untracked?: string
  // What `git rev-list --left-right --count @{upstream}...HEAD` prints; absent refuses, as for a branch with no upstream
  revList?: string
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
  // What a read of `settings:moved` answers while the test stored none: true ('told') by default, so a test of an
  // earlier command's choice meets no toast of S7's; 'unset' answers nothing, as a machine not yet told
  moved?: 'told' | 'unset'
  // Store keys whose first delete is refused, as a store that fails once would
  refuseDelete?: string[]
  // Paths whose writes, or whose existence checks, are refused, as a guard or a read-only disk would
  refuseWrite?: string[]; refuseExists?: string[]; refuseStat?: string[]
  // Paths that lead to another path, as a symbolic link does: a list, read, check or stat of one (or of a path under
  // it) meets the file or folder it names, and its `realPath` is that one's. `noRealPath` paths stat with no
  // `realPath`, as when a hook above withholds it.
  aliases?: Record<string, string>; noRealPath?: string[]
  // Paths that meet another path's files and folders but keep a `realPath` of their own, as a case alias, a bind mount
  // or a firmlink does; `as` is the spelling of that `realPath` where it differs only in case
  mirrors?: Record<string, { to: string; as?: string }>
  // Paths whose writes land with a line added, so a read-back of the copy differs from what was written
  mangleWrite?: string[]
  // Paths (named as a refused path is) that a check answers 'there' this many times before it answers truly, as a name
  // that is taken at first and free later
  taken?: Record<string, number>
  // What `rm` answers: rejected with `deny`, or exit `exitCode` (0 by default); each call is recorded in the returned `rm`
  // `removes` names the paths (as a refused path is named) that the call deletes, as an rm that fails part way does
  rm?: { deny?: boolean; exitCode?: number; removes?: string[] }
  // Runs just before `rm` answers, as a poll that lists the plan folders between the copy and the delete would
  beforeRm?: () => Promise<void>
  // Why `$.ui.copy` does not take, when a test gives one
  copyRefused?: 'no-surface' | 'no-clipboard' | 'refused'
}

export const gitResult = (stdout: string, exitCode = 0, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })


// The text of the file at `path` a test gave or the mod wrote, matched as the end of its key
export const fileAt = (files: { current: Record<string, FileStub> }, path: string): string | undefined =>
  Object.entries(files.current).find(([key]) => key === path || key.endsWith(path))?.[1].text

export function stubAll(on: On, o: Options = {}): {
  clock: MockClock; toasts: string[]; toastMs: (number | undefined)[]; opened: string[]; escapes: string[]; closed: string[]; copied: string[]; usage: { current: SessionUsage; breakdowns: number; refuse: boolean; fail: boolean }; panes: UiPane[]
  listed: { current: AgentInfo[]; calls: number }; files: { current: Record<string, FileStub>; reads: string[]; writes: string[]; exists: string[]; lists: string[] }
  // `git.current` and `git.calls`; the draft a test types and the texts the mod filled
  git: { current: ProcessRunResult | string; calls: number; argv: readonly string[] | null; timeoutMs: number | null }
  changes: { diff: string | undefined; untracked: string | undefined; revList: string | undefined; argv: (readonly string[])[]; cwd: string | null; timeoutMs: number | null }; prompt: { draft: string; fills: string[] }
  // Each `$.ui.invalidate` event the mod raised, in order
  invalidates: string[]
  // Each `$.ui.status` text the mod set, in order; undefined is a clear
  statuses: (string | undefined)[]
  // `set` writes as another session would, beneath the mod; `writes` lists the mod's own sets and deletes, in order, as
  // `set <key>` and `delete <key>`
  store: { get(key: string): unknown; keys(): string[]; set(key: string, value: unknown): void; writes: string[] }
  // A test changes the session id mid-test, as a /clear does, through `session.id`; `turns` is how many prompts the
  // session's transcript holds, 1 right after a /clear (its own row) and more after a resume
  session: { id: string; turns: number; root: string | null | undefined }
  // Each settings file by source, which a test changes mid-test, as an edit would: `sources.local['alfred-mods'] = ...`
  sources: Record<SettingsSource, Record<string, unknown>>
  // The names of the commands the mod registered, in order
  registered: string[]
  // Each `rm` argv the mod ran, with its timeout; `deny` is the option, which a test may change mid-test
  rm: { calls: (readonly string[])[]; checks: number; timeoutMs: number | null; deny: boolean }
} {
  const toasts: string[] = []
  // Each toast's timeoutMs, in the order of `toasts`: undefined is the default 4 s
  const toastMs: (number | undefined)[] = []
  const opened: string[] = []
  // The ids opened with closeOnEscape, and each id a close took down
  const escapes: string[] = []
  const closed: string[] = []
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
  // `root`, once set, is what `$.session.root()` answers, as a `/cd` moves it; null makes the call reject
  const session = { id: o.sessionId ?? 's1', turns: 0, root: undefined as string | null | undefined }
  on('session.id', () => ({ value: session.id }))
  on('session.turns', () => ({ value: session.turns }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
  on('session.root', () => {
    const root = session.root === undefined ? o.root : session.root
    return root === null ? { deny: 'test: no root' } : { value: root ?? o.cwd ?? '/w' }
  })
  on('session.model', () => (o.model === undefined ? { deny: 'test: no model' } : { value: o.model }))
  on('session.version', () => (o.version === undefined ? { deny: 'test: no version' } : { value: { version: o.version } }))
  on('session.repo', () => (o.repo === undefined ? { deny: 'test: no repo' } : { value: (o.repo === null ? null : { remote: null, internal: false, ...o.repo }) as never }))
  const registered: string[] = []
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    if (e.closeOnEscape === true) escapes.push(e.id)
    const isPlaced = o.unplaced === undefined
    if (!panes.some(p => p.id === e.id)) panes.push({ id: e.id, title: e.title ?? e.id, isShown: isPlaced, isFocused: false, isPlaced })
    return { value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: o.unplaced ?? '' } }
  })
  on('ui.panes', () => ({ value: panes }))
  // A close takes the pane off the list; an id not open is left alone, as Claude Code's is
  on('ui.close', (_, e) => {
    const at = panes.findIndex(p => p.id === e.id)
    if (at >= 0) {
      panes.splice(at, 1)
      closed.push(e.id)
    }
    return { value: undefined }
  })
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
  const { files, isRefused, removeAt } = stubFiles(on, o)
  const git = { current: o.git ?? gitResult('## main\n'), calls: 0, argv: null as readonly string[] | null, timeoutMs: null as number | null }
  const changes = { diff: o.diff, untracked: o.untracked, revList: o.revList, argv: [] as (readonly string[])[], cwd: null as string | null, timeoutMs: null as number | null }
  const rm = { calls: [] as (readonly string[])[], checks: 0, timeoutMs: null as number | null, deny: o.rm?.deny ?? false }
  on('process.run', async (_, e) => {
    // `rm -f --` with no path is the mod's check that rm runs: counted apart, it exits 0 unless rm is refused
    if (e.argv[0] === 'rm' && e.argv.length === 3) {
      rm.checks++
      return rm.deny ? { deny: 'test: rm refused' } : { value: gitResult('') }
    }
    if (e.argv[0] === 'rm') {
      await o.beforeRm?.()
      rm.calls.push(e.argv)
      rm.timeoutMs = e.init?.timeoutMs ?? null
      for (const target of e.argv.slice(3)) {
        if (o.rm?.removes?.some(path => isRefused(target, path)) === true) removeAt(target)
      }
      return rm.deny ? { deny: 'test: rm refused' } : { value: gitResult('', o.rm?.exitCode ?? 0) }
    }
    const isDiff = e.argv.includes('diff')
    if (e.argv.includes('rev-list')) {
      changes.argv.push(e.argv)
      return changes.revList === undefined ? { deny: 'test: no upstream' } : { value: gitResult(changes.revList) }
    }
    if (isDiff || e.argv.includes('ls-files')) {
      changes.argv.push(e.argv)
      changes.cwd = e.init?.cwd ?? null
      changes.timeoutMs = e.init?.timeoutMs ?? null
      const stdout = isDiff ? changes.diff : changes.untracked
      return stdout === undefined ? { deny: 'test: no git diff' } : { value: gitResult(stdout) }
    }
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
    toastMs.push(e.timeoutMs)
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
    if (o.copyRefused !== undefined) return { value: { isCopied: false as const, reason: o.copyRefused } }
    copied.push(e.text)
    return { value: { isCopied: true as const } }
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
  on('classic.ConfigChange', () => ({}))
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
    if (e.key === 'settings:moved' && !stored.has(e.key) && o.moved !== 'unset') return { value: true }
    return { value: stored.get(e.key) }
  })
  on('store.set', (_, e) => {
    writes.push(`set ${e.key}`)
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  const refusedDeletes = new Set<string>()
  on('store.delete', (_, e) => {
    if (o.refuseDelete?.includes(e.key) === true && !refusedDeletes.has(e.key)) {
      refusedDeletes.add(e.key)
      return { deny: `test: store delete refused, ${e.key}` }
    }
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
  return { clock, toasts, toastMs, opened, escapes, closed, copied, usage, panes, listed, files, store, session, git, changes, prompt, invalidates, statuses, sources, registered, rm }
}

// Claude Code's own answers to the events a session raises, for a test that drives a whole turn. A test hooks an
// event without a matcher once, so one that answers an event itself names it in `except`.
export function engine(on: On, except: string[] = []): void {
  const has = (name: string): boolean => !except.includes(name)
  if (has('session.start')) on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (has('prompt.submit')) on('prompt.submit', (_, e) => ({ text: e.text }))
  if (has('turn.start')) on('turn.start', (_, e) => ({ turnId: e.turnId }))
  if (has('prompt.attachment')) on('prompt.attachment', (_, e) => ({ text: e.text }))
  if (has('turn.complete')) on('turn.complete', () => ({ text: '' }))
  if (has('tool.call')) on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  if (has('session.measure')) on('session.measure', (_, e) => ({ changed: e.changed }))
  if (has('session.compact')) on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  if (has('agent.spawn')) on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
}

export const START = { cwd: '/w', surface: 'terminal', isInteractive: true } as const

// The task fields Claude Code 2.1.326 made required on AgentInfo. They come in through a spread, which takes no
// excess-property check, so the record type-checks on a build whose AgentInfo lacks them too (CI's pin, 2.1.322)
const AGENT_TASK: {
  kind: 'local_agent'; taskStatus: 'running'; label: string; startTime: number; cwd: string; tokenCount: number; tokenSamples: number[]; hasRow: boolean
} = { kind: 'local_agent', taskStatus: 'running', label: '', startTime: 0, cwd: '/w', tokenCount: 0, tokenSamples: [], hasRow: false }

// One `$.agent.list()` entry from the fields the mod reads
export function agentInfo(fields: Pick<AgentInfo, 'id' | 'description' | 'type' | 'status'> & Pick<Partial<AgentInfo>, 'parentId'>): AgentInfo {
  return { ...AGENT_TASK, ...fields }
}

// A person's edit to their user settings file mid-session: the fields merged under "alfred-mods", then Claude Code's
// ConfigChange and the clock's next tick, when the mod reads the files again (spec settings-values S4)
export async function setUser(
  $: Engine, kit: { sources: Record<SettingsSource, Record<string, unknown>>; clock: MockClock }, fields: Record<string, unknown>,
): Promise<void> {
  const before = kit.sources.user['alfred-mods']
  kit.sources.user['alfred-mods'] = { ...(typeof before === 'object' && before !== null ? before : {}), ...fields }
  await $.classic.ConfigChange({ source: 'user_settings' })
  await kit.clock.advance(0)
}
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

// A call a test leaves held past its end: the kit rejects it once the test's stubs are gone, which is expected, so the
// rejection is caught rather than left for the file's end
export function held(call: Promise<unknown>): void {
  void call.catch(() => undefined)
}

// Settles the clock until `isDone` holds, or 50 times: a hook's work on a 0 ms timer lands off the hook path
export async function until(clock: MockClock, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !isDone(); i++) await clock.settle()
}
