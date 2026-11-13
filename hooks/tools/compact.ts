// F10's compact tool rows (brief 'Compact tool rows', Decisions 4 to 8): one line per call, runs of reads folded into
// one, and the result block's preview emptied. Every line is drawn through drawLines, so REC masks it after compacting.
import { reportLine } from '../agents/agents'
import { durationText, fitLine, tokensText, widthOf } from '../core/format'
import type { Line, Seg } from '../core/types'
import type { CompactCall, RowContext } from './types'


// Tools a group folds into one reads line (Decision 8)
const READ_ONLY = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']

// Tools whose emptied result drew something false or bare live (A3, 2026-10-28: Write 'Wrote 1 line to …' and '(No
// content)' for three lines, Edit a lone ⎿): with "quiet" on their result block draws nothing, as an errored one does
// WebFetch, WebSearch, Agent and AskUserQuestion too: their own steps under the call say what came back (the user,
// 2026-11-12). And Bash: emptied, its result drew '(No output)' over a call that printed lines, above auto mode's line
// (live, 2026-11-12); the row carries that line and a background run as steps of its own
export const DROPS_RESULT: readonly string[] = ['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'AskUserQuestion']


// Steps a run of reads draws before `+k more`
const READ_STEPS = 4

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const basename = (path: string): string => path.split(/[\\/]/).filter(segment => segment !== '').pop() ?? path
const lineCount = (text: string): number => (text.trimEnd() === '' ? 0 : text.trimEnd().split('\n').length)

// A URL as a person reads it: no scheme, no 'www.', no trailing slash
const site = (url: string): string => url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
const hostOf = (url: string): string => (site(url).split(/[/?#]/)[0] ?? '').toLowerCase()

// What the row names: Bash's description, else its command's first 60 characters; a web call's page or query; another
// tool's file, pattern or path
function describe(call: CompactCall): string {
  const input = isRecord(call.input) ? call.input : {}
  const out = isRecord(call.output) ? call.output : {}
  if (call.tool === 'Agent') return str(out.agentType) || str(input.subagent_type) || 'general-purpose'
  if (call.tool === 'Skill') return str(input.skill)
  if (call.tool === 'Monitor') return fitLine(str(input.description), 120)
  if (call.tool === 'TodoWrite') return todoCounts(input.todos)
  if (call.tool === 'ToolSearch') return str(input.query).trim() === '' ? '' : `"${fitLine(str(input.query).trim(), 60)}"`
  if (call.tool === 'AskUserQuestion' || call.tool.startsWith('mcp__')) return ''
  if (call.tool === 'WebFetch') return site(str(input.url))
  if (call.tool === 'WebSearch') return str(input.query).trim() === '' ? '' : `"${str(input.query).trim()}"`
  if (call.tool === 'Bash') return str(input.description).trim() !== '' ? fitLine(str(input.description), 120) : fitLine(str(input.command), 60)
  const file = str(input.file_path) || str(input.notebook_path)
  return fitLine(file !== '' ? basename(file) : str(input.pattern) || str(input.path), 60)
}

// `5 todos · 2 done, 1 in progress`
function todoCounts(todos: unknown): string {
  const list = Array.isArray(todos) ? todos.filter(isRecord) : []
  const done = list.filter(todo => todo.status === 'completed').length
  const now = list.filter(todo => todo.status === 'in_progress').length
  const parts = [...(done > 0 ? [`${done} done`] : []), ...(now > 0 ? [`${now} in progress`] : [])]
  return `${list.length} ${list.length === 1 ? 'todo' : 'todos'}${parts.length === 0 ? '' : ` · ${parts.join(', ')}`}`
}

// A path as read from the project folder; outside it, the path as it is
function fromProject(path: string, cwd: string | null | undefined): string {
  if (cwd === null || cwd === undefined || cwd === '') return path
  const base = cwd.replace(/[\\/]+$/, '')
  return path.startsWith(`${base}/`) || path.startsWith(`${base}\\`) ? path.slice(base.length + 1) : path === base ? '.' : path
}

// `+3 −1`: the lines a patch added and removed
function patchCounts(patch: unknown): string | null {
  if (!Array.isArray(patch)) return null
  const lines = patch.flatMap(hunk => (isRecord(hunk) && Array.isArray(hunk.lines) ? hunk.lines : [])).map(str)
  return `+${lines.filter(line => line.startsWith('+')).length} −${lines.filter(line => line.startsWith('-')).length}`
}

// Lines of Bash's stdout and stderr, or of a string output; any other output has no count
function countOf(call: CompactCall): number | null {
  if (typeof call.output === 'string') return lineCount(call.output)
  if (call.tool === 'Bash' && isRecord(call.output)) return lineCount(str(call.output.stdout)) + lineCount(str(call.output.stderr))
  return null
}

const errorText = (call: CompactCall): string => (typeof call.output === 'string' ? call.output : isRecord(call.output) ? str(call.output.stderr) : '')

// The reason's first sentence, its closing stop dropped
function firstSentence(text: string): string {
  return (text.split(/(?<=[.!?])\s+/)[0] ?? '').replace(/[.!?]$/, '')
}

// ✓ with the line count; ✗, ✗ exit <n> or ✗ interrupted; ⊘ for a denied or blocked call
function status(call: CompactCall): Seg[] {
  if (call.outcome === 'denied') return [{ text: '⊘ denied by you', tone: 'warn' }]
  if (call.outcome === 'blocked') {
    const reason = firstSentence((call.reason ?? '').replace(/^blocked:\s*/, ''))
    return [{ text: reason === '' ? '⊘ blocked' : /^blocked\b/.test(reason) ? `⊘ ${reason}` : `⊘ blocked: ${reason}`, tone: 'warn' }]
  }
  if (call.isInterrupted) return [{ text: '✗ interrupted', tone: 'fail' }]
  if (call.isErrored) {
    const exit = /^Exit code (\d+)/.exec(errorText(call))
    return [{ text: exit === null ? '✗' : `✗ exit ${exit[1]}`, tone: 'fail' }]
  }
  const lineCount = countOf(call)
  return [...(lineCount === null || lineCount === 0 ? [] : [{ text: `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} ` }]), { text: '✓', tone: 'ok' }]
}

// Up to 3 indented lines under a failure: the last non-empty lines of stderr, else of the error text past its exit code
function errorLines(call: CompactCall): Line[] {
  if (!call.isErrored || call.isInterrupted || call.outcome !== null) return []
  const lines = errorText(call).split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '')
  if (/^Exit code \d+$/.test(lines[0] ?? '')) lines.shift()
  return lines.slice(-3).map(line => [{ text: `    ${line}`, tone: 'dim' }])
}

const sizeOf = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// A web call's steps, one `⎿` line each (the user, 2026-11-12: 'what source is agent fatching'): WebFetch what came
// back, from where when it moved, and what it took from the page; WebSearch how many results and their sites. A failed
// or stopped call has its error lines instead of what came back.
const stepOf = (text: string, columns: number): Line => [{ text: `  ⎿ ${fitLine(text, Math.max(1, columns - 4))}`, tone: 'dim' }]

// Any other call's steps (the user, 2026-11-12: 'What agent ... what job is done; What skill; What and where writing;
// What is asking and what is the responce; What doc mcp queryng; What monitoring'): what it was given, then what came
// back once it has
function stepLines(call: CompactCall, columns: number, cwd?: string | null): Line[] {
  const step = (text: string): Line => stepOf(text, columns)
  const input = isRecord(call.input) ? call.input : {}
  const out = isRecord(call.output) && !call.isErrored && call.outcome === null ? call.output : null
  if (call.tool === 'Agent') {
    const lines: Line[] = []
    if (str(input.description).trim() !== '') lines.push(step(`asked: ${str(input.description).trim()}`))
    if (out?.status === 'async_launched') lines.push(step('running in the background'))
    if (out?.status === 'remote_launched') lines.push(step('running in the cloud'))
    if (out?.status === 'completed') {
      const said = (Array.isArray(out.content) ? out.content : []).map(block => (isRecord(block) ? str(block.text) : '')).join('\n')
      const found = reportLine(said)
      if (found !== '') lines.push(step(`result: ${found}`))
      const uses = typeof out.totalToolUseCount === 'number' ? [`${out.totalToolUseCount} tool ${out.totalToolUseCount === 1 ? 'use' : 'uses'}`] : []
      const spent = typeof out.totalTokens === 'number' ? [`${tokensText(out.totalTokens)} tokens`] : []
      const took = typeof out.totalDurationMs === 'number' ? [durationText(out.totalDurationMs)] : []
      if (uses.length + spent.length + took.length > 0) lines.push(step([...uses, ...spent, ...took].join(' · ')))
    }
    return lines
  }
  if (call.tool === 'Bash') {
    if (out === null) return []
    return [
      ...(str(out.backgroundTaskId) !== '' ? [step('running in the background')] : []),
      ...(typeof out.timedOutAfterMs === 'number' ? [step(`timed out after ${durationText(out.timedOutAfterMs)}`)] : []),
      ...(str(out.returnCodeInterpretation).trim() !== '' ? [step(str(out.returnCodeInterpretation).trim())] : []),
    ]
  }
  if (call.tool === 'Skill') return str(input.args).trim() === '' ? [] : [step(`with: ${str(input.args).trim()}`)]
  if (call.tool === 'Write' && out !== null) {
    const where = fromProject(str(out.filePath) || str(input.file_path), cwd)
    if (out.type === 'create') return [step(`created ${where} · ${lineCount(str(input.content))} lines`)]
    const counts = patchCounts(out.structuredPatch)
    return [step(`rewrote ${where}${counts === null ? '' : ` · ${counts}`}`)]
  }
  if (call.tool === 'Edit' && out !== null) {
    const counts = patchCounts(out.structuredPatch)
    return [step(`changed ${fromProject(str(out.filePath) || str(input.file_path), cwd)}${counts === null ? '' : ` · ${counts}`}${out.replaceAll === true ? ' · every match' : ''}`)]
  }
  if (call.tool === 'TodoWrite') {
    const now = (Array.isArray(input.todos) ? input.todos : []).find(todo => isRecord(todo) && todo.status === 'in_progress')
    return isRecord(now) && str(now.activeForm).trim() !== '' ? [step(`now: ${str(now.activeForm).trim()}`)] : []
  }
  if (call.tool === 'ToolSearch' && out !== null && Array.isArray(out.matches)) {
    const found = out.matches.map(str).filter(match => match !== '')
    return [step(found.length === 0 ? 'found nothing' : `found ${found.join(', ')}`)]
  }
  if (call.tool === 'AskUserQuestion') {
    const answers = out !== null && isRecord(out.answers) ? out.answers : {}
    return (Array.isArray(input.questions) ? input.questions : []).filter(isRecord).flatMap(question => {
      const asked = str(question.question).trim()
      const answer = answers[str(question.question)]
      const said = Array.isArray(answer) ? answer.map(str).join(', ') : str(answer)
      return [...(asked === '' ? [] : [step(asked)]), ...(said.trim() === '' ? [] : [step(`answered: ${said.trim()}`)])]
    })
  }
  if (call.tool.startsWith('mcp__')) {
    const scalar = (value: unknown): value is string | number | boolean =>
      (typeof value === 'string' && value.trim() !== '') || typeof value === 'number' || typeof value === 'boolean'
    return Object.entries(input).filter(([, value]) => scalar(value)).slice(0, 3).map(([key, value]) => step(`${key}: ${String(value).trim()}`))
  }
  if (call.tool === 'Monitor') {
    const watched = str(input.command).trim() || (isRecord(input.ws) ? str(input.ws.url) : '')
    return watched === '' ? [] : [step(`watches: ${watched}`)]
  }
  if (call.tool === 'WebFetch') {
    const lines: Line[] = []
    if (out !== null && typeof out.bytes === 'number') {
      const moved = str(out.url) !== '' && site(str(out.url)) !== site(str(input.url)) ? ` from ${site(str(out.url))}` : ''
      const code = typeof out.code === 'number' ? ` · ${out.code}${str(out.codeText) === '' ? '' : ` ${str(out.codeText)}`}` : ''
      const time = typeof out.durationMs === 'number' ? ` · ${durationText(out.durationMs)}` : ''
      lines.push(step(`fetched ${sizeOf(out.bytes)}${moved}${code}${time}`))
    }
    const asked = str(input.prompt).trim()
    if (asked !== '') lines.push(step(`took: ${asked}`))
    return lines
  }
  if (call.tool === 'WebSearch' && out !== null && Array.isArray(out.results)) {
    const urls = out.results.flatMap(result => (isRecord(result) && Array.isArray(result.content) ? result.content : []))
      .map(hit => (isRecord(hit) ? str(hit.url) : '')).filter(url => url !== '')
    if (urls.length === 0) return [step('no results')]
    const sites = [...new Set(urls.map(hostOf).filter(host => host !== ''))]
    const more = sites.length > 3 ? ` +${sites.length - 3} more` : ''
    return [step(`${urls.length} ${urls.length === 1 ? 'result' : 'results'} · ${sites.slice(0, 3).join(', ')}${more}`)]
  }
  return []
}

// `⏺ <tool> · <description> · <status>`, the description cut so the line fits `columns`, then the call's steps and any
// error lines. A repeat says what its count means (the user, 2026-11-12: 'What is means x3?')
export function callLine(call: CompactCall, columns: number, at: RowContext = {}): Line[] {
  const times = at.times ?? 1
  const tail: Seg[] = [{ text: ' · ' }, ...status(call), ...(times > 1 ? [{ text: ` · ${times} times in a row` }] : [])]
  const head: Seg[] = [{ text: '⏺ ' }, { text: call.tool, bold: true }]
  const desc = describe(call)
  const room = columns - widthOf(head) - widthOf(tail) - 3
  const named: Seg[] = desc === '' ? [] : [{ text: ` · ${fitLine(desc, Math.max(1, room))}` }]
  // Auto mode's line, on a row whose result block draws nothing; any other result block draws Claude Code's own
  const allowed = call.isAutoAllowed === true && DROPS_RESULT.includes(call.tool) ? [stepOf('allowed by auto mode', columns)] : []
  return [[...head, ...named, ...tail], ...stepLines(call, columns, at.cwd), ...allowed, ...errorLines(call)]
}

// What one read did, and where: `read src/a.ts`, `grep "x" in src`, `glob src/**/*.ts`
function readStep(call: CompactCall, cwd: string | null | undefined): string {
  const input = isRecord(call.input) ? call.input : {}
  const file = str(input.file_path) || str(input.notebook_path)
  if (file !== '') return `read ${fromProject(file, cwd)}`
  const where = str(input.path) === '' ? '' : ` in ${fromProject(str(input.path), cwd)}`
  if (call.tool === 'Grep') return `grep "${str(input.pattern)}"${where}`
  if (call.tool === 'Glob') return `glob ${str(input.pattern)}${where}`
  return `${call.tool.toLowerCase()} ${fromProject(str(input.path) || str(input.pattern), cwd)}`.trimEnd()
}

// `⏺ <n> reads · ✓`, then one step per thing read or searched (`· 2 times` when read more than once), 4 at most and
// then `+k more`; `✗ <k>` when k failed
function readsLines(run: CompactCall[], columns: number, cwd: string | null | undefined): Line[] {
  const counts = new Map<string, number>()
  for (const readCall of run) counts.set(readStep(readCall, cwd), (counts.get(readStep(readCall, cwd)) ?? 0) + 1)
  const items = [...counts].map(([name, times]) => (times > 1 ? `${name} · ${times} times` : name))
  const failed = run.filter(call => call.isErrored || call.outcome !== null).length
  const head: Line = [{ text: '⏺ ' }, { text: `${run.length} ${run.length === 1 ? 'read' : 'reads'}`, bold: true }, { text: ' · ' },
    failed > 0 ? { text: `✗ ${failed}`, tone: 'fail' } : { text: '✓', tone: 'ok' }]
  const shown = items.length > READ_STEPS + 1 ? items.slice(0, READ_STEPS) : items
  const more = items.length - shown.length
  return [head, ...shown.map(i => stepOf(i, columns)), ...(more > 0 ? [stepOf(`+${more} more`, columns)] : [])]
}

// A repeat: the same tool, description and outcome, back to back
// back to back, its steps the same too (two agents of one type with different jobs stay two rows)
const sameAs = (left: CompactCall, right: CompactCall): boolean =>
  left.tool === right.tool && describe(left) === describe(right) && left.outcome === right.outcome && left.isErrored === right.isErrored
  && left.isInterrupted === right.isInterrupted &&
  JSON.stringify(stepLines(left, 200)) === JSON.stringify(stepLines(right, 200))

// A settled group's lines: each run of reads as one reads line and its steps, every other call its own lines, repeats
// as `N times in a row`
export function groupLines(calls: CompactCall[], columns: number, at: RowContext = {}): Line[] {
  const out: Line[] = []
  for (let i = 0; i < calls.length;) {
    const call = calls[i]!
    let j = i + 1
    if (READ_ONLY.includes(call.tool)) {
      while (j < calls.length && READ_ONLY.includes(calls[j]!.tool)) j++
      out.push(...readsLines(calls.slice(i, j), columns, at.cwd))
    } else {
      while (j < calls.length && sameAs(calls[j]!, call)) j++
      out.push(...callLine(call, columns, { cwd: at.cwd, times: j - i }))
    }
    i = j
  }
  return out
}
