# session-inspector mod: agent brief

Oct 27, 2026

## Purpose

You are a Claude Code agent. Check whether the session-inspector mod below can be built on the installed Claude Code version, give a verdict per feature, and build only what gets GO. Nothing is built before the verdict is approved.

1. Read this brief end to end, then read the mod types Claude Code writes for the installed build. Where the types and this brief disagree, the types win; note each disagreement in the verdict.
2. Run Phase 0: install the probe mod, run the probe session, and save the log.
3. Write the verdict table in the format of the Verdict section, then stop and wait for approval.
4. After approval, build the phases in order. A phase is done only when its acceptance checks pass.

Rules for the whole job:

- State only facts from the docs, the types or the probe log. Mark everything else as unverified.
- The mod makes no network calls and never writes prompts, tool inputs, secrets or the account email to any log or file.
- Keep each hook's own work under 50 ms. Move anything heavier to a timer.

## Context: Claude Code mods

A mod is a plugin whose JavaScript or TypeScript hooks run inside Claude Code, so it can observe, rewrite or answer events and draw its own interface. It needs Claude Code v2.1.287 or later in the terminal and v2.1.286 or later in the Desktop app, and the VS Code extension v2.1.299 or later to draw (v2.1.304 in a session that fetches no feature flags, such as one on Bedrock). Checked here against Claude Code 2.1.312, the installed build. (agent)

**Files**

- `.claude-plugin/plugin.json`: the plugin manifest.
- `hooks/hooks.json`: `{ "modules": ["./register.js"] }`.
- `hooks/register.js` or `.ts`: exports `register(on, options)` and registers each hook with `on(event, matcher?, async ($, e, next) => ...)`.
- Static analysis: every `on` names its event as a string literal and every call is written `$.noun.method(...)`. `claude plugin validate` fails a computed name: `the event name passed to on() is not a string literal`. (agent)
- `types/index.d.ts`: needed when the mod uses `$.state`, named in `plugin.json` as `types` before v2.1.299. (agent)
- `*.test.ts`: tests run by `claude plugin test`.

**Events this mod uses**

| Event | Used for | Notes |
| --- | --- | --- |
| `tool.call` | Tool counts, outcome after `await next(e)`, plan file writes | Carries `tool_use_id` and, in a subagent, `agentId`; core's result is `{ ref, result, text }`, plus `isError: true` when the tool failed; its time includes the permission prompt and the classifier; `!` commands typed at the prompt raise none (agent) |
| `tool.check` | Denied calls, the agent behind each call | Carries the same `tool_use_id` and `agentId` (from v2.1.290); resolves the rules' and hooks' verdict (`decision`, `reason`, `rule`, `hook`), never the person's answer at a prompt nor the auto mode classifier's: a call either settles still reads `ask` (agent) |
| `agent.spawn` | Subagent type, model, task, the `plan:` and `task:` lines | `next(e)` resolves `{ model, agentId }`, the only place the new agent's id appears; the docs say it does not fire again on a SendMessage resume, the 2.1.312 types declare `e.resume` for a resumed run, and the types win: a spawn with `e.resume` keeps that agent's row; agents run in the background by default, and an engine-internal agent can call tools with no spawn at all (agent) |
| `turn.step` | Model, effort, token and cache usage, output speed | Async generator, `yield* next(e)`; carries `turnId`, `index` and, in a subagent, `agentId`; chunks are told apart by `kind`, and the `stop` chunk and the result carry `usage`: the four token counts and the model (agent) |
| `turn.start`, `turn.complete` | Turn timing, tokens per turn | Both carry `turnId` and, in a subagent, `agentId`; `turn.complete` adds `durationMs`, `reason` and the turn's summed `usage` (agent) |
| `prompt.submit` | Time of your last prompt | `e.origin` tells your own prompt from a notification, a peer's message or a plugin's; only yours counts (agent) |
| `skill.prompt` | Skill name and source | Source fields from v2.1.299; no `agentId`, so skills per agent come from the Skill tool's `tool.call` (agent) |
| `session.compact` | Compaction count | `trigger` is `manual`, `auto`, `plugin` or `precompute`; count a main-loop compaction (no `agentId`) that ran, never `precompute` or a skip (agent) |
| `session.start`, `session.end` | Start timers, close today's cost entry | `session.end` hooks share a 1.5 s budget; `session.start` does not fire again after `/clear`, `/resume` or `/branch`, which reset `$.state` and end the session with `reason` `clear` or `resume` (agent) |
| `classic.SessionStart` | Reset per-session state after `/clear`, `/resume` or `/branch` | `e.source` is `clear`, `resume` or `fork` there; it also fires at startup and after a compaction (agent) |
| `session.measure` | Thresholds on context, the 5h and weekly windows and cost, without polling | Pushed after each main-loop turn and when a window moves a whole point; `e.changed` names what moved (agent) |
| `classic.PostToolUse`, `classic.PostToolUseFailure` | A tool's own run time | `duration_ms` leaves out the permission prompt and hook time (agent) |
| `classic.PreModelSwitch`, `classic.PostModelSwitch` | Cache TTL tier and re-cache cost, at a model switch only | Both carry `cache_ttl` (`5m` or `1h`), `prompt_cache_warm` and `estimated_cache_write_usd`; PostModelSwitch also fires on an automatic fallback and when `/resume` restores the model (`source` `auto`, `resume`); the probe hooked PreModelSwitch alone (agent) |
| `prompt.submit` (`context`), `ui.render` | REC: the model's note and display masking | The note rides the person's next own prompt after each change of level (agent) |

**Mods API calls this mod uses**

- `$.session.usage()`: `{ startedAt, context: { tokens?, window, percent? }, rateLimits: [{ kind, percentUsed, resetsAt? }], cost?: { usd } }`; `tokens` and `percent` are absent before the first response, and `rateLimits` is empty off a subscription. (agent)
- `$.agent.list()`: subagents and teammates, each `{ id, type, description, status, parentId?, name? }`, status pending, running, waiting, idle (the last two from v2.1.289), completed, failed or killed. No model, start time or current action: those come from `agent.spawn` and `tool.call`. (agent)
- `$.store`: this plugin's key-value store, one JSON file shared by every session on the machine, 4 MiB in total; a `get` then `set` is not atomic across sessions, so each session writes keys of its own. The settings and word keys (`settings:handoff`, `settings:rec`, `rec:words`) are shared by every session, and each write reads the key again first (agent). `$.state`: reactive per-session state, reset by `/clear`, `/resume` and `/branch`. (agent)
- `$.clock.every`, `$.clock.after`, `$.clock.now`, `$.fs.read`, `$.fs.stat`, `$.fs.write` (HANDOFF.md only), `$.process.run` (one `git status`, 2 s timeout), `$.env.get` (literal names only), `$.session.id`, `$.session.model`, `$.session.compact` (rejects while a turn runs), `$.prompt.read`, `$.prompt.fill`, `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.command.register`, `$.command.run`, `$.command.list`. (agent)
- `$.session.identity()` answers the account only to a mod the organization's managed settings install, and `{ deny }` to this one, so the account comes from the config file. (agent)

**Where it draws**

- **Render sites:** `AbovePrompt` is the band (terminal and Desktop only), `Pane` is a side or inline pane, and `Spinner` (terminal, Desktop, VS Code) is the line that animates while a turn runs, its `e.requestId` 'the agent id for a spinner' (types). The probe saw one instance per session, the main loop's, even while a background agent ran (I, one `requestId` from I 10 to I 272), so a background agent draws no spinner of its own; a foreground agent's is not seen. `ToolUse`, `ToolResult` and `ToolGroup` draw on every surface; `InfoNotice` is the terminal's dim status line under the logo. (agent)
- **Apps:** everything draws in the terminal and the Desktop Code tab, and in the VS Code extension from v2.1.299, except the band. A Desktop WSL session loads no plugins; Remote Control draws in the terminal on your machine. (agent)
- **A collapsed band:** the person can collapse the band (ctrl+x ctrl+a, or `[-]`); the mod cannot tell, and no hotkey presses a button in it then, so nothing the person must answer lives only in the band. (agent)
- **Headless sessions:** in `claude -p` and cloud sessions hooks run but nothing draws.

## Decisions already made

The mod is one plugin named `session-inspector`, built without Claude HUD, that merges six mods from the source deck into ten features. Challenge a decision in the verdict only with evidence from the probe or the types.

- **Mod-only, no Claude HUD.** One system, so REC can mask everything on screen and timers keep clocks live. HUD draws failed tools as ✓ (`src/render/activity.ts`) and REC cannot reach its statusline.
- **One plugin, one hooks module.** Every feature shares one state, and REC must see everything the plugin draws. Split code into sibling files only if the probe confirms the hooks module can import them.
- **Standalone plugin.** It is its own plugin in its own repo, with its own marketplace, so it installs and works in any project. The envoydev marketplace lists it as a second entry with a GitHub source pinned by both `ref` (the release tag) and `sha`, bumped together per release. The version lives only in `plugin.json`. The README tells users to install it through one marketplace only, because two ids with the same plugin name register hooks only once.
- **Commands.** `/inspect [tab]`, `/auto-handoff ...`, `/rec ...`, `/quiet on|off`. The deck lists `/agents` and `/goal` as built in, so never use those.
- **Core and Alfred Code integration.** The core works from the Claude Code mods API alone and is built first. The integration waits until the stack's workspace releases settle its paths. Besides the plugin's public contracts (the plan file and the plan: and task: prompt lines), its only input from the stack is one small versioned status file that the stack's own hooks publish (schema, session, model, auto-run, scorer, resume trigger, window, handoff prompt), one file per session in the plugin's fixed folder. The mod reads nothing else from the stack, ignores an unknown schema or another session's file, and shows nothing when unsure, with the reason in a dim diagnostics row under \[Inspect\]. With the file present, it adds the mode banner, measures the runway against the stack's resume trigger ahead of the engine's threshold, and makes \[Handoff\] fill the stack's ready handoff prompt verbatim, without sending it and only into an empty prompt. Without Alfred Code, \[Handoff\] uses the mod's own extractive resume prompt (HANDOFF.md, then a resume prompt filled after `/clear`), so each environment has exactly one handoff home; from Phase 4, F8 stands down for a session with a valid status file whose `fullContext` is not `off` (agent). In Alfred Code it can later replace `claude-hud`; it never replaces the `instrument-tool-usage` hook.
- **Parity.** Claude Code only: Cursor has no mods, so the Cursor half of the stack gets no twin. The plan and score file format is a public contract in the plugin's README, so any skill can write it; Alfred Code's plan and scorer skills are one writer.

**Mods from the source deck (claude\_code\_mods.pptx)**

| Deck mod | What happens | Becomes |
| --- | --- | --- |
| CACHE (cache-clock) | Folded in, with its toast at 5 min left and the \[Compact\] button | F4 Cache |
| PLAN (usage-gauge) | Folded in, with its 75% and 90% toasts and pace warning | F1 Session metrics |
| HANDOFF (auto-handoff) | Kept as is | F8 Handoff |
| AGENTS (agent-watch) | Extended with current action, failures and final report | F3 Agents |
| GOAL (goal-meter) | Its task-list tracking becomes the fallback when no plan file exists | F6 Plan progress |
| REC (recording-mode) | Kept, and extended to mask all of this plugin's own output | F9 Recording mode |

Keep each deck mod's chip colour for its feature: cyan `#22d3ee` cache, blue `#60a5fa` plan usage, violet `#a78bfa` handoff, pink `#f472b6` agents, gold `#facc15` plan progress, red for REC.

## Feature scope

Ten features, F1 to F10. The probe must settle every Medium row before the verdict; High rows rest on the docs.

