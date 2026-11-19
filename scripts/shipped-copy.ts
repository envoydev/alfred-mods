// The files git would ship (tracked, plus untracked ones not ignored), copied to a scratch folder, and the `claude`
// command that reads them. validate and test both run on that copy, never on the folder on disk: a Finder .DS_Store,
// the mod types Claude Code writes for the running build, or a git-ignored copy of the repo an audit leaves under
// docs/superpowers/ never reach them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns, type StdioOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node starts no .cmd or .bat file without a shell since 18.20.2 and 20.12.2 (CVE-2024-27980), and npm's global
// `claude` on Windows may be a .cmd shim: there it runs through the shell, each argument double-quoted, which starts a
// shim and an .exe alike. Elsewhere it starts directly, as before.
const quote = (arg: string) => `"${arg.replace(/"/g, '\\"')}"`;
export function claude(args: string[], stdio: StdioOptions = 'pipe'): SpawnSyncReturns<string>
{
    if (process.platform !== 'win32') return spawnSync('claude', args, { encoding: 'utf8', stdio });
    return spawnSync(['claude', ...args.map(quote)].join(' '), { encoding: 'utf8', shell: true, stdio });
}

export interface ShippedCopy
{
    readonly copy: string;
    readonly fileCount: number;
}

// Runs `use` on a fresh copy and removes it after. Exits 2 when git cannot list the files.
export function withShippedCopy(label: string, use: (shipped: ShippedCopy) => number): number
{
    const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    if (ls.error || ls.status !== 0)
    {
        console.error(`${label}: cannot list the repo's files (${ls.error ? ls.error.message : ls.stderr.trim()})`);
        return 2;
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `alfred-mods-${label}-`));
    const copy = path.join(scratch, 'alfred-mods');
    try
    {
        // a file deleted in the working tree but still in the index is not shipped either
        const files = ls.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
        for (const f of files)
        {
            fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
            fs.copyFileSync(path.join(root, f), path.join(copy, f));
        }
        return use({ copy, fileCount: files.length });
    }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
