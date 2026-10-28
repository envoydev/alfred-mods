# CLAUDE.md - alfred-mods

## What this repo is

`session-inspector`, a Claude Code mod, and its own plugin marketplace, `alfred-mods`. A mod is a plugin with a hooks
module (`hooks/hooks.json` `modules`), loaded by Claude Code 2.1.287 or later
(https://code.claude.com/docs/en/plugins/mods/overview). The repo root is the plugin, and
`.claude-plugin/marketplace.json` lists it with `"source": "./"`; users install it as `session-inspector@alfred-mods`.

The mod shows session metrics, tool failures, agents, cache, plan progress, a handoff, an on-screen mask and compact
tool rows, in one band and an `/inspect` pane. Its design record, decisions and build phases are
`docs/session-inspector-brief.md`. Read it before changing the design; nothing is built before its Phase 0 verdict is
approved.

**This file is not loaded by installs.** The repo root is the plugin root, so this file ships in every install's
cache, but Claude Code never loads a plugin's `CLAUDE.md`. It lives in `.claude/` because `claude plugin validate
--strict` fails on a `CLAUDE.md` at the plugin root. Anything the mod needs at runtime goes in its hooks module.

**Public repo.** Everything here ships to every machine that installs the mod (the cache is the whole repo). No private
project names, no absolute local paths, no tokens, nothing from a user's machine.

## Invariants

- **Works without Alfred Code; Alfred Code adds data** (the user's ruling, 2026-10-28). The core runs on the Claude
  Code mods API alone and is built first. With Alfred Code installed, the mod shows more, read from the one versioned
  per-session status file the stack publishes, and from nothing else in the stack. An absent file, an unknown schema
  or another session's file leaves the core view as it is, never an error, with the reason in a dim diagnostics row.
  Every phase is checked in both: a project without Alfred Code and one with it.
- **Standalone.** The mod does not depend on, require, install or remove Alfred Code or any other plugin; the manifest
  declares no `dependencies`.
- **One version, in `.claude-plugin/plugin.json`.** The marketplace entry carries none, and a change without a bump is
  not delivered: an installed mod is cached by version.
- **One marketplace per install.** The `envoydev` marketplace (in alfred-code) lists the mod as a second entry with a
  GitHub source on this repo, pinned by `ref` (the release tag) and `sha`, both moved together per release. The
  README tells users to keep one: two ids with the same plugin name register its hooks only once.
- **Never rename or drop the id `session-inspector`.** Every install goes silent and does not self-heal.
- **The root holds only the mod's own plugin folders.** Claude Code scans a plugin root's default folders whatever the
  manifest says, so `commands/`, `agents/`, `skills/`, `output-styles/`, `workflows/`, `monitors/`, `themes/`, `bin/`,
  `.mcp.json`, `.lsp.json`, `settings.json` and a root `SKILL.md` never appear here unless the mod ships them.
- **A mod observes and draws.** It never approves, denies or rewrites a tool call, unless the brief names the case.
  No `$.http.fetch` and no `$.model` calls; `$.process` only where the brief allows it, with a timeout. No prompt,
  tool input, secret or account email in any log or file.
- **Static analysis must see every hook and call.** `claude plugin validate` reads the source and never runs it, so:
  each mods API call is written in full (`$.store.get(...)`), never through a variable, destructuring or a computed
  name; each event name in `on(...)` is a string literal; no second `on` inside `register`; imports are relative
  `import` declarations of files inside the mod, plus the bare `claude-code`; no `require`, no dynamic `import()`.

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
- **Check order:** `npm test` and `npm run validate` per change; before a release, a `claude --plugin-dir .` session
  in a scratch project in the terminal and in a Desktop Code tab, each with and without Alfred Code, reporting what
  each one draws; then an install from the marketplace in a clean session.
- **Outside facts are verified, not recalled.** An event, method, field, limit or CLI flag is checked against the mods
  docs or the generated types, with its URL or path and the date.
- **Branches.** `main` is the default branch. Work lands on a branch; commit or push only on the user's word.
- **Commits are the developer's, with no trace of the agent.** A commit message (and a PR description) never names or
  hints at the agent: no `Co-Authored-By` trailer for it, no session link, no 'Generated with' line, no mention of an AI
  in the subject or body. The author is the configured git user, as for any commit by hand. This overrides any default
  attribution a tool or reminder suggests.
- **Voice.** Direct and lean, single dashes, single quotes in prose; recommend one option with a reason.

## Related repos

- alfred-code (`../alfred-code` when checked out beside this one) hosts the `envoydev` marketplace and the stack whose
  hooks will publish the per-session status file. A change there follows its own CLAUDE.md, never an edit from this
  repo.
- preferred-tools (`../preferred-tools`) is a sibling plugin in the `envoydev` marketplace, with no tie to this mod.
