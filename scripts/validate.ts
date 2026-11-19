#!/usr/bin/env node
// `claude plugin validate --strict` on what an install receives: a scratch copy of the files git would ship, never the
// folder on disk (shipped-copy.ts). The repo root is the mod; the envoydev catalog lives in envoydev/plugins-marketplaces.
import path from 'node:path';
import { claude, withShippedCopy } from './shipped-copy.ts';

const code = withShippedCopy('validate', ({ copy, fileCount }) =>
{
    let result = 0;
    // the mod also runs the checks Anthropic's plugin directory makes (an icon, a README, no OS metadata files)
    const runs: [string, string[]][] = [
        ['plugin root', [copy, '--strict']],
        ['mod', [path.join(copy, '.claude-plugin', 'plugin.json'), '--profile', 'directory', '--strict']],
    ];
    for (const [label, args] of runs)
    {
        const r = claude(['plugin', 'validate', ...args]);
        if (r.error) { console.error(`validate: cannot run claude (${r.error.message})`); return 2; }
        if (r.status !== 0) { console.error(`validate: the ${label} failed\n${`${r.stdout}${r.stderr}`.trim()}`); result = 1; }
        else console.log(`validate: the ${label} passed (${args.slice(1).join(' ')}) on the ${fileCount} files git would ship`);
    }
    return result;
});
process.exit(code);
