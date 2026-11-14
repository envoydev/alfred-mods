---
paths:
  - ".claude-plugin/**"
  - "hooks/**"
  - "tests/**"
  - "types/**"
  - "scripts/**"
  - "package.json"
---

# Plugin handling

Adding, changing, renaming or removing anything the mod ships. `.claude/CLAUDE.md` holds the why; this is the order of work.

## One home per item

- The hooks module is `hooks/register.ts`, the one file `hooks/hooks.json` names under `modules`. It holds the wiring only: every `on(...)`, each calling one function of a feature folder. A feature lives in `hooks/<folder>/`: `types.ts`, logic files with no `$` and no state, and `effects.ts`, which owns the folder's atoms and module memory and is the folder's only file that touches `$`. Another folder reaches an atom through its owner's exported functions, never the handle. A test sits at the same path under `tests/`.
- A test is a `*.test.ts` under `tests/`, written before the hook it covers is called done. Every mods API call the hook makes gets a stub.
- `types/index.d.ts` declares the `PluginState` values once the mod uses `$.state`. `.claude-plugin/types/` is generated per build and git-ignored: never edit it.
- The repo root is the plugin root, and Claude Code scans its default folders whatever the manifest says: never add `commands/`, `agents/`, `skills/`, `bin/`, `.mcp.json` or another default component path unless the mod ships it.

## One version

- The version lives only in `.claude-plugin/plugin.json`; the marketplace entry carries none. Bump it on every user-visible change: an installed mod is cached by version.
- Never rename or drop the id `alfred-mods`: every install goes silent. `session-inspector` (to 0.4.0) left the `envoydev` catalog in alfred-code 3.9.2.
- The `envoydev` marketplace (envoydev/plugins-marketplaces, since 2026-11-14) lists the mod from this repo's `main` with no `sha`, so a merge to `main` with a version bump is the release, and nothing in plugins-marketplaces moves for it. Tag `v<version>` at the release commit. A change to that entry is a commit in plugins-marketplaces, on the user's word.

## Release

- `main` is the default branch and work lands on a branch. Commit, push, tag or merge only on the user's word, after the proof below, and report what was not run.

## Proof

- Per batch: `npm test` and `npm run validate`.
- Once after a change that draws or hooks something: a `claude --plugin-dir .` session in a scratch project under an isolated `CLAUDE_CONFIG_DIR` and `HOME`, in a project without Alfred Code and in one with it, reporting what each draws. A Desktop Code tab is checked before a release, or reported NOT RUN.
- The repo is public: no private project names or absolute local paths in a tracked file.
