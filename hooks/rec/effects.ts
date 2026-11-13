// The rec folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Level, RecState } from './types'
import { mask, maskSpans, recLevel, setRec } from './mask'
import { recInForce, settingsMem } from '../settings/effects'
import { addWord, parseWords, recPaneLines } from './rec'
import { syncStatus } from '../band/effects'
import type { MatchedInput, MatchedNext } from '../core/types'
import { printable } from '../core/format'
import { maskDialog } from './sites'
import { drawWithInput } from '../core/draw'
import { isNoColor } from '../core/effects'

const INITIAL_REC: RecState = { level: 'off', count: 0, note: null }
const recAtom = atom({ plugin: 'alfred-mods', key: 'rec' } as const, INITIAL_REC, { shape: 'rec-1' })
export function readRec($: EngineInterface) {
  return read($, recAtom)
}
export function updateRec($: EngineInterface, change: (value: RecState) => RecState) {
  return update($, recAtom, change)
}
export function resetRec($: EngineInterface) {
  return update($, recAtom, () => INITIAL_REC)
}

// The REC level the model was last told of, in module memory: the person's next prompt carries the note while the
// level differs (Decision 11)
export const noteMem = { told: 'off' as Level }

// REC's private words and the home folder, in module memory only: never in $.state, a log or a file
// `compiled` names the level, words and home mask.ts holds, which a reload starts over at off
export const recMem = { words: [] as string[], home: null as string | null, compiled: JSON.stringify(['off', [], null]) }

// A compaction can drop REC's note from the history, so the next prompt carries it again
export function retellRecNote(): void {
  if (recLevel() !== 'off') noteMem.told = 'off'
}

// The level in force and the stored words into the masker and the rec atom: a word set in one session reaches every
// session within 30 seconds
export async function loadRec($: EngineInterface, note: string | null = null): Promise<void> {
  const level = recInForce()?.level ?? 'off'
  // A refused read keeps the words REC had, so the fields after REC still settle (the review's #4)
  const words = await $.store.get('rec:words').then(parseWords, () => recMem.words)
  recMem.words = words
  // Recompiled and every site redrawn only on a change: a word swapped for another keeps the atom's count, and rows a
  // reload drew before this read were drawn at off
  const compiled = JSON.stringify([level, words, recMem.home])
  if (compiled !== recMem.compiled) {
    recMem.compiled = compiled
    setRec(level, words, recMem.home)
    $.ui.invalidate('ui.render')
  }
  await updateRec($, r => (r.level === level && r.count === words.length && r.note === note ? r : { level, count: words.length, note }))
  await syncStatus($)
}

// Whether a site masks: mask.ts's level, which a /clear, a resume or a fork leaves as it was while the atom is reset;
// the atom is read so the site redraws when REC changes
export async function isRecOn($: EngineInterface): Promise<boolean> {
  await readRec($)
  return recLevel() !== 'off'
}

// An add or a remove reads the stored words again, applies its one change and writes, so no stale copy is written back
export async function addRecWord($: EngineInterface, raw: string): Promise<void> {
  const added = addWord(parseWords(await $.store.get('rec:words')), raw)
  if ('reason' in added) return loadRec($, added.reason)
  await $.store.set('rec:words', added.words)
  await loadRec($)
}

export async function removeRecWord($: EngineInterface, word: string): Promise<void> {
  const words = parseWords(await $.store.get('rec:words'))
  await $.store.set('rec:words', words.filter(w => w.toLowerCase() !== word.toLowerCase()))
  await loadRec($)
}

export async function maskUserMessage($: EngineInterface, e: MatchedInput<'ui.render', { component: 'UserMessage' }>, next: MatchedNext<'ui.render', { component: 'UserMessage' }>) {
  if (!(await isRecOn($))) return next(e)
  const text = mask(e.props.text)
  return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
}

export async function maskAssistantMessage($: EngineInterface, e: MatchedInput<'ui.render', { component: 'AssistantMessage' }>, next: MatchedNext<'ui.render', { component: 'AssistantMessage' }>) {
  if (!(await isRecOn($))) return next(e)
  const text = mask(e.props.text)
  return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
}

export async function maskCommandOutput($: EngineInterface, e: MatchedInput<'ui.render', { component: 'CommandOutput' }>, next: MatchedNext<'ui.render', { component: 'CommandOutput' }>) {
  if (!(await isRecOn($))) return next(e)
  const text = mask(e.props.text)
  return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: printable(text) } })
}

export async function maskQuestionDialog($: EngineInterface, e: MatchedInput<'ui.render', { component: 'AskUserQuestion' }>, next: MatchedNext<'ui.render', { component: 'AskUserQuestion' }>) {
  if (!(await isRecOn($))) return next(e)
  const questions = maskDialog(e.props.questions, maskSpans)
  return questions === e.props.questions ? next(e) : next({ ...e, props: { ...e.props, questions } })
}

export async function drawRecPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'rec' }>) {
  const r = await readRec($)
  const words = recMem.words
  const press: Record<string, () => unknown> = {}
  if (r.level === 'off') words.forEach((w, i) => { press[`remove-${i}`] = () => removeRecWord($, w) })
  const note = r.note === null ? [] : [[{ text: r.note, tone: 'warn' as const }]]
  const input = { key: 'word', label: 'Add a word', submitLabel: 'Add', onSubmit: (value: string) => { void addRecWord($, value) } }
  return drawWithInput($, e, recPaneLines(r.level, words), input, note, { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}
