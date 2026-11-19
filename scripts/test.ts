#!/usr/bin/env node
// `claude plugin test` on a scratch copy of the files git would ship, never the folder on disk (shipped-copy.ts): a
// git-ignored copy of the repo under docs/superpowers/ would add its tests to the run, or pass its 1000-file limit.
import { claude, withShippedCopy } from './shipped-copy.ts';

const code = withShippedCopy('test', ({ copy, fileCount }) =>
{
    console.log(`test: claude plugin test on the ${fileCount} files git would ship`);
    const r = claude(['plugin', 'test', copy], 'inherit');
    if (r.error) { console.error(`test: cannot run claude (${r.error.message})`); return 2; }
    return r.status ?? 1;
});
process.exit(code);
