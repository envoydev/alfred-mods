// REC's masker: the classes of what a recording hides, compiled once per level and word list, and the one pass over a
// text that replaces each match with its token (spec 'What each class hides').
import type { Level } from '../types'
import type { Line } from './band.ts'
import { AMOUNTS, EMAILS, KEYS, LEFT_ALONE, PHONES, strictSamples } from './samples.ts'

// A match and the text it draws as: a token, or digits as dots
export type Hit = { start: number; end: number; text: string }
type Klass = { re: RegExp; hit: (m: RegExpExecArray) => Hit | null }
export type Compiled = { level: Level; classes: Klass[] }

const whole = (token: string) => (m: RegExpExecArray): Hit => ({ start: m.index, end: m.index + m[0].length, text: token })

// The tokens REC draws, kept as they are, so a masked string masks to itself
const TOKENS: Klass = { re: /‹(?:key|email|phone|private|user)(?: \d+)?›/g, hit: m => whole(m[0])(m) }

// Each letter of a word either case, as one class of the key regex is case-sensitive and another is not
const either = (word: string): string => [...word].map(c => `[${c.toUpperCase()}${c.toLowerCase()}]`).join('')
const NAMES = ['key', 'token', 'secret', 'passwd', 'password', 'pwd'].map(either).join('|')
const VALUE = String.raw`[^\s"'` + '`' + ']{8,}'

// One regex for every key form. A named value and a bearer value hide the value alone, the group that ends the match;
// a name is at most 64 characters, so no part backtracks over more.
const KEY = new RegExp([
  String.raw`(?<![\w-])(?:sk-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|AIza[\w-]{35,}|eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,})`,
  String.raw`(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`,
  // A block with no end hides to the end of the text, as its body would show otherwise
  String.raw`-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----(?:[\s\S]*?-----END[A-Z ]{0,40}PRIVATE KEY-----|[\s\S]*)`,
  String.raw`\b[Bb]earer +(?<bearer>${VALUE})`,
  String.raw`(?<![\w.-])(?=[\w.-]{0,64}?(?:${NAMES}))[\w.-]{1,64}["']?[ \t]{0,4}[:=][ \t]{0,4}["']?(?<named>${VALUE})`,
].join('|'), 'g')

const keyHit = (m: RegExpExecArray): Hit => {
  const value = m.groups?.['bearer'] ?? m.groups?.['named']
  const end = m.index + m[0].length
  return { start: value === undefined ? m.index : end - value.length, end, text: '‹key›' }
}

