# alfred-mods

`session-inspector`, a Claude Code mod by envoydev, with its own plugin marketplace, `alfred-mods`. A mod is a Claude
Code plugin whose JavaScript or TypeScript hooks run inside Claude Code, so it can watch events and draw its own
interface ([mods overview](https://code.claude.com/docs/en/plugins/mods/overview)).

It works on Claude Code alone. With [Alfred Code](https://github.com/envoydev/alfred-code) installed in the same
project, it shows more, read from the one status file the stack publishes for each session. It never needs Alfred
Code, and nothing it draws breaks without it.

**Status: in design.** The hooks module is empty until the Phase 0 probe's verdict is approved; the design, the
features and the build phases are in [the session-inspector brief](docs/session-inspector-brief.md).

## What it shows

- **On Claude Code alone:** model and effort, context used out of the window, the 5-hour and weekly limits, session
  and daily cost, failed and denied tool calls with their reasons, running subagents, cache expiry, plan progress, a
  handoff prompt of its own, an on-screen mask for recordings (`/rec`) and compact tool rows (`/quiet`), in one calm
  band and an `/inspect` pane.
- **With Alfred Code:** also the stack's mode banner, the context runway measured against the stack's resume trigger,
  and `[Handoff]` filling the stack's ready handoff prompt instead of its own.

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
