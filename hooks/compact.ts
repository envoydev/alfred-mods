// F10's compact tool rows (brief 'Compact tool rows', Decisions 4 to 8): one line per call, runs of reads folded into
// one, and the result block's preview emptied. Every line is drawn through drawLines, so REC masks it after compacting.
import type { Line, Seg } from './band.ts'
import { fitLine, widthOf } from './format.ts'

// `outcome` and `reason`: a call the person denied or a rule, a hook or the classifier blocked, as Phase 1 settled it
export type CompactCall = {
  tool: string; input: unknown; output: unknown; isErrored: boolean; isInterrupted: boolean
  outcome: 'denied' | 'blocked' | null; reason: string | null
}

// Tools a group folds into one reads line (Decision 8)
const READ_ONLY = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']

// Tools whose emptied result the live run saw refused: their result block keeps its preview (Decision 5, A3)
export const KEEPS_PREVIEW: readonly string[] = []

// Tools whose emptied result drew something false or bare live (A3, 2026-10-28: Write 'Wrote 1 line to …' and '(No
// content)' for three lines, Edit a lone ⎿): under /quiet their result block draws nothing, as an errored one does
export const DROPS_RESULT: readonly string[] = ['Edit', 'Write']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const basename = (path: string): string => path.split(/[\\/]/).filter(p => p !== '').pop() ?? path
const lineCount = (text: string): number => (text.trimEnd() === '' ? 0 : text.trimEnd().split('\n').length)

// What the row names: Bash's description, else its command's first 60 characters; another tool's file, pattern or path
function describe(c: CompactCall): string {
  const input = isRecord(c.input) ? c.input : {}
  if (c.tool === 'Bash') return str(input.description).trim() !== '' ? fitLine(str(input.description), 120) : fitLine(str(input.command), 60)
  const file = str(input.file_path) || str(input.notebook_path)
  return fitLine(file !== '' ? basename(file) : str(input.pattern) || str(input.path), 60)
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

// `⏺ <tool> · <description> · <status>`, the description cut so the line fits `columns`, then any error lines
export function callLine(c: CompactCall, columns: number, times = 1): Line[] {
  const tail: Seg[] = [{ text: ' · ' }, ...status(c), ...(times > 1 ? [{ text: ` ×${times}` }] : [])]
  const head: Seg[] = [{ text: '⏺ ' }, { text: c.tool, bold: true }]
  const desc = describe(c)
  const room = columns - widthOf(head) - widthOf(tail) - 3
  const named: Seg[] = desc === '' ? [] : [{ text: ` · ${fitLine(desc, Math.max(1, room))}` }]
  return [[...head, ...named, ...tail], ...errorLines(c)]
}

// `⏺ <n> reads · <names> · ✓`, a name read more than once as `×N`, the names cut to fit; `✗ <k>` when k failed
function readsLine(run: CompactCall[], columns: number): Line {
  const counts = new Map<string, number>()
  for (const c of run) counts.set(describe(c), (counts.get(describe(c)) ?? 0) + 1)
  const names = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')
  const failed = run.filter(c => c.isErrored || c.outcome !== null).length
  const head: Seg[] = [{ text: '⏺ ' }, { text: `${run.length} ${run.length === 1 ? 'read' : 'reads'}`, bold: true }]
  const tail: Seg[] = [{ text: ' · ' }, failed > 0 ? { text: `✗ ${failed}`, tone: 'fail' } : { text: '✓', tone: 'ok' }]
  const room = columns - widthOf(head) - widthOf(tail) - 3
  return [...head, { text: ` · ${fitLine(names, Math.max(1, room))}` }, ...tail]
}

// A repeat: the same tool, description and outcome, back to back
const sameAs = (a: CompactCall, b: CompactCall): boolean =>
  a.tool === b.tool && describe(a) === describe(b) && a.outcome === b.outcome && a.isErrored === b.isErrored && a.isInterrupted === b.isInterrupted

// A settled group's lines: each run of reads as one reads line, every other call its own line, repeats as `×N`
export function groupLines(calls: CompactCall[], columns: number): Line[] {
  const out: Line[] = []
  for (let i = 0; i < calls.length;) {
    const c = calls[i]!
    let j = i + 1
    if (READ_ONLY.includes(c.tool)) {
      while (j < calls.length && READ_ONLY.includes(calls[j]!.tool)) j++
      out.push(readsLine(calls.slice(i, j), columns))
    } else {
      while (j < calls.length && sameAs(calls[j]!, c)) j++
      out.push(...callLine(c, columns, j - i))
    }
    i = j
  }
  return out
}

// A result block's preview emptied the way each tool's result schema allows (Decision 5): Bash's stdout and stderr;
// any other tool's output as it came
export function emptyPreview(tool: string, output: unknown): unknown {
  if (!isRecord(output) || KEEPS_PREVIEW.includes(tool)) return output
  if (tool === 'Bash') return { ...output, stdout: '', stderr: '' }
  return output
}