const EMAIL = /(?<![\w.%+-])[\w.%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g

// A + and 8 to 15 digits; or 10 or 11 digits in two to four groups, its last of 4. An IPv4 address's last group has at
// most 3 digits, so it never matches.
const PHONE = new RegExp(String.raw`(?<![\w+.-])(?:(?<intl>\+\d(?:[ .()-]{0,2}\d){7,14})|(?<national>(?:\(\d{1,4}\) ?\d{1,4}[ .-]|\d{1,4}[ .-]\d{1,4}[ .-]\d{1,4}[ .-]|\d{1,7}[ .-]\d{1,7}[ .-]|\d{6,7}[ .-])\d{4}))(?!\w|[.-]\d)`, 'g')

const phoneHit = (m: RegExpExecArray): Hit | null => {
  const national = m.groups?.['national']
  if (national !== undefined && ![10, 11].includes(national.replace(/\D/g, '').length)) return null
  return whole('‹phone›')(m)
}

const AMOUNT: Klass = {
  re: /\$\d[\d,]{0,20}(?:\.\d{1,6})?/g,
  hit: m => ({ start: m.index, end: m.index + m[0].length, text: m[0].replace(/\d/g, '•') }),
}

// What a u-flag regex escapes outside a class
const escape = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&')
const WORD_EDGE = String.raw`[\p{L}\p{N}_]`

// A home and its other spelling on Windows: Git Bash's HOME /c/Users/jane is C:\Users\jane to Claude Code and Windows
// tools, and a Windows home is /c/Users/jane inside Git Bash
function homeForms(home: string): string[] {
  const bash = /^\/([A-Za-z])(\/.+)$/.exec(home)
  if (bash !== null) return [home, `${bash[1]!}:${bash[2]!}`]
  const drive = /^([A-Za-z]):([\\/].+)$/.exec(home)
  if (drive !== null) return [home, `/${drive[1]!.toLowerCase()}${drive[2]!.replace(/\\/g, '/')}`]
  return [home]
}

function homeClasses(home: string): Klass[] {
  const forms = homeForms(home)
  const isWindows = forms.length > 1 || /^[A-Za-z]:/.test(home) || home.includes('\\')
  const out: Klass[] = []
  let name = ''
  for (const form of forms) {
    const parts = form.split(/[\\/]+/)
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    if (parts.filter(p => p !== '').length === 0) continue
    out.push({ re: new RegExp(`${parts.map(escape).join('[\\\\/]')}(?![\\p{L}\\p{N}_.-])`, isWindows ? 'giu' : 'gu'), hit: whole('~') })
    name = parts[parts.length - 1]!
  }
  if (name.length >= 3) out.push({ re: new RegExp(`(?<!${WORD_EDGE})${escape(name)}(?!${WORD_EDGE})`, 'giu'), hit: whole('‹user›') })
  return out
}

export function compile(level: Level, words: string[], home: string | null): Compiled {
  if (level === 'off') return { level, classes: [] }
  const classes: Klass[] = [TOKENS, { re: KEY, hit: keyHit }, { re: EMAIL, hit: whole('‹email›') }, { re: PHONE, hit: phoneHit }]
  // The longest word first, so the longest at a start wins
  const sorted = [...words].sort((a, b) => b.length - a.length).map(escape)
  if (sorted.length > 0) classes.push({ re: new RegExp(sorted.join('|'), 'giu'), hit: whole('‹private›') })
  if (level === 'strict') {
    if (home !== null) classes.push(...homeClasses(home))
    classes.push(AMOUNT)
  }
  return { level, classes }
}

// One pass: every class finds its matches in the original text, the overlaps go to the earliest start and then the
// longest, and no match is scanned again.
export function maskText(c: Compiled, text: string): string {
  const hits = maskHits(c, text)
  if (hits.length === 0) return text
  let out = ''
  let at = 0
  for (const h of hits) {
    out += text.slice(at, h.start) + h.text
    at = h.end
  }
  return out + text.slice(at)
}

// The matches the one pass keeps, in order and apart: by start, the longest first where two start together
export function maskHits(c: Compiled, text: string): Hit[] {
  if (c.classes.length === 0 || text === '') return []
  const hits: Hit[] = []
  for (const k of c.classes) {
    k.re.lastIndex = 0
    for (let m = k.re.exec(text); m !== null; m = k.re.exec(text)) {
      const h = k.hit(m)
      if (h !== null) hits.push(h)
      // A refused match, or an empty one, lets the next start one character on
      if (h === null || m[0] === '') k.re.lastIndex = m.index + 1
    }
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const kept: Hit[] = []
  let at = 0
  for (const h of hits) {
    if (h.start < at) continue
    kept.push(h)
    at = h.end
  }
  return kept
}

export const LEVELS: Level[] = ['off', 'on', 'strict']

// A stored level, anything else read as off
export function parseLevel(v: unknown): Level {
  return LEVELS.find(l => l === v) ?? 'off'
}

// The stored words, anything else read as none
export function parseWords(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string') : []
}

const countText = (n: number): string => `${n} private ${n === 1 ? 'word' : 'words'}`

// '● REC on · hiding keys · emails · phones · 3 private words', strict adding what it hides; off is 'REC off'
export function recStatus(level: Level, count: number): string {
  if (level === 'off') return 'REC off'
  const parts = ['keys', 'emails', 'phones', ...(count > 0 ? [countText(count)] : [])]
  if (level === 'strict') parts.push('account', 'home paths', '$ amounts')
  return `● REC ${level} · hiding ${parts.join(' · ')}`
}

export const REC_USAGE = 'Usage: /rec [on|strict|off|test|words]'

// The model's note for a level, which rides the person's next prompt (spec 'The model's note')
const NOTE_ON = 'Screen recording is on (session-inspector REC). Until told it is off, do not write secret values, API keys, tokens, passwords, email addresses or phone numbers in replies; refer to them by name, such as "the token in .env". Work on the task as usual.'
const NOTE_STRICT = 'Also leave out account names, home folder paths and dollar amounts.'
const NOTE_OFF = 'Screen recording is off (session-inspector REC); the earlier limit on secret values no longer applies.'

export function recNote(level: Level): string {
  return level === 'off' ? NOTE_OFF : level === 'strict' ? `${NOTE_ON} ${NOTE_STRICT}` : NOTE_ON
}

// The /rec help text: the usage and what REC cannot hide (spec 'What REC cannot hide')
export const REC_HELP = [
  REC_USAGE,
  '/rec turns masking on, /rec strict adds the account, home paths and $ amounts, /rec off turns it off, /rec test checks it, /rec words opens the private-words pane.',
  'REC cannot hide:',
  "- what you type in the prompt box",
  "- Claude Code's own screens and dialogs: the permission dialog, /context, /usage, /config, the status line and the welcome header",
  "- other plugins' bands and panes",
  '- the option labels of a question Claude asks: Claude Code draws them as asked',
  "- a private key's middle lines in a diff that does not show its BEGIN line",
  '- other open sessions, for up to 30 seconds after a change: run /rec in each one on screen',
  '- rows drawn before REC went on: turn it on before recording, then clear the terminal or start a new session',
  '- files on disk and the transcript: HANDOFF.md gets only its key, email and phone masking',
  '- anything the model reads',
].join('\n')

// A word added in the pane: trimmed, 3 to 64 characters, at most 100 words, none twice ignoring case
export function addWord(words: string[], raw: string): { words: string[] } | { reason: string } {
  const word = raw.trim()
  if (word.length < 3 || word.length > 64) return { reason: 'A word needs 3 to 64 characters.' }
  if (words.some(w => w.toLowerCase() === word.toLowerCase())) return { reason: 'That word is already in the list.' }
  if (words.length >= 100) return { reason: 'The list holds 100 words at most.' }
  return { words: [...words, word] }
}

// The rec pane's lines above its field: with REC off the words, each with its remove button; with REC on the count
export function recPaneLines(level: Level, words: string[]): Line[] {
  if (level !== 'off') return [[{ text: 'Private words', bold: true }], [{ text: `${countText(words.length)} · turn REC off to see or remove them` }]]
  const out: Line[] = [[{ text: 'Private words', bold: true }, { text: `  ${words.length} of 100`, tone: 'dim' }]]
  if (words.length === 0) out.push([{ text: 'No private words yet.', tone: 'dim' }])
  words.forEach((w, i) => out.push([{ text: `${w}  ` }, { button: { key: `remove-${i}`, label: 'remove' } }]))
  out.push([{ text: 'The field shows what you type: add words before recording starts.', tone: 'dim' }])
  return out
}

const row = (ok: boolean, label: string, hidden: number, total: number, tail: string): string =>
  `${ok ? '✓' : '✗'} ${label.padEnd(14)} ${`${hidden}/${total}`.padStart(5)} ${tail}`

// /rec test: the masker over the fake samples, one set per class, and the person's words, at the level that applies.
// A failed sample prints its class and the fake sample; a failed private word, its position only.
export function recTest(level: Level, words: string[], home: string | null): string {
  const c = compile(level, words, home)
  const out = [`/rec test · level ${level}`]
  const failed: string[] = []
  const check = (label: string, samples: { text: string; masked: string }[]): void => {
    const bad = samples.filter(s => maskText(c, s.text) !== s.masked)
    out.push(row(bad.length === 0, label, samples.length - bad.length, samples.length, 'hidden'))
    for (const s of bad) failed.push(`  ✗ ${label}: ${s.text}`)
  }
  check('keys', KEYS)
  check('emails', EMAILS)
  check('phones', PHONES)
  if (words.length > 0) {
    const bad = words.flatMap((w, i) => (maskText(c, w) === w ? [i + 1] : []))
    out.push(row(bad.length === 0, 'private words', words.length - bad.length, words.length, 'hidden (not shown)'))
    for (const i of bad) failed.push(`  ✗ private word ${i} shown`)
  }
  const alone = LEFT_ALONE.filter(t => level !== 'strict' || !t.startsWith('$'))
  const moved = alone.filter(t => maskText(c, t) !== t)
  out.push(row(moved.length === 0, 'left alone', alone.length - moved.length, alone.length, 'shown (SHA, time, date, version, token count, port, path, URL, UUID, digits, IP, $ off strict)'))
  for (const t of moved) failed.push(`  ✗ left alone: ${t}`)
  const strict = compile('strict', words, home)
  const part = (label: string, samples: { text: string; masked: string }[]): string => {
    const ok = samples.filter(s => maskText(strict, s.text) === s.masked).length
    return `${ok === samples.length ? '✓' : '✗'} ${label} ${ok}/${samples.length}`
  }
  const home2 = home === null ? [] : strictSamples(home)
  const homes = home2.filter(s => s.masked !== 'by ‹user› today')
  const account = home2.filter(s => s.masked === 'by ‹user› today')
  out.push(`strict: ${[
    home === null ? 'home path skipped (no home folder)' : part('home path', homes),
    home === null ? 'account skipped' : account.length === 0 ? 'account skipped (name under 3 characters)' : part('account', account),
    part('$ amounts', AMOUNTS),
  ].join(' · ')}`)
  return [...out, ...failed].join('\n')
}
