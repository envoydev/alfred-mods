// The kit's stubs of the mod's $.state: a reader of what it writes, a store that fails, seeds an earlier version left,
// and a reset
import type { On } from 'claude-code'

// The latest value the mod wrote under each key, read beneath the plugin as the write lands, and every write in order
// as JSON, so a test can look for text in any value the mod ever wrote
// `beforeWrite` may change a value in place before it lands, as a state stored by an older build would hold it
export function watchState(on: On, beforeWrite: (key: string, value: unknown) => void = () => undefined): { get(key: string): unknown; writes: string[] } {
  return recordWrites(on, () => undefined, beforeWrite)
}

// The one `state.set` hook of watchState and emptyState: `onWrite` hears the key of each write as it lands
function recordWrites(
  on: On, onWrite: (key: string) => void, beforeWrite: (key: string, value: unknown) => void = () => undefined,
): { get(key: string): unknown; forget(key: string): void; writes: string[] } {
  const latest = new Map<string, unknown>()
  const writes: string[] = []
  on('state.set', async ($, e, next) => {
    beforeWrite(e.key, e.value)
    writes.push(JSON.stringify(e.value))
    const r = await next(e)
    onWrite(e.key)
    if (r.value?.isSet === true) {
      const v = e.value as { shape?: string; value?: unknown } | number
      latest.set(e.key, typeof v === 'object' && v !== null && 'shape' in v ? v.value : v)
    }
    return r
  })
  return { get: key => latest.get(key), forget: key => void latest.delete(key), writes }
}

// Refuses the mod's read of one atom while `key` is set, as a store that fails would: every render hook reads an
// atom before it draws, so this makes any of them throw
export function failState(on: On): { key: string | null } {
  const fail = { key: null as string | null }
  on('state.get', (_, e, next) => (fail.key !== null && e.key === fail.key ? { deny: 'test: state read refused' } : next(e)))
  return fail
}

// Reads each key of `seeds` as the value an earlier version stored under it, until the mod writes that key: a session
// reloaded over state a test sets
export function seedState(on: On, seeds: Record<string, unknown>): void {
  const written = new Set<string>()
  on('state.set', async (_, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', async (_, e, next) => {
    const stored = await next(e)
    const seed = seeds[e.key]
    return seed === undefined || written.has(e.key) || stored.value === undefined ? stored : { value: { ...stored.value, value: seed } }
  })
}

// watchState and more: once `empty()` is called, a read of each key of `keys` answers as nothing stored (the StateRead's
// value undefined, so the atom reads its initial value, as after the engine's own reset) until the mod next writes that
// key, and `get` forgets the last value written, so it answers undefined until then too. The test kit takes one
// `state.set` and one `state.get` hook, so a test that needs both uses this alone.
export function emptyState(on: On, keys: string[]): { empty(): void; get(key: string): unknown; writes: string[] } {
  const emptied = new Set<string>()
  const watched = recordWrites(on, key => void emptied.delete(key))
  on('state.get', async (_, e, next) => {
    const stored = await next(e)
    return !emptied.has(e.key) || stored.value === undefined ? stored : { value: { ...stored.value, value: undefined } }
  })
  return {
    ...watched,
    empty() {
      for (const key of keys) {
        emptied.add(key)
        watched.forget(key)
      }
    },
  }
}
