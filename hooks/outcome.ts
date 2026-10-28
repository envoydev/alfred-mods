// A tool call's facts, as its events reported them, to the outcome the band and the pane show.
import { oneLine } from './format.ts'

import type { Failure, Outcome } from '../types'

export type CallFacts = {
  tool: string
  checked: 'allow' | 'ask' | 'deny' | null
  checkReason: string | null
  asked: boolean
  failedInTool: boolean
  interrupted: boolean
  classifierReason: string | null
  result: { isError: boolean; deny: string | null; text: string } | null
}

// The first rule that holds wins. Blocked, refused and interrupted calls never count as new: Claude recovers from
// a block by itself, and an interrupt is the person's own act.
export function classify(f: CallFacts): { outcome: Outcome; reason: string; isNew: boolean } {
  // Claude Code wraps an input error in a tag meant for the model
  const text = (f.result?.text ?? '').replace(/<\/?tool_use_error>/g, '')
  if (f.result?.deny) return { outcome: 'blocked', reason: `blocked: ${f.result.deny}`, isNew: false }
  if (f.checked === 'deny') return { outcome: 'blocked', reason: f.checkReason === null ? 'blocked by a rule' : hookReason(f.checkReason), isNew: false }
  if (f.classifierReason) return { outcome: 'blocked', reason: `auto mode: ${f.classifierReason}`, isNew: false }
  if (!f.result?.isError) return { outcome: 'ok', reason: '', isNew: false }
  if (f.failedInTool && f.interrupted) return { outcome: 'error', reason: 'interrupted', isNew: false }
  if (f.failedInTool) return { outcome: 'error', reason: oneLine(text, 80), isNew: true }
  if (f.checked === 'ask' && f.asked) return { outcome: 'denied', reason: 'denied by you', isNew: true }
  if (f.checked === 'ask') return { outcome: 'refused', reason: oneLine(text, 80) || 'refused', isNew: false }
  // No check, an error, no failure: an input error or Claude Code's own refusal, shown as an error by the ruling
  return { outcome: 'error', reason: oneLine(text, 80), isNew: true }
}

// A plugin's hook names its command before its message ('hook error: [node "…/guard.js"]: Blocked: …'): the message
// is what the person reads, on one line
function hookReason(reason: string): string {
  return oneLine(reason.replace(/^([^[\n]*hook error: )\[[^\]\n]*\]: */, '$1'), 80)
}

// The Tools table's row: a skill by its name, an MCP tool by its server, anything else by the tool's name.
export function toolKey(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Skill') return `Skill: ${String(input.skill ?? '')}`
  const mcp = /^mcp__(.+?)__/.exec(tool)
  return mcp ? `mcp: ${mcp[1]}` : tool
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
  return [...list, next].slice(-limit)
}
