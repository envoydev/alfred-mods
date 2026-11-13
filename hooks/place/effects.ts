// The place folder's effects: what it reads and writes through $

// The HEAD file the place was read from, so the 30-second poll reads that one file for a checkout; the working folder
// it was read with, as a move to another (a `cd`, a worktree, /cd) reads the place again; and the folder it shows, the
// working folder or the folder of the file the main thread last edited or wrote
export const placeMem = { head: null as string | null, cwd: null as string | null, at: null as string | null, repo: null as string | null }

// The working folder the quiet rows read paths from, kept even when the place read is refused past it
export const rowsMem = { cwd: null as string | null }

// The repository's uncommitted changes for the project row (the user, 2026-11-12): `git diff --numstat HEAD` from the
// repository's folder, and each new untracked file's lines as added, the newest 200 files of 1 MiB or less, a file read
// again only when its size or time moved. Off the hooks, one count at a time; one asked for while another runs follows
// it. A refusal, a repository with no commit or a timeout leaves no counts. Nothing of a file is kept but its count.
export const changesMem = { isRunning: false, again: false, lines: new Map<string, { size: number; mtimeMs: number; lines: number }>() }
