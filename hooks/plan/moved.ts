// The stand-in time of a file the update copied: pure, so the plan folder's memory of copies stays in effects.ts
import type { Moved } from './types'

// The source's mtimeMs while the listed mtimeMs and size are still the copy's as the update saw them, else null
export function standInMtime(moved: Moved | undefined, listedMs: number, listedSize: number): number | null {
  if (moved === undefined) return null
  return listedMs === moved.copyMtimeMs && listedSize === moved.copySize ? moved.mtimeMs : null
}
