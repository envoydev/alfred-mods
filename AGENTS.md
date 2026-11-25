# AGENTS.md - alfred-mods

## What this repo is

`alfred-mods`, a Claude Code mod (the plugin `session-inspector` until 0.5.0). A mod is a plugin with a hooks
module (`hooks/hooks.json` `modules`), loaded by Claude Code 2.1.287 or later
(https://code.claude.com/docs/en/plugins/mods/overview). The repo root is the plugin; it carries no marketplace of its
own. Users install it as `alfred-mods@envoydev`; development runs it with `claude --plugin-dir .`.

The mod shows session metrics, tool failures, agents, cache, plan progress, a handoff, an on-screen mask and compact
tool rows, in one band and an `/inspect` pane. Its design record, decisions and build phases are
`docs/session-inspector-brief.md`. Read it before changing the design; nothing is built before its Phase 0 verdict is
approved.

**This file is not loaded by installs.** The repo root is the plugin root, so this file ships in every install's
cache, but Claude Code never loads a plugin's instruction file. It is `AGENTS.md` at the root (the user's ruling,
2026-11-15): `claude plugin validate --strict` passes with it there and fails on a root `CLAUDE.md` (measured on
2.1.325). **Never add a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`:** Claude Code reads `AGENTS.md` only
while none of the three exists and says nothing when one switches it off (https://code.claude.com/docs/en/memory);
`npm run kit:check` fails when one appears. Anything the mod needs at runtime goes in its hooks module.

**Public repo.** Everything here ships to every machine that installs the mod (the cache is the whole repo). No private
project names, no absolute local paths, no tokens, nothing from a user's machine.

## Commands

```bash
npm run validate     # claude plugin validate --strict on a copy of the files git ships
npm test             # claude plugin test on the same copy - every *.test.ts, no session, sign-in or network
npm run kit:check    # the files claude-kit manages are unedited, and no CLAUDE.md hides this file
npm run typecheck    # tsc on tsconfig.json and tsconfig.scripts.json - needs npm install and .claude-plugin/types/
claude --plugin-dir .   # load the working tree for one session; it reloads on save
```

The first three are what CI runs on Linux, macOS and Windows, in that order. `typecheck` is CI's fourth job, on Linux
only: it reads `.claude-plugin/types/`, which Claude Code writes when an interactive `--plugin-dir` session loads the
mod, so run one such session first (the folder is git-ignored and belongs to the running build). It also needs
`npm install` once in a fresh clone: `typescript` and `@types/node`, pinned exactly in `devDependencies` with no
lockfile, check `scripts/` under `tsconfig.scripts.json` (nodenext, Node's types). Nothing the mod ships imports them.

`npm run validate` and `npm test` run `scripts/validate.ts` and `scripts/test.ts` on Node's type stripping, so a
maintainer's Node is 26.13.0 or newer, the line every envoydev plugin uses (the user, 2026-11-24; type stripping is
on by default from 23.6, https://nodejs.org/api/typescript.md): `engines` is `>=26.13.0` and `.nvmrc` says `26`. CI's
`node-version: 26` takes the newest 26.x. Both run on a scratch copy of the files git would ship
(`scripts/shipped-copy.ts`): a git-ignored copy of the repo that an audit leaves under `docs/superpowers/` never adds
its tests to the run or takes it past `claude plugin test`'s limit of 1000 test files.

## Layout

- `hooks/hooks.json` names the one module, `hooks/register.ts`: the wiring only, each `on(...)` calling one function
  of a feature folder.
- `hooks/<folder>/` - one feature each (`band`, `inspect`, `handoff`, `plan`, `tools`, `agents`, `cache`, ...):
  `types.ts`, logic files that take no `$`, and `effects.ts`, the folder's only file that touches `$`.
- `tests/` - each hook's `*.test.ts` at the same path as its source, with shared helpers in `tests/kit.ts`.
- `types/` - the mod's own `index.d.ts`; `scripts/validate.ts` and `scripts/test.ts` - the validate and test runs,
  on Node's type stripping, and `scripts/shipped-copy.ts`, the copy both run on; `docs/` - the brief and the band
  explorer.

## Invariants

- **Works without Alfred Code; Alfred Code adds data** (the user's ruling, 2026-10-28). The core runs on the Claude
  Code mods API alone and is built first. With Alfred Code installed, the mod shows more, read from the one versioned
  per-session status file the stack publishes and, through its `plan` field, the plan folder it names (`status.json`
  and `scoring.json`; the user's ruling, 2026-11-13: 'alfred mods must learn Alfred's code plans'). With
  `plansFolder` `.alfred` it also reads those two files from each plan folder under `.alfred/docs/work/plans/`, the 20
  written last (the user's ruling, 2026-11-25: 'plans must be taken from alfred code structure'). It reads nothing
  else in the stack. An absent file, an unknown schema or another session's file leaves the core view as it is, never
  an error, with the reason in a dim diagnostics row.
  claude-kit is a second source that adds data (the user's ruling, 2026-11-21, replacing 2026-11-19's line-only ruling):
  the mod reads it from `.claude/kit/settings.json` in the project and from the public plan and score files, and from no
  other file of the kit's. The
  `plansFolder` field picks whose plans show, one source each (the user's ruling, 2026-11-25: 'when selecting alfred
  we must follow and track alfreds plans structure, if claude kit the claude kit plans and structure, if default the
  default behaviour'): `.alfred-mods` reads claude-kit's `.alfred-mods/plans/<slug>.json` and
  `.alfred-mods/scores/<slug>.json`; `.alfred` reads Alfred Code's plan folders and the one its status file names, and
  the mod makes no folder in `.alfred/`; `default` reads no plan file, so the plan row is Claude Code's task list.
  Unset, the mod reads as before: the roots `.alfred-mods`, `.claude/session-inspector` and `.alfred/alfred-mods`
  (newest file per name, the earlier root on a tie) and the plan the status file names, since Alfred Code sets no
  `plansFolder`. The writers' rule is in the README, 'Plan and score files'. `/alfred-mods:update` is the one writer
  of plan and score files in the mod, under `.alfred-mods` only: it copies a file of the other two roots in, reads it
  back, and only then removes the source. No line leaves the core view as it is.
  Every phase is checked in both: a project without Alfred Code and one with it.
- **Standalone.** The mod does not depend on, require, install or remove Alfred Code or any other plugin; the manifest
  declares no `dependencies`. The one exception: `/alfred-mods:update` switches off the mod's own former id
  `session-inspector@` in a settings file; it never installs, removes or switches any other plugin.
- **One version, in `.claude-plugin/plugin.json`.** The marketplace entry carries none, and a change without a bump is
  not delivered: an installed mod is cached by version.
- **One marketplace for users: `envoydev`.** The `envoydev` marketplace (envoydev/plugins-marketplaces, since
  2026-11-14) lists the mod with a GitHub source on this repo's `main` and no `sha` (the user's ruling of 2026-11-04).
  So `main` is the release branch: a merge there reaches every install on its next update once `plugin.json`'s version
  is bumped, and nothing in plugins-marketplaces moves per release. The repo's own `alfred-mods` marketplace was
  deleted on 2026-11-14 (the user's 'clean cut'); development and the install check use `claude --plugin-dir .`.
- **Never rename or drop the id `alfred-mods`.** Every install goes silent and does not self-heal. The one rename,
  `session-inspector` to `alfred-mods` in 0.5.0, was the user's ruling of 2026-11-06: the `envoydev` catalog dropped
  `session-inspector` in alfred-code 3.9.2 (the same day, the user's call), so an old install goes silent until moved.
  The handoff file `.claude/session-inspector/HANDOFF.md` and its marker kept their names. The stack's per-session
  status file moved: it writes `<project root>/.alfred/state/sessions/status/<session id>.json` from the release after
  alfred-code 3.12.1, which wrote `.claude/session-inspector/status/<session id>.json`. The mod reads, first found wins,
  the new path under the root, under the root read at session start, the old path under the root, then the old path
  relative to the working folder (`statusPaths` in `hooks/handoff/handoff.ts`).
- **The root holds only the mod's own plugin folders.** Claude Code scans a plugin root's default folders whatever the
  manifest says, so `agents/`, `skills/`, `output-styles/`, `workflows/`, `monitors/`, `themes/`, `bin/`, `.mcp.json`,
  `.lsp.json`, `settings.json` and a root `SKILL.md` never appear here unless the mod ships them. The mod ships
  `commands/` (the user's ruling, 2026-11-19): `init.md`, `configure.md` and `update.md` name `/alfred-mods:init`,
  `/alfred-mods:configure` and `/alfred-mods:update`, and each has its own `command.run` hook in `hooks/register.ts`,
  which answers in place of the model (probed on 2.1.328). The markdown body is only the fallback for a host that runs
  no mod hooks. No command is registered with `$.command.register` under the name `alfred-mods`. The one
  exception is a git-ignored, machine-local `.mcp.json` for development: it never ships, but a `claude --plugin-dir .`
  session reads it as the mod's own MCP server (`plugin details` lists it), so a check of what the mod adds to a
  session loads a copy of the files git lists, as `npm run validate` does.
- **A mod observes and draws.** It never approves, denies or rewrites a tool call, unless the brief names the case.
  The one call past observing is `$.mcp.connect` on a loading MCP server whose raise the hooks beneath answered unrefused, to
  read its state (the user's ruling, 2026-11-24: Claude Code's `mcp.connect` answers before the server starts, and
  this call never starts a server the session lists). No `$.http.fetch` and no `$.model` calls; `$.process` only
  where the brief allows it, with a timeout. No prompt,
  tool input, secret or account email in any log or file.
- **Static analysis must see every hook and call.** `claude plugin validate` reads the source and never runs it, so:
  each mods API call is written in full (`$.store.get(...)`), never through a variable, destructuring or a computed
  name; each event name in `on(...)` is a string literal; no second `on` inside `register`; imports are relative
  `import` declarations of files inside the mod, plus the bare `claude-code`; no `require`, no dynamic `import()`.
- **One owner per atom, in its folder's `effects.ts`.** `claude plugin validate` refuses an atom handed to another
  file (checked 2026-11-13, Claude Code 2.1.323), so each `$.state` atom is made, read and updated in one
  `hooks/<folder>/effects.ts`, and other folders call its exported functions. A logic file takes no `$`. A stored
  field renamed means its atom's `shape` tag moves; a `$.store` key or a stored value's field is never renamed.
- **A relative import names its file with no extension** (`from './format'` for `format.ts`), in `hooks/` and
  `tests/`. From Claude Code 2.1.323 `claude plugin validate` type-checks every file on its own options and fails
  `--strict` on a `.ts` path (TS5097), whatever `tsconfig.json` says; validate, `claude plugin test` and the loader
  resolve a path with no extension to its `.ts` or `.tsx` file (checked 2026-11-13: validate in both profiles, the
  test run and a live session).

## Mod facts this repo relies on

From the mods docs (create, reference, test), read 2026-10-28 against Claude Code 2.1.312. The types Claude Code
writes into `.claude-plugin/types/` for the running build win over any page when the two disagree.

- **Files.** `.claude-plugin/plugin.json` (no mod-only fields); `hooks/hooks.json` whose `modules` lists ONE path,
  relative to it; the hooks module, an ES module exporting `register(on, options)`, `.js` or `.ts` loaded with no
  build step; `types/index.d.ts` once the mod uses `$.state`.
- **Tests.** `*.test.ts` anywhere in the mod, run by `claude plugin test` with the kit from `claude-code/testing`, no
  session, sign-in or network. Every mods API call the mod makes needs a stub, registered before the test's first call
  on `$`; `session.start` does not run by itself; 5 s per test by default.
- **Limits.** A hook's own time 10 s (keep each under 50 ms; heavy work goes on a timer), a `.catch` 1 s, all
  `session.end` hooks 1.5 s together, `$.store` 4 MiB of JSON, `$.fs` 4 MiB per file, redraws throttled to 10 a
  second (30 in the terminal).
- **Loading.** `claude --plugin-dir .` loads the working tree for one session and reloads it on save; an installed copy
  is cached by version. `claude plugin validate` fails a plugin name that looks like Anthropic's own, such as one
  starting `claude-`.
- **The built-in `plugin-authoring` skill** knows the events and methods of the running build. This repo's own
  packaging skill is `plugin-packaging`, so it does not replace the built-in one: a project skill named like a bundled
  one replaces it (https://code.claude.com/docs/en/skills).

## Working in this repo

- **Every change is proven on a throwaway project, never the real account.** Run nested `claude` sessions and installs
  under an isolated `CLAUDE_CONFIG_DIR` and `HOME` in the session scratchpad: on the real config they once left records
  of deleted scratch projects in `~/.claude/plugins/installed_plugins.json` and ended logged out. Ask before any run
  against the real account, and say it may cost a `/login`.
- **Read the result, not the exit code.** A case not run is reported as NOT RUN, never implied as passing.
- **CI runs the same checks, and they run here first** (`.github/workflows/ci.yml`: validate, test and kit:check on
  Linux, macOS and Windows, plus the type check on Linux, against the Claude Code build pinned there). Before a push,
  run them here in that order and push only when each passes; then watch the remote run to its end - it is what
  proves Linux and Windows (the user's ruling, 2026-11-15). The Windows runner is several times slower on the timer
  tests: a test that drives thousands of timer ticks carries its own `timeoutMs`.
- **Check order:** `npm test` and `npm run validate` per change; before a release, a `claude --plugin-dir .` session
  in a scratch project in the terminal and in a Desktop Code tab, each with and without Alfred Code, reporting what
  each one draws; then an install from the marketplace in a clean session.
- **Outside facts are verified, not recalled.** An event, method, field, limit or CLI flag is checked against the mods
  docs or the generated types, with its URL or path and the date.
- **Branches.** `main` is the default branch and the release branch; work lands on `develop`. Commit or push only on
  the user's word.
- **Commits carry no trace of the agent** - no co-author trailer, session link or 'Generated with' line. The rule is
  `.claude/rules/commits.md`, shared by every repo claude-kit serves.
- **Voice.** Direct and lean, single dashes, single quotes in prose; recommend one option with a reason.

## Related repos

- plugins-marketplaces (`../plugins-marketplaces`) hosts the `envoydev` marketplace; a change to the mod's entry is a
  commit there, on the user's word.
- alfred-code (`../alfred-code` when checked out beside this one) is the stack whose hooks will publish the
  per-session status file. A change there follows its own `AGENTS.md`, never an edit from this
  repo.
- alfred-tools (`../alfred-tools`, `preferred-tools` until 0.4.0) is a sibling plugin in the `envoydev` marketplace,
  with no tie to this mod.
- claude-kit (`../claude-kit`) holds the shared `.claude` rules, skills and settings synced into this repo
  (`.claude/kit/lock.json` lists them): change one there and sync, never here.
