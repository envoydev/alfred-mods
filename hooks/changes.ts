// The project row's change counts (the user, 2026-11-12: 'project: alfred-mods │ git:(web-steps) +5323 -123'): what
// `git diff --numstat HEAD` and `git ls-files --others -z` print, as numbers the row draws.

// Lines added and removed, summed over `git diff --numstat`'s rows; a binary file's `-` counts none
export function numstatTotals(stdout: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(row)
    if (m === null) continue
    added += m[1] === '-' ? 0 : Number(m[1])
    removed += m[2] === '-' ? 0 : Number(m[2])
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