| ID | Feature | Shows | Data source | Confidence |
| --- | --- | --- | --- | --- |
| F1 | Session metrics | Model and effort; context tokens, window and %; 5h and weekly % with reset times, plus any other window kind by name; session duration; session cost; today's cost across sessions; output tok/s; total tokens in, out, cache read, cache write; compactions; account plan and email | `$.session.usage()`, `session.measure`, `$.store`, `turn.step`, `session.compact`, the global config file (`$CLAUDE_CONFIG_DIR/.claude.json` when set, else `~/.claude.json`) via `$.fs.read` | High; Medium for tok/s, token totals, account (agent) |
| F2 | Tools and skills | Calls per tool, skill and MCP server; outcome ok, error, denied or blocked (refused by a guard hook or one of Claude Code's own rules); last 10 failures with time, target and reason | `tool.call` after `await next(e)`, `tool.check`, `skill.prompt`, `classic.PostToolUseFailure` (an error the tool raises while it runs has one; an input error and a refusal raised before `tool.check` have none, and look alike); calls of the main loop and of agents seen at `agent.spawn` only | High, but a refusal raised before the check shows as an error (agent) |
| F3 | Agents | Type, model, task, status, elapsed; current action; final report; effort, context used out of window, tools and skills per agent with failures | `agent.spawn` (its result's `agentId`), `$.agent.list()`, `tool.call` and `tool.check` (`e.agentId`), `tool.call` on the Agent and Skill tools, `turn.step` and `turn.complete` (`e.agentId`) | High for the first three groups; Medium for the per-agent group (agent) |
| F4 | Cache | TTL tier (5 min or 1 h); expiry clock time; hit rate for the last request and the session; cached tokens; rewrite cost if it goes cold; toast at 5 min left; \[Compact\] button | `turn.step` usage, `classic.PreModelSwitch` (`cache_ttl`, at a model switch only), deck price table | Medium; the tier and rate are known only after a model switch (agent) |
| F5 | Timeline | Per turn: your prompt time, Claude's reply time, duration, tokens in and out, tool calls, failures; in the band, the time of your last prompt and Claude's last reply | `prompt.submit`, `turn.start`, `turn.complete`, `$.clock.now()`; a turn's calls and failures are the `tool.call`s with no `agentId` inside it, as agents run in the background | High (agent) |
| F6 | Plan progress | Steps with status, current stage, % done, time on the current step, estimated and actual time per step and for the whole plan, your integrated notes marked ✎ with their text, last update time | Plan file via `tool.call` on Write or Edit, plus a 30 s `$.fs.stat` poll; task list as fallback; a call's wait, `tool.call` `ms` minus `classic.PostToolUse` `duration_ms`, leaves step time only when a `classic.PermissionRequest` asked the person, as the classifier's and hooks' time is the machine's (Phase 0 question 11) | High, if the skills follow the contract (agent) |
| F7 | Scores | Score rounds; total and per-criterion score with change from the last round; findings fixed, improved or still open, with the step that fixed them | One scores file per scored output | High, if the scorer follows the contract |
| F8 | Handoff | Ask or auto mode at a threshold (80% by default), keys h, c and r, the toasts, HANDOFF.md and a resume prompt after `/clear`, as 'F8 and F9 behaviour' says | `session.measure`, `$.session.usage({ breakdown: 'summary' })`, `session.compact`, `$.session.compact`, a 0 ms save timer, one `git status` through `$.process.run`, `$.fs.write`, `$.prompt.read`, `$.prompt.fill`, `classic.SessionStart` | High: the behaviour is the user's approved spec in 'F8 and F9 behaviour' (2026-10-28) (agent) |
| F9 | Recording mode | `/rec`, `/rec strict`, `/rec test` and private words, plus masking of every surface this plugin draws, as 'F8 and F9 behaviour' says | `ui.render` on message sites, `prompt.submit` (`context`), one internal `mask()` | High for this plugin's output: the behaviour is the user's approved spec in 'F8 and F9 behaviour' (2026-10-28) (agent) |
| F10 | Compact tool rows | With /quiet on: one line per tool call with its description, output line count and ✓ or ✗; up to 3 error lines on a failure; runs of read-only calls folded into one line; blocked calls as one ⊘ row, repeats folded into ×N. /quiet off restores the full rows | ui.render on ToolUse and ToolResult, which draw a Bash call on the main screen, and on ToolGroup, which folds it into one line in fullscreen's normal view; `isExpanded` marks the ctrl+o view, where a compact hook passes; a compact ToolResult keeps `next(e)`'s tree, which holds the classifier line | High; the row data is checked in both layouts, the compact ToolGroup row is drawn first in Phase 4, and a refusal raised before the check draws as ✗ (agent) |

**Notes**

- **F1 today's cost:** write each session's cost to `$.store` under a key of its own per local day and session (`cost:<date>:<session id>`), and sum the day's keys; a read-then-write of one shared ledger loses another session's write. Reset at local midnight. Drop keys older than 7 days. (agent)
- **F1 account:** read only `oauthAccount` from the global config file, which is `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set; `~/.claude.json` may then be a stale copy, as the isolated probe run wrote only the one in `CLAUDE_CONFIG_DIR`. A config signed in by token holds no `oauthAccount` at all. On any parse failure or a missing record, hide the field and don't show an error. (agent)
- **F3 tree** (the user, 2026-10-28, from the deck's slides): the Agents tab draws the main loop as the root, `⟳ main chat · opus 5.5 · 9 tools`, and each agent under the one that started it, `└ ✓ Explore · haiku`, with `doing: "<task>"` beneath. In Alfred Code the task is the dispatch's `task:` line. Phase 2 first checks that an agent's spawn names the agent that started it; without that, every agent sits directly under the main loop. (agent)
- **F2 and F3 skills line** (the user, 2026-10-28, from the deck's slides): `skills fired: watch ×1 · plugin-authoring ×4` closes the Agents tab and the Now tab's AGENTS section, from F2's skill counts. (agent)
- **F4 cache has no size capacity:** what matters is time to expiry, hit rate and rewrite cost. Never show a cache fill bar; the reuse rate's bar is a ratio, so it takes the one bar.
- **F4 hit rate:** cache read ÷ (cache read + cache write + uncached input) for each main-loop request. Subagent requests count in totals only.
- **F4 wording** (the user, 2026-10-28, from the deck's slides): `warm 52m ▰▰▰▰▱ 94% reused · 180k cached · rewrite ≈ $1.44`. Warm or cold with the time left replaces the expiry clock time, and 'reused' names the hit rate. (agent)
- **F4 tier before a switch** (the user, 2026-10-28): before a model switch reports `cache_ttl`, the tier follows Claude Code's documented rule and shows as an estimate, `warm ≈52m`. First come the variables and the setting that choose it, in Claude Code's order: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H`. Then the default: one hour on a subscription within its plan usage, five minutes on usage credits (a 5h or 7d window at 100%) or off a subscription (no 5h or 7d window). A switch's report wins while the billing it was made under holds. This replaces the F4 verdict's 'until a model switch' for the tier, warmth and the warning. Evidence: https://code.claude.com/docs/en/prompt-caching.md ('Which TTL each request gets', 'Choose the TTL yourself'), read 2026-10-28; types `$.settings.read`, `$.env.get`, `SessionUsage` ('`rateLimits` is empty off a subscription'). (agent)
- **F4 warning by tier** (the user, 2026-10-28): the 1h tier gets the toast and the band's `⚠ cache cold in 5m [3 Compact]` at 5 minutes left; the 5m tier gets the band item alone in its last minute, no toast, as every reply leaves a 5m cache under 5 minutes from cold. Both only while idle. (agent)
- **F4 warning floor** (the user, 2026-10-28): on either tier, no toast and no band item while the cache holds under 100,000 tokens (the last request's reads and writes): the rewrite is cheap, and a compaction would lose more than it saves. Claude Code's own idle compaction has the same floor. Raised by the Phase 2 final review.
- **F4 and idle compaction:** on the 1h tier Claude Code compacts an idle conversation itself after about 54 minutes once its context reaches 200,000 tokens (`idleCompaction`, on by default; off with `autoCompactEnabled` false or `DISABLE_AUTO_COMPACT`; the threshold set by `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, at least 100,000). A feature flag Claude Code fetches gates it too, which the mod cannot see, and in the Phase 2 terminal run Claude Code did not compact by minute 60. So where it should apply, the mod delays the warning to the cache's last 3 minutes and never withholds it: Claude Code's own compaction makes the cache cold first, and without it the toast and the band item still come. The Cache tab says when Claude Code should compact and when the warning comes. Evidence: https://code.claude.com/docs/en/settings-reference (`idleCompaction`) and https://code.claude.com/docs/en/env-vars (Features that need feature-flag fetching), read 2026-10-28; Phase 2 Task 8 (m). (agent)
- **F3 doing line** (the user, 2026-10-28): `doing:` shows the agent's description, with `· task <id>` beside it when the dispatch carries a `task:` line, as the data contract defines `task:` as a step id. (agent)
- **F8 from the deck's slides** (the user, 2026-10-28): the HANDOFF line reads `ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now` in ask mode and `ctx 62% · saves at 80%` in auto mode, so `h` saves now. What `c` and `r` do, the toasts' text and when HANDOFF.md is written are settled in 'F8 and F9 behaviour' (the user, 2026-10-28); with a valid Alfred Code status file F8 stands down rather than take the stack's trigger. Slides are evidence of the deck's behaviour, not its code. (agent)
- **F9 masking:** pass every string this plugin draws through `mask()`, so REC covers the band, panes, toasts and spinner suffixes, not only messages. REC is display-only: the model still sees secrets in context.
- **F9 status** (the user, 2026-10-28, from the deck's slides): REC on reads `REC on · hiding keys · emails · phones · 3 private words`, so by default it hides keys, emails and phones, plus the person's private words, counted. What `/rec strict` adds stays as Phase 4's Done when says. (agent)
- **F10 compact rows:** display only, so Claude still reads the full output and no tokens are saved. Show the Bash call's `description` instead of the command, falling back to its first 60 characters. Compact first, then pass the row through `mask()`, so REC also covers compact rows. Claude's own text (`AssistantMessage`) is never compacted.

## Layout

Three layers by urgency: a band that stays calm until something needs you, one pane for live detail, and toasts only for changes you must act on. All values in the mockups are illustrative.

```text
Events and reads      State                          Surfaces
Turns and prompts   ─┐                               ┌─ Band above the prompt
Tools and skills    ─┤                               ├─ /inspect pane: Now, Usage, Agents, Tools, Cache, Timeline, Plan
Agents              ─┼─▶ Shared state ─▶ REC mask() ─┤
Timers, file reads  ─┘                               ├─ Toasts, only what needs you
                                                     └─ Spinners and /quiet tool rows
```

Hooks only update the shared state. Every surface reads that state and passes its text through `mask()`, so REC covers the whole plugin, not only messages.

**Design rules**

- **Calm by default:** idle and healthy, the band is one dim line. Colour appears only when a threshold is crossed.
- **Now first:** while Claude works, line 1 shows what is running: the plan step, each agent's current action, and a running Bash command with its elapsed time. When idle, it shows the last turn: duration, tool calls, failures, and the time of your last prompt and of Claude's reply.
- **Room left:** line 2 holds the gauges. Context and 5h get bars because they move within a session; the 7d window and cost are numbers. Each window shows when it resets after its percent, as its day, month and clock in brackets, such as (31.10 09:00) (the user, 2026-10-28).
- **Bars:** one bar everywhere, in the band and the pane: 5 cells of 20%, one character each, ▰ filled and ▱ empty, with no gaps, such as ▰▰▱▱▱ at 40% (the user, 2026-10-28). A cell fills only when its share is reached, the filled part takes the threshold colour and the empty part stays dim, so the shape reads without colour.
- **Forecasts:** shown next to the gauges, marked ≈, and only after 3 data points: turns left until the handoff threshold (mean context growth over the last 5 turns), when the 5h or weekly limit runs out at the current pace compared with its reset time, as `full ≈15:40` and only once the readings span 5% of the window (15 minutes of 5h, 8.4 hours of a week; the user, 2026-10-28), and the plan's time left (remaining step estimates, calibrated by the actual time of finished steps).
- **Actions, not just alerts:** line 3 appears only when something needs you, and each item carries its button: Handoff, Compact or Inspect. Band buttons get digit hotkeys, which fire when you type the digit alone into an empty prompt and pause, and not while the band is collapsed; every item that needs you also raises its toast or shows in the Now tab, since the mod cannot tell the band is collapsed. (agent)
- **Failure inbox:** failed and denied calls count as new until you open the Now or Tools tab. Blocked calls never count as new, because Claude recovers from them by itself.
- **Times fit or drop:** when the calm line passes the width, Claude's time drops first, then yours, each whole and never cut mid-word; every gauge, reset and the cost stay. The times still show on line 1 whenever a turn needs you, and in the Timeline. (the user, 2026-10-28)
- **Narrow terminals, under 100 columns:** line 2 keeps the bars and resets with the 7d window as a bar too, and drops forecasts and cost; line 1 keeps only the plan step and the agent count.
- **Glyphs and colour:** ⟳ running, ✓ done, ✗ failed, ⊘ denied or blocked, ✎ your note, ≈ estimate, ⚠ needs you. Colour adds state, model and feature on top, as set out under Colours, so no meaning depends on colour alone.

**Colours**

Colour marks three things: state, model and feature. Every state keeps its glyph, so the UI still reads in a terminal without colour.

| Role | Colour | Where |
| --- | --- | --- |
| OK | green `#22c55e` | ✓, a bar's fill and its percent under 60%, score ▲, on pace, ● live |
| Warning | amber `#f59e0b` | ⚠, ⊘ denied, a bar's fill and its percent from 60 to 85%, a forecast that misses its reset time |
| Failure | red `#ef4444` | ✗, a bar's fill and its percent over 85%, NEEDS A LOOK, score ▼, ● REC |
| Running | bold default text | ⟳ rows; no colour, so amber keeps meaning warning |
| Secondary | the terminal's dim colour | Empty bar cells, separators, times, error text |
| Opus, Sonnet, Haiku, Fable | `#ff8c1a`, `#3d9bff`, `#19c3a6`, `#d16bff` | Model badges in the band, agent rows and spinners |
| Skills | green `#65a30d` | Skill names |
| Usage | blue `#60a5fa` | ctx, 5h and 7d labels; Usage tab label |
| Agents | pink `#f472b6` | AGENTS heading; Agents tab label |
| Plan | gold `#facc15` | PLAN heading; Plan tab label; ✎ your note |
| Cache | cyan `#22d3ee` | Cache tab label; \[Compact\] button |
| Handoff | violet `#a78bfa` | \[Handoff\] button |

- **Bars:** filled cells and the percent beside them take the state colour, and empty cells stay dim (the user, 2026-10-28).
- **Buttons:** bold, in the colour of the feature they act on; \[Inspect\], \[Show\] and \[Copy\] stay in the default colour.
- **No colour:** when `NO_COLOR` is set, everything draws in the default colour and the glyphs carry the meaning.
- **Light terminal themes:** Phase 1 measured lime `#a3e635` at 1.51:1 on white, so skills use `#65a30d` (3.09:1 on white, 5.40:1 on `#1e1e1e`). Gold reads poorly on white too: check it in Phase 3, where plan progress first draws it, and switch to `#ca8a04` if needed.

The band and Now tab mockups below use this palette in the terminal.

**Band: working**

```text
⟳ S4 Update interceptor 12m │ Explore ▸ Grep AuthService │ Bash ▸ npm test 0:12
ctx ▰▰▱▱▱ 45% ≈6 turns │ 5h ▰▱▱▱▱ 25% (28.10 16:15) on pace │ 7d 62% (31.10 09:00) │ $3.12
```

**Band: idle, needs you**

```text
✓ Turn 7 · 3m 10s · 9 tools · 1 ✗ │ you 14:02 · Claude 14:05 │ PLAN 3/5 · score 8.1 ▲1.3
ctx ▰▰▰▰▱ 82% │ 5h ▰▰▱▱▱ 55% (28.10 16:15) full ≈15:40 │ 7d 62% (31.10 09:00) │ $3.12
⚠ ctx past 80% [4 Handoff]    ⚠ cache cold in 4m [3 Compact]    ✗ 2 new [1 Inspect]
```

**Band: idle and healthy, one dim line**

```text
ctx ▰▱▱▱▱ 30% │ 5h ▱▱▱▱▱ 15% (28.10 16:15) │ 7d 40% (31.10 09:00) │ $1.08 │ you 14:02 · Claude 14:05
```

**Band: narrow terminal**

```text
⟳ S4 12m · 2 agents
ctx ▰▰▱▱▱ 45% · 5h ▰▱▱▱▱ 25% (28.10 16:15) · 7d ▰▰▰▱▱ 62% (31.10 09:00)
```

**Band: plan progress** (Phase 3; the user, 2026-10-28)

```text
Build the mods ▰▰▰▱▱ 4/6 · 67% · 18m · ≈9m left │ ▶ Write the deck
Build the mods ▰▰▰▰▰ done ✓ in 27m
```

- **The line:** the plan's title (`Tasks` for the task list), the one bar by percent done, steps done of all, the percent, working time so far, the time left marked ≈, and ▶ the current step. Once the last step is done, the second form.
- **Time left:** the remaining steps' estimates calibrated by the actual time of finished steps; for the task list, which has no estimates, the mean time of finished tasks times those left, shown once 3 are done.
- **Time:** working time, as step time is counted under Time per step: waits for you and idle time between turns are left out.
- **Its place:** line 1 while a plan runs. Phase 3's plan settles how it shares line 1 with agents and the running Bash.

**Spinner suffix:** on the main loop's spinner, its current action and context, such as `Grep AuthService · 17%`, and `· 2 agents` while agents run. Background agents draw no spinner of their own (probe, one spinner instance per session), so an agent's current action shows in its Agents row and the Now tab; a spinner whose `requestId` is an agent's id gets that agent's suffix if one ever draws. (agent)

**The `/inspect` pane**

- **Placement:** docked beside the transcript in the terminal's fullscreen layout from 110 columns (and in a VS Code panel 800 px or wider), inline above the prompt otherwise; `e.props.placement` says which. `/inspect` opens it at any width, since the person asked; only a pane opened unasked waits for 144 columns. It remembers whether it was open. (agent)
- **Tabs:** Now (default), Usage, Agents, Tools, Cache, Timeline, Plan. `/inspect <tab>` opens on a tab and `/inspect plan <slug>` picks a plan. There is no separate plan pane.
- **Now:** the view to keep open while Claude works: the current plan step, running agents with their current action, and new failures.
- **Failure rows:** \[Show\] expands the error in a code block and \[Copy\] copies it.
- **Desktop:** the per-turn context chart draws as an SVG; the terminal uses ▁▂▃▄▅▆▇.

```text
[Now]  Usage  Agents  Tools  Cache  Timeline  Plan                         ● live
PLAN   Token refresh · 3/5 · ≈30m left of ≈1h 37m
  ✓ S3 Migration with rollback                done in 12m
  ⟳ S4 Update interceptor                     12m of ≈24m
  · S5 E2E tests                              ≈18m
AGENTS 2 running
  ⟳ Explore [haiku ◑ medium] ▸ Grep 'AuthService' in src/   ctx ▱▱▱▱▱ 17%
  ⟳ Plan [opus ◑ high] ▸ Read src/auth/token.ts             ctx ▱▱▱▱▱ 9%
NEEDS A LOOK  2 new
  ✗ 14:21 Edit  src/auth/token.ts   old_string not found          [Show] [Copy]
  ⊘ 13:55 Bash  rm -rf dist         denied by you
```

```text
Usage                                                session 1h 12m
Context   ▰▰▱▱▱ 45%   90k / 200k     ≈6 turns to 80%
          per turn ▁▂▂▃▃▄▅▅
5h        ▰▱▱▱▱ 25%   resets 28.10 16:15       on pace
7d        ▰▰▰▱▱ 62%   resets 31.10 09:00   on pace
Cost      $3.12 session · $18.49 today, est.
Tokens    in 412k · out 38k · cache read 1.9M · cache write 210k · 70.5 tok/s
Account   Max 20x · <account>              Compactions 1, at 14:40
```

```text
Agents (3)                                             opus 1 · haiku 2
⟳ Explore [haiku ◑ medium]  Finding auth code                   2m 15s
   ▸ Grep 'AuthService' in src/
   ctx ▱▱▱▱▱ 17%   tools Read ×6 ✓ · Grep ×3 ✓ · Bash ×1 ✗
⟳ Plan [opus ◑ high]  Design token refresh                      0m 40s
   ▸ Read src/auth/token.ts
✓ general-purpose [haiku]  Check test coverage                  done in 1m 05s
   result: 12 files, 3 untested services                        [Show report]
```

```text
Tools                   calls   ok   ✗   ⊘
Read                       24   24   0   0
Edit                        9    8   1   0
Bash                        9    5   1   3
Skill: plan-builder         2    2   0   0
mcp: context7               3    3   0   0

Last failures and blocks
✗ 14:21  Edit  src/auth/token.ts   old_string not found          [Show] [Copy]
✗ 14:09  Bash  npm test            exit 1: 2 failing tests       [Show] [Copy]
⊘ 14:03  Bash  sleep 25; gh run…   blocked: use Monitor ×2       [Show]
⊘ 13:55  Bash  rm -rf dist         denied by you
```

```text
Cache      TTL 1h · expires 15:05, in 52m
Hit rate   last request 94% · session 88%
Cached     86k tokens
If cold    rewrite ≈ $1.12 on Opus 5.5                          [Compact]
```

```text
#   you     Claude   took     in / out      tools   ✗
7   14:02   14:05    3m 10s   12k / 2.1k    9       1
6   13:51   13:52    48s      8k / 0.9k     3       0
```

```text
Plan · Token refresh              3/5 · ≈1h 37m total · ≈30m left (×1.2)
✓ S1 Add refresh endpoint                      done in 18m   est 15m
✓ S2 Rotate tokens   ✎ your note integrated    done in 25m   est 20m
     'Use sliding expiry, not fixed 15 min'
✓ S3 Migration with rollback                   done in 12m   est 10m
⟳ S4 Update interceptor                        12m of ≈24m   est 20m
· S5 E2E tests                                       ≈18m    est 15m

Scores   R1 68 → R2 81 ▲13   (scale 100)
  correctness 70→80 ▲   risk 50→80 ▲   completeness 80→80 =
  BLOCKER 1→0   MATERIAL 3→1   MINOR 2→2
  open:  no load test for refresh storm
last update 2m ago
```

**Compact tool rows (`/quiet on`):** one line per tool call in place of the command and output preview. Failures keep up to 3 error lines, and runs of read-only calls fold into one line. Blocked calls show the rule's first sentence on one row, and repeats fold into ×N. To see more: \[Show\] in the Tools tab or /quiet off, plus Ctrl+O and an in-row \[Show\] if Phase 0 confirms they work.

```text
⏺ Bash · Show CI failure lines 1038-1042 · 30 lines ✓
⏺ Three of the Windows failures reveal a real security gap: ...
⏺ 4 reads · habits-scorer-card.test.js, secret-chain.js, layout.js ×2 · ✓
⏺ Bash · sleep 25; gh run list … · ⊘ blocked: use Monitor or run_in_background ×2
⏺ Bash · Run guard tests · ✗ exit 1
    AssertionError: expected blocked (guard-sensitive-data.test.js:425)
```

**Toasts:** only for changes you must act on: usage crossing 75% and 90%, cache 5 min from cold, the handoff threshold, a note integrated into the plan, a plan finished, and REC on or off. Everything else waits in the band or the pane.

## Data contracts for the plan and scorer skills

F6 and F7 read JSON files from one fixed folder in the project, `.claude/session-inspector/`, so the mod never works out where a writer keeps its own data: `plans/<slug>.json` for each plan, `scores/<slug>.json` for each scored output and, in Alfred Code, `status/<session id>.json`. Writers resolve their own paths and publish there, and the mod only reads, except HANDOFF.md, which F8 writes (agent). The folder is gitignored.

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

**Allowed values**

- `steps[].status`: pending, in\_progress, done, failed, blocked, skipped. Several steps can be in\_progress at once, since agents can run steps in parallel.
- `changes[]` is optional. `kind`: created, step\_added, step\_changed, step\_removed, integrated. `source`: user or claude. `note`: at most 200 characters.
- Scores file: `subject.kind` is plan, diagnosis or reply, and `subject.ref` names the plan slug or the graded file. `scale` is required; criteria can have any names and any number. `findings[].severity` is optional (BLOCKER, MATERIAL, MINOR). `findings[].status` (open, fixed, improved, wontfix) and `by` are optional.
- `steps[].estimateMin` is optional: the writer's estimate of Claude's working minutes for the step, not wall-clock time.

**Crediting subagent time.** A subagent whose prompt contains a line `plan: <slug>` and a line `task: <step id>` is credited to that step. The mod reads both lines at `agent.spawn` and links them to the subagent's agentId, which its later turns and tool calls carry. The step id must equal `steps[].id` in the plan file. Every subagent that works on a step names it, including verifiers and fix passes, because the estimate covers the gate and one fix pass. This is part of the public contract in the plugin's README, like the plan file.

**Rules to add to the plan skill**

1. Create the file when the plan is first written, with every step pending and a `created` change.
2. Set a step to in\_progress with `startedAt` before working on it, and to done with `doneAt` after it passes its checks.
3. When the user gives text to fold into the plan, change the affected steps and add an `integrated` change with `source: user` and the user's words as `note`.
4. Always rewrite the whole file with the Write tool and update `updatedAt`. Never patch the JSON with Edit.
5. Give each step `estimateMin`: the working minutes of the agent that builds it, including its tests, its gate, one fix pass and any build or CI waits, but not time spent waiting for the user. An estimate can change only while its step is pending, and is frozen once the step starts.

**Rules to add to the scorer skill**

1. Publish one scores file per graded output, with the subject it graded. The plan file holds no scores.
2. Add a new round each time; never edit an old round.
3. Always give the scale.
4. When the same finding can be recognised across rounds, reuse its id and set its status and `by`. When it can't, as with a fresh grader each round, leave them out: the mod then shows each round's total, the change per criterion and the count per severity (for example BLOCKER 2→0), and hides fixed and improved.

**In Alfred Code.** Plans stay Markdown at `<docs root>/work/plans/<feature>.md` (or the older `<docs root>/plans`), written by the model and kept permanently. The JSON is a generated view, never edited by hand or by the model: a PostToolUse hook on the plan files regenerates `plans/<feature>.json` and stamps `startedAt` and `doneAt` when a step's status changes. Lines added to the plan's Asked or Decisions sections become `integrated` changes with `source: user`, which keeps ✎ working. A card's estimate line becomes `estimateMin`, and the card's number becomes the step id. The designer subagents report an estimate with each card, and the approval guard that already checks `plan:` also requires `task:` on every dispatch that carries `plan:`. Scores stay session-scoped in the scorer folder, and the graded output can be a plan, a diagnosis or an inline reply: the scorecard script publishes each round to `scores/<slug>.json` with its subject, so rounds outlive the session. The stack resolves its own data root, including the workspace lookup order, before it writes, so the mod never repeats that logic. The stack's stale sweep should also prune the published folder, keeping each plan's JSON while its Markdown exists.

**What the mod does with the file**

- **When it reloads:** after each Write or Edit call completes and again at the end of the turn, because a writer's hook may regenerate the JSON after the tool call, and on a 30 s `$.fs.stat` check of the folder for changes made outside Claude.
- **Several plans:** it shows the most recently updated file, and `/inspect plan <slug>` switches.
- **Invalid JSON:** it keeps the last good version and shows `plan file invalid` in line 2.
- **Staleness:** when `updatedAt` is over 20 minutes old while a step is in\_progress, it shows the age in amber.
- **Fallback:** with no plan file, it shows task list progress from the task-list tool, as the deck's GOAL mod did.
- **Time per step:** the estimate, and the actual time, which is the working time of whoever builds the step while it is in progress. The mod records it from its own turn events in `$.store`, keyed by plan and step. Machine waits such as builds, tests and CI count. Waits for you are subtracted: AskUserQuestion calls, and permission prompts once Phase 0 confirms they can be timed. Idle time between turns never counts. A subagent's time goes to the step its prompt names, as set out under Crediting subagent time. When several steps are in progress and none is named, each turn's time is split equally among them and those steps are marked shared.
- **Time for the plan:** actual time of finished steps plus the remaining estimates, multiplied by this plan's actual-to-estimate ratio once 2 steps are done. Before that, the raw estimates show, marked uncalibrated. Steps running in parallel count as work time, so the total can exceed the wall-clock time. The main loop's own work while the plan runs, such as dispatching and updating the plan, is a separate overhead figure: it counts in the plan's total, but not in any step or in the ratio, because estimates cover the building agent only. While the main loop waits inside an Agent call, that time is not counted twice.

## F8 and F9 behaviour

The user's approved spec of F8 Handoff and F9 Recording mode (2026-10-28), carried here as the tracked record of
what Phase 4 builds. The F8 and F9 rows of the feature scope point here. (agent)

### F8 Handoff

#### Settings and the command

| Setting   | Values                     | Default | Store key          |
|-----------|----------------------------|---------|--------------------|
| mode      | `ask`, `auto`, `off`       | `ask`   | `settings:handoff` |
| threshold | a whole percent, 10 to 95  | 80      | `settings:handoff` |

`/auto-handoff` takes one argument (argumentHint `[ask|auto|off|at <percent>|now]`):

- `ask`, `auto` or `off` sets the mode.
- `at <n>` sets the threshold. A value outside 10-95, or not a whole number, answers
  `Threshold must be a whole percent from 10 to 95.` and changes nothing.
- `now` saves a handoff at once, in any mode, `off` included.
- With no argument, it prints the state, for example
  `Handoff: ask at 80% · ctx 62% · last save 14:05 (.claude/session-inspector/HANDOFF.md)`, and the usage line.
- Anything else answers with the usage line.

Settings live in `$.store`, one JSON key per feature, and apply to every session and project on the machine. The
session that ran the command applies the change at once; other running sessions pick it up on their next 30-second
plan-file poll (Phase 3's timer). Each `/auto-handoff` change reads `settings:handoff` from `$.store` first and
changes only the field it names, so a session that has not polled yet never writes back an old mode or threshold. Two
writes in the same instant can still race, as a `$.store` get then set is not atomic, and the second wins; for a value
the person types by hand that is acceptable. The context forecast on band line 2 (`≈6 turns`, `turnsLeft` in
`hooks/forecast.ts`) counts the turns left to this threshold instead of a fixed 80, converted as the next section says.

#### Steps, asks and saves

The threshold sets steps 5 points apart, up to 95: at 80 the steps are 80, 85, 90 and 95. The mod reads the context
from `session.measure`, which Claude Code pushes after each main-loop turn and which Phase 1 already hooks. Subagent
context never counts.

F8's percent is the tokens in use over the point where Claude Code compacts by itself, not over the model's window
(`percent` in `session.measure` is over the window, types). On a 1M window Claude Code compacts near 390k tokens
(Alfred Code's measurement in three projects, `stack/hooks/fresh-session.js` in alfred-code), so 80% of the window
would come only after the compaction F8 exists to get ahead of.

- **The point** is the breakdown's `autoCompactThreshold`, from `$.session.usage({ breakdown: 'summary' })`, which
  estimates locally and sends no request (types, `SessionUsageArgs`). The mod reads it at the first reading and again
  only when the model or the window changes.
- **Auto-compaction off** (`isAutoCompactEnabled` false, no threshold): the point is the window.
- **The row** adds the point when it is not the window: `ctx ▰▰▰▰▱ 79% of 390k · asks at 80% · h: save now`.
- **The forecast** on band line 2 and in the Now tab (both call `turnsLeft`, `hooks/band.ts` and `hooks/tabs.ts`)
  takes F8's threshold over the window, so its turns run to the same moment: 80% of a 390k point on a 1M window is 31%
  of the window.

- A reading at or past a step not yet handled handles the highest step reached, once. A jump from 70 to 88 handles 85
  alone, and a session resumed at 86% handles 85 at its first reading.
- **Ask mode** puts up the ask: band line 3 shows `⚠ ctx past 80% [4 Handoff]`, the toast below fires, and the Now
  tab's HANDOFF row changes to its ask form. Nothing is saved until the person answers. Answering h, c or r, or
  pressing 4, takes the ask down until the next step.
- **Auto mode** saves at once at each step. The first save of a session raises the toast below, and later saves only
  update the HANDOFF row.
- **Off** draws no HANDOFF row, no band item and no toast. `/auto-handoff now` still saves.
- A compaction in the main loop (`session.compact` with no `agentId`, any trigger but `precompute`, not skipped)
  resets the handled step to the highest step at or under the next reading. So a compaction that drops context under
  the threshold re-arms the first step.
- Before the first response there is no context percent: the row reads `ctx – · asks at 80%`, and nothing is asked or
  saved.
- `/clear`, `/resume` and `/branch` reset the handled step with the rest of `$.state`; the settings stay.

#### The HANDOFF row and the keys

The Now tab draws a HANDOFF section, its heading violet, after PLAN and before AGENTS. Its one row, by state:

| State                        | Row                                                                              |
|------------------------------|----------------------------------------------------------------------------------|
| ask, no ask up               | `ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now`                                      |
| ask, ask up                  | `⚠ ctx ▰▰▰▰▱ 82% · past 80% · h: save handoff · c: compact · r: remind at 85%`  |
| auto, before its first save  | `ctx 62% · saves at 80%`                                                         |
| auto, after a save           | `ctx 82% · saved at 80% (14:05) · next save at 85%`                              |
| save failed                  | the state's row, then `✗ save failed 14:05: <reason>`, until a save succeeds    |

- `h: save now`, `c: compact` and `r: remind at 85%` are `plain` Buttons with hotkeys `h`, `c` and `r`, drawn
  `h: label` as the types say for `plain`. Letter hotkeys work only while the pane holds the focus: from the prompt a
  letter types itself (types, `ButtonProps.hotkey`). From the prompt, digit 4 on the band's Handoff button and
  `/auto-handoff now` do what h does.
- After the last save, a second dim row reads `last save 14:05 · .claude/session-inspector/HANDOFF.md`.
- The bar is the brief's one 5-cell bar, coloured by the context thresholds.
- At 95, the ask's `r` row reads `r: dismiss`, as no step is left to remind at.
- With no ask up, `asks at` names the next step not yet handled: `asks at 85%` after `r` at 82%, and no `asks at` once
  95 is handled.
- **h** hands off: it saves HANDOFF.md and arms the resume prompt (below).
- **c** saves a handoff first, unless a save happened at this step already, then compacts through Phase 2's
  `compactNow` (`hooks/register.ts`), which already reports a skip, a failure and a second press. `c` is drawn only
  while no main-loop turn runs, since `$.session.compact` rejects while a turn runs.
- **r** takes the ask down until the next step.
- **Hotkey clash.** The pane's Cache tab uses hotkey `c` (`hooks/tabs.ts` TABS), and of two Buttons on one hotkey the
  one drawn later wins. So the Cache tab moves to `k`. Phase 2 is not released, so no installed copy changes.

#### What a save writes

A save writes `.claude/session-inspector/HANDOFF.md`, relative to the session's working directory, with
`$.fs.write`, which creates the missing folders. The file is UTF-8 with LF line ends. Each save overwrites it, so the
last save in a project wins, and its header names the session. The mod writes no other file.

- **Overwrite guard.** The mod overwrites the file only when its first line is the marker
  `<!-- session-inspector handoff v1 -->`. A file at that path without the marker is left untouched, and the save
  fails with the reason `HANDOFF.md exists and is not the mod's`.
- **Off the hook path.** A save runs from a 0 ms timer started by the press, the command or the measure hook, so no
  hook waits on git. If a save is already running, another request joins it instead of starting a second one.
- **Git.** The one process call is
  `$.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 2000 })`.
  `--no-optional-locks` keeps git from taking `index.lock` while the person's own git commands run. A missing
  `git`, a folder that is not a repository, a non-zero exit or the timeout writes `Git: not available (<reason>)`.
- **Content, extractive only.** The file copies only what is already on disk in the project, or what the mod counts:
  - From the plan file: its path, the plan's title, steps, statuses and times as Phase 3 parsed them, and a count of
    integrated notes per step (`✎ 1 note`), never a note's text.
  - The latest scores round: totals and open findings.
  - The git branch line, and up to 50 changed paths, then `+N more`.
  - Counts: turn number, duration, tool calls, failures, agents run, and the cost, marked `est.` when the session is on
    a subscription (the band's rule).
- **Masked at write.** Every copied string passes the key, email and phone classes before it is written, whatever
  REC's level. Private words are kept: the file is for Claude and the person, not a screen.
- **Never in the file:** a prompt or a note's text (a note is the user's words), a tool input (the task list exists only
  in tool calls, so its items stay out, as do Bash commands and tool-call paths), a failure's reason, an agent's
  description or report, or an unmasked key, email or phone.

The file, with illustrative values:

```markdown
<!-- session-inspector handoff v1 -->
# Handoff - 2026-10-28 14:05

Saved at 82% context (asks at 80%) by session-inspector · session 3f2a9c1e · Opus 5.5 · branch feature/token-refresh.
To continue in a new session, ask Claude to read .claude/session-inspector/HANDOFF.md and resume from Next.

## Next

S4 Update interceptor - in progress, 12m of ≈24m.

## Plan - Token refresh, 3/5

From .claude/session-inspector/plans/token-refresh.json.

- [x] S1 Add refresh endpoint - done in 20m
- [x] S2 Rotate tokens - done in 24m - ✎ 1 note
- [x] S3 Migration with rollback - done in 12m
- [ ] S4 Update interceptor - in progress
- [ ] S5 E2E tests - pending

Scores (token-refresh): R1 68 → R2 81 · open: F2 No load test for refresh storm (MATERIAL)

## Git

    ## feature/token-refresh...origin/feature/token-refresh [ahead 2]
     M src/auth/interceptor.ts
    ?? src/auth/refresh.test.ts

## Session

Turn 23 · 1h 12m · 140 tool calls, 3 failed · 2 agents · $3.12 est.
```

- Git's output is copied verbatim as an indented block, so its `##` branch line never reads as a heading.
- The header names the branch from that same `git status` call; with no git, the branch part is left out.
- With no plan, `Next` reads `No plan file this session; see Git below.` and the Plan and Scores parts are left out.
- With the task list as the plan, `Next` reads `Task list in use; its items are not written to this file.`

#### The resume prompt

This is the brief's 'extractive resume prompt' ('Decisions already made', Core and Alfred Code integration), the core's one handoff home. It is filled, never sent, and
only into an empty prompt.

- Each save, by h, 4, c, `now` or auto mode, arms it. The mod keeps the save's time in its module memory (`held` in
  `hooks/register.ts`), which `/clear` does not reset, unlike `$.state`.
- On `classic.SessionStart` with `source` `clear` within 2 hours of the last save, the mod reads the prompt with
  `$.prompt.read()`. If the draft is empty, it fills `Read .claude/session-inspector/HANDOFF.md, check that the branch
  it names is checked out, and continue from its Next section.` with `$.prompt.fill`, once, then disarms. Claude does
  the branch check with the git it already runs, so the mod adds no process call at `/clear`. Its toast reads
  `Resume prompt filled from the handoff saved 14:05 - press Enter to send`.
- **Fallback.** A draft that is not empty, or a fill answering `isFilled: false` (a dialog is up), gets no fill.
  Instead the toast reads `Handoff saved 14:05: ask Claude to read .claude/session-inspector/HANDOFF.md`. HANDOFF.md
  is the copy that outlives the session either way.
- A new session started in another terminal gets no fill, as the mod cannot tell a continuation from new work. Every
  save toast names the path for that reason, and each one but c's names `/clear` too; c compacts in place of a clear.

#### F8 toasts

| When                                        | Toast                                                                     |
|---------------------------------------------|---------------------------------------------------------------------------|
| Ask mode, an ask goes up                    | `Context past 80%: press 4 or run /auto-handoff now to save a handoff`   |
| Auto mode, first save of the session        | `Handoff saved at 82% to .claude/session-inspector/HANDOFF.md - /clear fills a resume prompt` |
| A save by h, 4 or `now`                     | `Handoff saved to .claude/session-inspector/HANDOFF.md - /clear fills a resume prompt` |
| A save by c                                 | `Handoff saved to .claude/session-inspector/HANDOFF.md - compacting`      |
| After `/clear`, the resume prompt filled    | `Resume prompt filled from the handoff saved 14:05 - press Enter to send` |
| After `/clear`, the draft not empty         | `Handoff saved 14:05: ask Claude to read .claude/session-inspector/HANDOFF.md` |
| A save fails                                | `Handoff not saved: <reason>`                                             |

The ask's toast names `/auto-handoff now` because band digits do not fire while the band is collapsed (brief, design
rules). Every toast goes through `toast()` in `hooks/mask.ts`, so REC masks it.

#### With Alfred Code installed

Without Alfred Code, F8 handles a full context. With Alfred Code, the stack's own feature does, never both (the user,
2026-10-28). That feature is two hooks in alfred-code's `stack/hooks/`:

- `guard-fresh-session-start.js` offers a fresh session past its token trigger, or compacts instead with
  `ALFRED_CODE_AUTO_COMPACT=1`.
- `history-session.js` puts the last sessions on the branch, with their plan's state, into each new session's context.

The mod learns that the stack is there only from the stack's per-session status file,
`.claude/session-inspector/status/<session id>.json`, the one input the brief allows from the stack ('Decisions already made', Core and Alfred Code integration). The
user's ruling brings this one read into Phase 4 (F8 and F9 choice 14); the rest of the reader stays Phase 5's.

- **When it reads.** At the session's start, on each 30-second poll, and on `classic.SessionStart` with `source`
  `clear`, `resume` or `fork`, under the new session id, with `$.fs.read`. A session that stood down keeps standing
  down across that start, in module memory, until a read of the new id's file says otherwise: the stack writes the
  new id's file in its own SessionStart hook, which may run after the mod's. A stood-down session makes no save, so
  no resume prompt is armed.
- **A valid file** parses, has `schema` 1 and has this session's id in `session`. Its `fullContext` says what the
  stack does at a full context: `fresh-session`, `compact` or `off`. The mod ignores fields it does not know, so Phase
  5 adds fields under the same schema.
- **Valid, `fullContext` `fresh-session` or `compact`:** F8 stands down for the session. There is no ask, no auto
  save, no band item 4 and no resume fill. The HANDOFF row reads `ctx 62% · handoff by Alfred Code`, and a bare
  `/auto-handoff` says the same. `/auto-handoff now` still saves when typed, as an explicit act.
- **Valid, `fullContext` `off`:** the person turned the stack's offer off, so F8 runs, and a full context always has
  one home.
- **No file:** F8 runs as without Alfred Code, and nothing is drawn about it, so a project without Alfred Code
  shows no trace of the check.
- **A file that does not parse, has another schema or names another session:** F8 runs, and the HANDOFF section adds
  a dim row, `Alfred Code status file not used: not JSON`, `...: schema 2` or `...: another session`. The general
  diagnostics row under [Inspect] stays Phase 5's, with the rest of the reader.
- **A file that appears or goes mid-session** changes the mode at the next read. An ask already up is taken down when
  the stack takes over.
- **The stack side** publishes the file, which is alfred-code's work, requested by the user (2026-10-28). Phase 4 builds and releases
  without it: in a project whose stack does not publish it yet, F8 runs, in ask mode by default, which writes nothing
  until a press, and F8 stands down by itself once the stack's release brings the file, with no mod update.
- **No per-project switch.** `settings:handoff` stays one setting for the machine. F8 stands down by the file wherever
  the stack runs, so nobody has to turn it off by hand, and `/auto-handoff off` turning it off in every project is
  what the README says it does.

### F9 Recording mode

#### Levels and the command

| Level    | Hides                                                                         |
|----------|-------------------------------------------------------------------------------|
| `off`    | nothing; `mask()` returns its input, as now                                   |
| `on`     | keys, emails, phones, private words                                           |
| `strict` | the same, plus the account (the local user name), home paths and $ amounts    |

`/rec` takes one argument (argumentHint `[on|strict|off|test|words]`):

- Every `/rec` reads `settings:rec` from `$.store` first, so a session that has not polled yet acts on the stored
  level, never on its own stale copy.
- No argument turns REC on over a stored `off`. Over a stored `on` or `strict`, it takes that level in this session at
  once and prints the status, writing nothing. A bare `/rec` never turns REC off, nor strict down to on, as the level
  persists: a person typing `/rec` to start a recording must never unmask it (F8 and F9 choice 15).
- `on`, `strict` and `off` set the level. Only `/rec off` turns it off.
- `test` runs the self-test below.
- `words` opens the `rec` pane.

The level is kept in `$.store` (`settings:rec`), so it holds across sessions and restarts until `/rec off`. It reaches
other running sessions within 30 seconds, as F8's settings do. Each change updates a `rec` atom in `$.state` that
holds the level, never the words, so every surface that reads it redraws. The words stay in module memory, loaded from
`$.store` at the session's start, on every 30-second poll and on every level change, so a word added in one session
masks in every running session within 30 seconds.

`mask()` takes the level and the words from module memory, which `/clear` does not reset, and the `rec` atom only
makes surfaces redraw. On `classic.SessionStart` with `source` `clear`, `resume` or `fork`, after Phase 1's
`resetAll($)` and before the hook returns, the mod re-reads `settings:rec` and `rec:words` and writes the level back
into the fresh `rec` atom, so the first redraw after a `/clear` masks at the level that held before it.

#### What each class hides

The rules below are the contract. The samples in [F8 and F9 acceptance](#f8-and-f9-acceptance) pin them as tests.

- **Keys**, drawn `‹key›`:
  - `sk-ant-`, `sk-` and `sk-proj-` keys of 20 characters or more.
  - GitHub tokens: `gh[pousr]_` and `github_pat_`.
  - Slack `xox[abposr]-` tokens, AWS `AKIA` and `ASIA` key ids, Google `AIza` keys, and Stripe `sk_live_`, `sk_test_`,
    `rk_live_` and `rk_test_` keys.
  - JWTs: three base64url parts, the first starting `eyJ`.
  - PEM private-key blocks, from `-----BEGIN` to `-----END ... PRIVATE KEY-----`.
  - The value after `Bearer `.
  - The value of 8 or more non-space characters after a name containing `key`, `token`, `secret`, `password`, `passwd`
    or `pwd` and then `=` or `:`, optionally quoted. Only the value is hidden: `API_KEY=‹key›`.
- **Emails**, drawn `‹email›`: `local@domain.tld`.
- **Phones**, drawn `‹phone›`:
  - A `+` and 8 to 15 digits, which may be separated by spaces, dots, dashes or parentheses.
  - A 10- or 11-digit number in two to four groups, each separated by one space, `-` or `.`, or with the area code in
    parentheses, its last group 4 digits: `(415) 555-0132`, `415-555-0132`, `415.555.0132`, `020 7946 0958`. An IPv4
    address, whose groups have at most 3 digits, never matches.
  - Never a bare run of digits, a date, a time, a version, an amount or a token count.
- **Private words**, drawn `‹private›`: each word matched case-insensitively wherever it appears, inside longer words
  too, so `Acme` hides in `AcmeCorp`.
- **Strict adds:**
  - **Home paths:** the home folder prefix becomes `~`, with `/` or `\` separators. The home folder is
    `$.env.get('HOME')`, else `$.env.get('USERPROFILE')`, as the brief's Platforms row says. It matches case-insensitively on Windows.
  - **The account**, drawn `‹user›`: the local user name, the home folder's last segment, as a whole word,
    case-insensitively. A name
    under 3 characters is skipped, and `/rec test` says so. The mod does not read the Claude account (F1's account
    field was dropped as PARTIAL); its email is hidden by the email class anyway.
  - **$ amounts:** the digits of each amount become `•`, so `$3.12` reads `$•.••` and keeps its width. `est.` and `≈`
    stay.

One pass finds every match in the original text, and a match is never re-scanned. Overlapping matches go to the
earliest start, then to the longest. So a private word `key` never breaks a `‹key›` token. The patterns compile once
per change of level or words, as one regex per class with no nested quantifiers. A key name is at most 64 characters
before its `=` or `:`, and a value is one run of non-space characters, so no part of a pattern backtracks over more
than 64 characters and each class scans in time linear in the text. Masked text is cached in module memory by the
original string, up to 256 entries and 4 MiB of text, and the cache empties on each change of level or words, so a row
drawn again is not masked again. Every surface's width rules (the
band's fit-or-drop, the pane's step rows) measure the masked text, not the raw text.

#### Private words

- **Adding.** Words are added only in the `rec` pane (`$.ui.open({ id: 'rec', title: 'REC words', focus: true })`),
  through an `Input` with `autoFocus`. They are never added through command arguments: a slash command's arguments
  show in the transcript's echo, and a plugin command cannot mark them sensitive (`CommandSpec` has no such field). The
  field shows what is typed, so add words before recording starts.
- **Rules.** Each word is trimmed and must be 3 to 64 characters, with at most 100 words. A word already in the list,
  ignoring case, is refused, and the pane says why under the field.
- **Edits from two sessions.** Each add or remove reads `rec:words` from `$.store` again, applies its one change to what
  it read, and writes the result, so an edit never writes back a stale copy. Two edits in the same instant can still
  race, as a `$.store` get then set is not atomic; the pane redraws the list from the store after each write, so a lost
  word shows there, with REC off.
- **Storage.** The words are kept in `$.store` (`rec:words`) as a JSON list, in plain text in the plugin's store file.
  The stored list is never put in `$.state`, a log, a toast, a file the mod writes, or the model's context. A word
  that already sits in text the mod copies, such as a plan step's title, stays in that copy: HANDOFF.md keeps it
  (F8 and F9 choice 13), and the person's own plan file is where it came from.
- **The pane's list.** With REC off, the pane lists the words, each with a `remove` Button. With REC on, it shows only
  the count (`3 private words · turn REC off to see or remove them`) and the Input.

#### Where REC masks

1. **The mod's own surfaces**, through `mask()`: the band, every pane tab, the `rec` pane's own text, toasts, the
   spinner suffix, the output of its own commands, and F10's compact rows (compacted first, then masked).
2. **Claude Code's message rows**, through `ui.render` rewrites made only while REC is on:
   - `UserMessage.text`, `AssistantMessage.text` and `CommandOutput.text`, for every command's output.
   - Every string inside `ToolUse.input` and `ToolResult.output`, with the object's shape and non-string values kept.
   - An errored `ToolResult` draws its error text, not `output` (types), and live its `output` was no string (a Bash
     run that exited 3, read 2026-10-28). So the mod keeps each errored call's error text in memory, from the call's
     result or from its `ToolUse` row, and draws it masked as its own lines; a call whose text it never saw draws
     `Error · text hidden while REC is on` in its place.
   - `ToolGroup`: the folded line ('Read 3 files, ran 2 shell commands') shows the calls' paths, patterns and git
     results, and `isExpanded` is the only prop a rewrite changes (types). So while REC is on, a hook sets
     `isExpanded: true`, and each call draws as its own `ToolUse` row, which the rule above masks. With /quiet on,
     F10's compact row takes the group's place, masked.
   - Every string inside `AskUserQuestion.questions` but the option labels, kept inside the tool's schema, since a
     rewrite that misfits draws the original unmasked (types, the `AskUserQuestion` render site). Claude Code 2.1.312
     also draws the original when a rewrite changes any option label (its debug log: 'a rewrite may relabel the
     questions but not change question 1's options', read live 2026-10-28), so labels are handed on exactly as asked
     and listed under What REC cannot hide. The tool's input types cap a `header` at 12 characters, and plain masking
     can break that: `Acme API` becomes `‹private› API`, 13 characters. So in the dialog alone:
     - Each masked value gets a numbered token, the same value the same number across the dialog: `‹email 1›`,
       `‹email 2›`.
     - A masked header over 12 characters is cut to 11 and `…`.
   - The engine's `Spinner` `word` and `message`, as well as the mod's own suffix.
   - A hook rewrites only when masking changes something; otherwise it passes `next(e)` through untouched.
   - These rewrites change the drawing only. The stored messages, and what the model reads, stay as they are. The mod
     never rewrites the tool call itself.

#### What REC cannot hide

The `/rec` help text and the README say this plainly:

- What you type in the prompt box.
- Claude Code's own screens and dialogs: the permission dialog, which shows the command and which the engine alone
  draws (types, `RenderComponent`), `/context`, `/usage`, `/config`, the status line and the welcome header.
- Other plugins' bands and panes.
- The option labels of a question Claude asks (`AskUserQuestion`): Claude Code draws them as asked. The model's note
  asks Claude to keep values out of them, and the header, question and descriptions are masked.
- A private key's middle lines in a diff that does not show its BEGIN line. An Edit diff holds one string per line,
  and the key class needs the BEGIN and END lines in one string, so in a list of lines the mod hides every line from
  a BEGIN line it hides through the END line, or the list's end, as `‹key›` after any diff mark; a hunk that starts
  inside a key shows its body.
- Other open sessions, for up to 30 seconds after a change: the level and the words reach them on their next poll.
  Run `/rec` in each session that will be on screen; a bare `/rec` there takes the stored level at once, strict
  included.
- Rows drawn before REC went on. On the terminal's main screen they sit in scrollback and do not redraw, so turn REC
  on before recording starts, then clear the terminal or start a new session.
- Files on disk and the transcript. HANDOFF.md gets only its write-time key, email and phone masking.
- Anything the model reads.

#### The model's note

While REC is on, the model gets one short note, so that its own replies avoid writing secrets out. The note goes in
`context` on `prompt.submit`: it rides the person's next own prompt (`origin` the composer's) after REC goes on. The
note is added again after a main-loop compaction while REC is on, and an 'off' note is added after REC goes off. It is
not a `prompt.compose` section (F8 and F9 choice 6). The note is invisible to the person and adds no tokens to later
requests beyond its place in the history.

- On, 44 words: 'Screen recording is on (session-inspector REC). Until told it is off, do not write secret values, API
  keys, tokens, passwords, email addresses or phone numbers in replies; refer to them by name, such as "the token in
  .env". Work on the task as usual.'
- Strict adds: 'Also leave out account names, home folder paths and dollar amounts.'
- Off: 'Screen recording is off (session-inspector REC); the earlier limit on secret values no longer applies.'

#### /rec test

`/rec test` checks the level that applies: the current one, or `on` when REC is off. It runs the masker over fake
built-in samples, one set per class, plus the person's private words, and prints a table that REC also masks:

```text
/rec test · level on
✓ keys            13/13 hidden
✓ emails           3/3 hidden
✓ phones           6/6 hidden
✓ private words    3/3 hidden (not shown)
✓ left alone      12/12 shown (SHA, time, date, version, token count, port, path, URL, UUID, digits, IP, $ off strict)
strict: ✓ home path 2/2 · ✓ account 1/1 · ✓ $ amounts 3/3
```

- The fake samples are assembled at runtime from parts (`'gh' + 'p_' + ...`), so no file of the public repo holds a
  provider-shaped literal for secret scanners to flag. A vendor's own documented example, such as AWS's example key
  id, is assembled the same way.
- A failed sample prints its class and the fake sample.
- A failed private word prints its position only: `✗ private word 2 shown`.

#### Status, band and toasts

- **Band.** A red `● REC` leads the band's first line in every state, the calm line and the narrow form included. It
  is never dropped for width.
- **Now tab.** The first row is the status, `● REC on · hiding keys · emails · phones · 3 private words`. With no
  words, the private-words part is left out. Strict reads
  `● REC strict · hiding keys · emails · phones · 3 private words · account · home paths · $ amounts`.
- **Toasts.** The status text when REC goes on or changes level, and `REC off` when it goes off.
- **The `/rec` reply.** When the level changes, the reply adds `Other open sessions follow within 30 s; run /rec in each
  one on screen.`

### F8 and F9 acceptance

Unit and hook tests (`claude plugin test`):

- **Keys hidden** (each assembled at runtime): `sk-ant-api03-` with 40 characters, `sk-proj-` with 40, `ghp_` with
  36, `github_pat_11` with 60, `xoxb-` with three groups, AWS's documented example key id (`AKIA` and 16 characters
  ending `EXAMPLE`), `AIza` with 35, `sk_live_` with 24, a three-part JWT, a PEM `OPENSSH PRIVATE KEY` block,
  `Authorization: Bearer abcdefghijklmnop1234`, `API_KEY=hunter2hunter2` and `"password": "correct-horse"`.
- **Emails hidden:** `jane.doe@example.com`, `a+b@sub.example.co.uk` and `ops@example.io`.
- **Phones hidden:** `+1 415 555 0132`, `+44 20 7946 0958`, `(415) 555-0132`, `415-555-0132`, `+380 44 123 4567`
  and `+4915123456789`.
- **Left alone:**
  - `c50c7aa` and a 40-character hex SHA.
  - `14:05`, `2026-10-28`, `(28.10 16:15)`, `2.1.312`, `180k cached` and `1,234,567 tokens`.
  - `localhost:8080`, `src/auth/refresh.ts` and `https://example.com/a?b=1`.
  - A UUID, `12345678901`, `10.100.200.150`, and `$3.12` below strict.
- **Strict hides:**
  - `/Users/jane/src` as `~/src` and `C:\Users\jane\src` as `~\src`.
  - `jane` as a whole word, but not inside `janet`.
  - `$3.12` as `$•.••`, plus `≈ $1.44` and `$1,204.50`.
- **Private words:**
  - `Acme` hides in `AcmeCorp` and `acme-api`.
  - A word `key` leaves `‹key›` whole.
  - A word under 3 characters, the 101st word and a duplicate are refused.
- **Message sites:** with REC on, a `ToolGroup` is drawn expanded, and `AskUserQuestion` questions and the `Spinner`
  word are masked; with REC off, each site passes `next(e)` untouched. A masked `ToolResult` output for Bash and Read
  keeps every key and type of the original, and its lines without a sample unchanged. An errored `ToolResult` whose
  `output` holds no text draws the error text the call returned, or its row carried, masked, and one whose text the
  mod never saw draws `Error · text hidden while REC is on`.
- **Dialog limits:** with REC on, two options `Use` and a fake email keep their labels as asked while their
  descriptions and the question draw `‹email 1›` and `‹email 2›`; a header `Acme API` with the private word `Acme`
  draws `‹private› A…`, 12 characters; a dialog whose only samples sit in labels is passed unchanged; every masked
  dialog keeps headers of 12 characters or fewer and its labels exactly as asked.
- **Compact rows:** with /quiet on and REC on, an F10 compact row whose call holds a fake key draws `‹key›`. With
  /quiet on, an Edit or Write result draws nothing under its compact row: live, Write's emptied result drew 'Wrote 1
  line' for three lines written, and Edit's a lone `⎿` (2026-10-28).
- **Masking cost:** with REC on and 100 words, a 1 MB single line of base64 masks in under 10 times the time of a
  100 kB one, and masking the same string again returns the cached result.
- **Bare `/rec`:** over a stored off it writes on; over a stored on or strict it prints the status and writes nothing.
  A session whose copy says off while the store says strict leaves the store at strict and draws strict at once.
- **Stale settings:** `/auto-handoff at 70` in a session whose copy says ask, while the store says auto, stores auto at
  70.
- **Words across sessions:** an add made in a session whose memory lacks a word another session stored keeps both words;
  a session reloads the words on its 30-second poll.
- **Surfaces:** with REC on, the band, each pane tab, a toast and the spinner suffix draw no sample in clear. With REC
  off, every surface draws exactly what Phase 3 draws, and every existing test passes unchanged (375 at the Phase 3 commit) (none pins the Cache
  tab's `c`).
- **F8 compaction point:** on a 1M window with `autoCompactThreshold` 390,000, a reading of 312k tokens asks and the
  row reads `of 390k`; with auto-compaction off, a 200k window asks at 160k; the forecast's threshold on the 1M window
  is 31.
- **F8 with Alfred Code:** a valid status file with `fullContext` `fresh-session` stands F8 down (no ask at 88, the row
  reads `handoff by Alfred Code`, `/auto-handoff now` still saves); `fullContext` `off`, another session's id, schema 2
  and a file that does not parse each leave F8 running, the last three with their dim `not used` row; no file draws
  no such row; a file removed mid-session brings the ask back on the next poll, at the last reading.
- **Across `/clear`:** REC strict, then `/clear`: the first redraw is strict. A stood-down session, then `/clear`
  before the new id's file exists: no ask until a read finds no file for the new id.
- **F8 steps:**
  - Readings of 70 then 88 ask once, at 85.
  - Auto mode saves at 80, 85, 90 and 95.
  - A compaction to 40% re-arms 80.
  - `off` asks and saves nothing.
  - `at 9`, `at 96` and `at 8.5` are refused.
- **F8 file:**
  - The written text starts with the marker.
  - It holds no failure reason, task subject, agent description or note text; a fake key in a plan title is written as
    `‹key›`, and a private word in it is kept.
  - A foreign file at the path is left alone, and the save fails with its reason.
  - A git timeout writes `Git: not available (timed out)`.
  - Two saves at once make one write.
- **Resume prompt:** a `/clear` within 2 hours of a save fills the prompt once, and only an empty draft; a draft that is
  not empty gets the fallback toast; a `/clear` with no save, or past 2 hours, fills nothing.

Live, in a scratch project under an isolated `CLAUDE_CONFIG_DIR` and `HOME`, without and with Alfred Code, at 120
and 90 columns, main screen and fullscreen:

- **Handoff.** With `/auto-handoff at 10` in ask mode, reading a large file passes 10%. Then:
  - The toast, band item 4 and the ask row draw.
  - 4 writes HANDOFF.md with the branch in its header, and a `/clear` then fills the resume prompt.
  - c saves and then compacts.
  - In auto mode the file is saved without a press.
  - With Alfred Code publishing its status file, the same reading asks nothing and the row reads
    `handoff by Alfred Code`; with the file removed, the ask returns within 30 seconds.
- **REC on.** With `/rec` on and a scratch `.env` holding fake samples, Claude's `cat .env` shows only `‹key›`,
  `‹email›` and `‹phone›` in the Bash row and in Claude's reply, and the result row draws its other lines. A run of
  reads and greps that would fold draws expanded, each row masked. With /quiet on, the compact rows draw masked, on the
  main screen and in fullscreen. A `cat` of a 1 MB single-line file draws with no visible stall.
- **REC strict.** `/rec strict` hides home paths and $ amounts in the band, the pane, the toasts and the spinner.
- **Rest of REC.** `/rec test` passes. Private words added in the `rec` pane never appear in the transcript. A
  rewrite refused for any tool is reported by name.
- **REC dialog.** Asked to choose between two fake emails under a header holding a private word, Claude's
  AskUserQuestion dialog draws the masked header, question and descriptions with its labels as asked, and the pick
  reaches Claude as the original option.
- **REC across sessions.** With two sessions open, `/rec` in one shows `● REC` in the other within 30 seconds. After
  `/rec strict` in one, a bare `/rec` in the other within those 30 seconds draws strict there at once, and the first
  stays strict.
- **Not run here.** Desktop runs only on the user's word; Windows and Linux run only on a machine that has them.

After rollout there is no telemetry, since the mod makes no network call. In the field, `/rec test` and the HANDOFF
row's last-save line are the checks a person can run.

### F8 and F9 choices

Each choice is applied in this section, as the user approved it (2026-10-28). Choice 0 departs from the brief's
literal wording of \[Handoff\].

| # | Choice made                                                                    | Alternative                                                    | Cost if wrong                                                     |
|---|--------------------------------------------------------------------------------|----------------------------------------------------------------|-------------------------------------------------------------------|
| 0 | [Handoff] saves HANDOFF.md and arms a resume prompt that fills after `/clear` | The press fills the whole extractive handoff into the current prompt box, the brief's literal wording | A long draft in a full session's box helps only once copied to a fresh one |
| 1 | `r` = remind at the next step                                                  | `r` = resume: fill a 'read HANDOFF.md' prompt in a new session | One key's action and its row text                                 |
| 2 | `c` saves a handoff, then compacts                                             | `c` compacts only                                              | One extra file write per c                                        |
| 3 | The Cache tab's hotkey moves from `c` to `k`                                   | Handoff's compact key becomes another letter                   | A hotkey and one test                                             |
| 4 | HANDOFF.md at `.claude/session-inspector/HANDOFF.md`, guarded by a marker      | `HANDOFF.md` at the project root, as the deck's name suggests  | Root: risk of a commit, and of overwriting a person's own file   |
| 5 | Extractive only: no model writes the handoff                                   | h fills a prompt asking Claude to write it, never sent         | A thinner handoff; a fill costs tokens when sent                  |
| 6 | The model's note via `prompt.submit` `context`                                 | A `prompt.compose` section, as the brief's F9 data source says | A section rewrites the whole prompt cache at each toggle (`≈ $1.44` at 180k cached on Opus, the brief's F4 example) |
| 7 | Private words added in the `rec` pane                                          | `/rec add <word>`                                              | Command arguments are echoed into the transcript, which is a file |
| 8 | The REC level holds across sessions until off                                  | Per session                                                    | A new session during a recording would start unmasked             |
| 9 | Private words match inside longer words, case-insensitively, 3 characters or more | Whole words only                                            | `AcmeCorp` would show                                             |
| 10 | Strict's 'account' is the local user name                                     | The Claude account email and organization                      | F1 does not read the account, so there is nothing to hide; emails hide anyway |
| 11 | Threshold range 10-95, so a live check reaches it cheaply                      | 50-95                                                          | A person may set a low threshold and get asks early              |
| 12 | From the prompt, handoff is one digit (band item 4) or `/auto-handoff now`; h, c and r work in the focused pane only, as letter hotkeys never fire from the prompt | Band line 3 carries all three answers as digit Buttons (4 Handoff, 5 Compact, 6 Later) | Two more band digits, and a longer line 3 |
| 13 | HANDOFF.md masks keys, emails and phones at write and keeps private words      | Mask private words too, or mask nothing                        | Masking private words can blank the plan's own names for the next session |
| 14 | F8 stands down for a session with a valid Alfred Code status file whose `fullContext` is not `off`; the stack publishes the file (alfred-code), and this one read moves into Phase 4 | Detect Alfred Code through `enabledPlugins` (`$.settings.read`), with no stack change | Reads the stack's presence from outside its one file, against the 2026-10-28 ruling, and misses a project whose stack hooks were copied in |
| 15 | A bare `/rec` turns REC on, or prints the status; only `/rec off` turns it off | A bare `/rec` toggles                                          | With the level persisting, a toggle unmasks a recording when typed to start one |
| 16 | F8 measures context to the compaction point (`autoCompactThreshold`)          | To the model's window, as band line 2 does                     | On a 1M window the ask comes after Claude Code has compacted      |
| 17 | The file names the branch, and the resume prompt asks Claude to check it       | The mod runs git at `/clear` and skips the fill on another branch | One more process call per `/clear`                              |

## Phase 0: probe mod

Before any build, a throwaway mod records which fields each event really carries. It logs field names and a few safe values, never prompts, tool inputs or account values. Signatures checked against the 2.1.312 types: every call is async and `$.fs.write(path, text)` holds, but stream chunks are told apart by `kind`, not `type`, and the sketch's loops of `on(ev, ...)` fail `claude plugin validate`, so each hook is written out. The probe as run is `probe/hooks/register.js`: it also logs each call's id, loop, outcome and timing, the settings-hook events, and every render site's prop names. (agent)

**What the probe must answer**

| # | Question | Decides |
| --- | --- | --- |
| 1 | Does `turn.step` carry an agent id, model and effort? | F3 effort and context per agent |
| 2 | Does `turn.step`'s stream or return value hold input, output, cache read and cache write tokens? | F1 token totals and tok/s, F3 context, F4 |
| 3 | Does `tool.call` carry an agent id, and does its result show an error flag and message? | F2 outcome, F3 tools per agent |
| 4 | Can a `tool.check` entry be matched to its `tool.call`, for example by a shared call id? | F2 denied vs error, F3 failures |
| 5 | Does `skill.prompt` carry an agent id? | F3 skills per agent |
| 6 | Which `rateLimits` kinds does this account report? | F1 |
| 7 | Does `~/.claude.json` hold `oauthAccount`, and with which keys? | F1 account |
| 8 | Can the hooks module import a sibling file? | Code layout |
| 9 | Do `inspect`, `auto-handoff`, `rec` or `quiet` clash with existing commands? | Command names |
| 10 | What do the ToolUse, ToolResult and ToolGroup props hold, which site draws the auto mode classifier line, and does Ctrl+O still expand a redrawn row? | F10 |
| 11 | Does the wait at a permission prompt fall inside a timed tool call, so the mod can subtract it from working time? | F6 time per step |
| 12 | Does a call refused by a guard hook or by one of Claude Code's own rules (such as a foreground sleep) show up as a deny in tool.check, or only as an error result? Can the mod tell it from a real error without parsing the message text? | F2 blocked outcome, F10 |
| 13 | Can a Button drawn inside a ToolResult row be focused and pressed in the terminal and the Desktop app? Add a test \[Show\] button to the probe's ToolResult hook to find out. | F10 in-row expand |

**Probe module**

```js
// hooks/register.js: probe only, delete after Phase 0
import { helperLoaded } from './probe-helper.js' // question 8; probe-helper.js exports const helperLoaded = true

const log = []
const shape = (e = {}) => ({
  keys: Object.keys(e),
  agentId: e.agentId, tool: e.tool, skill: e.skill, source: e.source,
  model: e.model, effort: e.effort, isTeammate: e.isTeammate,
})
const keep = (event, e, extra = {}) => log.push({ t: Date.now(), event, ...shape(e), ...extra })
const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v) : typeof v)

export function register(on) {
  on('session.start', async ($, e, next) => {
    const names = (await $.command.list()).map((c) => c.name)
    keep('session.start', e, {
      helperLoaded,
      clashes: ['inspect', 'auto-handoff', 'rec', 'quiet'].filter((n) => names.includes(n)),
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    keep('tool.call', e)
    const r = await next(e)
    keep('tool.call:after', e, { resultKeys: keysOf(r) })
    return r
  })

  on('tool.check', async ($, e, next) => {
    const d = await next(e)
    keep('tool.check', e, { decision: d?.decision })
    return d
  })

  // validate needs a literal event name in each on(), so no loop over names  // (agent)
  on('agent.spawn', async ($, e, next) => { keep('agent.spawn', e); return next(e) })  // (agent)
  on('skill.prompt', async ($, e, next) => { keep('skill.prompt', e); return next(e) })  // (agent)
  on('session.compact', async ($, e, next) => { keep('session.compact', e); return next(e) })  // (agent)
  on('prompt.submit', async ($, e, next) => { keep('prompt.submit', e); return next(e) })  // (agent)
  on('turn.start', async ($, e, next) => { keep('turn.start', e); return next(e) })  // (agent)

  on('turn.step', async function* ($, e, next) {
    keep('turn.step', e)
    const started = Date.now()
    const chunkTypes = new Set()
    const gen = next(e)
    let step = await gen.next()
    while (!step.done) {
      chunkTypes.add(step.value?.kind)  // (agent) chunks carry kind, not type
      yield step.value
      step = await gen.next()
    }
    keep('turn.step:end', e, { ms: Date.now() - started, chunkTypes: [...chunkTypes], returnKeys: keysOf(step.value) })
    return step.value
  })

  on('turn.complete', async ($, e, next) => {
    const u = await $.session.usage()
    const agents = await $.agent.list()
    let accountKeys = null
    try {
      const configDir = await $.env.get('CLAUDE_CONFIG_DIR')  // (agent) the global config moves with it
      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
      const file = configDir ? `${configDir}/.claude.json` : `${home}/.claude.json`  // (agent)
      accountKeys = keysOf(JSON.parse(await $.fs.read(file))?.oauthAccount)  // (agent)
    } catch (err) { accountKeys = `error: ${err.message}` }
    keep('turn.complete', e, {
      usageKeys: keysOf(u), rateKinds: u.rateLimits?.map((r) => r.kind),
      agentKeys: keysOf(agents[0]), accountKeys,
    })
    await $.fs.write('.claude/probe.jsonl', log.map((x) => JSON.stringify(x)).join('\n'))
    return next(e)
  })
}
```

For question 10, add these hooks inside `register(on)`. They log prop names only, never tool input or output.

```js
// One hook per site, each matcher a literal  // (agent)
const site = (name, e) => keep(`ui.render:${name}`, e, {  // (agent)
  surface: e.surface, propKeys: keysOf(e.props), inputKeys: keysOf(e.props?.input),
})  // (agent)
on('ui.render', { component: 'ToolUse' }, async ($, e, next) => { site('ToolUse', e); return next(e) })  // (agent)
on('ui.render', { component: 'ToolResult' }, async ($, e, next) => { site('ToolResult', e); return next(e) })  // (agent)
on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => { site('ToolGroup', e); return next(e) })  // (agent)
on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => { site('InfoNotice', e); return next(e) })  // (agent)
```

**Probe session**

1. Run `claude plugin validate --strict probe`. In a scratch repo with its own `CLAUDE_CONFIG_DIR` and `HOME` in the session scratchpad, holding a settings `PreToolUse` guard hook that blocks one marked command and a one-line project skill, start `claude --plugin-dir <repo>/probe`. Sign that config in with a `/login` of its own: a token in `CLAUDE_CODE_OAUTH_TOKEN` writes no `oauthAccount`, so question 7 stays open under one. (agent)
2. Ask Claude to use an Explore subagent to find where config is loaded.
3. Ask Claude to run `node -e "process.exit(1)"`, so one tool call fails. Then ask it to run sleep 25 in the foreground, so one of Claude Code's own rules blocks a call, and to run the marked command, so the guard hook blocks one. (agent)
4. Ask for a file deletion and answer No at the permission prompt, so one call is denied. Wait about 10 seconds before answering, so the log shows whether that wait falls inside the timed call. Then ask for a second deletion and answer Yes after about 5 seconds, so the log shows whether the tool's own `duration_ms` leaves the wait out. (agent)
5. Press Ctrl+O on one Bash row and note whether it expands. Reach the probe's \[Show\] button in a Bash result and press it; type 1 into the empty prompt to press the probe band's button. Run the project skill, switch the model with `/model`, then run `/compact`. Where the account offers auto mode, switch to it and run one command the classifier judges. Run steps 3 and 5 in both terminal layouts, the main screen (`CLAUDE_CODE_NO_FLICKER=0`) and fullscreen (`CLAUDE_CODE_NO_FLICKER=1`): a Bash row draws differently in each, and only fullscreen takes a click on \[Show\]. With neither set, this build drew a signed-out session on the main screen and a signed-in one fullscreen. (agent)
6. Read `.claude/probe.jsonl` and answer the thirteen questions, quoting the log lines.

**Answers, 2026-10-28** (agent)

Five logs, kept machine-local in the git-ignored `docs/superpowers/phase0/`: X, main screen, a failed Edit and a failed Read for question 12 (57 lines); S, signed out, main screen (22 lines); I, signed in with a token, steps 2 to 5, fullscreen, which this build chose by itself (288 lines, `"isFullscreen":true` from I 2); F, fullscreen set by `CLAUDE_CODE_NO_FLICKER=1`, for question 13 (42 lines); M, main screen set by `CLAUDE_CODE_NO_FLICKER=0`: one Bash call (the model wrapped the failing command, so it ran clean), ctrl+o, \[Show\] and a classifier try (57 lines, `"isFullscreen":false` at M 1). A line is cited by its `n`; the logs hold field names and safe values only, and rate-limit percentages are left out here. (agent)

1. **Yes.** A subagent's step carries `agentId`, `model` and `effort`; the main loop's carries no `agentId`. I 29: `"keys":["turnId","index","model","effort","messageCount","agentId"]`, `"agentId":"a07cad68a22e840ed","model":"claude-sonnet-5-5","effort":"medium"`; I 18: `"keys":["turnId","index","model","effort","messageCount"]`. (agent)
2. **Yes, all four,** on the `stop` chunk and the result. I 31: `"chunkKinds":["engine","tool","input","stop"]`, `"usage":{"input":2,"output":224,"cacheRead":0,"cacheWrite":33603,"model":"claude-sonnet-5-5"}`. `turn.complete` sums the turn: I 44 `"usage":{"input":4,"output":254,"cacheRead":33603,"cacheWrite":34287,...}`. (agent)
3. **Yes.** In a subagent `tool.call` carries `agentId`: I 47 `"tool":"Bash",...,"agentId":"a07cad68a22e840ed"`. A failed call's result has `isError` and its message in `text`: I 84 `"resultKeys":["ref","result","text","isError"],"isError":true,...,"textLength":11`. (agent)
4. **Yes, by `tool_use_id`.** I 77 `"event":"tool.call","tool":"Bash","id":"toolu_0115aMyfHZT8EnkZpbyA7Sau"`; I 81 `"event":"tool.check","tool":"Bash","id":"toolu_0115aMyfHZT8EnkZpbyA7Sau"`. (agent)
5. **No,** not even run from a subagent; the Skill tool's `tool.call` beside it has both. I 226 `"event":"skill.prompt","keys":["skill","text","frontmatter","source","path"]`, `"hasAgentId":false`; I 224 `"event":"tool.call","tool":"Skill",...,"agentId":"a8e38b7467e958348"`. (agent)
6. **`five_hour` and `seven_day`,** each with a reset time. I 44 `"rateLimits":[{"kind":"five_hour","percentUsed":…,"hasResetsAt":true},{"kind":"seven_day","percentUsed":…,"hasResetsAt":true}]`. Signed out the list is empty: S 14 `"rateLimits":[]`. (agent)
7. **Open.** A config signed in by `CLAUDE_CODE_OAUTH_TOKEN` holds no `oauthAccount`: I 44 `"accountFile":"CLAUDE_CONFIG_DIR/.claude.json","accountKeys":"undefined"`. A `/login` account's file was not read: auto mode refused listing its key names as credential exploration. The 2.1.312 code reads `oauthAccount.emailAddress`, `planDisplayName` and `billingType`, which says the fields exist, but no live file confirms them. (agent)
8. **Yes.** I 5 (and S 5): `"event":"session.start",...,"helperLoaded":true,"version":"2.1.312"`. (agent)
9. **No clash.** I 5: `"clashes":[],"commandCount":117`. (agent)
10. **ToolUse** holds `tool_use_id`, `tool`, `input` (`command` and `description` for Bash), `isRunning`, `isErrored`, `isInterrupted`, `isExpanded`, `output` (I 166, M 25), and `onScreen` where the surface reports it (I 35, F 38; absent at I 166 and M 25, as the types allow: 'absent where the surface does not say'); **ToolResult** `tool_use_id`, `tool`, `output`, `isErrored`, `isExpanded` (I 167, M 26), and `onScreen` the same way (I 37, F 39); **ToolGroup** `calls` (each `tool_use_id`, `tool`, `input`, `isRunning`, `isErrored`, `isInterrupted`, `output`), `isActive`, `isExpanded`, `isCallsOnly`, `onScreen` (I 87). **Where a Bash call draws depends on the layout.** On the main screen it is a ToolUse row over its ToolResult in the normal view, and the probe's compact ToolUse row drew there (M 25 `"isExpanded":false`; screen `main-1`, '⏺ Bash · Run node command that exits with code 1 ... · probe compact row'). In fullscreen the normal view folds it into a ToolGroup line, 'Ran 1 shell command' (I 87, screen `auth-4`), and ToolUse draws it in the ctrl+o view alone (the first Bash ToolUse is I 166, after the ctrl+o mark at I 162). **Ctrl+O** expands a redrawn row: on the main screen the same call redrew with `"isExpanded":true` (M 34), the probe passed, and the full row 'Bash(node -e "process.exit(1)"; ...)' drew (screen `main-2`); in fullscreen each row redrew with `"isExpanded":true` (I 166 to 175). A compact ToolGroup row was not drawn, as no settled run of Bash calls came up on the main screen; the types give ToolGroup `isExpanded` true in the main screen's ctrl+o view, and no ToolGroup at all in fullscreen's. **The classifier line**, 'Allowed by auto mode classifier', is drawn by the engine inside ToolResult's own tree: between the output and the probe's \[Show\], which the probe appends to `next(e)`'s tree (screen `main-1`, rows 8 and 9; fullscreen ctrl+o, screen `fs-3`, row 12). It is in no site's props (`"mentionsAuto":false` at M 26, F 36 and F 39), and InfoNotice drew nowhere in the five logs. A hook that replaces ToolResult without `next(e)` drops it. (agent)
11. **Yes, and the tool's own time is there to subtract.** The approved call took `"ms":6407` with a 5 s wait (I 156) while `classic.PostToolUse` gave `"durationMs":24` for the same id (I 155); the declined call took `"ms":15729` with a 14 s wait and has no PostToolUse (I 138). The classifier's time is inside as well: `"ms":1953` (I 280) against `"durationMs":52` (I 279). So `ms` minus `duration_ms` is the person's wait only for a call the person was asked about, a `tool.check` `ask` followed by a `classic.PermissionRequest` for it (I 136, I 137); a declined call has no `duration_ms`, and all its `ms` is the wait. For any other call the gap is the classifier's and the hooks' time, which F6 counts as machine time. (agent)
12. **A guard's block is a deny in `tool.check` and is told apart. Claude Code's own block is not a deny, and it cannot be told from an input error without the text.** Guard: I 118 `"decision":"deny",...,"hook":"PreToolUse"`. Foreground sleep: no `tool.check` between I 97 (`tool.call`) and I 99 `"ms":7,...,"isError":true`, and no PostToolUseFailure. An Edit whose `old_string` is not in the file has the same shape: X 26 `tool.call` `"tool":"Edit"`, no `tool.check`, X 28 `"ms":13,...,"isError":true`, no PostToolUseFailure. Both are refused before the check. An error the tool raises while it runs has a check and `classic.PostToolUseFailure` with its id: the Bash exit, I 81 then I 83 `"id":"toolu_0115aMyfHZT8EnkZpbyA7Sau","durationMs":50`; a Read of a missing file, X 47 `"decision":"allow"` then X 49. The person's No is a fourth shape: `tool.check` `"decision":"ask"` (I 136), a `classic.PermissionRequest` for the same tool (I 137), an error with no PostToolUseFailure (I 138), and ToolUse `"isInterrupted":true` (I 172). **Not seen: a classifier block.** The classifier allowed all three commands tried in auto mode (I 260, I 280, M 50), and no `classic.PermissionDenied` came up in any log. Its expected shape is `ask`, an error with no PostToolUseFailure, and no PermissionRequest (none fires in auto mode, I 257), and `classic.PermissionDenied` carries the call's `tool_use_id` and a `reason` (types `PermissionDeniedHookInput`). A fourth try, a line piping a remote script into the shell profile, was refused by the model before any tool call (screen `cls-1`). Phase 1 checks it with a command the docs list as blocked by default. (agent)
13. **Terminal: by a click in fullscreen only. Desktop: NOT RUN** (it needs the real account). A click on \[Show\] in the fullscreen ctrl+o view: F 41 `"event":"press:ToolResult","id":"toolu_01ThpdSATiAhrPd5kqNCA59o"`. In fullscreen, Tab then Enter pressed nothing (I, no `press:ToolResult` line at all), and the normal view folds Bash into a ToolGroup line with no ToolResult to hold the button. On the main screen \[Show\] draws in both views (screens `main-1`, `main-2`), but neither Tab, Up and Enter nor a click pressed it (M, no `press:ToolResult` line; screens `main-3`, `main-4`). (agent)

**Also seen** (agent)

- `!` commands typed at the prompt raise no `tool.call`: after `! node -e "process.exit(1)"` the probe band read `tools 0 · errors 0` (screen `noauth-4`). (agent)
- Agents run in the background even when asked not to: I 25 and I 209 `"background":true`. The report comes back as a prompt with `"origin":"task-notification"` (I 60) and the agent's own `turn.complete` with `agentId` (I 64). (agent)
- A call can come from an agent no `agent.spawn` announced: I 266 `"tool":"ToolSearch","agentId":"a16cc5196a7721d03"`, an error (I 267) the probe band counted. The types allow it: 'An agent started with no event raised has one too' (`AgentSpawnInput.resume.agentId`). (agent)
- In auto mode `tool.check` still says `ask` and no PermissionRequest fires; the classifier settles the call out of sight: I 257 `"decision":"ask"`. (agent)
- `/clear` ends the session and raises no `session.start`: S 20 `"event":"session.end",...,"reason":"clear"`, S 21 `"event":"classic.SessionStart",...,"source":"clear"`. (agent)
- `/compact` reports its tokens: I 243 `"trigger":"manual"`, I 247 `"resultKeys":["messages","tokensBefore","tokensAfter","usage"]`, I 246 `"source":"compact"`. (agent)
- The cache tier shows only at a model switch: S 19 `"cacheTtl":"5m"` signed out; I 240 `"cacheTtl":"1h","isCacheWarm":true,"contextTokens":38678,"estimatedCacheWriteUsd":0.0077`. No event the probe hooked carries it otherwise; the types declare `cache_ttl` on the PreModelSwitch and PostModelSwitch inputs only, and PostModelSwitch also fires on an automatic fallback and a `/resume` (`source` `auto`, `resume`). (agent)
- `tool.call` carries no `turnId`, so a call belongs to the main-loop turn whose `turn.start` and `turn.complete` bracket it. (agent)
- Typing 1 into the empty prompt pressed the probe band's button, signed out and in: S 6 and I 190 `"event":"press:AbovePrompt"`. (agent)

## Verdict

The verdict is one row per feature plus an overall call, and then the agent stops for approval. Every row cites its evidence: a probe log line, a type declaration or a doc page.

**Per feature**

- **GO:** every field in the feature's Shows column has a confirmed source.
- **PARTIAL:** the feature ships without the named fields. Those fields are hidden, never shown as guesses.
- **NO-GO:** the feature's main purpose has no source. Drop it and name what would unblock it.

**Overall**

- **GO** when F1, F2, F5 and F6 are all GO, since they are the core of the mod.
- **NO-GO** otherwise. Report what failed and stop.

**Also report**

- The installed Claude Code version.
- Every place where the types disagree with this brief.
- Any risk the probe found that the Risks section does not list.

**Example verdict.** The values are illustrative, not a prediction.

| ID | Verdict | Evidence | Dropped if PARTIAL |
| --- | --- | --- | --- |
| F1 | GO | `turn.complete` usageKeys and rateKinds `five_hour`, `seven_day` (log line 52) |  |
| F2 | GO | `tool.call:after` resultKeys include `isError` (line 18) |  |
| F3 | PARTIAL | `tool.check` has agentId (line 23); `turn.step` and `skill.prompt` have none (lines 9, 31) | Effort, context and skills per agent |
| F4 | GO | `turn.step:end` returnKeys include `usage` with cache read and write (line 12) |  |
| F5 | GO | Documented events |  |
| F6 | GO | Documented events; plan file contract |  |
| F7 | GO | Plan file contract |  |
| F8 | GO | Documented events; deck behaviour |  |
| F9 | GO | Documented events |  |
| F10 | PARTIAL | ToolUse props include input.description (line 64); the classifier line is drawn by InfoNotice (line 66); Ctrl+O shows the mod's row, not the full output | Ctrl+O expansion; use /quiet off for full rows |

Overall: GO. Eight of ten features GO, F3 and F10 PARTIAL.

**Verdict, 2026-10-28** (agent)

Claude Code 2.1.312, on macOS. Log lines are the Phase 0 answers' S, I, F, M and X; no prototype evidence counts, as `prototype/` was not found. (agent)

| ID | Verdict | Evidence | Dropped if PARTIAL |
| --- | --- | --- | --- |
| F1 | PARTIAL | Model and effort I 18; context `{"tokens":34289,"window":1000000,"percent":3}`, `five_hour` and `seven_day` with resets, `cost` `usd` (I 44); token totals and tok/s from the `stop` usage and `ms` (I 31); compactions I 243 | Account plan and email, until question 7 is read from a `/login` account (agent) |
| F2 | PARTIAL | Outcome by `isError` (I 84); a guard or rule block is a `tool.check` deny (I 118); your No is an `ask` with a PermissionRequest (I 136 to 138); skills from `skill.prompt` and the Skill tool (I 193, I 224). A refusal raised before the check, such as a foreground sleep, has the shape of an input error (I 97 to 99, X 26 to 28). A classifier block is derived, not seen (question 12): until Phase 1 sees it, an `ask` call that errors with no PermissionRequest and no PostToolUseFailure shows as 'refused' | 'Blocked' for Claude Code's own refusals raised before the check: they show as errors, as the mod never parses the message text (agent) |
| F3 | PARTIAL | Type, model, task I 25; id I 28; status from `$.agent.list` `["id","description","type","status"]` (I 44); current action I 47; report from the agent's `turn.complete` (I 64); effort I 29; context tokens per agent step I 48; tools and skills I 224. No event or call gives an agent's window: the only window seen is the main loop's (I 44) | The agent's window and context %; its context tokens still show. A same-model agent sharing the main loop's window is unverified, and Phase 2 adds it back only if a source turns up (agent) |
| F4 | PARTIAL | Hit rate and cached tokens from the `stop` usage (I 31, I 41); TTL tier and re-cache estimate at a model switch only (I 240); \[Compact\] through `$.session.compact` (types) | TTL tier, expiry clock, the 5 min toast and rewrite cost, until a model switch in the session reports `cache_ttl`; the deck's price table is not on this machine (agent) |
| F5 | GO | Your prompt `"origin":"composer"` (I 15); `turn.start` I 17; `durationMs` and `usage` I 44; a turn's calls are the ones with no `agentId` inside it, as `tool.call` has no `turnId` and agents run in the background (I 25) | (agent) |
| F6 | GO | Documented events; plan file contract; the person's wait at a permission prompt left out of step time, after a PermissionRequest only (I 137, I 155, I 156) | (agent) |
| F7 | GO | Score file contract | (agent) |
| F8 | GO | Context % I 44 and `session.measure` I 45; the compaction result I 247; `$.command.run` (types). GO is for the data: the deck behaviour the Shows column names (keys h, c, r, the toasts, the HANDOFF.md fallback) is not defined in this brief and the deck is not on this machine, so it is owed before Phase 4 | (agent) |
| F9 | GO | Message sites drawn: UserMessage I 9, AssistantMessage I 39, CommandOutput I 12; `prompt.compose` (types). GO is for the data: what `/rec` and `/rec strict` hide, `/rec test` and private-word matching are the deck's, owed before Phase 4 as for F8 | (agent) |
| F10 | PARTIAL | A compact ToolUse row drew on the main screen and stepped aside under ctrl+o (M 25, M 34; screens `main-1`, `main-2`); ToolGroup `calls` carry `input`, `isErrored` and `output` (I 87), and its `isExpanded` marks the main screen's ctrl+o view (types); blocked and error told apart as in F2; the classifier line is part of ToolResult's own tree, so a compact hook keeps `next(e)`'s result (screen `main-1`); the compact ToolGroup row is not drawn yet | A ⊘ row for Claude Code's own refusals raised before the check: they draw as ✗, as in F2 (agent) |

Overall: NO-GO by this brief's rule, on two fields. F5 and F6 are GO; F1 is PARTIAL on its account plan and email, and F2 on 'blocked' for Claude Code's own refusals raised before the check. Five of ten features are GO (F5 to F9), and five PARTIAL (F1 to F4, F10). Recommended: rule that the core ships with those two fields hidden, which makes the call GO. (agent)

- The account: Claude Code withholds it from this mod on purpose (`$.session.identity()` answers `{ deny }`), auto mode refused reading the config's account keys as credential exploration, a token sign-in has no record to read (I 44), and it is the smallest part of F1. The other route is to read question 7's key names from a `/login` account's config file on your word. (agent)
- The own-rule refusals: they still show, as errors with Claude Code's reason, and only their label is lost. The other route is to let F2 match the refusal's text, which question 12 set out to avoid and which can change in any build. (agent)

**Also report** (agent)

- Version: 2.1.312 (I 5). (agent)
- Types against this brief: the Step 1 fixes under Changes by agent. The docs say `agent.spawn` does not fire on a SendMessage resume, while the types declare `e.resume`; the types win, a resumed agent keeps its row, and Phase 2 checks a resume. The probe added three: the classifier line is no InfoNotice but part of ToolResult's own tree, and a Bash call is a ToolUse row on the main screen but a ToolGroup line in fullscreen's normal view (question 10); and while the types name a spinner's `requestId` the agent id, a background agent drew no spinner of its own (Where it draws). The types also put `cache_ttl` on `classic.PostModelSwitch`, which the brief's Events table lacked. (agent)
- New risks, now rows in Risks: calls from agents no `agent.spawn` announced; the cache tier unknown until a model switch; Bash rows drawn differently in the two layouts; own refusals that look like input errors; the classifier block not seen; the in-row button pressed only by a click in fullscreen; `!` commands unseen by F2; no spinner per background agent; Windows and Linux not run. (agent)
- Platforms: macOS only. Windows and Linux are NOT RUN; the mod must work on all three (the user, 2026-10-28). Phase 6 gates the release on a `claude plugin test` and a terminal session on each, so a Windows and a Linux machine or CI runner is needed by then, or a written waiver per release. (agent)
- The prototype: no `prototype/` or runway-line build is in alfred-code's working tree, branches or history, so none of its evidence is in this verdict. Its path or link would add evidence to F1 and F8, the rows a runway line bears on. (agent)
- The deck: `claude_code_mods.pptx` is not on this machine, and this brief does not define the deck behaviour F8 and F9 keep (keys h, c, r, the toasts and the HANDOFF.md fallback; `/rec`, `/rec strict`, `/rec test` and private words), nor the price table F4's rewrite cost needs. The deck, or a spec of those behaviours, is needed before Phase 4. Without the table, F4 shows a rewrite cost only from a model switch's `estimated_cache_write_usd`, as its row says. (agent)

## Build phases

Six phases after an approved verdict, core first. Skip any feature the verdict marked NO-GO, and hide PARTIAL fields.

| Phase | Builds | Done when |
| --- | --- | --- |
| 1. Core | F1, F2, F5; the band in all its states; `/inspect` tabs Now, Usage, Tools, Timeline; a `mask()` that passes text through | Context and usage match `/context` and `/usage` within 1 point; a failing Bash call shows in Tools with its reason; a denied call shows as denied; a guard hook's block shows as blocked; a foreground sleep, an Edit whose `old_string` is missing and a Read of a missing file show as errors with their reasons; a call the auto mode classifier blocks is recorded with its events, and shows as blocked once that shape is confirmed: the trigger is `git reset --hard` over an uncommitted change in the scratch repo, which the auto mode docs list as blocked by default, as Phase 0's tries were allowed (a force push with no remote, deleting a scratch folder and a project file) or refused by the model before any call (screen `cls-1`); if no try blocks, that case is reported NOT RUN, such a call shows as 'refused', and the phase passes on its other checks; today's cost survives a second session (agent) |
| 2. Agents and cache | F3, F4; Agents and Cache tabs; spinner suffix | Two parallel Explore agents each show their own current action in their Agents rows; the main loop's spinner shows its current action and the running-agent count; a foreground agent is tried once, and its own spinner gets its suffix only if a second spinner instance draws, else that case is reported as not drawn; an agent resumed by SendMessage keeps its one row; cache expiry matches the TTL tier once a model switch reports it; the 5 min toast fires once (agent) |
| 3. Plan and scores | F6, F7; the Plan tab in `/inspect`; the rule changes to the plan and scorer skills | A note given to Claude shows ✎ within 2 s; an outside edit shows within 30 s; a second score round shows changes and the fixed list; invalid JSON keeps the last good view |
| 4. Handoff, REC and compact rows | F8, F9, F10; starts once the deck, or the user's spec of F8 and F9's behaviour, is in hand (the verdict's Also report) | At the threshold, ask mode waits and auto mode saves; `/rec strict` hides account, home paths and $ amounts in the band, the pane, toasts and spinners; `/rec test` passes for keys, emails and phones; /quiet on shows one line per tool call and keeps up to 3 error lines on a failure, on the main screen and in fullscreen; /quiet off restores the full rows; REC masks compact rows too; and the acceptance in 'F8 and F9 behaviour' (agent) |
| 5. Alfred Code integration | Starts only on the user's word (the user, 2026-10-28: 'nothing from the Alfred Code integration until I say so'). The status file's presence check for F8's stand-down came in Phase 4 (the user, 2026-10-28). The rest of the status file reader; the mode banner; the runway against the stack's resume trigger; \[Handoff\] from the stack's ready prompt. The stack side, its hooks publishing `status/<session id>.json`, lands in alfred-code first | With a valid status file for this session, the band shows the mode banner, the runway is measured against the resume trigger, and \[Handoff\] fills the stack's prompt verbatim, only into an empty prompt and never sending it; with no file, an unknown schema or another session's file, every surface draws what the core draws and the diagnostics row under \[Inspect\] names the reason (agent) |
| 6. Ship | Marketplace entry | `claude plugin validate --strict` passes; `tsc` and `claude plugin test` pass; installing from the marketplace in a clean session loads `1 mod active · session-inspector`; `claude plugin test` and one terminal session pass on Windows and on Linux, or the user waives that platform in writing for this release, as the mod must work on all three (where they run is the user's call, the verdict's Also report) (agent) |

**Every phase**

- Write tests for its hooks as `*.test.ts` before it is called done.
- Run a real terminal session and a Desktop Code tab session, and report what each one draws. The terminal session runs under an isolated `CLAUDE_CONFIG_DIR` and `HOME`; the Desktop app has no isolated config, so its session runs on the real account only on the user's word, and is reported NOT RUN otherwise. (agent)
- Check its Done when in a project without Alfred Code and in one with it. Without Alfred Code nothing is missing or broken; with it, only what phase 5 adds differs.
- Run `claude plugin validate --strict`, `tsc` and `claude plugin test`, and show the user the band in a real terminal session. (agent)
- Commit at the end of the phase with a message that names the phase, then stop until the user says continue. (agent)

**Rollback** (agent)

- The person turns the mod off with `claude plugin disable session-inspector` and removes it with `claude plugin uninstall session-inspector` (`claude plugin --help`, 2.1.312). (agent)
- A bad release is undone by a new release with a higher version that reverts it, its `ref` and `sha` moved together in the envoydev entry. A user gets a new copy only when the version string changes ('Host and maintain a marketplace', 'Release a new version'), and a higher one keeps each version naming one build. With `ref` and `sha` both set, Claude Code checks out the `sha` (marketplace reference, 'Plugin sources'). (agent)

## Constraints and limits

The Claude Code limits below are from the mods reference; the right column is how this mod stays inside them.

| Limit | Value | What the mod does |
| --- | --- | --- |
| Minimum Claude Code | v2.1.287 terminal, v2.1.286 Desktop, VS Code extension v2.1.299 (v2.1.304 without feature flags); some fields need v2.1.289, v2.1.290 or v2.1.299 | States the minimum in the README and hides fields the running version lacks. From Phase 4 the README asks for v2.1.312: neither the changelog nor the reference shows `ToolGroupCall.tool_use_id` or `$.session.usage({ breakdown: 'summary' })` at v2.1.287 (read 2026-10-28) (agent) |
| A hook's own execution time | 10 s, then the hook is skipped; a `.catch` handler 1 s | Keeps each hook under 50 ms; reads files and computes on timers (agent) |
| Redraws | 10 a second, 30 in the terminal; extra calls are coalesced | Calls `$.ui.invalidate` at most once per event |
| `$.store` | 4 MiB of JSON in total, shared by every session; a get then set is not atomic | Keeps only settings, private words, a 7-day cost ledger and per-plan step times, each session writing keys of its own (agent) |
| `$.fs.read`, `$.fs.write` | 4 MiB per file | Treats a larger plan file as invalid |
| `session.end` hooks | 1.5 s shared budget | Writes the cost ledger on every turn, not only at session end |
| Toasts | 4 s unless `timeoutMs` is set | Uses the default |
| Names of commands and panes | Letters, digits, `_` and `-`, up to 64 characters | `inspect`, `auto-handoff`, `rec`, `quiet` |
| Pane opened without the user asking | Placed from 144 terminal columns, 110 once the person has opened it | Never auto-opens a pane; panes open only on a command (agent) |
| `$.process.run` | 30 s timeout by default, 4 MiB per stream | The one `git status` passes a short timeout of its own (agent) |
| `claude plugin test` | 5 s per test; every `$` call needs a stub, registered before the test's first call | Timers run on `mock.clock`, never on real waits (agent) |
| Platforms | Windows, Linux and macOS (the user, 2026-10-28) | Finds the config from `CLAUDE_CONFIG_DIR`, else `HOME`, else `USERPROFILE`; reads plan and score files with LF or CRLF; a missing `git` leaves the handoff without git state; each phase's terminal check runs on all three or reports the rest NOT RUN (agent) |

**Security**

- **Network and processes:** no `$.http.fetch` and no `$.model` calls. The only `$.process` call allowed is one fixed, read-only `git status` for the extractive handoff, with a timeout.
- **Approvals:** the mod never approves, denies or rewrites a tool call; F8 writes HANDOFF.md and fills an empty prompt, and F9 rewrites only what rows draw, as the 'F8 and F9 behaviour' section says. (agent)
- **Files written:** one `$.fs.write`, of `.claude/session-inspector/HANDOFF.md`, and never over a file without its marker. (agent)
- **Private data:** private words live only in `$.store`, never in code, logs or `$.state`.
- **What it reads:** the global config file (`$CLAUDE_CONFIG_DIR/.claude.json` when set, else `~/.claude.json`) for `oauthAccount`, the files under `.claude/session-inspector/` in the project, and nothing else. (agent)

## Risks and open questions

No known blocker: the core features rest on documented events. The material risks are listed first.

| Rank | Risk | Trigger | Fallback |
| --- | --- | --- | --- |
| MATERIAL | Per-agent context needs the agent's window, and no event or call gives a subagent's (`$.session.usage()` is the main loop's, I 44); the agent id is confirmed on `turn.step` and `tool.call` (probe questions 1 and 3), and skills per agent come from the Skill tool's `tool.call`, as `skill.prompt` has none (question 5) | Phase 2 builds the Agents row | The agent's context tokens show; its window and % stay hidden for every agent, same model or not, until Phase 2 finds a window source (verdict F3) (agent) |
| MATERIAL | Plan progress is only as accurate as the plan skill's writes | Claude skips a status update | Staleness age in amber; the rule in the plan skill |
| MATERIAL | 'Fixed' and 'improved' are guesswork if the scorer renames findings or criteria | Scorer ignores the contract | Rule in the scorer skill; show a round with no matching ids as new findings |
| MATERIAL | The mods API still changes between versions; fields changed from v2.1.287 to v2.1.312, the build checked here | A Claude Code update | Tests against the types for the installed build; minimum version in the README (agent) |
| MATERIAL | The person can collapse the band, and the mod cannot tell | ctrl+x ctrl+a or `[-]` | Every item that needs you also raises a toast or shows in the Now tab (agent) |
| MATERIAL | The Desktop and VS Code checks of every phase need the real account | A phase's Desktop check | Run only on the user's word, else reported NOT RUN; the terminal checks run under an isolated config (agent) |
| MATERIAL | Two homes for a full context: F8 Handoff and the stack's guard-fresh-session-start hook, which offers a fresh session before a heavy run on a full context | Both act as context nears its limit | With a valid status file, the stack owns handoff and F8 only shows the state (Phase 5 adds the button filling the stack's prompt); without one, F8's own handoff is the only one (agent) |
| MATERIAL | Calls come from agents no `agent.spawn` announced, such as the engine-internal one auto mode ran a failing ToolSearch under (probe I 266) | Auto mode, background engine work | F2 and F3 count only the main loop and agents seen at `agent.spawn` (agent) |
| MATERIAL | The cache tier and write rate are known only after a model switch (probe I 240) | A session with no `/model` switch | F4 hides the expiry clock, its toast and the rewrite cost until then; hit rate and cached tokens always show (agent) |
| MATERIAL | Only macOS is checked here, and the mod must work on Windows and Linux too | A path, line ending or `$.process` difference | The Platforms limit; each phase reports Windows and Linux NOT RUN until a machine runs them (agent) |
| MATERIAL | A Bash call draws as a ToolUse row on the main screen and as a ToolGroup line in fullscreen's normal view, and the layout can change with sign-in alone (probe question 10) | F10 built and checked in one layout only | F10 hooks all three sites; Phase 4 checks /quiet on and off in both layouts (agent) |
| MATERIAL | Claude Code's own refusals raised before `tool.check` (a foreground sleep) look like input errors (an Edit whose `old_string` is missing): no check, an error, no PostToolUseFailure (probe question 12) | Any such refusal | F2 counts them as errors with the engine's reason and F10 draws them as ✗; text matching is not used (agent) |
| MATERIAL | The auto mode classifier's block was not seen, so its event shape is derived (probe question 12) | A session in auto mode, the default here | F2 shows such a call as 'refused' until Phase 1 records a real block and its `classic.PermissionDenied` (agent) |
| MATERIAL | A spinner per agent was not seen: one spinner instance per session, the main loop's, even while a background agent ran (probe I, one `requestId`) | Agents in the background, the default (I 25, I 209) | Agent actions live in the Agents rows and the Now tab; the main spinner's suffix adds the running-agent count; Phase 2 tries a foreground agent once (agent) |
| MINOR | On a subscription plan, Cost and Today are API-equivalent estimates, not the bill | Always | Label them 'est.' when the account is on a plan |
| MINOR | The account comes from an undocumented file, which moves with `CLAUDE_CONFIG_DIR` | The file changes shape or place | Read it from `CLAUDE_CONFIG_DIR` first; hide the field on any parse failure (agent) |
| MINOR | Two sessions writing one `$.store` key race, and the second write wins | Today's cost or step times from two sessions | One key per session and day, or per plan, step and session (agent) |
| MINOR | REC hides text on screen only; the model still sees secrets in context | Always | State it in `/rec` help text |
| MINOR | REC's note adds tokens once per change of level, on the person's next prompt (`prompt.submit` `context`): one note per change, not every request; everything else in the mod costs no tokens | REC turned on or off | Keep the note under 60 words (agent) |
| MINOR | An in-row button is pressed only by a click in the fullscreen terminal; on the main screen it draws, but no key or click reaches it (probe question 13) | F10's in-row expand | Ctrl+O and /quiet off expand rows; no feature needs an in-row button (agent) |
| MINOR | `!` commands typed at the prompt raise no `tool.call` (probe, screen `noauth-4`) | You run a command with `!` | F2 counts the model's calls only, and the Tools tab says so (agent) |

**Open question**

- [x] Plan and scorer output today: plans are permanent Markdown at `<docs root>/work/plans/<feature>.md`; scores are session-scoped Markdown under `<data root>/state/sessions/scorer/`, and the graded output can be a plan, a diagnosis or an inline reply. Still open: whether the 7-day stale sweep reaches the scorer folder.

## Sources

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview): capabilities, where mods run, trust model, built-in mods.
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference): events, API methods, render sites, elements, limits.
- [TypeScript declarations for mods](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts): may be older than the installed build.
- The types Claude Code 2.1.312 writes: `types/claude-code.d.ts` in the built-in `plugin-authoring` skill's folder, and `.claude-plugin/types/` beside a mod it loads from a folder it watches. These win over every page here. (agent)
- [Draw in the interface](https://code.claude.com/docs/en/plugins/mods/interface): panes, the band and its collapse, `$.store` across sessions, `$.state` after `/clear`. (agent)
- [Test a mod](https://code.claude.com/docs/en/plugins/mods/test): stubs, `mock.clock`, mounting a site on a surface. (agent)
- [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces): plugin sources and pinning; with the [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference) for `ref` and `sha`, and [Host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace) for versions and updates. Read 2026-10-28. (agent)
- [claude-hud repository](https://github.com/jarrodwatts/claude-hud): the statusline approach this mod replaces; its README, read 2026-10-28, lists context, rate limits, tools, agents and todos, and does not say how a failed tool shows. (agent)
- claude\_code\_mods.pptx, slides 10 to 20: the six deck mods and their settings.

## Changes by agent

Step 1, the gap review, 2026-10-28, against Claude Code 2.1.312. 'Types' is the declaration file that build writes (`claude-code.d.ts`); a page name is a mods docs page read the same day. Decisions already made are unchanged.

- Context: VS Code needs extension v2.1.299 to draw, v2.1.304 without feature flags. Evidence: overview, 'Where mods run'; reference, 'Render sites'.
- Files: `on` needs a literal event name. Evidence: `claude plugin validate` on a copy of the sketch's loop: `register.js:3: the event name passed to on() is not a string literal`.
- Files: `types` in `plugin.json` before v2.1.299. Evidence: reference, 'Files'.
- Events, `tool.call`: carries `tool_use_id` and `agentId`, result `isError`. Evidence: types `ToolCallInput` (`ToolCallEnvelope & AgentLoop`), `ToolCallResult`.
- Events, `tool.check`: the same `tool_use_id`; the verdict is the rules' and hooks', not the person's. Evidence: types `ToolCheckInput.tool_use_id`, `ToolCheckResult`.
- Events, `agent.spawn`: the new agent's id is in `next(e)`'s result. Evidence: types `AgentSpawnResult.agentId`. Disagreement kept open: reference says no spawn on a SendMessage resume, types declare `AgentSpawnInput.resume`.
- Events, `turn.step`: `agentId`, `turnId`, `index`; chunks keyed by `kind`; `usage` on the stop chunk and the result. Evidence: types `TurnStepInput`, `TurnStepChunk`, `TurnStepStopChunk`, `TurnStepResult`.
- Events, `turn.start` and `turn.complete`: `agentId`, `turnId`, `durationMs`, `usage`. Evidence: types `TurnStartInput`, `TurnCompleteFields`.
- Events, `prompt.submit`: `origin` separates your prompt from a delivery or a plugin's. Evidence: types `PromptSubmitInput.origin`.
- Events, `skill.prompt`: no `agentId`. Evidence: types `SkillPromptInput` (skill, text, frontmatter, source, pluginName, path).
- Events, `session.compact`: `trigger` values and `agentId`. Evidence: types `SessionCompactTrigger`, `SessionCompactInput.agentId`.
- Events, `session.start`: not after `/clear`, `/resume`, `/branch`; `classic.SessionStart` with `source` is. Evidence: reference, 'Session'; interface, 'Load a saved value again after /clear'.
- Events, added `session.measure`. Evidence: types `SessionMeasureInput`; reference, 'Session'.
- Events, added `classic.PostToolUse` and `classic.PostToolUseFailure` `duration_ms`. Evidence: types `PostToolUseFailureHookInput.duration_ms`: 'Excludes permission-prompt and hook time'.
- Events, added `classic.PreModelSwitch` `cache_ttl`. Evidence: types `PreModelSwitch` hook input (`cache_ttl: '5m' | '1h'`, `estimated_cache_write_usd`).
- API, `$.session.usage()`: optional `tokens`, `percent`, `resetsAt`, `cost: { usd }`. Evidence: types `SessionUsage`, `SessionContextUsage`, `SessionRateLimit`, `SessionCost`.
- API, `$.agent.list()`: entry fields, no model or start time. Evidence: types `AgentInfo`; reference, '$.agent' (idle and waiting from v2.1.289).
- API, `$.store` races and `$.state` resets. Evidence: interface, 'Save from more than one session' and 'Keep state'.
- API, added calls the features use, `$.env.get` literal names, `$.session.compact` rejects mid-turn. Evidence: types `env.get`, `session.compact`, `prompt.fill`.
- API, `$.session.identity()` denies a mod the organization does not install. Evidence: types `SessionIdentity`.
- Render sites: `AbovePrompt` terminal and Desktop only, `InfoNotice` terminal only and under the logo. Evidence: types `RenderPropsOf` ('Raised on ...'); reference, 'Render sites'.
- Apps: WSL and Remote Control. Evidence: overview, 'Where mods run'.
- A collapsed band; Design rules, band hotkeys. Evidence: interface, 'When the user collapses the band'; reference, 'More Button rules'.
- F1 data source and account note: the config file moves with `CLAUDE_CONFIG_DIR`. Evidence: the isolated probe run, where Claude Code kept its global config in `$CLAUDE_CONFIG_DIR/.claude.json` and wrote no `$HOME/.claude.json`.
- F1 today's cost: one key per session and day. Evidence: interface, 'Save from more than one session'.
- F3, F4, F10 data sources. Evidence: the event rows above; types `RenderPropsOf.ToolUse.isExpanded`: 'A hook that draws a compact row of its own passes when true, so ctrl+o shows all'.
- Layout, pane placement: docks in fullscreen from 110 columns; 144 only for an unasked open. Evidence: types `RenderPropsOf.Pane.placement`, `ui.open`; reference, 'Limits'.
- Phase 0: signatures, `kind`, literal `on`, the config path in the sketch. Evidence: types `TurnStepChunk`; the validate line above.
- Phase 0 session: isolated config, a guard hook, an approved prompt with a wait, a model switch, auto mode, the band and in-row buttons. Evidence: `.claude/CLAUDE.md` 'Working in this repo'; probe questions 11, 12, 13; F4.
- Every phase, Desktop check needs the real account. Evidence: `.claude/CLAUDE.md` 'Ask before any run against the real account'.
- Limits: VS Code minimum, `.catch` 1 s, `$.store` sharing, pane 110, `$.process.run` 30 s, test 5 s. Evidence: reference, 'Limits'; types `HookBudget.catchMs`.
- Security, what it reads: the config path. Evidence: as F1.
- Risks: the per-agent row rewritten (the id is declared, the window is not); version range to 2.1.312; band collapse; Desktop on the real account; the account file's place; `$.store` races. Evidence: as the rows above.
- Sources: the generated types, the interface and test pages. Evidence: read 2026-10-28.
- Not found: `prototype/` (the runway-line build) is in neither this repo nor alfred-code (working tree, every branch, stashes, history), so no prototype evidence counts in the verdict; and `claude_code_mods.pptx` is not on this machine, so the deck's price table and behaviour stay unverified.
- Proposed changes to Decisions already made: none. The probe bears out two as written: sibling files import (question 8), and `/inspect`, `/auto-handoff`, `/rec` and `/quiet` clash with nothing (question 9).

Steps 2 and 3, the probe and the verdict, 2026-10-28. S, I, F, M and X are the Phase 0 answers' logs.

- Phase 0 session, step 1: sign the isolated config in with its own `/login`. Evidence: I 44 `"accountKeys":"undefined"` under a token sign-in.
- Phase 0 session, step 5: run steps 3 and 5 in both layouts; only fullscreen takes a click on \[Show\]. Evidence: S 1 `"isFullscreen":false` and I 2 `true` with no layout set; F 41; no press on the main screen (M, screens `main-3`, `main-4`).
- Phase 0 probe: a compact ToolGroup row added to `probe/hooks/register.js` before the main-screen run, which steps aside under ctrl+o. Evidence: `claude plugin validate probe --strict` passed.
- Phase 0 answers and Also seen: added. Evidence: the lines each answer quotes.
- Events, `tool.call`: its time includes the prompt and the classifier; `!` commands raise none. Evidence: I 155 and I 156; I 279 and I 280; screen `noauth-4`.
- Events, `tool.check`: an ask the classifier settles still reads `ask`. Evidence: I 257, with no PermissionRequest after it.
- Events, `agent.spawn`: background by default; agents with no spawn. Evidence: I 25, I 209; I 266.
- F2 data source: PostToolUseFailure tells an error from a block; only known agents count. Evidence: question 12; I 266.
- F4 confidence: the tier only after a model switch. Evidence: I 240; types, `cache_ttl` on the PreModelSwitch and PostModelSwitch inputs only.
- F6 data source: `duration_ms` leaves waits out. Evidence: question 11.
- F10 data source and confidence: ToolUse and ToolResult on the main screen, ToolGroup in fullscreen's normal view; the classifier line inside ToolResult's tree. Evidence: question 10 (M 25, M 34, I 87, screen `main-1`).
- F1 account note: the dev machine's file dates replaced by the isolated run's finding; a token sign-in has no record. Evidence: the isolated config held `.claude.json` and HOME none; I 44.
- Phase 0 answers: rate-limit percentages left out of the quotes. Evidence: the public-repo rule in `.claude/CLAUDE.md`.
- Verdict: added; overall NO-GO by the rule, on F1's account field and F2's 'blocked' for refusals raised before the check, with both hidden recommended; F3 PARTIAL on the agent's window; F10 PARTIAL on ⊘ for those refusals; F2's classifier block shown as 'refused' until seen. Evidence: the verdict rows; types `SessionIdentity`; X 26 to 28 against I 97 to 99.
- Phase 0 question 12: a failed Edit and a failed Read (log X) test the PostToolUseFailure rule beyond Bash. Evidence: X 26 to 28, X 47 to 50.
- Events, `agent.spawn`, and Also report: the resume disagreement settled by the types-win rule; Phase 2 checks it. Evidence: Purpose, step 1; types `AgentSpawnInput.resume`.
- F5 data source: a turn's calls are those with no `agentId`. Evidence: I 25, I 209 (agents in the background).
- Also report, the prototype: what its path would add. Evidence: the user's note that it is in alfred-code; the recheck below.
- Build phases: Phase 1 checks a guard block, the own refusals, a failed Edit and Read, and records a classifier block; Phase 2 checks a resumed agent; Phase 4 checks both layouts; Phase 5 starts on the user's word; every phase runs validate, tsc and test, shows the band and stops after its commit. Evidence: the user's request, 2026-10-28; questions 10 and 12.
- Build phases, Rollback: disable, uninstall, and a higher-version revert release. Evidence: `claude plugin --help` (2.1.312); `.claude/CLAUDE.md` 'One version'.
- Limits, Platforms row: all three operating systems. Evidence: the user's message, 2026-10-28.
- Risks: agents with no spawn, the cache tier, platforms, the two layouts, the classifier block, the in-row button, `!` commands. Evidence: I 266, I 240, the user's message, question 10, question 12, question 13, screen `noauth-4`.
- Not found, rechecked after the user's note that it is in alfred-code: every local and remote branch there holds only `docs/session-inspector mod agent brief.md` (origin/main, dfb48b73) and one comment in `scripts/plan-estimate.test.js`; neither names a prototype or a runway line.
- Events, added `classic.PostModelSwitch`: it carries `cache_ttl` too, and fires on a fallback and a `/resume`. Evidence: types `PostModelSwitchHookInput` (`cache_ttl`, `source` `auto` and `resume`); the probe hooked PreModelSwitch only (`probe/hooks/register.js`).
- Where it draws, Spinner; Layout, the spinner suffix; Phase 2; a Risks row; Also report: one spinner instance per session, none per background agent. Evidence: I, one `requestId` on every Spinner line (I 10 to I 272) while agents ran (I 25, I 209), the probe logging each new `requestId`; types `RenderInputOf.requestId`, 'the agent id for a spinner'.
- Phase 0 question 10: `onScreen` cited where it is (I 35, I 37, F 38, F 39), absent at I 166, I 167, M 25 and M 26; 'five logs'. Evidence: those lines' `propKeys`; types `onScreen`, 'absent where the surface does not say'.
- Phase 0 question 12 and Phase 1: the classifier trigger, `git reset --hard` over an uncommitted change, and NOT RUN if no try blocks. Evidence: permission modes page, 'What the classifier blocks by default', read 2026-10-28; I 260, I 280, M 50 (allowed); screen `cls-1` (refused by the model).
- F8 and F9 confidence, verdict rows, Phase 4 and Also report: the deck behaviour marked unverified and owed before Phase 4. Evidence: the brief defines no keys, fallback or `/rec` rules; the deck is not on this machine.
- Rollback: why a higher version, and `sha` wins over `ref`. Evidence: Host and maintain a marketplace, 'Release a new version'; marketplace reference, 'Plugin sources', read 2026-10-28.
- Sources: the marketplace pages and the claude-hud README read. Evidence: Create a marketplace, the marketplace reference and Host and maintain a marketplace, read 2026-10-28; the claude-hud README, read 2026-10-28, which does not say how a failed tool shows, so Decisions' 'HUD draws failed tools as ✓' rests on `src/render/activity.ts`, not read here.
- Risks, per-agent context row: rewritten to the probe's outcome, the % hidden for every agent. Evidence: questions 1, 3 and 5; verdict F3.
- Phase 0 question 11, F6 data source and verdict row: a call's `ms` minus `duration_ms` is the person's wait only after a PermissionRequest; the classifier's and hooks' time stays machine time. Evidence: I 136, I 137 (asked); I 279, I 280 (classified, with no PermissionRequest, I 257).
- Phase 6 and Also report: the release waits on Windows and Linux runs or a written waiver. Evidence: the user's message, 2026-10-28; the Platforms row.
- Also seen: the band button pressed by typing 1. Evidence: S 6, I 190.
- Graded with the refining-plans loop by independent reviewers, 2026-10-28: 78, 89, 88, 91; the three round 3 findings above fixed after the last grade, and the fourth, the prototype's evidence, waits on its path.

Phase 4, 2026-10-28, against Claude Code 2.1.312.

- F8 and F9 behaviour: a new section carrying the user's approved spec of F8 and F9, its acceptance and its choices. Evidence: the user's approval of the spec, 2026-10-28.
- Feature scope, F8 and F9 rows and the F8 slides note; events table REC row; `$.store` and calls lines; Core and Alfred Code integration; the folder paragraph; Phase 4 and Phase 5 rows; Security; the two-homes and REC token risk rows: brought in line with that section. Evidence: the spec's 'Changes to the brief and README on approval'.
