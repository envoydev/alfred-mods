// The project row's change counts (the user, 2026-11-12: 'project: alfred-mods │ git:(web-steps) +5323 -123'): what
// `git diff --numstat HEAD` and `git ls-files --others -z` print, as numbers the row draws.

// Lines added and removed, summed over `git diff --numstat`'s rows; a binary file's `-` counts none
export function numstatTotals(stdout: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of stdout.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(row)
    if (match === null) continue
    added += match[1] === '-' ? 0 : Number(match[1])
    removed += match[2] === '-' ? 0 : Number(match[2])
  }
  return { added, removed }
}

// `git ls-files --others --exclude-standard -z`'s names, split on NUL
export function untrackedNames(stdout: string): string[] {
  return stdout.split('\0').filter(n => n !== '')
}

// A text file's lines, a last line with no newline counted; null for one that holds a NUL, as git counts no lines in it
export function textLines(text: string): number | null {
  if (text.includes('\0')) return null
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// Commits ahead of and behind the upstream (the user, 2026-11-12: 'git:(band-order) arrow-up-symbol 1
// arrow-down-symbol 2'): `git rev-list --left-right --count @{upstream}...HEAD` prints behind, a tab, then ahead
export function aheadBehind(stdout: string): { ahead: number; behind: number } | null {
  const match = /^(\d+)\t(\d+)\s*$/.exec(stdout)
  return match === null ? null : { ahead: Number(match[2]), behind: Number(match[1]) }
}
