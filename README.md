# alfred-mods

`session-inspector`, a Claude Code mod by envoydev, with its own plugin marketplace, `alfred-mods`. A mod is a Claude
Code plugin whose JavaScript or TypeScript hooks run inside Claude Code, so it can watch events and draw its own
interface ([mods overview](https://code.claude.com/docs/en/plugins/mods/overview)).

It works on Claude Code alone. With [Alfred Code](https://github.com/envoydev/alfred-code) installed in the same
project, it shows more, read from the one status file the stack publishes for each session. It never needs Alfred
Code, and nothing it draws breaks without it.

**Status: Phase 3 (plan and scores) built:** the band with its plan line, and `/inspect` with Now, Usage, Agents,
Tools, Cache, Timeline and Plan. Later phases add handoff, REC and compact rows; the design, the features and the
build phases are in [the session-inspector brief](docs/session-inspector-brief.md).

## What it shows

- **On Claude Code alone:** model and effort, context used out of the window, the 5-hour and weekly limits, session
  and daily cost, failed and denied tool calls with their reasons, running subagents, cache expiry, plan progress, a
  handoff prompt of its own, an on-screen mask for recordings (`/rec`) and compact tool rows (`/quiet`), in one calm
  band and an `/inspect` pane.
- **With Alfred Code:** also the stack's mode banner, the context runway measured against the stack's resume trigger,
  and `[Handoff]` filling the stack's ready handoff prompt instead of its own.

## Commands

- `/inspect [now|usage|agents|tools|cache|timeline|plan [name]]` opens the pane on a tab, Now when none is named.
  `/inspect plan <name>` pins the plan file `<name>.json`; `/inspect plan` alone returns to the newest.

## Plan and score files

The Plan tab and the band's plan line read JSON files from one fixed folder in the project:
`.claude/session-inspector/plans/<slug>.json` for each plan and `.claude/session-inspector/scores/<slug>.json` for each
scored output. Any skill or tool can write them; writers resolve their own paths and publish there. The mod only
reads the folder and never writes it. Keep the folder gitignored.

The mod reads both folders after each Write, Edit or NotebookEdit call completes, at the end of each turn, and every
30 seconds. It shows the plan with a step in progress written this session, else the task list, else the newest plan;
`/inspect plan <slug>` pins one. A file that does not parse keeps its last good version and shows `plan file invalid`.
Files with LF or CRLF line ends, and with or without a byte-order mark, read the same.

A plan file and a scores file:

```json
{
  "version": 1,
  "slug": "token-refresh",
  "title": "Token refresh",
  "updatedAt": "2026-10-27T14:22:00Z",
  "steps": [
    { "id": "S1", "title": "Add refresh endpoint", "status": "done", "estimateMin": 15, "startedAt": "2026-10-27T13:20:00Z", "doneAt": "2026-10-27T13:40:00Z" },
    { "id": "S2", "title": "Rotate tokens", "status": "done", "estimateMin": 20, "startedAt": "2026-10-27T13:41:00Z", "doneAt": "2026-10-27T14:10:00Z" },
    { "id": "S3", "title": "Migration with rollback", "status": "done", "estimateMin": 10, "startedAt": "2026-10-27T14:11:00Z", "doneAt": "2026-10-27T14:21:00Z" },
    { "id": "S4", "title": "Update interceptor", "status": "in_progress", "estimateMin": 20, "startedAt": "2026-10-27T14:22:00Z" },
    { "id": "S5", "title": "E2E tests", "status": "pending", "estimateMin": 15 }
  ],
  "changes": [
    { "at": "2026-10-27T13:05:00Z", "kind": "created", "source": "claude" },
    { "at": "2026-10-27T14:05:00Z", "kind": "integrated", "step": "S2", "source": "user", "note": "Use sliding expiry, not fixed 15 min" }
  ]
}
```

```json
{
  "version": 1,
  "slug": "token-refresh",
  "subject": { "kind": "plan", "ref": "token-refresh" },
  "updatedAt": "2026-10-27T14:25:00Z",
  "scale": 100,
  "rounds": [
    { "round": 1, "at": "2026-10-27T13:10:00Z", "total": 68,
      "criteria": { "correctness": 70, "risk": 50, "completeness": 80 },
      "findings": [ { "id": "F1", "text": "No migration rollback", "severity": "BLOCKER" } ] },
    { "round": 2, "at": "2026-10-27T14:25:00Z", "total": 81,
      "criteria": { "correctness": 80, "risk": 80, "completeness": 80 },
      "findings": [ { "id": "F2", "text": "No load test for refresh storm", "severity": "MATERIAL" } ] }
  ]
}
```

### Allowed values

- `steps[].status`: pending, in\_progress, done, failed, blocked, skipped. Several steps can be in\_progress at once,
  since agents can run steps in parallel.
- `changes[]` is optional. `kind`: created, step\_added, step\_changed, step\_removed, integrated. `source`: user or
  claude. `note`: at most 200 characters.
- Scores file: `subject.kind` is plan, diagnosis or reply, and `subject.ref` names the plan slug or the graded file.
  `scale` is required; criteria can have any names and any number. `findings[].severity` is optional (BLOCKER, MATERIAL,
  MINOR). `findings[].status` (open, fixed, improved, wontfix) and `by` are optional.
- `steps[].estimateMin` is optional: the writer's estimate of Claude's working minutes for the step, not wall-clock
  time.

### Crediting subagent time

A subagent whose prompt contains a line `plan: <slug>` and a line `task: <step id>` is credited to that step. The mod
reads both lines at `agent.spawn` and links them to the subagent's agentId, which its later turns and tool calls carry.
The step id must equal `steps[].id` in the plan file. Every subagent that works on a step names it, including verifiers
and fix passes, because the estimate covers the gate and one fix pass. This is part of the public contract in the
plugin's README, like the plan file.

Each step's time is the working time of whoever builds it while it is in progress, recorded by the mod from its own
turn events. Machine waits such as builds, tests and CI count; waits for you (AskUserQuestion calls and permission
prompts) and idle time between turns do not.

### Rules for a plan skill

1. Create the file when the plan is first written, with every step pending and a `created` change.
2. Set a step to in\_progress with `startedAt` before working on it, and to done with `doneAt` after it passes its
   checks.
3. When the user gives text to fold into the plan, change the affected steps and add an `integrated` change with
   `source: user` and the user's words as `note`.
4. Always rewrite the whole file with the Write tool and update `updatedAt`. Never patch the JSON with Edit.
5. Give each step `estimateMin`: the working minutes of the agent that builds it, including its tests, its gate, one fix
   pass and any build or CI waits, but not time spent waiting for the user. An estimate can change only while its step
   is pending, and is frozen once the step starts.

### Rules for a scorer skill

1. Publish one scores file per graded output, with the subject it graded. The plan file holds no scores.
2. Add a new round each time; never edit an old round.
3. Always give the scale.
4. When the same finding can be recognised across rounds, reuse its id and set its status and `by`. When it can't, as
   with a fresh grader each round, leave them out: the mod then shows each round's total, the change per criterion and
   the count per severity (for example BLOCKER 2→0), and hides fixed and improved.

## Install

Requires Claude Code 2.1.287 or later in the terminal, or 2.1.286 or later in the Desktop app (`claude --version`).

```bash
claude plugin marketplace add envoydev/alfred-mods
claude plugin install session-inspector@alfred-mods
```

Then run `/reload-plugins`, or start a new session: `/plugin` shows `1 mod active · session-inspector`.

Install it through one marketplace only. The `envoydev` marketplace may list it too; if you added both, keep one of the
two installs: two plugin ids with the same name register its hooks only once.

Updates are pulled, not pushed:

```bash
claude plugin marketplace update alfred-mods
claude plugin update session-inspector@alfred-mods
```

A mod does not load in a session started with `--safe-mode` or `--bare`, with `disableAllHooks` set, or where your
organization's managed settings allow only its own mods
([troubleshoot a mod](https://code.claude.com/docs/en/plugins/mods/troubleshoot)).

## Development

The repo root is the mod: `.claude-plugin/plugin.json` (the one place its version lives), `hooks/hooks.json` naming
the hooks module `hooks/register.ts`, and tests under `tests/`. `.claude-plugin/marketplace.json` lists the root as
the marketplace's one plugin.

```bash
npm test                 # claude plugin test: hooks fired with stubs, no session, sign-in or network
npm run validate         # claude plugin validate --strict on both manifests (the mod with --profile directory too), on a copy of the files git would ship
claude --plugin-dir .    # load the working tree for one session; a save reloads the hooks
```

The first interactive `--plugin-dir` session writes the mod types for the running build into
`.claude-plugin/types/` (git-ignored), which editors and `tsc` read. Requires Node 22 for the scripts (built-ins
only) and the `claude` CLI on PATH. This repo's own rules are in `.claude/CLAUDE.md`.

## License

MIT - see [LICENSE](LICENSE).
