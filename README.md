# alfred-mods

A Claude Code mod that shows what your session is doing while you work: a band above the prompt with the model, the
context, your usage limits, the cost, the cache and the tools, skills, agents and rules in play, and an `/inspect` pane
with the details. It also saves a handoff before the context fills, and masks keys, emails and phone numbers on screen
while you record.

It works on Claude Code alone. With [Alfred Code](https://github.com/envoydev/alfred-code) installed in the same
project, it shows more, read from the one status file the stack publishes for each session. It never needs Alfred
Code, and nothing it draws breaks without it.

A mod is a Claude Code plugin whose hooks run inside Claude Code, so it can watch events and draw its own interface
([mods overview](https://code.claude.com/docs/en/plugins/mods/overview)). Until 0.5.0 this one was named
`session-inspector`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Settings](#settings)
- [What it shows](#what-it-shows)
- [Recording mode](#recording-mode)
- [Handoff](#handoff)
- [With Alfred Code](#with-alfred-code)
- [Plan and score files](#plan-and-score-files)
- [Development](#development)

## Install

Requires Claude Code 2.1.312 or later, in the terminal (`claude --version`) and in the Desktop app's Code tab
(`/status`). Mods load from 2.1.287, but the handoff and the compact rows use fields this mod is checked against only
from 2.1.312.

Install it from `envoydev`, the one marketplace for envoydev's plugins
([envoydev/plugins-marketplaces](https://github.com/envoydev/plugins-marketplaces)). It also lists Alfred Code, which the
mod does not need:

```bash
claude plugin marketplace add envoydev/plugins-marketplaces
claude plugin install alfred-mods@envoydev
```

Then run `/reload-plugins`, or start a new session: `/plugin` shows `1 mod active · alfred-mods`.

If you added `envoydev` from `envoydev/alfred-code` before, the catalog has moved: the
[plugins-marketplaces README](https://github.com/envoydev/plugins-marketplaces#moving-from-the-old-marketplace) has the
steps.

It adds nothing to every session's context: `claude plugin details alfred-mods@envoydev` reads `Always-on:
~0 tok` (measured 2026-10-30). The one thing it ever tells Claude is Recording mode's short note.

The `envoydev` entry follows this repo's `main` branch, so each release reaches you on your next update. Updates are
pulled, not pushed:

```bash
claude plugin marketplace update envoydev
claude plugin update alfred-mods@envoydev
```

### Without a GitHub SSH key

Claude Code fetches the mod from GitHub over SSH when it can. On a machine with no GitHub SSH key, an install or
update from `/plugin` in a session fails with `git@github.com: Permission denied (publickey)`: only
`claude plugin install` run from a shell falls back to HTTPS on its own. This repo is public, so HTTPS needs no
sign-in. Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` for good, then open a new terminal and start Claude Code again:

```bash
# macOS and Linux: add the line to ~/.zshrc or ~/.bashrc
export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1
```

```powershell
# Windows, in PowerShell
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_PREFER_HTTPS', '1', 'User')
```

Keep it set: updates do not fall back to HTTPS either
([installing without a GitHub SSH key](https://code.claude.com/docs/en/plugins/host-marketplace#serve-users-who-have-no-git-host-account)).

### Moving from session-inspector

Until 0.5.0 the mod was the plugin `session-inspector`. The `envoydev` marketplace no longer lists that id, so an old
install stops loading. Switch once, at the scope you installed it (`--scope user` by default):

```bash
claude plugin marketplace update envoydev
claude plugin uninstall session-inspector@envoydev
claude plugin install alfred-mods@envoydev
```

Settings the mod saved between sessions (the `/rec`
words, `/quiet`, `/auto-handoff` and today's cost) are kept per plugin name, so they start fresh under the new id.
The files it writes in a project keep their place under `.claude/session-inspector/`.

A mod does not load in a session started with `--safe-mode` or `--bare`, with `disableAllHooks` set, or where your
organization's managed settings allow only its own mods
([troubleshoot a mod](https://code.claude.com/docs/en/plugins/mods/troubleshoot)).

## Quick start

1. [Install](#install) it and run `/reload-plugins`. The band appears above the prompt; Ctrl+X Ctrl+A folds it away
   and back, and `/inspect band off` hides it until `/inspect band full`.
2. Run `/inspect` for the pane with the details: Now, Usage, Agents, Tools, Cache, Timeline and Plan. Esc at an
   empty prompt, or `/inspect close`, closes it.
3. Change what you want in `~/.claude/settings.json`, under one `"alfred-mods"` key beside the keys the file already
   has. Add only the fields you change; here is every field with its default:

   ```json
   {
     "alfred-mods": {
       "band": "full",
       "bandPlace": "above",
       "bandRows": true,
       "quiet": true,
       "rec": "off",
       "handoff": "ask",
       "handoffAt": 80
     }
   }
   ```

   Keep the JSON valid: Claude Code drops a file that does not parse, its permission rules with it. The band redraws
   as soon as you save.

### Common setups

| You want                                             | In `"alfred-mods"`     | Or run                |
|------------------------------------------------------|------------------------|-----------------------|
| The band under the prompt (the terminal only)        | `"bandPlace": "under"` | -                     |
| The short, two-line band                             | `"band": "calm"`       | `/inspect band calm`  |
| No band at all                                       | `"band": "off"`        | `/inspect band off`   |
| No `tools:`, `skills:`, `agents:` and `rules:` rows  | `"bandRows": false`    | -                     |
| Each tool call's full command and output             | `"quiet": false`       | -                     |
| Keys, emails and phones masked for a recording       | `"rec": "on"`          | `/rec on`             |
| Also your user name, home paths and dollar amounts   | `"rec": "strict"`      | `/rec strict`         |
| The recording over                                   | `"rec": "off"`         | `/rec off`            |
| A handoff saved by itself before the context fills   | `"handoff": "auto"`    | `/auto-handoff auto`  |
| No handoff                                           | `"handoff": "off"`     | `/auto-handoff off`   |
| The handoff from 70% instead of 80%                  | `"handoffAt": 70`      | `/auto-handoff at 70` |

A command writes its field into `~/.claude/settings.json` for you. For one project only, put the field in that
project's `.claude/settings.local.json`, which wins over your user file there ([Which file wins](#which-file-wins)).
The [Band Explorer](docs/band-explorer.html), one page that runs in a browser, offline too, previews each setting on
the band and gives each file's block to copy. Its live terminal has example transcripts (reading and testing, editing,
agents and skills, web research, questions and planning, failures), drawn as compact rows by the mod's own code or as
Claude Code's own rows with `"quiet": false`.

## Commands

- **`/inspect [now|usage|agents|tools|cache|timeline|plan [name]]`** opens the pane on a tab, Now when none is named.
  In the pane, `n`, `u`, `a`, `t`, `k`, `l` and `p` switch tabs. `/inspect plan <name>` pins the plan file
  `<name>.json`; `/inspect plan` alone returns to the newest.
- **`/inspect band off`, `calm`, `full`** set the band's mode, the `"band"` field, in your user file: `off` draws no
  band, above or under. **`/inspect band`** alone prints the mode and the file it comes from.
- **`/inspect show [n]`** expands the error of the failure whose row starts with n, as its Show button does, and
  again hides it; **`/inspect copy [n]`** puts that error on the clipboard, as Copy does. Failures are numbered as
  they happen, 1 the session's first, and a number never changes, so one that lands while Claude works moves no other
  row's. The Now and Tools tabs list the last 10, the newest on top; left out, n is the newest. Show opens the pane on
  Now unless it is open on one of those two.
- **`/inspect report [n]`** shows or hides an agent's report on the Agents tab, as its `Show report n` button does,
  1 the top.
- **`/inspect fill`** fills Alfred Code's resume prompt into the empty prompt box, as `f` does
  ([With Alfred Code](#with-alfred-code)).
- **`/inspect close`** closes the pane. So does Esc at an idle, empty prompt, or in the pane while it has the keys
  (Ctrl+X Tab). On the terminal's main screen, where nothing takes a click, these are the ways to close it; in
  fullscreen its ✕ takes a click too.
- **`/rec on`, `/rec strict`, `/rec off`** set [Recording mode](#recording-mode)'s level, the `"rec"` field, in your
  user file.
- **`/rec`** reads the settings files again and prints the level, the file it comes from, the private-word count and
  what REC cannot hide. **`/rec test`** runs the masker over fake samples and your private words; **`/rec words`**
  opens the private-words pane with the keys, so Esc closes it; **`/rec words close`** closes it from the prompt.
- **`/auto-handoff ask`, `auto`, `off`** set the [handoff](#handoff)'s mode, the `"handoff"` field, in your user file.
  **`/auto-handoff at 70`** (or `/auto-handoff 70`) sets the percent it starts at, `"handoffAt"`, a whole number from
  10 to 95.
- **`/auto-handoff now`** saves a handoff at once, in any mode. **`/auto-handoff compact`** saves one, then compacts,
  as the ask's `c` does; **`/auto-handoff later`** takes the ask down until its next step, as `r` does.
  **`/auto-handoff`** reads the settings files again and
  prints the mode, the first ask and the file each comes from.

A command that sets a field writes that one field under `"alfred-mods"` in `~/.claude/settings.json` (in
`$CLAUDE_CONFIG_DIR` when that is set) and leaves every other key, the file's indent and its line ends as they were.
The band follows within seconds, as for an edit by hand. If a project or local file gives the same field, it still
comes first, and the command says so. A file that does not parse as JSON, or whose `"alfred-mods"` is not an object,
is never rewritten: the command says why, and you set the field by hand.

Every button and key the mod draws has a command, so nothing needs a click or the pane's keys: in iTerm's main screen
with tabs, for one, neither reaches the mod. On the terminal's main screen (`CLAUDE_CODE_NO_FLICKER=0`) the pane draws
each button as that command, so the row tells you what to type:

```text
NEEDS A LOOK
23 ✗ 14:58 Bash  Verify each grader finding   Exit code 1 /inspect show 23 · /inspect copy 23
22 ⊘ 14:47 Bash  Check stamp lines            auto mode: Classifier unavailable /inspect show 22
```

An agent's report reads `/inspect report 1`, the handoff ask `/auto-handoff now · /auto-handoff compact ·
/auto-handoff later`, and Alfred Code's fill `/inspect fill`. In fullscreen and on the Desktop they stay buttons. The
tabs keep theirs, as each tab's name is its command's word (`/inspect usage`). The band's `[ /compact ]` and the Cache
tab's Compact are Claude Code's own `/compact`. Every switch is a settings value ([Settings](#settings)).

## Settings

The mod's switches are values under one key, `"alfred-mods"`, in Claude Code's own settings files. Add the key to a
file, save it, and the band redraws. The [Band Explorer](docs/band-explorer.html), one page that runs in a browser,
offline too, previews each setting on the band and gives each file's block to copy: download the file, or clone the
repo, and open it.

### Where to put them

1. Pick the file. `~/.claude/settings.json` applies to every project on the machine. A project's
   `.claude/settings.local.json` applies to that project alone and is yours, not meant to be committed. A field in the
   local file wins over the same field in your user file, and the fields it leaves out come from the user file.
2. Add `"alfred-mods"` beside the keys the file already has, with only the fields you want to change:

   ```json
   {
     "permissions": { "allow": ["Bash(npm test)"] },
     "alfred-mods": { "bandPlace": "under" }
   }
   ```

3. Check the JSON before you save: a missing comma or quote is enough. Claude Code drops a file that does not parse
   whole, its permission rules and every other setting in it too, and the next session starts on its 'Settings Error'
   dialog.
4. Save. The session redraws at once, and other open sessions within 30 seconds.

### The fields

| Field       | Values                       | Default   | Decides                                                            |
|-------------|------------------------------|-----------|--------------------------------------------------------------------|
| `band`      | `"full"`, `"calm"`, `"off"`  | `"full"`  | `"full"` adds the info line and the rows under it; `"calm"` keeps two lines; `"off"` draws none |
| `bandPlace` | `"above"`, `"under"`         | `"above"` | the band above the input, or under it (the terminal only)          |
| `bandRows`  | `true`, `false`              | `true`    | the `tools:`, `skills:`, `agents:` and `rules:` rows open or closed |
| `quiet`     | `true`, `false`              | `true`    | one line per tool call in place of the command and its output      |
| `rec`       | `"off"`, `"on"`, `"strict"`  | `"off"`   | [Recording mode](#recording-mode): what is masked on screen        |
| `handoff`   | `"ask"`, `"auto"`, `"off"`   | `"ask"`   | how a [handoff](#handoff) is saved before the context fills        |
| `handoffAt` | a whole number from 10 to 95 | `80`      | the context percent where the handoff first asks or saves          |

`band`, `rec`, `handoff` and `handoffAt` can also be set by a command, which writes the field into your user file
([Commands](#commands)).

### Each field, with an example

Each example shows the field inside the `"alfred-mods"` key of a settings file; keep the other keys and fields the
file already has.

#### `band` - how much the band shows

`"full"` (the default) draws the turn, the gauges, an info line and the rows under it; `"calm"` keeps the first two
lines; `"off"` draws no band at all. `/inspect band off|calm|full` sets it.

```json
{ "alfred-mods": { "band": "calm" } }
```

```text
"full":                                                    "calm":
⟳ Turn 2 · 0:14 · 18 tools                                 ⟳ Turn 2 · 0:14
ctx ▰▱▱▱▱ 30% │ 5h 15% … │ $1.29 · today $10.46           ctx ▰▱▱▱▱ 30% │ 5h 15% … │ $1.29
Sonnet 5.5 ◑ medium │ 59m │ ≈133 tok/s avg │ …
usage:   [ 19 tools ]
tools:   AskUserQuestion ×13 │ Bash ×5 │ Grep ×1
…
```

#### `bandPlace` - above or under the prompt

`"above"` (the default) draws the band over the input; `"under"` draws it below, in Claude Code's footer, on the
terminal only (a Desktop tab keeps it above). Under, Claude Code's own mode line stays first, right under the prompt.

```json
{ "alfred-mods": { "bandPlace": "under" } }
```

```text
❯ your prompt
  ⏵⏵ auto mode on (shift+tab to cycle)
  ⟳ Turn 2 · 0:14 · 18 tools
  ctx ▰▱▱▱▱ 30% │ 5h 15% … │ $1.29 · today $10.46
```

#### `bandRows` - the detail rows

`true` (the default) shows the `tools:`, `skills:`, `agents:` and `rules:` rows under the full band; `false` leaves
them out, and `usage:` still counts them in one line.

```json
{ "alfred-mods": { "bandRows": false } }
```

```text
⟳ Turn 2 · 0:14 · 18 tools
ctx ▰▱▱▱▱ 30% │ 5h 15% … │ $1.29 · today $10.46
Sonnet 5.5 ◑ medium │ 59m │ ≈133 tok/s avg │ cache warm 54m │ you 14:47 · Claude 15:58
usage:   [ 19 tools ]
```

#### `quiet` - one line per tool call

`true` (the default) draws each tool call in the conversation as one line: what it did, how many lines it printed,
and ✓ or ✗, with the steps that say what it worked on in `⎿` lines under it. Runs of reads fold into one line, a
failure keeps up to 3 error lines, and a blocked call shows the rule's first sentence. `false` draws Claude Code's full
rows: the command and its output. Ctrl+O expands either, and `[Show]` in the Tools tab shows a failure's whole error.

```json
{ "alfred-mods": { "quiet": true } }
```

```text
⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓
⏺ Bash · Show working tree status · 1 line ✓ · 3 times in a row
⏺ Bash · npm test · ✗ exit 1
    FAIL tests/auth.test.ts
⏺ 4 reads · ✓
  ⎿ read src/a.ts · 2 times
  ⎿ grep "refreshToken" in src
  ⎿ glob src/**/*.spec.ts
⏺ Edit · token.interceptor.ts · ✓
  ⎿ changed src/app/token.interceptor.ts · +3 −1
⏺ Write · plan.md · ✓
  ⎿ created docs/plan.md · 42 lines
```

Every other call names what it worked on the same way:

```text
⏺ WebFetch · code.claude.com/docs/en/plugins/mods/overview · ✓
  ⎿ fetched 42.1 KB · 200 OK · 1s
  ⎿ took: List the hook events and their limits
⏺ WebSearch · "claude code mods api" · ✓
  ⎿ 6 results · code.claude.com, github.com, anthropic.com +2 more
⏺ Agent · alfred-code:output-scorer · ✓
  ⎿ asked: Review plan round 1
  ⎿ result: C1.1 yes - the plan names every file it touches
  ⎿ 12 tool uses · 31k tokens · 1m 20s
⏺ Skill · superpowers:brainstorming · ✓
⏺ TodoWrite · 5 todos · 2 done, 1 in progress · ✓
  ⎿ now: Writing the tests
⏺ ToolSearch · "select:WebFetch" · ✓
  ⎿ found WebFetch
⏺ AskUserQuestion · ✓
  ⎿ Which band mode?
  ⎿ answered: Full
⏺ mcp__context7__query-docs · 12 lines ✓
  ⎿ libraryId: /vercel/next.js
  ⎿ query: app router caching
⏺ Monitor · Watch the build · ✓
  ⎿ watches: gh run watch 42
```

How to read a row:

| Mark                     | Meaning                                                                                      |
|--------------------------|----------------------------------------------------------------------------------------------|
| `⏺ <tool> · <what>`      | the tool, then what it worked on: a description, file, page, query, agent type or skill      |
| `⎿`                      | one step of the call: what it was given, what it did or what came back                       |
| `30 lines ✓`             | done, and how many lines it printed                                                          |
| `✗`, `✗ exit 1`          | failed (with its exit code), up to 3 error lines under it                                    |
| `✗ interrupted`          | stopped before it finished                                                                   |
| `⊘ denied by you`        | you said no to it                                                                            |
| `⊘ blocked: <reason>`    | a rule, a hook or the permission classifier stopped it                                       |
| `⎿ allowed by auto mode` | auto mode's classifier let the call run without asking you                                   |
| `· 3 times in a row`     | the same call with the same result ran 3 times back to back, drawn once                      |
| `4 reads`, `· 2 times`   | 4 reads or searches in a row folded into one row; a file read twice among them               |
| `+3 −1`                  | lines the edit or write added and removed                                                    |
| `+2 more`                | steps left out to keep the row short; Ctrl+O shows them all                                  |

Paths read from the session's working folder; one outside it shows in full.

#### `rec` - masking for a recording or a shared screen

`"off"` (the default) masks nothing. `"on"` masks keys, emails, phone numbers and your private words wherever the mod
and Claude Code's message rows draw them, and leads the band with a red `● REC`; `"strict"` also masks your user
name, home folder paths and dollar amounts. `/rec on|strict|off` sets it ([Recording mode](#recording-mode)).

```json
{ "alfred-mods": { "rec": "strict" } }
```

```text
before:  export API_KEY=sk-live-4f9a… · jane.doe@example.com · /Users/jane/app · $12.40
"on":    export API_KEY=‹key› · ‹email› · /Users/jane/app · $12.40
"strict": export API_KEY=‹key› · ‹email› · ~/app · $••.••
```

#### `handoff` - saving a handoff before the context fills

`"ask"` (the default) asks once the context passes `handoffAt`, in the band and the Now tab; `"auto"` saves by itself
at each step; `"off"` never asks or saves (`/auto-handoff now` still saves). The handoff is
`.claude/session-inspector/HANDOFF.md`, which the next session reads to carry on ([Handoff](#handoff)).
`/auto-handoff ask|auto|off` sets it.

```json
{ "alfred-mods": { "handoff": "auto" } }
```

```text
"ask":   ⚠ ctx past 80% 4: Handoff
"auto":  Handoff saved to .claude/session-inspector/HANDOFF.md - /clear fills a resume prompt
```

#### `handoffAt` - when the handoff starts

The context percent, a whole number from 10 to 95, where the handoff first asks or saves; after that it comes again
every 5 points, up to 95. The percent is of the point where Claude Code compacts by itself, not of the model's
window. `/auto-handoff at 70` sets it.

```json
{ "alfred-mods": { "handoffAt": 70 } }
```

```text
⚠ ctx past 70% 4: Handoff        then again at 75%, 80%, … 95%
```

### Which file wins

Each field on its own takes the first valid value in this order:

1. managed settings, an administrator's;
2. `--settings` on the `claude` command line;
3. the project's `.claude/settings.local.json`;
4. the project's `.claude/settings.json`;
5. your `~/.claude/settings.json`;
6. a choice you made with a command before 0.8.0 ([From 0.7](#from-07));
7. the default.

So with `"alfred-mods": { "bandPlace": "under", "rec": "on" }` in your user file and `"alfred-mods": { "bandRows":
false }` in one project's local file, that project draws the band under the input with REC on and the rows closed,
and every other project the same with the rows open.

- A value of the wrong type, or outside its field's values, is skipped as if absent, and a toast says so once. It
  names the file, the values the field takes and the value in use, never the bad value: `"band" in
  .claude/settings.local.json takes "full" or "calm" - using "calm" from ~/.claude/settings.json`.
- A field name the mod does not know is ignored, and an `"alfred-mods"` that is not an object gives that file no
  fields.
- `.claude/settings.json` is often committed, so a field there applies to everyone who works in the project. Keep your
  own choices, such as `rec` and `bandPlace`, in your user file or the local one.

### REC holds

One exception to the order, for REC alone: mid-session, REC never goes down because a file stopped giving it. A file
that does not parse reads as absent, the same as one whose `"rec"` was removed, so a typo made while editing any field
would otherwise unmask a running recording. When the file that set the level gives no `"rec"` any more, REC keeps its
level and a toast says so once: `REC stays on: .claude/settings.local.json no longer gives "rec" - fix the file, or set
"rec": "off" in it`. A value REC does not take in that file holds it the same way. `"rec": "off"` in that file, or in
one above it, turns REC off at once; otherwise the hold lasts until the next `claude` run. Raising REC, and every other field,
follow the files at once.

### When a change shows

At once in the session whose settings file changed, as Claude Code tells the mod, and within 30 seconds in every other
open session; a bare `/rec` or `/auto-handoff` reads the files again at once. A change of `rec` shows REC's toast,
`● REC on · hiding …` or `REC off`; the other fields redraw what they decide, with no toast. With
`leave_out_skipped_hooks` on, every change takes up to 30 seconds, REC included.

### From 0.7

- `/band` and `/quiet` are gone; typed, they are an unknown command. `/rec` and `/auto-handoff` keep their actions,
  and their switches now write your user file ([Commands](#commands)).
- A switch is a settings value now: no click or `t` on the band's toggle. `/rec on` and `/auto-handoff auto` still
  work, by setting the field in `~/.claude/settings.json`.
- Your earlier choices are kept. The mod reads what `/band`, the toggle, `/quiet`, `/rec` and `/auto-handoff` stored,
  as one layer under your user file, and the first session after the update shows, once and for 30 seconds, the line
  to paste: `Add "alfred-mods": { "bandRows": false, "rec": "strict" } to ~/.claude/settings.json - the choices your
  earlier commands made`. A toast shows about 120 characters, so with several choices kept its end is cut: `/rec` and
  `/auto-handoff` name where their values come from, and the band shows the rest. Once your user file sets a field, the
  stored choice for it is deleted; a project's file overrides it in that project and keeps it for the others.
- Going back to 0.7.0 brings the commands back on the stored choices: each one your user file has not replaced is still
  there, and a replaced one reads its default.

## What it shows

- **On Claude Code alone:** model and effort, context used out of the window, the 5-hour and weekly limits, session and
  daily cost, output speed as an average over the session (`≈70 tok/s avg` in the Usage tab), failed and denied tool
  calls with their reasons, running subagents, cache expiry, plan progress, a handoff prompt of its own, an on-screen
  mask for recordings (`"rec"`) and compact tool rows (`"quiet"`), in one band and an `/inspect` pane.
- **With Alfred Code:** where the stack publishes its status file, the stack handles a full context and the mod's
  handoff stands down ([Handoff](#handoff)), and the mod shows the stack's mode banner, the context runway measured
  against the stack's resume trigger, and an ALFRED CODE section whose `f` fills the stack's ready resume prompt
  ([With Alfred Code](#with-alfred-code)).

If the band or the pane fails to draw, it shows one dim line naming the failure, such as `alfred-mods: the band
failed to draw (throw)`, instead of going blank.

OK, warning and failure take your theme's own colours (`/theme`), so a light or colour-blind theme draws them as it
draws Claude Code's; with `NO_COLOR` set, nothing is coloured and the glyphs carry the meaning. Every row is laid out
in fixed-width cells and margins rather than runs of spaces, for surfaces that draw in a proportional face such as the
Desktop app; a table too wide for its pane shows its leading whole columns, and a failure row cuts its text before it
gives up its Show and Copy buttons. A narrow pane, down to 24 columns, keeps the numbers: the Tools tab narrows the
tool's column to keep its counts, and the Timeline leaves out the prompt's time to keep how long each turn took and
its tokens.

By default the band has an info line under its gauges, and rows under that:

```text
Sonnet 5.5 ◑ high │ 9m │ ≈119 tok/s avg │ cache warm ≈60m │ you 17:15 · Claude 17:13 │ CC 2.1.322
project: my-app │ git:(develop) +12 −3 │ folder: .claude
plan:    Token refresh ▰▰▰▱▱ 3/5 · ▸ S4 Update interceptor
usage:   [ 45 tools · 2 skills · 4 agents (1 ◐) · 5 rules ]
tools:   Bash ×32 │ AskUserQuestion ×4 │ Read ×4 │ Write ×4 │ Grep ×1
skills:  superpowers:brainstorming ×1 │ solve-task ×2 │ 57 of 60 listed
agents:  ◐ alfred-code:web-angular-verifier ×1 │ ✓ Explore ×2 │ ✓ general-purpose ×1 │ 1 running
rules:   alfred-interaction.md │ alfred-git.md │ alfred-preferences.md │ web-angular.md │ typescript.md │ 3 always-on · 2 by path
```

- **The info line:** the model and effort, the session's time, the average output speed, the cache, the times of your
  last prompt and Claude's reply, and Claude Code's version. While a turn runs, the band's first line counts the turn's
  tool calls, and the gauges add today's cost. Today's cost is the mod's own count on this machine: sessions it did not
  run in are not in it, so it can read lower than a status line's that counts every session.
- **`project:`** the folder the session started in, then `git:(<branch>)`, the branch of the repository holding the
  folder Claude works in (left out outside a repository), then `↑1 ↓2`, the commits the branch is ahead of and behind
  its upstream as of your last fetch (the mod never fetches; a side at 0, or a branch with no upstream, is left out),
  then that repository's uncommitted changes as `+added −removed` lines against the last commit, a new untracked file's lines counted as added (left out when there are
  none), then `folder:`, that folder when it is not the project's
  root. The folder follows Claude: where a Bash `cd` went, or the folder of the last file Claude edited or wrote,
  whichever came last (a folder outside the project shows as `…/<name>`); it is re-read after each Bash call, edit and
  write, and every 30 s. `git:(`, `)` and the arrows are purple, the branch yellow, the added lines green and the removed red, the
  project and the folder in your text's own colour. The counts come from `git diff --numstat HEAD`, `git ls-files` and
  `git rev-list --left-right --count @{upstream}...HEAD`, each with a 2 s timeout; short of width the folder goes first,
  then the changes, then the arrows.
- **`plan:`** while a plan runs: its title, bar, steps done and the step in progress (the Plan tab has the percent and
  the times), then the plan's score and its change from the round before, `score 85 ▲13`.
- **`usage:`** in aqua, counts what the rows under it list: tool calls, skills, agents dispatched (and how many run)
  and rules. It shows whether the rows are open or not.
- **The detail rows** are open by default; `"bandRows": false` closes them ([Settings](#settings)). Each row waits for
  its first item: no `skills:` row until a skill is loaded, no `agents:` until one is dispatched, and so on, so a new
  session shows none of them, and `usage:` none until something is counted.

`×N` on these rows is how many times this session. `tools:` lists every tool by name with its calls, agents' calls
included, an MCP tool as `<server>:<tool>`. `skills:`
lists the skills loaded into the main chat's context this conversation, by Claude's Skill tool or by you as `/name` (a
subagent's Skill calls are on its Agents row, and a skill that runs forked is in its own subagent, never listed here),
then how many skills the context's listing carries, of the session's. `agents:` lists each agent type in the order it
was first dispatched, with how many times: `◐` while one of it runs, `✗` once one failed or was stopped, else `✓`,
then how many run. `rules:` lists the rule files in the main context: those loaded at start (from `.claude/rules/`, a
link there named by the file it reaches, and your own rules folder), then those loaded by path, when Claude reads,
writes or edits a file their `paths:` match, in violet, then how many of each; a compaction
keeps them. A resumed or branched conversation still holds the skills, agents and by-path rules from before it, which no
mods API lists, so those rows count from the resume: what came since, with `since resume`, and no row until then.

When the width runs out, the info line wraps onto a second row between items, and items drop whole only when two rows
cannot hold them (the version first, then the times); `project:` shortens its folder to the last part, then leaves it
out, and `usage:` drops the rules, then the agents, then the skills. When the band has fewer rows than it needs, as in
fullscreen under a tall draft, `project:` goes first, then the info line's second row, then the open rows from the last
(`rules:`, `agents:`, `skills:`, `tools:`), then `usage:`, then `plan:`, then the whole info line, so the line with its
buttons stays in view. Once `plan:` goes, its count and score move to line 1 while something needs you
(`PLAN 1/4 · score 85 ▲13`). The full band keeps its colours when idle too, not only while a turn runs; `"band": "calm"`
goes back to the two lines, dim until something needs you.

`"bandPlace": "under"` draws the band under the input instead. Claude Code draws its own mode line (`⏵⏵ auto mode on`)
as the first row under the prompt whatever a mod does, so with `"above"` it is the bottom row, under the band and the
prompt, and with `"under"` it sits between the prompt and the band. Under the input is the terminal's only (a Desktop
tab keeps the band above), and it takes no keys, so each button becomes the command that does its job: in fullscreen a
click presses it, `[ /inspect ]`, `[ /compact ]`, `[ /auto-handoff now ]`; on the main screen
(`CLAUDE_CODE_NO_FLICKER=0`), where nothing takes a click, it is that command as text. There the action row (new failures, a cache
warning, the handoff ask) comes first, right under the input, over the turn line and the gauges. In fullscreen the room under the input is about half the screen, less the prompt, two rows when a
status line is set and one for the mod's pinned line; whatever else takes room, a draft of several lines or a taller
status line, cuts the band at the screen's edge from its last row, `rules:` first. It was built on Claude Code 2.1.322.

The full band draws from the session's first second, before any prompt: the model, the session's time, the project
and branch (read from git's own `HEAD` file, and again every 30 seconds for a checkout or a move to another folder)
and the version, with the 5h and 7d windows the last turn on this machine stored, marked `≈15%` until this session's
first reply brings its own, and only while their reset is still ahead; a session off a subscription, which has no
windows, drops them at its first request. The context's fill waits for the first request (`ctx —`), and the effort
for the first reply; nothing is fetched to get them sooner. The calm band waits for the first reading, as before.

An agent whose last step stopped at the output limit ends its Agents row with `⚠ max_tokens`, and its result reads
`result (cut off): …`, as the report ends mid-way. The Timeline's `spend` is the session's spend while the turn ran,
agents included (`spend, est.` on a plan, as the Usage tab marks cost); spend while no turn runs, such as an agent
finishing after the reply, falls in no row, so the column does not sum to the session's cost.

The Usage tab shows what fills the context, from Claude Code's own estimate: `In context` lists each part (system
prompt, tools, agents, memory files, messages), `Plugins` each plugin's agents and skills with their tokens, `Memory`
the memory files with the three largest, and `Skills` the skills loaded into the main chat, the listing's count and its
tokens. It reads again after a compaction, and when the tab opens a minute or
more after the last read. A memory file outside the project is named by its type and base name, never its path.

With two agents or more, the Agents tab draws them on one time axis above the tree, one lane each, the newest 8; the
Desktop app and VS Code draw it as a picture. Each lane names what the agent was asked (`task T-7 · Review plan round
1` when it has a task id), up to 40 cells, and its bar takes at most 40, so a wide pane is not a row of dots. A narrow
pane shortens the labels to keep a 10-cell bar, so a pane docked beside a 120-column terminal shows the lanes, and one
under 30 columns draws none. In the tree, a finished agent's `result:` is its report's first line that is not a
heading, as wide as the pane allows. Model loops that no Agent call started are
counted apart on one line, `Other loops 2 · 1 active · out 41k`; their tool calls are not counted.

A call a hook blocked names the hook's script, `⊘ blocked by guard.js: …`, and the Tools tab counts blocks by script
under `Blocked by hooks`.

An administrator's managed plugin can send events on past the plugins you install, and Claude Code then tells the
model, once per event and conversation, `alfred-mods: its classic.SessionStart hook was skipped. "<plugin>" runs first
and sent the event on past it.` One did so for six of the mod's hooks: `classic.SessionStart`, `classic.PostToolUse`,
`classic.PermissionRequest`, `classic.PostToolUseFailure`, `classic.PermissionDenied` and `skill.prompt`. On such a
machine, turn on the mod's option `Leave out hooks a managed plugin skips` (`leave_out_skipped_hooks`) in `/config`:
the mod leaves those six hooks out, so the notices stop, and loses nothing, as they never ran there. It also leaves out
the hook that sees a rule load by path, `classic.InstructionsLoaded`, which such a plugin may skip too, and the one
that sees a settings file change, `classic.ConfigChange`. A new install
asks for it once; leave it off anywhere else. Either way the mod reads a `/clear`, a resume or a branch off the session
id, so the band starts over within a second and the first prompt carries REC's note. A `/clear` after a saved handoff
still fills the resume prompt, unless you send a prompt first; resuming a conversation of one prompt fills it too, into
the empty box, never sent. What it cannot tell without those hooks:

- outside auto mode, a call you were asked about reads `refused`, whether you denied it, it failed after you allowed
  it, or another plugin's permission hook denied it;
- a classifier block counts as a new failure;
- a skill typed as `/name` is not counted, and is missing from the band's `skills` row and the Usage tab's `Skills`
  row; one Claude loads with its Skill tool is there;
- time you spend at a permission prompt counts toward a plan step's time;
- after a resume, the cache's rewrite cost (`rewrite ≈ $…`) is missing until you switch models;
- the band's `rules:` row lists only the rules loaded at start, and ends `by path not tracked`;
- a change to the mod's [settings](#settings) shows within 30 seconds, not at once.

A call that fails in auto mode still counts as new, and an interrupt is read from the mod's own tool hook.

While something needs you - recording mode on, the context at 60% or more, new failures - the mod pins one line under
the prompt, `⚠ alfred-mods: ● REC · ctx 82% · ✗ 2 new`, which stays while the band is collapsed (Ctrl+X Ctrl+A) or off (`"band": "off"`).
While the band is in view it shows REC and the context itself, so from Claude Code 2.1.321, which tells the mod the
band is collapsed, the line leaves them out then and keeps the new failures; collapsed, under a survey, where no band
draws (`-p`, an SDK session) or on an earlier build, it shows all three. Where two surfaces draw one session, the one
drawn last decides. It changes only when its text does, and clears once nothing needs you. A status line of your own,
such as claude-hud's, is not replaced: it draws under the prompt, below this line, with the band above the prompt.

## Recording mode

Recording mode masks what the mod and Claude Code's message rows draw, for a screen recording or a shared screen.
`"rec": "on"` or `"strict"` in a settings file turns it on, and `"rec": "off"` turns it off; `/rec on`, `/rec strict`
and `/rec off` set it in your user file ([Settings](#settings), [Commands](#commands)).

| Level    | Hides                                                                    |
|----------|--------------------------------------------------------------------------|
| `on`     | keys, emails, phone numbers and your private words                       |
| `strict` | the same, plus your local user name, home folder paths and dollar amounts |

- **It holds** across sessions and restarts while a settings file gives it. Mid-session it never goes down because a
  file stopped giving it, a typo included ([REC holds](#rec-holds)). A red `● REC` leads the band while it is on.
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
- **Keys** are provider keys and tokens, private key blocks, bearer tokens and named secrets (`API_KEY=…`), and also:
  a value named `password`, `passwd`, `pwd` or `secret` from 4 characters (`password=‹key›`, not `password: null`);
  a secret flag and its value (`--password ‹key›`, `--token=‹key›`); an Authorization header of any scheme
  (`Authorization: Basic ‹key›`); and the password in a URL's credentials (`postgres://admin:‹key›@localhost`). Only
  the value is hidden.
- **If a row fails to draw** while REC is on, it reads `‹row hidden: REC could not mask it›`, the spinner reads
  `Working`, and a question dialog keeps its option labels with every other text `‹hidden›`. With REC off, Claude Code
  draws the row as it would without the mod.
- **`/rec test`** runs the masker over fake samples of each kind, near misses that must stay visible, and your private
  words, and prints what it hid.
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
- Other open sessions, for up to 30 seconds after a change; run `/rec` in each session that will be on screen, which
  reads the files at once.
- Rows drawn before REC went on: on the terminal's main screen they stay in scrollback, so turn REC on before
  recording starts, then clear the terminal or start a new session.
- Files on disk and the transcript. HANDOFF.md gets only its key, email and phone masking.
- Anything Claude reads.

## Handoff

Before the context fills, the mod saves a handoff: a file the next session reads to carry on. Its percent is the
context in use over the point where Claude Code compacts the conversation by itself, not over the model's window, so
the ask comes before that compaction.

- **Ask mode** (the default): past 80% (`"handoffAt"`), the band shows `⚠ ctx past 80% [4 Handoff]`, a toast names
  `/auto-handoff now`, and the Now tab's HANDOFF row offers `h: save handoff`, `c: compact` (save, then compact) and
  `r: remind at 85%`. Letter keys work while the pane has the focus (Ctrl+X Tab moves it to the band's buttons,
  then to the pane; a click works in fullscreen). From the prompt, press 4 or run `/auto-handoff now`; the commands
  `/auto-handoff compact` and `/auto-handoff later` do `c` and `r`. It asks again at each step 5 points higher, up
  to 95.
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

`"handoff": "off"` turns it off: in `~/.claude/settings.json` for every project, in a project's
`.claude/settings.local.json` for that project ([Settings](#settings)).

## With Alfred Code

In a project where [Alfred Code](https://github.com/envoydev/alfred-code) publishes
`.claude/session-inspector/status/<session id>.json` for the session, the mod reads that one file at the session's
start, every 30 seconds and after `/clear`, and shows more:

- **The mode banner:** `auto-run · auto-compact 490k · scoring 80 │` leads the band from the session's start while the
  stack's auto-run, auto-compact or scoring is on, after `● REC` while recording. `490k` is where Claude Code compacts
  for the session's model; `auto-compact` alone when the stack does not know it. Where the band's first line does not fit beside it, the banner takes that line alone.
- **The runway:** while the stack offers a fresh session at a full context, the band's context gauge measures against
  the stack's trigger instead of the window, `ctx ▰▰▰▱▱ 62% of 150k`, and the turns forecast counts to it.
- **The ALFRED CODE section** in `/inspect`'s Now tab: what the stack does at a full context, its auto-run, auto-compact and scoring,
  the model it judges the session by, its resume prompt's first line and when it last wrote the file. A field the mod
  cannot use is named as ignored, and the rest still shows.
- **The plan and its score:** when the status file names the plan folder Alfred Code works on
  (`"plan": ".alfred/docs/work/plans/<feature>/"`), the plan row shows that plan from the folder's `status.json`,
  before any other plan, from `awaiting approval` to `done ✓`. It ends with the score from the folder's
  `scoring.json`: the kept round's total, `▲` or `▼` against the round graded before it, green at or above the scoring
  level and amber under it, `grading` while the grading still runs, and `withheld` once
  Alfred Code withheld the plan (its `scoring.json` `status`, from alfred-code 3.12). A plan let go finished stays 10 minutes. No
  folder named, or a file with another schema, and the plan row shows what it would without Alfred Code.
- **The resume prompt:** while the pane has the focus (Ctrl+X Tab, or a click in fullscreen), `f` fills the stack's
  prompt into an empty prompt box, never sending it. Enter in the prompt box sends it; in the terminal the focus is
  back there after the fill. `/inspect fill` does the same from the prompt. With something already typed, a toast says
  to clear it first.

The stack's own parts show as any plugin's do, the status file aside: the Usage tab names `alfred-code` with its
agents' tokens, the Tools tab names its guards (`blocked by shell-guards.js: …`), and its dispatched agents take their
`task:` id as their lane's label.

Without Alfred Code, or when the file is missing, has another schema or names another session, the band shows none of
this, and the ALFRED CODE section shows one dim line with the reason, such as `Alfred Code: no status file for this
session`. The file is the stack's: the mod never writes it, and reads nothing else of the stack but the two files of the
plan folder it names.

## Plan and score files

The Plan tab and the band's plan line read JSON files from one fixed folder in the project:
`.claude/session-inspector/plans/<slug>.json` for each plan and `.claude/session-inspector/scores/<slug>.json` for each
scored output. Any skill or tool can write them; writers resolve their own paths and publish there. The mod only
reads the folder, except HANDOFF.md, which it writes. Keep the folder gitignored.

The mod reads both folders after each Write, Edit or NotebookEdit call completes, at the end of each turn, and every
30 seconds. It shows the plan with a step in progress written this session, else the task list, else the newest plan
(with Alfred Code, the plan its status file names comes first: see With Alfred Code);
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

## Development

The repo root is the mod: `.claude-plugin/plugin.json` (the one place its version lives), `hooks/hooks.json` naming
the hooks module `hooks/register.ts` (the wiring; each feature lives in its folder under `hooks/`), and tests under
`tests/` at the same paths. The `envoydev` marketplace (envoydev/plugins-marketplaces) lists this repo by its GitHub
source; the repo carries no marketplace of its own.

```bash
npm test                 # claude plugin test: hooks fired with stubs, no session, sign-in or network
npm run validate         # claude plugin validate --strict on the root and on the manifest with --profile directory, on a copy of the files git would ship
claude --plugin-dir .    # load the working tree for one session; a save reloads the hooks
```

CI (`.github/workflows/ci.yml`) runs `npm run validate` and `npm test` on Linux, macOS and Windows, and `tsc` on Linux
against the types the pinned Claude Code build writes.

The first interactive `--plugin-dir` session writes the mod types for the running build into
`.claude-plugin/types/` (git-ignored), which editors and `tsc` read. Requires Node 22 for the scripts (built-ins
only) and the `claude` CLI on PATH. This repo's own rules are in `.claude/CLAUDE.md`; the
design, the features and the build phases are in [the session-inspector brief](docs/session-inspector-brief.md).

## License

MIT - see [LICENSE](LICENSE).
