// The kit's stub of `$.config.set()`, which the skip ask's 'Leave out' calls: it records each call, and answers the value
// or, with `deny`, a refusal as a locked `/config` row would, or, with `throws`, a call that rejects as a build
// without `$.config` does
import type { On } from 'claude-code'

export type ConfigSetCall = { key: string; value: unknown }

export function stubConfigSet(on: On, o: { deny?: string; throws?: string } = {}): { calls: ConfigSetCall[] } {
  const calls: ConfigSetCall[] = []
  on('config.set', (_, e) => {
    calls.push({ key: e.key, value: e.value })
    if (o.throws !== undefined) throw new Error(o.throws)
    return o.deny === undefined ? { value: e.value } : { deny: o.deny }
  })
  return { calls }
}
