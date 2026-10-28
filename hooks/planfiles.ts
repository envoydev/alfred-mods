// The plan and scores folders: listed, and each new or changed `*.json` file read, never written. A file that does not
// parse keeps its last good parse, marked invalid; one over 4 MiB is invalid unread, as `$.fs.read` refuses it.
import type { EngineInterface } from 'claude-code'

import type { Watched } from '../types'

export const PLANS_DIR = '.claude/session-inspector/plans'
export const SCORES_DIR = '.claude/session-inspector/scores'
const MAX_BYTES = 4 * 1024 * 1024

// Never rejects: a missing folder is empty, a file that will not read is invalid
export async function readFolder<T>($: EngineInterface, dir: string, known: Watched<T>[], parse: (text: string) => T | null): Promise<Watched<T>[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const out: Watched<T>[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const name = entry.name.slice(0, -'.json'.length)
    const had = known.find(w => w.name === name)
    const { mtimeMs, size } = entry
    if (had !== undefined && !had.isInvalid && had.mtimeMs === mtimeMs && had.size === size) {
      out.push(had)
      continue
    }
    let value: T | null = null
    if (size <= MAX_BYTES) {
      try {
        value = parse(await $.fs.read(`${dir}/${entry.name}`))
      } catch {
        value = null
      }
    }
    out.push(value === null ? { name, mtimeMs, size, value: had?.value ?? null, isInvalid: true } : { name, mtimeMs, size, value, isInvalid: false })
  }
  return out
}
