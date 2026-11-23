// The kit's stub of `$.config.set()`, which the skip ask's 'Leave out' calls: it records each call, and answers the value
// or, with `deny`, a refusal as a locked `/config` row would
import type { On } from 'claude-code'

export type ConfigSetCall = { key: string; value: unknown }

export function stubConfigSet(on: On, o: { deny?: string } = {}): { calls: ConfigSetCall[] } {
  const calls: ConfigSetCall[] = []
  on('config.set', (_, e) => {
    calls.push({ key: e.key, value: e.value })
    return o.deny === undefined ? { value: e.value } : { deny: o.deny }
  })
  return { calls }
}
