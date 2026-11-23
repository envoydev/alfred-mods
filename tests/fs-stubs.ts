// The kit's file system: the stubs of every $.fs call over the files a test gave, the links and aliases between
// paths, and the delete an `rm` stub makes. stubAll (kit.ts) calls stubFiles once per test.
import type { On } from 'claude-code'

import type { Options } from './kit'

// A file the mod lists and reads; `size` stands in for the text's UTF-8 byte length when given
export type FileStub = { text: string; mtimeMs: number; size?: number }
const sizeOf = (file: FileStub): number => file.size ?? new TextEncoder().encode(file.text).length

export type Files = { current: Record<string, FileStub>; reads: string[]; writes: string[]; exists: string[]; lists: string[] }

// `isRefused` matches a path as a refused path is named; `removeAt` deletes the file a removed path meets
export function stubFiles(on: On, o: Options): { files: Files; isRefused: (full: string, path: string) => boolean; removeAt: (target: string) => void } {
  // A test changes the files mid-test through `files.current`; a folder with no file in it is missing. The kit hands a
  // hook the path resolved against the mod's folder, with Windows' separators on Windows, so a stub matches its end
  // after `\` reads as `/`; `{ deny }` rejects the mod's call.
  const files = { current: { ...(o.files ?? {}) }, reads: [] as string[], writes: [] as string[], exists: [] as string[], lists: [] as string[] }
  const links = o.links ?? {}
  const taken = { ...o.taken }
  // A stub's absolute path such as `/shared/house.md` reaches a hook on Windows with the drive the resolve added
  // (`D:\shared\house.md`, or `\\?\D:\...` past the long-path limit), so the drive is dropped before matching
  // (Windows CI, 2026-11-12)
  const slashed = (path: string): string => path.replace(/\\/g, '/')
  const undrived = (path: string): string => slashed(path).replace(/^(?:\/\/\?\/)?[A-Za-z]:(?=\/)/, '')
  const at = (full: string, path: string): boolean => undrived(full) === path || undrived(full).endsWith(`/${path}`)
  // A refused path ends where the path does; one ending in `*` is a name's start, for a file whose name is random
  const isRefused = (full: string, path: string): boolean => (path.endsWith('*') ? `/${undrived(full)}`.includes(`/${path.slice(0, -1)}`) : at(full, path))
  // The mod's path reaches a hook resolved against its folder, so a table matches on a whole-segment run of the path
  const rewrite = (path: string, table: Record<string, string>): string => {
    const plain = undrived(path)
    for (const [from, to] of Object.entries(table)) {
      const start = plain === from || plain.startsWith(`${from}/`) ? 0 : plain.indexOf(`/${from}`) + 1
      const end = start + from.length
      if ((start > 0 || plain.startsWith(from)) && (end === plain.length || plain[end] === '/')) return `${plain.slice(0, start)}${to}${plain.slice(end)}`
    }
    // No drive either way, so a real path that no table rewrote compares with one it did on Windows too
    return plain
  }
  const mirrored = Object.entries(o.mirrors ?? {})
  const lookupTable: Record<string, string> = { ...o.aliases, ...Object.fromEntries(mirrored.map(([from, mirror]) => [from, mirror.to])) }
  const spellingTable: Record<string, string> = { ...o.aliases, ...Object.fromEntries(mirrored.flatMap(([from, mirror]) => (mirror.as === undefined ? [] : [[from, mirror.as]]))) }
  const canon = (path: string): string => rewrite(path, lookupTable)
  // What `realPath` says: an alias lands on its target, a mirror on its own spelling unless it says another
  const spelled = (path: string): string => rewrite(path, spellingTable)
  on('fs.list', (_, e) => {
    const dir = canon(slashed(e.path)).replace(/\/$/, '')
    files.lists.push(dir)
    const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
    const inDir = Object.entries(files.current).filter(([path]) => at(dir, parentOf(path)))
    const linksIn = Object.keys(links).filter(path => at(dir, parentOf(path)))
    // A folder holding a file or link at any depth below is listed as a folder
    const folders = (path: string): string[] => (path.includes('/') ? [parentOf(path), ...folders(parentOf(path))].filter(f => f.includes('/')) : [])
    const dirsIn = [...new Set([...Object.keys(files.current), ...Object.keys(links)].flatMap(path => folders(path).filter(f => at(dir, parentOf(f)))))]
    if (inDir.length === 0 && linksIn.length === 0 && dirsIn.length === 0) return { deny: `ENOENT: no such directory, ${e.path}` }
    return {
      value: [
        ...dirsIn.map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
        ...inDir.map(([path, f]) => ({
          name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: sizeOf(f), mtimeMs: f.mtimeMs, isLink: false,
        })),
        ...linksIn.map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })),
      ],
    }
  })
  // A link stats as what it leads to, with `realPath` its target when asked; a file as itself, its path its real one
  on('fs.stat', (_, e) => {
    if (o.refuseStat?.some(path => at(e.path, path)) === true) return { deny: `EACCES: stat refused, ${e.path}` }
    const link = Object.entries(links).find(([path]) => at(e.path, path))
    if (link !== undefined) {
      const isDir = Object.keys(files.current).some(path => path.startsWith(`${link[1]}/`))
      return { value: { kind: isDir ? 'dir' as const : 'file' as const, size: 0, mtimeMs: 0, isLink: true, ...(e.resolve ? { realPath: link[1] } : {}) } }
    }
    const real = canon(e.path)
    const found = Object.entries(files.current).find(([path]) => at(real, path))
    const isResolved = e.resolve === true && o.noRealPath?.some(path => at(e.path, path)) !== true
    if (found === undefined) {
      const folder = slashed(real).replace(/\/$/, '')
      const isDir = Object.keys(files.current).some(path => path.split('/').slice(0, -1).some((_, i, parts) => at(folder, parts.slice(0, i + 1).join('/'))))
      if (!isDir) return { deny: `ENOENT: no such file, ${e.path}` }
      return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(isResolved ? { realPath: slashed(spelled(e.path)) } : {}) } }
    }
    // An absolute stub's real path is its own, as a link's target is written: both sides then compare on Windows too
    const realPath = found[0].startsWith('/') ? found[0] : slashed(spelled(e.path))
    return { value: { kind: 'file' as const, size: sizeOf(found[1]), mtimeMs: found[1].mtimeMs, isLink: false, ...(isResolved ? { realPath } : {}) } }
  })
  // A read rejects over 4 MiB, as Claude Code's does (types, `$.fs.read`). `offset` and `length` are bytes of the text's
  // UTF-8, the cut text decoding with U+FFFD at a split character; `as: 'bytes'` answers `{ base64 }` of that range.
  on('fs.read', async (_, e) => {
    const found = Object.entries(files.current).find(([path]) => at(canon(e.path), path))
    if (found !== undefined) files.reads.push(found[0])
    if (found === undefined) return { deny: `ENOENT: no such file, ${e.path}` }
    if (o.holdRead !== undefined && found[0].endsWith(o.holdRead.path)) await o.holdRead.until
    const isRange = e.offset !== undefined || e.length !== undefined
    if (!isRange && e.as !== 'bytes') return (found[1].size ?? 0) > 4 * 1024 * 1024 ? { deny: `EFBIG: over 4 MiB, ${e.path}` } : { value: found[1].text }
    const encoded = new TextEncoder().encode(found[1].text)
    const start = e.offset ?? 0
    const range = encoded.slice(start, e.length === undefined ? undefined : start + e.length)
    if (range.length > 4 * 1024 * 1024) return { deny: `EFBIG: over 4 MiB, ${e.path}` }
    if (e.as !== 'bytes') return { value: new TextDecoder().decode(range) }
    let binary = ''
    for (let index = 0; index < range.length; index += 8192) binary += String.fromCharCode(...range.subarray(index, index + 8192))
    return { value: { base64: btoa(binary) } }
  })
  // Each path asked, so a test counts the reads of a missing file
  on('fs.exists', (_, e) => {
    files.exists.push(slashed(e.path))
    if (o.refuseExists?.some(path => isRefused(e.path, path)) === true) return { deny: `EACCES: check refused, ${e.path}` }
    const pending = Object.keys(taken).find(path => (taken[path] ?? 0) > 0 && isRefused(e.path, path))
    if (pending !== undefined) {
      taken[pending] = (taken[pending] ?? 0) - 1
      return { value: true }
    }
    return { value: Object.keys(files.current).some(path => at(canon(e.path), path)) }
  })
  // A write lands at the path of a file the test gave, else at the path the mod passed, with no drive, so a read of
  // that path finds it on Windows too (Windows CI, 2026-11-19)
  on('fs.write', (_, e) => {
    if (o.refuseWrite?.some(path => isRefused(e.path, path)) === true) return { deny: `EACCES: write refused, ${e.path}` }
    const key = Object.keys(files.current).find(path => at(e.path, path)) ?? undrived(e.path)
    const text = o.mangleWrite?.some(path => at(e.path, path)) === true ? `${e.text}\n#` : e.text
    files.current[key] = { text, mtimeMs: o.now ?? 0 }
    files.writes.push(key)
    return { value: undefined }
  })
  const removeAt = (target: string): void => {
    const key = Object.keys(files.current).find(path => at(path, canon(target)))
    if (key !== undefined) delete files.current[key]
  }
  return { files, isRefused, removeAt }
}
