import type { EngineInterface } from 'claude-code'

import type { Level } from '../types'
import { compile, maskHits, maskText } from './rec.ts'
import type { Compiled, Hit } from './rec.ts'
import { printable, setMasker } from './format.ts'

// REC's level, words and compiled classes live here in module memory, which /clear does not reset; the `rec` atom
// only makes surfaces redraw. The words are never put in $.state.
let level: Level = 'off'
let compiled: Compiled = compile('off', [], null)

// Masked text by its original, up to 256 entries and 4 MiB of text, emptied on each change of level or words
const CACHE_ENTRIES = 256
const CACHE_CHARS = 4 * 1024 * 1024
const cache = new Map<string, string>()
let cached = 0
let passes = 0

// The file's classes, whatever the level: keys, emails and phones, never private words or home paths
const FILE = compile('on', [], null)

export function setRec(next: Level, words: string[], home: string | null): void {
  level = next
  compiled = compile(next, words, home)
  cache.clear()
  cached = 0
}

export function recLevel(): Level {
  return level
}

// How many texts the compiled classes have scanned, for the cache's test
export function maskStats(): { passes: number } {
  return { passes }
}

// The one seam every drawn string and every toast passes through: REC's classes at its level, or the text as it is
export function mask(text: string): string {
  if (level === 'off' || text === '') return text
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  passes++
  const out = maskText(compiled, text)
  const size = text.length + out.length
  if (size <= CACHE_CHARS) {
    cache.set(text, out)
    cached += size
    for (const [k, v] of cache) {
      if (cache.size <= CACHE_ENTRIES && cached <= CACHE_CHARS) break
      cache.delete(k)
      cached -= k.length + v.length
    }
  }
  return out
}

// The matches mask() would replace, for the dialog's numbered tokens; none while REC is off
export function maskSpans(text: string): Hit[] {
  return level === 'off' ? [] : maskHits(compiled, text)
}

// What HANDOFF.md gets at write time: keys, emails and phones hidden, whatever REC's level
export function maskForFile(text: string): string {
  return maskText(FILE, text)
}

setMasker(mask)

// Every toast of the mod goes through here, so it is filtered and masked like any drawn string: a toast can carry
// text read from a file.
export function toast($: EngineInterface, text: string): void {
  $.ui.toast(mask(printable(text)))
}
