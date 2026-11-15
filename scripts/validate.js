#!/usr/bin/env node
// `claude plugin validate --strict` on what an install receives: a scratch copy of the files git would ship (tracked,
// plus untracked ones not ignored), never the folder on disk, so a Finder .DS_Store or the mod types Claude Code writes
// for the running build never fail it. The repo root is the mod; the envoydev catalog lives in envoydev/plugins-marketplaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node starts no .cmd or .bat file without a shell since 18.20.2 and 20.12.2 (CVE-2024-27980), and npm's global
// `claude` on Windows may be a .cmd shim: there it runs through the shell, each argument double-quoted, which starts a
// shim and an .exe alike. Elsewhere it starts directly, as before.
const quote = (arg) => `"${arg.replace(/"/g, '\\"')}"`;
function claude(args)
{
    if (process.platform !== 'win32') return spawnSync('claude', args, { encoding: 'utf8' });
    return spawnSync(['claude', ...args.map(quote)].join(' '), { encoding: 'utf8', shell: true });
}
const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
if (ls.error || ls.status !== 0)
{
    console.error(`validate: cannot list the repo's files (${ls.error ? ls.error.message : ls.stderr.trim()})`);
    process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-mods-validate-'));
const copy = path.join(scratch, 'alfred-mods');
let code = 0;
try
{
    // a file deleted in the working tree but still in the index is not shipped either
    const files = ls.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
    for (const f of files)
    {
        fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
        fs.copyFileSync(path.join(root, f), path.join(copy, f));
    }
    // the mod also runs the checks Anthropic's plugin directory makes (an icon, a README, no OS metadata files)
    const runs = [
        ['plugin root', [copy, '--strict']],
        ['mod', [path.join(copy, '.claude-plugin', 'plugin.json'), '--profile', 'directory', '--strict']],
    ];
    for (const [label, args] of runs)
    {
        const r = claude(['plugin', 'validate', ...args]);
        if (r.error) { console.error(`validate: cannot run claude (${r.error.message})`); code = 2; break; }
        if (r.status !== 0) { console.error(`validate: the ${label} failed\n${`${r.stdout}${r.stderr}`.trim()}`); code = 1; }
        else console.log(`validate: the ${label} passed (${args.slice(1).join(' ')}) on the ${files.length} files git would ship`);
    }
}
finally { fs.rmSync(scratch, { recursive: true, force: true }); }
process.exit(code);
