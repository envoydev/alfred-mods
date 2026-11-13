// The rec folder's $.state atoms, made, read and updated here alone: `claude plugin validate` refuses an atom or a
// ref handed to another module. Change a shape tag when that value's fields change: it declines what an earlier version
// stored, which outlives a reload.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { RecLevel, RecState } from './types'
import { mask, maskSpans, recLevel, setRec } from './mask'
import { loadSettings, recInForce, writeUserField } from '../settings/effects'
import { LEVELS, REC_HELP, addWord, parseWords, recNote, recPaneLines, recStatus, recTest } from './rec'
import { syncStatusLine } from '../band/effects'
import type { MatchedInput, MatchedNext } from '../core/types'
import { printable } from '../core/format'
import { maskDialog } from './sites'
import { drawWithInput } from '../core/draw'
import { closePane, isNoColor } from '../core/effects'
import { sourceLabel } from '../settings/settings'

const INITIAL_REC: RecState = { level: 'off', wordCount: 0, note: null }
const recAtom = atom({ plugin: 'alfred-mods', key: 'rec' } as const, INITIAL_REC, { shape: 'rec-2' })
export function readRec($: EngineInterface) {
  return read($, recAtom)
}
function updateRec($: EngineInterface, change: (value: RecState) => RecState) {
  return update($, recAtom, change)
}
export function resetRec($: EngineInterface) {
  return update($, recAtom, () => INITIAL_REC)
}

// The REC level the model was last told of, in module memory: the person's next prompt carries the note while the
// level differs (Decision 11)
const noteMemory = { told: 'off' as RecLevel }

// REC's private words and the home folder, in module memory only: never in $.state, a log or a file
// `compiled` names the level, words and home mask.ts holds, which a reload starts over at off
const wordsMemory = { words: [] as string[], home: null as string | null, compiled: JSON.stringify(['off', [], null]) }

// A compaction can drop REC's note from the history, so the next prompt carries it again
export function retellRecNote(): void {
  if (recLevel() !== 'off') noteMemory.told = 'off'
}

// The level in force and the stored words into the masker and the rec atom: a word set in one session reaches every
// session within 30 seconds
export async function applyRec($: EngineInterface, note: string | null = null): Promise<void> {
  const level = recInForce()?.level ?? 'off'
  // A refused read keeps the words REC had, so the fields after REC still settle (the review's #4)
  const words = await $.store.get('rec:words').then(parseWords, () => wordsMemory.words)
  wordsMemory.words = words
  // Recompiled and every site redrawn only on a change: a word swapped for another keeps the atom's count, and rows a
  // reload drew before this read were drawn at off
  const compiled = JSON.stringify([level, words, wordsMemory.home])
  if (compiled !== wordsMemory.compiled) {
    wordsMemory.compiled = compiled
    setRec(level, words, wordsMemory.home)
    $.ui.invalidate('ui.render')
  }
  await updateRec($, r => (r.level === level && r.wordCount === words.length && r.note === note ? r : { level, wordCount: words.length, note }))
  await syncStatusLine($)
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
  if ('reason' in added) return applyRec($, added.reason)
  await $.store.set('rec:words', added.words)
  await applyRec($)
}

export async function removeRecWord($: EngineInterface, word: string): Promise<void> {
  const words = parseWords(await $.store.get('rec:words'))
  await $.store.set('rec:words', words.filter(w => w.toLowerCase() !== word.toLowerCase()))
  await applyRec($)
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

export async function maskQuestions($: EngineInterface, e: MatchedInput<'ui.render', { component: 'AskUserQuestion' }>, next: MatchedNext<'ui.render', { component: 'AskUserQuestion' }>) {
  if (!(await isRecOn($))) return next(e)
  const questions = maskDialog(e.props.questions, maskSpans)
  return questions === e.props.questions ? next(e) : next({ ...e, props: { ...e.props, questions } })
}

export async function drawRecPane($: EngineInterface, e: MatchedInput<'ui.render', { component: 'Pane', requestId: 'rec' }>) {
  const r = await readRec($)
  const words = wordsMemory.words
  const press: Record<string, () => unknown> = {}
  if (r.level === 'off') words.forEach((w, i) => { press[`remove-${i}`] = () => removeRecWord($, w) })
  const note = r.note === null ? [] : [[{ text: r.note, tone: 'warn' as const }]]
  const input = { key: 'word', label: 'Add a word', submitLabel: 'Add', onSubmit: (value: string) => { void addRecWord($, value) } }
  return drawWithInput($, e, recPaneLines(r.level, words), input, note, { noColor: await isNoColor($), press, columns: e.props.bodyColumns })
}

export async function runRecCommand($: EngineInterface, e: MatchedInput<'command.run', { command: 'rec' }>) {
  const word = e.args.trim().toLowerCase()
  const target = LEVELS.find(l => l === word)
  if (target !== undefined) return { text: mask(await writeUserField($, 'rec', target)) }
  if (/^words\s+close$/.test(word)) return { text: await closePane($, 'rec', 'REC words pane') }
  if (word === 'words') {
    const opened = await $.ui.open({ id: 'rec', title: 'REC words', focus: true, closeOnEscape: true })
    return { text: opened.isPlaced ? 'Opened the REC words pane.' : `The REC words pane is open but not drawn: ${opened.reason}.` }
  }
  await loadSettings($)
  const level = recInForce()?.level ?? 'off'
  if (word === 'test') return { text: mask(recTest(level === 'off' ? 'on' : level, wordsMemory.words, wordsMemory.home)) }
  const from = sourceLabel(recInForce()?.from ?? 'default', '/rec')
  return { text: mask(`${recStatus(level, wordsMemory.words.length)} - from ${from}\n${REC_HELP}`) }
}

// How many private words REC holds
export function recWordCount(): number {
  return wordsMemory.words.length
}

// REC's note goes with the next prompt again
export function forgetRecNote(): void {
  noteMemory.told = 'off'
}

// The note the next prompt carries, once per level: null when this level was told
export function takeRecNote(): string | null {
  const level = recLevel()
  const note = level === noteMemory.told ? null : recNote(level)
  noteMemory.told = level
  return note
}

// The home folder REC's samples name as ~
export async function readRecHome($: EngineInterface): Promise<void> {
  wordsMemory.home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? null
}
