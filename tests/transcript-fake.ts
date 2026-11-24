// A `$` of the test's own for the transcript reader: every call the reader makes, answered from memory, so a test holds
// one call and moves the clock where the kit's stubs cannot. The reader's module memory is the test's copy of the
// module, not the plugin's, so a test calls `resetTranscript` to start clean and to play a plugin reload.
import type { EngineInterface } from 'claude-code'

export const FAKE_PATH = '/cfg/projects/-work-app/s1.jsonl'
export const FAKE_CONFIG = '/cfg'

export type FakeOptions = {
  text: string
  // The engine's answer for the transcript's path: the path, or a build without the call, so the path is derived
  info?: 'given' | 'throws'
  // The stat of the file fails
  refuseStat?: boolean
}

export type HoldName = 'session.id' | 'fs.exists' | 'fs.stat'

export type Fake = {
  $: EngineInterface
  atoms: Map<string, unknown>
  clock: { now: number }
  // The next fs.read moves the clock on by this many ms, once
  slowNextRead: (ms: number) => void
  // The nth call (1 is the run's first) of `$.session.id()`, `$.fs.exists()` or `$.fs.stat()` waits until `release` runs
  hold: (name: HoldName, call: number) => { release: () => void; isHeld: () => boolean }
  setText: (text: string) => void
}

const ENCODER = new TextEncoder()

export function fakeEngine(options: FakeOptions): Fake {
  let bytes = ENCODER.encode(options.text)
  const atoms = new Map<string, unknown>()
  const clock = { now: Date.parse('2026-10-28T14:00:00Z') }
  let version = 0
  let slowMs = 0
  const calls: Record<HoldName, number> = { 'session.id': 0, 'fs.exists': 0, 'fs.stat': 0 }
  const holds: Partial<Record<HoldName, { call: number; until: Promise<void>; isHeld: boolean }>> = {}
  const counted = async (name: HoldName): Promise<void> => {
    calls[name]++
    const held = holds[name]
    if (held === undefined || held.call !== calls[name]) return
    held.isHeld = true
    await held.until
  }
  const fake = {
    session: {
      id: async () => {
        await counted('session.id')
        return 's1'
      },
      root: async () => '/work/app',
      cwd: async () => '/work/app',
      info: async () => {
        if (options.info === 'throws') throw new Error('test: session.info missing')
        return { transcriptPath: FAKE_PATH }
      },
    },
    env: { get: async (name: string) => (name === 'CLAUDE_CONFIG_DIR' ? FAKE_CONFIG : undefined) },
    clock: { now: async () => clock.now },
    fs: {
      exists: async () => {
        await counted('fs.exists')
        return bytes.length > 0
      },
      stat: async () => {
        await counted('fs.stat')
        if (options.refuseStat === true) throw new Error('test: stat refused')
        return { size: bytes.length }
      },
      read: async (_path: string, o: { offset?: number; length?: number; as?: string }) => {
        clock.now += slowMs
        slowMs = 0
        const start = o.offset ?? 0
        const range = bytes.slice(start, o.length === undefined ? undefined : start + o.length)
        if (o.as === 'bytes') {
          let binary = ''
          for (let index = 0; index < range.length; index += 8192) binary += String.fromCharCode(...range.subarray(index, index + 8192))
          return { base64: btoa(binary) }
        }
        return new TextDecoder().decode(range)
      },
    },
    state: {
      get: async (ref: { key: string }) => ({ value: atoms.get(ref.key), version }),
      set: async (ref: { key: string }, next: unknown) => {
        atoms.set(ref.key, next)
        return { isSet: true, version: ++version }
      },
    },
  }
  return {
    $: fake as unknown as EngineInterface,
    atoms,
    clock,
    slowNextRead: ms => { slowMs = ms },
    hold: (name, call) => {
      let release = (): void => undefined
      const until = new Promise<void>(resolve => { release = resolve })
      const held = { call, until, isHeld: false }
      holds[name] = held
      return { release, isHeld: () => held.isHeld }
    },
    setText: text => { bytes = ENCODER.encode(text) },
  }
}
