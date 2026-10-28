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

- The hooks module is `hooks/register.ts`, the one file `hooks/hooks.json` names under `modules`. A sibling file it imports sits beside it, imported by relative path, only once the brief's Phase 0 probe confirms such an import loads.
- A test is a `*.test.ts` under `tests/`, written before the hook it covers is called done. Every mods API call the hook makes gets a stub.
- `types/index.d.ts` declares the `PluginState` values once the mod uses `$.state`. `.claude-plugin/types/` is generated per build and git-ignored: never edit it.
- The repo root is the plugin root, and Claude Code scans its default folders whatever the manifest says: never add `commands/`, `agents/`, `skills/`, `bin/`, `.mcp.json` or another default component path unless the mod ships it.

## One version

- The version lives only in `.claude-plugin/plugin.json`; the marketplace entry carries none. Bump it on every user-visible change: an installed mod is cached by version.
- Never rename or drop the id `session-inspector`: every install goes silent.
- The `envoydev` marketplace in alfred-code lists the mod with a GitHub source pinned by `ref` (the release tag `v<version>`) and `sha`; both move together per release, and that change follows alfred-code's own CLAUDE.md.

## Release

- `main` is the default branch and work lands on a branch. Commit, push, tag or merge only on the user's word, after the proof below, and report what was not run.

## Proof

- Per batch: `npm test` and `npm run validate`.
- Once after a change that draws or hooks something: a `claude --plugin-dir .` session in a scratch project under an isolated `CLAUDE_CONFIG_DIR` and `HOME`, in a project without Alfred Code and in one with it, reporting what each draws. A Desktop Code tab is checked before a release, or reported NOT RUN.
- The repo is public: no private project names or absolute local paths in a tracked file.
