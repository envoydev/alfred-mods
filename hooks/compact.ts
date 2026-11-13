// F10's compact tool rows (brief 'Compact tool rows', Decisions 4 to 8): one line per call, runs of reads folded into
// one, and the result block's preview emptied. Every line is drawn through drawLines, so REC masks it after compacting.
import type { Line, Seg } from './band.js'
import { reportLine } from './agents.js'
import { duration, fitLine, tokens, widthOf } from './format.js'

// `outcome` and `reason`: a call the person denied or a rule, a hook or the classifier blocked, as Phase 1 settled it
// `isAutoAllowed`: auto mode's classifier let the call run, no one asked
export type CompactCall = {
  tool: string; input: unknown; output: unknown; isErrored: boolean; isInterrupted: boolean
  outcome: 'denied' | 'blocked' | null; reason: string | null; isAutoAllowed?: boolean
}

// Tools a group folds into one reads line (Decision 8)
const READ_ONLY = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']

// Tools whose emptied result drew something false or bare live (A3, 2026-10-28: Write 'Wrote 1 line to …' and '(No
// content)' for three lines, Edit a lone ⎿): with "quiet" on their result block draws nothing, as an errored one does
// WebFetch, WebSearch, Agent and AskUserQuestion too: their own steps under the call say what came back (the user,
// 2026-11-12). And Bash: emptied, its result drew '(No output)' over a call that printed lines, above auto mode's line
// (live, 2026-11-12); the row carries that line and a background run as steps of its own
export const DROPS_RESULT: readonly string[] = ['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'AskUserQuestion']

// What a row knows besides the call: the project folder, so a path reads from it, and how many times it ran in a row
export type RowContext = { cwd?: string | null; times?: number }

// Steps a run of reads draws before `+k more`
const READ_STEPS = 4

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const basename = (path: string): string => path.split(/[\\/]/).filter(p => p !== '').pop() ?? path
const lineCount = (text: string): number => (text.trimEnd() === '' ? 0 : text.trimEnd().split('\n').length)

// A URL as a person reads it: no scheme, no 'www.', no trailing slash
const site = (url: string): string => url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
const hostOf = (url: string): string => (site(url).split(/[/?#]/)[0] ?? '').toLowerCase()

// What the row names: Bash's description, else its command's first 60 characters; a web call's page or query; another
// tool's file, pattern or path
function describe(c: CompactCall): string {
  const input = isRecord(c.input) ? c.input : {}
  const out = isRecord(c.output) ? c.output : {}
  if (c.tool === 'Agent') return str(out.agentType) || str(input.subagent_type) || 'general-purpose'
  if (c.tool === 'Skill') return str(input.skill)
  if (c.tool === 'Monitor') return fitLine(str(input.description), 120)
  if (c.tool === 'TodoWrite') return todoCounts(input.todos)
  if (c.tool === 'ToolSearch') return str(input.query).trim() === '' ? '' : `"${fitLine(str(input.query).trim(), 60)}"`
  if (c.tool === 'AskUserQuestion' || c.tool.startsWith('mcp__')) return ''
  if (c.tool === 'WebFetch') return site(str(input.url))
  if (c.tool === 'WebSearch') return str(input.query).trim() === '' ? '' : `"${str(input.query).trim()}"`
  if (c.tool === 'Bash') return str(input.description).trim() !== '' ? fitLine(str(input.description), 120) : fitLine(str(input.command), 60)
  const file = str(input.file_path) || str(input.notebook_path)
  return fitLine(file !== '' ? basename(file) : str(input.pattern) || str(input.path), 60)
}

// `5 todos · 2 done, 1 in progress`
function todoCounts(todos: unknown): string {
  const list = Array.isArray(todos) ? todos.filter(isRecord) : []
  const done = list.filter(t => t.status === 'completed').length
  const now = list.filter(t => t.status === 'in_progress').length
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
  const lines = patch.flatMap(h => (isRecord(h) && Array.isArray(h.lines) ? h.lines : [])).map(str)
  return `+${lines.filter(l => l.startsWith('+')).length} −${lines.filter(l => l.startsWith('-')).length}`
}

// Lines of Bash's stdout and stderr, or of a string output; any other output has no count
function countOf(c: CompactCall): number | null {
  if (typeof c.output === 'string') return lineCount(c.output)
  if (c.tool === 'Bash' && isRecord(c.output)) return lineCount(str(c.output.stdout)) + lineCount(str(c.output.stderr))
  return null
}

const errorText = (c: CompactCall): string => (typeof c.output === 'string' ? c.output : isRecord(c.output) ? str(c.output.stderr) : '')

// The reason's first sentence, its closing stop dropped
function firstSentence(text: string): string {
  return (text.split(/(?<=[.!?])\s+/)[0] ?? '').replace(/[.!?]$/, '')
}

// ✓ with the line count; ✗, ✗ exit <n> or ✗ interrupted; ⊘ for a denied or blocked call
function status(c: CompactCall): Seg[] {
  if (c.outcome === 'denied') return [{ text: '⊘ denied by you', tone: 'warn' }]
  if (c.outcome === 'blocked') {
    const reason = firstSentence((c.reason ?? '').replace(/^blocked:\s*/, ''))
    return [{ text: reason === '' ? '⊘ blocked' : /^blocked\b/.test(reason) ? `⊘ ${reason}` : `⊘ blocked: ${reason}`, tone: 'warn' }]
  }
  if (c.isInterrupted) return [{ text: '✗ interrupted', tone: 'fail' }]
  if (c.isErrored) {
    const exit = /^Exit code (\d+)/.exec(errorText(c))
    return [{ text: exit === null ? '✗' : `✗ exit ${exit[1]}`, tone: 'fail' }]
  }
  const n = countOf(c)
  return [...(n === null || n === 0 ? [] : [{ text: `${n} ${n === 1 ? 'line' : 'lines'} ` }]), { text: '✓', tone: 'ok' }]
}

// Up to 3 indented lines under a failure: the last non-empty lines of stderr, else of the error text past its exit code
function errorLines(c: CompactCall): Line[] {
  if (!c.isErrored || c.isInterrupted || c.outcome !== null) return []
  const lines = errorText(c).split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '')
  if (/^Exit code \d+$/.test(lines[0] ?? '')) lines.shift()
  return lines.slice(-3).map(l => [{ text: `    ${l}`, tone: 'dim' }])
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
function stepLines(c: CompactCall, columns: number, cwd?: string | null): Line[] {
  const step = (text: string): Line => stepOf(text, columns)
  const input = isRecord(c.input) ? c.input : {}
  const out = isRecord(c.output) && !c.isErrored && c.outcome === null ? c.output : null
  if (c.tool === 'Agent') {
    const lines: Line[] = []
    if (str(input.description).trim() !== '') lines.push(step(`asked: ${str(input.description).trim()}`))
    if (out?.status === 'async_launched') lines.push(step('running in the background'))
    if (out?.status === 'remote_launched') lines.push(step('running in the cloud'))
    if (out?.status === 'completed') {
      const said = (Array.isArray(out.content) ? out.content : []).map(b => (isRecord(b) ? str(b.text) : '')).join('\n')
      const found = reportLine(said)
      if (found !== '') lines.push(step(`result: ${found}`))
      const uses = typeof out.totalToolUseCount === 'number' ? [`${out.totalToolUseCount} tool ${out.totalToolUseCount === 1 ? 'use' : 'uses'}`] : []
      const spent = typeof out.totalTokens === 'number' ? [`${tokens(out.totalTokens)} tokens`] : []
      const took = typeof out.totalDurationMs === 'number' ? [duration(out.totalDurationMs)] : []
      if (uses.length + spent.length + took.length > 0) lines.push(step([...uses, ...spent, ...took].join(' · ')))
    }
    return lines
  }
  if (c.tool === 'Bash') {
    if (out === null) return []
    return [
      ...(str(out.backgroundTaskId) !== '' ? [step('running in the background')] : []),
      ...(typeof out.timedOutAfterMs === 'number' ? [step(`timed out after ${duration(out.timedOutAfterMs)}`)] : []),
      ...(str(out.returnCodeInterpretation).trim() !== '' ? [step(str(out.returnCodeInterpretation).trim())] : []),
    ]
  }
  if (c.tool === 'Skill') return str(input.args).trim() === '' ? [] : [step(`with: ${str(input.args).trim()}`)]
  if (c.tool === 'Write' && out !== null) {
    const where = fromProject(str(out.filePath) || str(input.file_path), cwd)
    if (out.type === 'create') return [step(`created ${where} · ${lineCount(str(input.content))} lines`)]
    const counts = patchCounts(out.structuredPatch)
    return [step(`rewrote ${where}${counts === null ? '' : ` · ${counts}`}`)]
  }
  if (c.tool === 'Edit' && out !== null) {
    const counts = patchCounts(out.structuredPatch)
    return [step(`changed ${fromProject(str(out.filePath) || str(input.file_path), cwd)}${counts === null ? '' : ` · ${counts}`}${out.replaceAll === true ? ' · every match' : ''}`)]
  }
  if (c.tool === 'TodoWrite') {
    const now = (Array.isArray(input.todos) ? input.todos : []).find(t => isRecord(t) && t.status === 'in_progress')
    return isRecord(now) && str(now.activeForm).trim() !== '' ? [step(`now: ${str(now.activeForm).trim()}`)] : []
  }
  if (c.tool === 'ToolSearch' && out !== null && Array.isArray(out.matches)) {
    const found = out.matches.map(str).filter(m => m !== '')
    return [step(found.length === 0 ? 'found nothing' : `found ${found.join(', ')}`)]
  }
  if (c.tool === 'AskUserQuestion') {
    const answers = out !== null && isRecord(out.answers) ? out.answers : {}
    return (Array.isArray(input.questions) ? input.questions : []).filter(isRecord).flatMap(q => {
      const asked = str(q.question).trim()
      const answer = answers[str(q.question)]
      const said = Array.isArray(answer) ? answer.map(str).join(', ') : str(answer)
      return [...(asked === '' ? [] : [step(asked)]), ...(said.trim() === '' ? [] : [step(`answered: ${said.trim()}`)])]
    })
  }
  if (c.tool.startsWith('mcp__')) {
    const scalar = (v: unknown): v is string | number | boolean => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number' || typeof v === 'boolean'
    return Object.entries(input).filter(([, v]) => scalar(v)).slice(0, 3).map(([k, v]) => step(`${k}: ${String(v).trim()}`))
  }
  if (c.tool === 'Monitor') {
    const watched = str(input.command).trim() || (isRecord(input.ws) ? str(input.ws.url) : '')
    return watched === '' ? [] : [step(`watches: ${watched}`)]
  }
  if (c.tool === 'WebFetch') {
    const lines: Line[] = []
    if (out !== null && typeof out.bytes === 'number') {
      const moved = str(out.url) !== '' && site(str(out.url)) !== site(str(input.url)) ? ` from ${site(str(out.url))}` : ''
      const code = typeof out.code === 'number' ? ` · ${out.code}${str(out.codeText) === '' ? '' : ` ${str(out.codeText)}`}` : ''
      const time = typeof out.durationMs === 'number' ? ` · ${duration(out.durationMs)}` : ''
      lines.push(step(`fetched ${sizeOf(out.bytes)}${moved}${code}${time}`))
    }
    const asked = str(input.prompt).trim()
    if (asked !== '') lines.push(step(`took: ${asked}`))
    return lines
  }
  if (c.tool === 'WebSearch' && out !== null && Array.isArray(out.results)) {
    const urls = out.results.flatMap(r => (isRecord(r) && Array.isArray(r.content) ? r.content : []))
      .map(h => (isRecord(h) ? str(h.url) : '')).filter(u => u !== '')
    if (urls.length === 0) return [step('no results')]
    const sites = [...new Set(urls.map(hostOf).filter(h => h !== ''))]
    const more = sites.length > 3 ? ` +${sites.length - 3} more` : ''
    return [step(`${urls.length} ${urls.length === 1 ? 'result' : 'results'} · ${sites.slice(0, 3).join(', ')}${more}`)]
  }
  return []
}

// `⏺ <tool> · <description> · <status>`, the description cut so the line fits `columns`, then the call's steps and any
// error lines. A repeat says what its count means (the user, 2026-11-12: 'What is means x3?')
export function callLine(c: CompactCall, columns: number, at: RowContext = {}): Line[] {
  const times = at.times ?? 1
  const tail: Seg[] = [{ text: ' · ' }, ...status(c), ...(times > 1 ? [{ text: ` · ${times} times in a row` }] : [])]
  const head: Seg[] = [{ text: '⏺ ' }, { text: c.tool, bold: true }]
  const desc = describe(c)
  const room = columns - widthOf(head) - widthOf(tail) - 3
  const named: Seg[] = desc === '' ? [] : [{ text: ` · ${fitLine(desc, Math.max(1, room))}` }]
  // Auto mode's line, on a row whose result block draws nothing; any other result block draws Claude Code's own
  const allowed = c.isAutoAllowed === true && DROPS_RESULT.includes(c.tool) ? [stepOf('allowed by auto mode', columns)] : []
  return [[...head, ...named, ...tail], ...stepLines(c, columns, at.cwd), ...allowed, ...errorLines(c)]
}

// What one read did, and where: `read src/a.ts`, `grep "x" in src`, `glob src/**/*.ts`
function readStep(c: CompactCall, cwd: string | null | undefined): string {
  const input = isRecord(c.input) ? c.input : {}
  const file = str(input.file_path) || str(input.notebook_path)
  if (file !== '') return `read ${fromProject(file, cwd)}`
  const where = str(input.path) === '' ? '' : ` in ${fromProject(str(input.path), cwd)}`
  if (c.tool === 'Grep') return `grep "${str(input.pattern)}"${where}`
  if (c.tool === 'Glob') return `glob ${str(input.pattern)}${where}`
  return `${c.tool.toLowerCase()} ${fromProject(str(input.path) || str(input.pattern), cwd)}`.trimEnd()
}

// `⏺ <n> reads · ✓`, then one step per thing read or searched (`· 2 times` when read more than once), 4 at most and
// then `+k more`; `✗ <k>` when k failed
function readsLines(run: CompactCall[], columns: number, cwd: string | null | undefined): Line[] {
  const counts = new Map<string, number>()
  for (const c of run) counts.set(readStep(c, cwd), (counts.get(readStep(c, cwd)) ?? 0) + 1)
  const items = [...counts].map(([name, n]) => (n > 1 ? `${name} · ${n} times` : name))
  const failed = run.filter(c => c.isErrored || c.outcome !== null).length
  const head: Line = [{ text: '⏺ ' }, { text: `${run.length} ${run.length === 1 ? 'read' : 'reads'}`, bold: true }, { text: ' · ' },
    failed > 0 ? { text: `✗ ${failed}`, tone: 'fail' } : { text: '✓', tone: 'ok' }]
  const shown = items.length > READ_STEPS + 1 ? items.slice(0, READ_STEPS) : items
  const more = items.length - shown.length
  return [head, ...shown.map(i => stepOf(i, columns)), ...(more > 0 ? [stepOf(`+${more} more`, columns)] : [])]
}

// A repeat: the same tool, description and outcome, back to back
// back to back, its steps the same too (two agents of one type with different jobs stay two rows)
const sameAs = (a: CompactCall, b: CompactCall): boolean =>
  a.tool === b.tool && describe(a) === describe(b) && a.outcome === b.outcome && a.isErrored === b.isErrored && a.isInterrupted === b.isInterrupted &&
  JSON.stringify(stepLines(a, 200)) === JSON.stringify(stepLines(b, 200))

// A settled group's lines: each run of reads as one reads line and its steps, every other call its own lines, repeats
// as `N times in a row`
export function groupLines(calls: CompactCall[], columns: number, at: RowContext = {}): Line[] {
  const out: Line[] = []
  for (let i = 0; i < calls.length;) {
    const c = calls[i]!
    let j = i + 1
    if (READ_ONLY.includes(c.tool)) {
      while (j < calls.length && READ_ONLY.includes(calls[j]!.tool)) j++
      out.push(...readsLines(calls.slice(i, j), columns, at.cwd))
    } else {
      while (j < calls.length && sameAs(calls[j]!, c)) j++
      out.push(...callLine(c, columns, { cwd: at.cwd, times: j - i }))
    }
    i = j
  }
  return out
}
