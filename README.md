# alfred-mods

`session-inspector`, a Claude Code mod by envoydev, with its own plugin marketplace, `alfred-mods`. A mod is a Claude
Code plugin whose JavaScript or TypeScript hooks run inside Claude Code, so it can watch events and draw its own
interface ([mods overview](https://code.claude.com/docs/en/plugins/mods/overview)).

It works on Claude Code alone. With [Alfred Code](https://github.com/envoydev/alfred-code) installed in the same
project, it shows more, read from the one status file the stack publishes for each session. It never needs Alfred
Code, and nothing it draws breaks without it.

**Status: Phase 5 (Alfred Code integration) built:** the band with its plan line and handoff ask, `/inspect`
with Now, Usage, Agents, Tools, Cache, Timeline and Plan, `/auto-handoff`, `/rec` and `/quiet`, and with Alfred Code
the mode banner, the runway and the resume prompt. Phase 6 ships it; the design, the features and the build phases are
in [the session-inspector brief](docs/session-inspector-brief.md).

## What it shows

- **On Claude Code alone:** model and effort, context used out of the window, the 5-hour and weekly limits, session
  and daily cost, failed and denied tool calls with their reasons, running subagents, cache expiry, plan progress, a
  handoff prompt of its own, an on-screen mask for recordings (`/rec`) and compact tool rows (`/quiet`), in one calm
  band and an `/inspect` pane.
- **With Alfred Code:** where the stack publishes its status file, the stack handles a full context and the mod's
  handoff stands down ([Handoff](#handoff)), and the mod shows the stack's mode banner, the context runway measured
  against the stack's resume trigger, and an ALFRED CODE section whose `f` fills the stack's ready resume prompt
  ([With Alfred Code](#with-alfred-code)).

## Commands

- `/inspect [now|usage|agents|tools|cache|timeline|plan [name]]` opens the pane on a tab, Now when none is named.
  `/inspect plan <name>` pins the plan file `<name>.json`; `/inspect plan` alone returns to the newest. In the pane,
  `n`, `u`, `a`, `t`, `k`, `l` and `p` switch tabs.
- `/auto-handoff [ask|auto|off|at <percent>|now]` sets how the mod saves a handoff before the context fills: `ask`
  (the default) asks, `auto` saves by itself, `off` does neither, `at <n>` sets the threshold (a whole percent from 10
  to 95, 80 by default) and `now` saves at once in any mode. With no argument it prints the state. See
  [Handoff](#handoff).
- `/rec [on|strict|off|test|words]` masks what is on screen for a recording: `on` or a bare `/rec` turns it on, `strict`
  hides more, `off` turns it off, `test` checks the masker and `words` opens the private-words pane. See
  [Recording mode](#recording-mode).
- `/quiet [on|off]` draws one line per tool call in place of the command and its output preview. A failure keeps up to
  3 error lines, runs of read-only calls fold into one line, and a blocked call shows the rule's first sentence.
  `/quiet off`, Ctrl+O or `[Show]` in the Tools tab bring the full rows back.

  ```text
  ⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓
  ⏺ 4 reads · scorer-card.test.js, chain.js, layout.js ×2 · ✓
  ⏺ Bash · npm test · ✗ exit 1
      FAIL tests/auth.test.ts
  ```

Settings for all three apply to every session and project on the machine; other open sessions follow within 30
seconds.

## Handoff

Before the context fills, the mod saves a handoff: a file the next session reads to carry on. Its percent is the
context in use over the point where Claude Code compacts the conversation by itself, not over the model's window, so
the ask comes before that compaction.

- **Ask mode** (the default): past 80%, the band shows `⚠ ctx past 80% [4 Handoff]`, a toast names
  `/auto-handoff now`, and the Now tab's HANDOFF row offers `h: save handoff`, `c: compact` (save, then compact) and
  `r: remind at 85%`. Letter keys work while the pane has the focus (Ctrl+X Tab moves it to the band's buttons,
  then to the pane; a click works in fullscreen); from the prompt, press 4 or run `/auto-handoff now`. It asks
  again at each step 5 points higher, up to 95.
- **Auto mode** saves at each step by itself, with a toast on the first save of the session.
- **The file** is `.claude/session-inspector/HANDOFF.md`. It holds only what is already on disk or what the mod counts:
  the plan file's path, title, steps, statuses and times, and a count of notes per step; the latest scores round's
  totals and open findings; the git branch line and up to 50 changed paths; and the turn, duration, tool calls,
  failures, agents and cost. It never holds a prompt, a note's text, a tool input (so no task-list items or commands),
  a failure's reason or an agent's description. Keys, emails and phone numbers are masked when it is written; private
  words are kept, as the file is for Claude and you, not a screen.
- **Your own HANDOFF.md** at that path is never overwritten: the mod writes only over a file whose first line is its
  marker, `<!-- session-inspector handoff v1 -->`, and otherwise says the save failed and why.
- **`git`** is optional; without it, the file says `Git: not available` with the reason.
- **The resume prompt:** after a save, a `/clear` within 2 hours fills `Read .claude/session-inspector/HANDOFF.md,
  check that the branch it names is checked out, and continue from its Next section.` into an empty prompt, never
  sending it. With something already typed, a toast names the file instead. A new session started elsewhere gets no
  fill; ask Claude to read the file.
- **With Alfred Code:** in a project whose stack publishes `.claude/session-inspector/status/<session id>.json` with
  `fullContext` `fresh-session` or `compact`, the stack handles a full context and the mod stands down for that
  session: no ask, no automatic save and no resume prompt, while `/auto-handoff now` still saves. With `fullContext`
  `off`, or no file, the mod's handoff runs. A file that does not parse, has another schema or names another session
  leaves the handoff running, and the ALFRED CODE section in `/inspect` says why.

`/auto-handoff off` turns it off in every project on the machine.

## With Alfred Code

In a project where [Alfred Code](https://github.com/envoydev/alfred-code) publishes
`.claude/session-inspector/status/<session id>.json` for the session, the mod reads that one file at the session's
start, every 30 seconds and after `/clear`, and shows more:

- **The mode banner:** `auto-run · scorer 80 │` leads the band while the stack's auto-run or its scorer is on, after
  `● REC` while recording. Where the band's first line does not fit beside it, the banner takes that line alone.
- **The runway:** while the stack offers a fresh session at a full context, the band's context gauge measures against
  the stack's trigger instead of the window, `ctx ▰▰▰▱▱ 62% of 150k`, and the turns forecast counts to it.
- **The ALFRED CODE section** in `/inspect`'s Now tab: what the stack does at a full context, its auto-run and scorer,
  the model it judges the session by, its resume prompt's first line and when it last wrote the file. A field the mod
  cannot use is named as ignored, and the rest still shows.
- **The resume prompt:** while the pane has the focus (Ctrl+X Tab, or a click in fullscreen), `f` fills the stack's
  prompt into an empty prompt box, never sending it. Enter in the prompt box sends it; in the terminal the focus is
  back there after the fill. With something already typed, a toast says to clear it first.

Without Alfred Code, or when the file is missing, has another schema or names another session, the band shows none of
this, and the ALFRED CODE section shows one dim line with the reason, such as `Alfred Code: no status file for this
session`. The file is the stack's: the mod never writes it and reads nothing else of the stack.

## Recording mode

`/rec` masks what the mod and Claude Code's message rows draw, for a screen recording or a shared screen.

| Level    | Hides                                                                    |
|----------|--------------------------------------------------------------------------|
| `on`     | keys, emails, phone numbers and your private words                       |
| `strict` | the same, plus your local user name, home folder paths and dollar amounts |

- **It holds** across sessions and restarts until `/rec off`. A bare `/rec` never turns it off or down, so typing it
  to start a recording never unmasks one. A red `● REC` leads the band while it is on.
- **Where it masks:** the band, every pane tab, toasts, the spinner, the mod's own command output, Claude's messages,
  command output, tool rows (each call drawn as its own row while REC is on) and Claude's question dialogs. Masked
  values read `‹key›`, `‹email›`, `‹phone›` and `‹private›`. Only the drawing changes: the stored messages and what
  Claude reads stay as they are.
- **Claude is told:** while REC is on, your next prompt carries a short note asking Claude not to write secret values,
  emails or phone numbers in replies; turning REC off sends a note that the limit is lifted.
- **Private words** are added in the `/rec words` pane, never as command arguments, which the transcript echoes. Each
  is 3 to 64 characters, up to 100 words, matched inside longer words regardless of case. They are stored as plain
  JSON in the mod's store file on this machine, not encrypted, and never in session state, a log, a toast, a file the
  mod writes or Claude's context. With REC on, the pane shows only how many there are.
- **`/rec test`** runs the masker over fake samples of each kind and your private words, and prints what it hid.
- **Before you record:** run `/rec test` and check that each sample and private word is hidden, then clear the
  terminal or start a new session, so no row drawn before REC went on is left in view.

What REC cannot hide:

- What you type in the prompt box.
- A prompt the mod fills into the prompt box (`f` in the ALFRED CODE section).
- Claude Code's own screens and dialogs: the permission dialog, `/context`, `/usage`, `/config`, the status line and the
  welcome header.
- Other plugins' bands and panes.
- The option labels of a question Claude asks: Claude Code draws them as asked. The question, its header and the
  option descriptions are masked.
- A private key's middle lines in a diff that does not show its BEGIN line. A diff that shows it draws every line of
  the key as `‹key›`.
- Other open sessions, for up to 30 seconds after a change; run `/rec` in each session that will be on screen.
- Rows drawn before REC went on: on the terminal's main screen they stay in scrollback, so turn REC on before
  recording starts, then clear the terminal or start a new session.
- Files on disk and the transcript. HANDOFF.md gets only its key, email and phone masking.
- Anything Claude reads.

## Plan and score files

The Plan tab and the band's plan line read JSON files from one fixed folder in the project:
`.claude/session-inspector/plans/<slug>.json` for each plan and `.claude/session-inspector/scores/<slug>.json` for each
scored output. Any skill or tool can write them; writers resolve their own paths and publish there. The mod only
reads the folder, except HANDOFF.md, which it writes. Keep the folder gitignored.

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

Requires Claude Code 2.1.312 or later, in the terminal (`claude --version`) and in the Desktop app's Code tab
(`/status`). Mods load from 2.1.287, but the handoff and the compact rows use fields this mod is checked against only
from 2.1.312.

```bash
claude plugin marketplace add envoydev/alfred-mods
claude plugin install session-inspector@alfred-mods
```

Then run `/reload-plugins`, or start a new session: `/plugin` shows `1 mod active · session-inspector`.

It adds nothing to every session's context: `claude plugin details session-inspector@alfred-mods` reads `Always-on:
~0 tok` (measured 2026-10-30). The one thing it ever tells Claude is Recording mode's short note.

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
