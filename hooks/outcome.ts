// A tool call's facts, as its events reported them, to the outcome the band and the pane show.
import { oneLine } from './format'

import type { Failure, Outcome } from '../types'

export type CallFacts = {
  tool: string
  checked: 'allow' | 'ask' | 'deny' | null
  checkReason: string | null
  asked: boolean
  failedInTool: boolean
  interrupted: boolean
  classifierReason: string | null
  hookDeny: string | null
  result: { isError: boolean; deny: string | null; text: string } | null
  // The mod's own tool.call dispatch was abandoned when the call errored (types `Next.signal`): the person's Esc, or a
  // hook above that settled first
  aborted: boolean
  // The session's last seen permission mode was 'auto' when the call started
  autoMode: boolean
}

// The first rule that holds wins. Blocked, refused and interrupted calls never count as new: Claude recovers from
// a block by itself, and an interrupt is the person's own act. `by` names the hook script that blocked the call, when
// its reason names one (spec C6). A plugin in a tier above may keep classic.PostToolUseFailure from the mod, so two
// rules stand without it: an abort read from the mod's own hook marks an interrupt, and in auto mode an `ask` nobody
// saw was the classifier's allow, so its error is the tool's (a classifier block still arrives as PermissionDenied).
export function classify(f: CallFacts): { outcome: Outcome; reason: string; isNew: boolean; by: string | null } {
  // Claude Code wraps an input error in a tag meant for the model
  const text = (f.result?.text ?? '').replace(/<\/?tool_use_error>/g, '')
  const plain = (outcome: Outcome, reason: string, isNew: boolean) => ({ outcome, reason, isNew, by: null })
  if (f.result?.deny) return plain('blocked', `blocked: ${f.result.deny}`, false)
  if (f.checked === 'deny') return f.checkReason === null ? plain('blocked', 'blocked by a rule', false) : hookBlock(f.checkReason, hookReason(f.checkReason))
  if (f.classifierReason) return plain('blocked', `auto mode: ${f.classifierReason}`, false)
  // A PermissionRequest hook answered the ask with a deny, so the person never saw it
  if (f.hookDeny !== null) return hookBlock(f.hookDeny, f.hookDeny.trim() === '' ? 'blocked by a hook' : `hook: ${oneLine(f.hookDeny, 80)}`)
  if (!f.result?.isError) return plain('ok', '', false)
  if (f.failedInTool && f.interrupted) return plain('error', 'interrupted', false)
  if (f.failedInTool) return plain('error', oneLine(text, 80) || 'failed', true)
  if (f.checked === 'ask' && f.asked) return plain('denied', 'denied by you', true)
  if (f.aborted) return plain('error', 'interrupted', false)
  if (f.checked === 'ask' && !f.autoMode) return plain('refused', oneLine(text, 80) || 'refused', false)
  // No check, an error, no failure: an input error or Claude Code's own refusal, shown as an error by the ruling
  return plain('error', oneLine(text, 80) || 'failed', true)
}

// A hook's block: 'blocked by <script>: <message>' when its reason names the script, else today's text
function hookBlock(text: string, unnamed: string): { outcome: Outcome; reason: string; isNew: boolean; by: string | null } {
  const by = blockerOf(text)
  if (by === null) return { outcome: 'blocked', reason: unnamed, isNew: false, by: null }
  const message = oneLine(/hook error: \[[^\n]*?\]:(?:\s|$)\s*([\s\S]*)$/.exec(text)?.[1] ?? '', 200).replace(/^Blocked:\s*/i, '')
  return { outcome: 'blocked', reason: oneLine(message === '' ? `blocked by ${by}` : `blocked by ${by}: ${message}`, 80), isNew: false, by }
}

// A plugin's hook names its command before its message ('hook error: [node "…/guard.js"]: Blocked: …'): the message
// is what the person reads, on one line
function hookReason(reason: string): string {
  return oneLine(reason.replace(/^([^[\n]*hook error: )\[[^\n]*?\]:(?:\s+|$)/, '$1'), 80)
}

const SCRIPT = /\.(?:js|mjs|cjs|ts|sh|py|ps1|rb)$/

// The script a hook's block names (spec C6). Claude Code reports it as 'hook error: [<command>]: <message>', the
// bracket being the hook's command: the base name of its last token that ends in a script extension, quotes removed,
// at most 40 printable characters. No path or argument is kept; a command with no script, such as `node -e …`, names
// none. The command ends at the first ']: ', so one with brackets of its own (`[ -x a.sh ] && a.sh`) is read whole and a
// second bracket, in the message, is never read.
export function blockerOf(text: string): string | null {
  const command = /hook error: \[([^\n]*?)\]:(?:\s|$)/.exec(text)?.[1]
  if (command === undefined) return null
  const scripts = command.split(/\s+/).map(t => t.replace(/["']/g, '')).filter(t => SCRIPT.test(t))
  const name = scripts[scripts.length - 1]?.split(/[\\/]/).pop() ?? ''
  return name !== '' && [...name].length <= 40 && !/\p{C}/u.test(name) ? name : null
}

// The Tools table's row: a skill by its name, an MCP tool as `<server>:<tool>` (a claude.ai connector's or a plugin's
// server without that prefix), anything else by the tool's name.
export function toolKey(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Skill') return `Skill: ${String(input.skill ?? '')}`
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${(mcp[1] ?? '').replace(/^(claude_ai|plugin)_/, '')}:${mcp[2] ?? ''}` : tool
}

function relative(path: string, cwd: string): string {
  return cwd !== '' && path.startsWith(cwd) && (path[cwd.length] === '/' || path[cwd.length] === '\\')
    ? path.slice(cwd.length + 1)
    : path
}

// What a call acted on, in one line of 60.
export function targetOf(tool: string, input: Record<string, unknown>, cwd: string): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  let target = ''
  if (tool === 'Bash') target = str(input.description) || str(input.command)
  else if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool)) target = relative(str(input.file_path) || str(input.notebook_path), cwd)
  else if (tool === 'Grep' || tool === 'Glob') target = str(input.pattern)
  else if (tool === 'Skill') target = str(input.skill)
  else if (tool === 'Agent') target = str(input.description)
  return oneLine(target, 60)
}

// A repeat of the last row raises its count and moves its time; anything else is appended. Keeps the last `limit`.
export function fold(list: Failure[], next: Failure, limit = 10): Failure[] {
  const prev = list[list.length - 1]
  if (prev && prev.tool === next.tool && prev.target === next.target && prev.outcome === next.outcome && prev.reason === next.reason) {
    return [...list.slice(0, -1), { ...prev, at: next.at, detail: next.detail, count: prev.count + 1, isNew: prev.isNew || next.isNew }]
  }
  const n = next.n ?? Math.max(0, ...list.map(numberOf)) + 1
  return [...list, { ...next, n }].slice(-limit)
}

// A row's number: its own, or, for a row an earlier version kept, its place from the oldest (the user, 2026-11-12:
// 'right now I need to count and order')
export function numberOf(f: Failure, i: number): number {
  return f.n ?? i + 1
}
