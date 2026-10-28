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
| `prompt.compose`, `ui.render` | REC: model instruction and display masking |  |

**Mods API calls this mod uses**

- `$.session.usage()`: `{ startedAt, context: { tokens?, window, percent? }, rateLimits: [{ kind, percentUsed, resetsAt? }], cost?: { usd } }`; `tokens` and `percent` are absent before the first response, and `rateLimits` is empty off a subscription. (agent)
- `$.agent.list()`: subagents and teammates, each `{ id, type, description, status, parentId?, name? }`, status pending, running, waiting, idle (the last two from v2.1.289), completed, failed or killed. No model, start time or current action: those come from `agent.spawn` and `tool.call`. (agent)
- `$.store`: this plugin's key-value store, one JSON file shared by every session on the machine, 4 MiB in total; a `get` then `set` is not atomic across sessions, so each session writes keys of its own. `$.state`: reactive per-session state, reset by `/clear`, `/resume` and `/branch`. (agent)
- `$.clock.every`, `$.clock.now`, `$.fs.read`, `$.fs.stat`, `$.env.get` (literal names only), `$.session.id`, `$.session.model`, `$.session.compact` (rejects while a turn runs), `$.prompt.read`, `$.prompt.fill`, `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.command.register`, `$.command.run`, `$.command.list`. (agent)
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
- **Core and Alfred Code integration.** The core works from the Claude Code mods API alone and is built first. The integration waits until the stack's workspace releases settle its paths. Besides the plugin's public contracts (the plan file and the plan: and task: prompt lines), its only input from the stack is one small versioned status file that the stack's own hooks publish (schema, session, model, auto-run, scorer, resume trigger, window, handoff prompt), one file per session in the plugin's fixed folder. The mod reads nothing else from the stack, ignores an unknown schema or another session's file, and shows nothing when unsure, with the reason in a dim diagnostics row under \[Inspect\]. With the file present, it adds the mode banner, measures the runway against the stack's resume trigger ahead of the engine's threshold, and makes \[Handoff\] fill the stack's ready handoff prompt verbatim, without sending it and only into an empty prompt. Without Alfred Code, \[Handoff\] uses the mod's own extractive resume prompt, so each environment has exactly one handoff home. In Alfred Code it can later replace `claude-hud`; it never replaces the `instrument-tool-usage` hook.
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
| F8 | Handoff | Deck behaviour: 80% threshold, ask or auto mode, keys h, c, r, toasts, HANDOFF.md fallback | `$.session.usage()`, `session.compact`, `$.command.run` from a timer | High for the data; what keys h, c and r do, the toasts' text and when HANDOFF.md is written are the deck's and unverified, as the deck is not on this machine (agent) |
| F9 | Recording mode | Deck behaviour: `/rec`, `/rec strict`, private words; plus masking of every surface this plugin draws | `ui.render` on message sites, `prompt.compose`, one internal `mask()` | High for this plugin's output; what `/rec` and `/rec strict` mask, `/rec test` and how private words are matched are the deck's and unverified (agent) |
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
- **F4 and idle compaction:** on the 1h tier Claude Code compacts an idle conversation itself after about 54 minutes once its context reaches 200,000 tokens (`idleCompaction`, on by default; off with `autoCompactEnabled` false or `DISABLE_AUTO_COMPACT`; the threshold set by `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, at least 100,000). A feature flag Claude Code fetches gates it too, which the mod cannot see, and in the Phase 2 terminal run Claude Code did not compact by minute 60. So where it should apply, the mod delays the warning to the cache's last 3 minutes and never withholds it: Claude Code's own compaction makes the cache cold first, and without it the toast and the band item still come. The Cache tab says when Claude Code should compact and when the warning comes. Evidence: https://code.claude.com/docs/en/settings-reference (`idleCompaction`) and https://code.claude.com/docs/en/env-vars (Features that need feature-flag fetching), read 2026-10-28; Phase 2 Task 8 (m). (agent)
- **F3 doing line** (the user, 2026-10-28): `doing:` shows the agent's description, with `· task <id>` beside it when the dispatch carries a `task:` line, as the data contract defines `task:` as a step id. (agent)
- **F8 from the deck's slides** (the user, 2026-10-28): the HANDOFF line reads `ctx ▰▰▰▱▱ 62% · asks at 80% · h: save now` in ask mode and `ctx 62% · saves at 80%` in auto mode, so `h` saves now. With Alfred Code the threshold is the stack's resume trigger from the status file. Still the deck's and unverified: what `c` and `r` do, the toasts' text, and when HANDOFF.md is written. Slides are evidence of the deck's behaviour, not its code. (agent)
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

F6 and F7 read JSON files from one fixed folder in the project, `.claude/session-inspector/`, so the mod never works out where a writer keeps its own data: `plans/<slug>.json` for each plan, `scores/<slug>.json` for each scored output and, in Alfred Code, `status/<session id>.json`. Writers resolve their own paths and publish there, and the mod only reads. The folder is gitignored.

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
| 4. Handoff, REC and compact rows | F8, F9, F10; starts once the deck, or the user's spec of F8 and F9's behaviour, is in hand (the verdict's Also report) | At the threshold, ask mode waits and auto mode saves; `/rec strict` hides account, home paths and $ amounts in the band, the pane, toasts and spinners; `/rec test` passes for keys, emails and phones; /quiet on shows one line per tool call and keeps up to 3 error lines on a failure, on the main screen and in fullscreen; /quiet off restores the full rows; REC masks compact rows too (agent) |
| 5. Alfred Code integration | Starts only on the user's word (the user, 2026-10-28: 'nothing from the Alfred Code integration until I say so'). The status file reader; the mode banner; the runway against the stack's resume trigger; \[Handoff\] from the stack's ready prompt. The stack side, its hooks publishing `status/<session id>.json`, lands in alfred-code first | With a valid status file for this session, the band shows the mode banner, the runway is measured against the resume trigger, and \[Handoff\] fills the stack's prompt verbatim, only into an empty prompt and never sending it; with no file, an unknown schema or another session's file, every surface draws what the core draws and the diagnostics row under \[Inspect\] names the reason (agent) |
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
| Minimum Claude Code | v2.1.287 terminal, v2.1.286 Desktop, VS Code extension v2.1.299 (v2.1.304 without feature flags); some fields need v2.1.289, v2.1.290 or v2.1.299 | States the minimum in the README and hides fields the running version lacks (agent) |
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
- **Approvals:** the mod never approves, denies or rewrites a tool call. It only observes, except the HANDOFF and REC behaviour described in the deck.
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
| MATERIAL | Two homes for a full context: F8 Handoff and the stack's guard-fresh-session-start hook, which offers a fresh session before a heavy run on a full context | Both act as context nears its limit | With Alfred Code present, the stack owns handoff and F8 only shows the state and the button; without it, F8's own handoff is the only one |
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
| MINOR | REC's prompt.compose instruction adds tokens to every request while REC is on; everything else in the mod costs no tokens | REC on | Keep the instruction under 60 words; measure turn.step input tokens with REC on and off |
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
