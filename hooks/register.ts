// The alfred-mods hooks module, the wiring alone: each on(...) calls one function of a feature folder under hooks/.
// Every hook observes and draws; none approves, denies or rewrites a tool call.
// Each $.state atom is made, read and updated in its owner folder's effects.ts: `claude plugin validate` refuses an atom
// or a ref handed to another module.
import type { Register } from 'claude-code'

import { drawNote } from './core/draw'
import { REC_HIDDEN, SPINNER_WORD, paneFailed } from './core/failsafe'
import { clock, when } from './core/format'
import { recLevel } from './rec/mask'
import { neutralDialog } from './rec/sites'
import { DROPS_RESULT } from './tools/compact'
import { runs } from './plan/plan'
import { countSkillPrompt, drawToolGroup, drawToolResult, drawToolUse, notePermissionAsk, notePermissionDenied, notePromptMode, noteToolCheck, noteToolFailure, noteToolTime, trackToolCall } from './tools/effects'
import { completeTurn, startTurn, submitPrompt, takeMeasure, trackTurnStep } from './session/effects'
import { trackSpawn } from './agents/effects'
import { afterModelSwitch, beforeModelSwitch, followCompaction } from './cache/effects'
import { runAutoHandoffCommand } from './handoff/effects'
import { drawRecPane, maskAssistantMessage, maskCommandOutput, maskQuestionDialog, maskUserMessage, runRecCommand } from './rec/effects'
import { drawBandAbove, drawBandAboveFailed, drawBandUnder, drawBandUnderFailed, drawSpinner } from './band/effects'
import { noteLoadedRule } from './context/effects'
import { drawInspectPane, runInspectCommand } from './inspect/effects'
import type { Call } from './tools/types'
import type { Held } from './core/types'
import { followConfigChange } from './settings/effects'
import { followSessionStart, startSession } from './lifecycle/effects'

