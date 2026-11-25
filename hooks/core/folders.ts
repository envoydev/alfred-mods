// Folders as Claude Code keys a project in its records. Pure.

// A folder spelled one way: forward slashes, no trailing one
export const folderKey = (folder: string): string => folder.replace(/\\/g, '/').replace(/\/+$/, '')

// Whether `folder` is `root` or a folder above it: a session started in a subfolder belongs to the project above
export function isFolderOf(folder: string, root: string): boolean {
  const key = folderKey(folder)
  const at = folderKey(root)
  return key === at || (key !== '' && at.startsWith(`${key}/`))
}