export const register: Register = (on, options) => {
  // The person's word that a managed plugin sends these events on past the mod: Claude Code then tells the model, once
  // per event and conversation, that the mod's hook was skipped. Left out, the hooks never join the chain; they never ran
  // there anyway, and a new conversation is read off the session id. The rules hook goes with the six on the safe side
  // (spec 2026-11-11, D4, A1): such a plugin may skip it too, and the rules row then says by path is not tracked.
  const isLeftOut = options.leave_out_skipped_hooks === true
  // Keyed by call id, at most 100, the oldest dropped first
  const calls = new Map<string, Call>()
  const held: Held = {
    close: null, compacting: false, counted: 0, isTerminal: false, reload: null, reading: Promise.resolve(), writes: Promise.resolve(),
  }

  on('agent.spawn', ($, e, next) => trackSpawn($, e, next)).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => trackToolCall($, e, next, calls, held)).catch(($, e, next) => next(e))

  on('tool.check', ($, e, next) => noteToolCheck($, e, next, calls)).catch(($, e, next) => next(e))

  // The permission mode only: the prompt itself is never read or kept
  on('classic.UserPromptSubmit', ($, e, next) => notePromptMode($, e, next)).catch(($, e, next) => next(e))

  // The six hooks a managed plugin's notices named (2026-11-10), each of which it can send on past the mod. Left out
  // with `leave_out_skipped_hooks`, as they never run there: Claude Code then has no skipped hook to tell the model of.
  if (!isLeftOut) {
    on('classic.PostToolUseFailure', ($, e, next) => noteToolFailure($, e, next, calls)).catch(($, e, next) => next(e))

    // The tool's own time, without the permission prompt or hooks: a call the person was asked about waited the rest
    on('classic.PostToolUse', ($, e, next) => noteToolTime($, e, next, calls)).catch(($, e, next) => next(e))

    // The person is asked only when no hook answered the request. It names no call id: it marks the newest unsettled
    // call of the tool whose check said ask.
    on('classic.PermissionRequest', ($, e, next) => notePermissionAsk($, e, next, calls)).catch(($, e, next) => next(e))

    // It can arrive after the call settled: the call is classified again, its row and counts replaced
    on('classic.PermissionDenied', ($, e, next) => notePermissionDenied($, e, next, calls)).catch(($, e, next) => next(e))

    // A skill the person runs as /name raises no Skill call; one the model runs raises both, and counts once. One with
    // no Skill call behind it while no main turn runs is the person's /name, in the main context; mid-turn, it is a
    // subagent's preload.
    // A `context: fork` skill runs in a subagent of its own (code.claude.com/docs/en/skills, read 2026-11-11).
    on('skill.prompt', ($, e, next) => countSkillPrompt($, e, next, calls)).catch(($, e, next) => next(e))

    // A /clear, a resume or a branch starts over at once; a resumed one also takes the cache rate its event carries
    on('classic.SessionStart', ($, e, next) => followSessionStart($, e, next, calls, held)).catch(($, e, next) => next(e))

    // A rule the main context loaded by path (spec 2026-11-11, D4): a match of its `paths:` globs, or a nested folder's
    // rules. A subagent's load is in its own context; a start-up or compaction load is the breakdown's to list. Only a
    // rule's frontmatter matches by path, so that file is a rule wherever a link under `.claude/rules/` lands it.
    on('classic.InstructionsLoaded', ($, e, next) => noteLoadedRule($, e, next)).catch(($, e, next) => next(e))

    // An edit to a settings file (spec settings-values S4): a read inside this hook still answers the old value (F4),
    // so the files are read again at the clock's next tick; left out, the 30 s poll reads them
    on('classic.ConfigChange', ($, e, next) => followConfigChange($, e, next)).catch(($, e, next) => next(e))
  }

  on('session.start', ($, e, next) => startSession($, e, next, calls, held)).catch(($, e, next) => next(e))

  // Your prompt, typed at the terminal or sent through Remote Control, waits for the turn that answers it: the engine
  // queues one typed during a turn, and a slash command may start no turn at all. It waits before `next`, as the
  // engine may start its turn before this hook resumes; a prompt dropped beneath leaves, one rewritten is re-keyed.
  on('prompt.submit', ($, e, next) => submitPrompt($, e, next, calls, held)).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => startTurn($, e, next)).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    return yield* trackTurnStep($, e, next, held)
  })

  on('turn.complete', ($, e, next) => completeTurn($, e, next, held)).catch(($, e, next) => next(e))

  on('session.measure', ($, e, next) => takeMeasure($, e, next)).catch(($, e, next) => next(e))

  on('session.compact', ($, e, next) => followCompaction($, e, next, held)).catch(($, e, next) => next(e))

  // A switch forfeits the cache; its report gives the tier under the billing now and prices the rewrite
  on('classic.PostModelSwitch', ($, e, next) => afterModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // Claude Code may still ask to confirm the switch, so the cache stays warm; a switch a hook stops reports nothing
  on('classic.PreModelSwitch', ($, e, next) => beforeModelSwitch($, e, next, held)).catch(($, e, next) => next(e))

  // '/inspect [tab]': opens the pane, never on its own. '/inspect plan <name>' pins that plan; 'plan' alone clears it.
  on('command.run', { command: 'inspect' }, ($, e) => runInspectCommand($, e))

  // '/rec [on|strict|off|test|words]': the level is a settings value (S5) that on, strict and off write into the user
  // file (the user's ruling, 2026-11-12); every form but words reads the files first, so a session that has not polled
  // answers with the level in force, never its own copy
  on('command.run', { command: 'rec' }, ($, e) => runRecCommand($, e))

  // '/auto-handoff [ask|auto|off|at <percent>|now]': the mode and the first ask are settings values (S5) that ask, auto,
  // off and at <percent> write into the user file (the user's ruling, 2026-11-12); a bare form reads the files first
  // and prints the state with each value's source, and while Alfred Code owns the handoff, its state alone
  on('command.run', { command: 'auto-handoff' }, ($, e) => runAutoHandoffCommand($, e, held))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawBandAbove($, e, next, held, isLeftOut)).catch(($, e, next) => drawBandAboveFailed($, e, next))

  // The band under the input, in Claude Code's footer on the terminal (spec band-under U2): Claude Code's own line first,
  // then the band, at the site above's width and the rows the screen leaves; above, or elsewhere, the footer as it was
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => drawBandUnder($, e, next, held, isLeftOut)).catch(($, e, next) => drawBandUnderFailed($, e, next))

  // The main loop's spinner adds its action, context and the agents running; an agent's spinner, that agent's
  on('ui.render', { component: 'Spinner' }, ($, e, next) => drawSpinner($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : next({ ...e, props: { ...e.props, word: SPINNER_WORD, message: null } })))

  // REC on Claude Code's rows: each site rewrites its props only while REC is on and masking changes something, else
  // passes next(e) as it came. The stored messages and what the model reads stay as they are.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => maskUserMessage($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => maskAssistantMessage($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => maskCommandOutput($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // The tool sites in two steps (Decision 14): "quiet"'s compact row or emptied result first, then REC over whatever
  // the first hands on. A settled row that is not expanded, or that a group unfolded, draws its compact line.
  // An unfolded group's rows draw `output` inline, so a row's input and output are both masked
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => drawToolUse($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // With "quiet" on an errored result draws an empty Box, as Claude Code would draw its whole error text and the compact
  // row above carries ✗ and its error lines, and so does a result whose row carries what it said (DROPS_RESULT: Bash,
  // Edit, Write and more); any other keeps next(e)'s tree, the classifier line in it. Under REC, so does an errored
  // result whose row drew its masked error text
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => drawToolResult($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  // With "quiet" on a settled group of calls alone draws its compact lines. One holding another row, or an errored or
  // interrupted call, is unfolded and its calls marked, so each draws its own compact line; a group drawn expanded (the
  // main screen's ctrl+o) unmarks them, so ctrl+o shows all. A group's folded line shows its calls' paths, patterns and
  // git results, and `isExpanded` is the one prop a rewrite changes, so REC unfolds it into ToolUse rows, which the
  // hook above masks, live or settled.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => drawToolGroup($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : drawNote($, e, REC_HIDDEN)))

  on('ui.render', { component: 'AskUserQuestion' }, ($, e, next) => maskQuestionDialog($, e, next)).catch(($, e, next) => (recLevel() === 'off' ? next(e) : next({ ...e, props: { ...e.props, questions: neutralDialog(e.props.questions) } })))

  on('ui.render', { component: 'Pane', requestId: 'inspect' }, ($, e) => drawInspectPane($, e, held)).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))

  // The private-words pane: words are added only here, never through a command's arguments, which the transcript echoes
  on('ui.render', { component: 'Pane', requestId: 'rec' }, ($, e) => drawRecPane($, e)).catch(($, e, next) => drawNote($, e, paneFailed(next.error.kind, next.error.message, recLevel() !== 'off')))
}
