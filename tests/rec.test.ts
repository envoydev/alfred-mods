import { expect, test } from 'claude-code/testing'

import { compile, maskText } from '../hooks/rec'
import { mask, maskForFile, maskStats, recLevel, setRec } from '../hooks/mask'
import { fitLine, oneLine, widthOf } from '../hooks/format'
import { AMOUNTS, EMAILS, KEYS, LEFT_ALONE, PHONES, strictSamples } from '../hooks/samples'

// REC's level lives in module memory, shared by every test of a run: each test that sets it puts it back
function withRec(level: 'off' | 'on' | 'strict', words: string[], home: string | null, fn: () => void): void {
  setRec(level, words, home)
  try {
    fn()
  } finally {
    setRec('off', [], null)
  }
}

// A deterministic line of base64 text
function base64(n: number): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let seed = 7
  let out = ''
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out += abc[seed % 64]
  }
  return out
}

test('every key sample is hidden, a named value by its value alone', () => {
  const c = compile('on', [], null)
  for (const s of KEYS) expect(maskText(c, s.text)).toBe(s.masked)
  expect(maskText(c, `see ${KEYS[2]!.text} here`)).toBe('see ‹key› here')
  expect(maskText(c, 'API_KEY=hunter2hunter2')).toBe('API_KEY=‹key›')
})

test('the four forms hide their value, at on and strict', () => {
  const forms: [string, string][] = [
    ['password=hunter2', 'password=‹key›'], ['--password hunter2', '--password ‹key›'], ['--token=abcd1234', '--token=‹key›'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic ‹key›'], ['authorization=Token abcd', 'authorization=Token ‹key›'],
    ['postgres://admin:hunter2@localhost', 'postgres://admin:‹key›@localhost'],
  ]
  for (const level of ['on', 'strict'] as const) {
    const c = compile(level, [], '/Users/jane')
    for (const [text, masked] of forms) expect({ level, out: maskText(c, text) }).toEqual({ level, out: masked })
  }
})

test('near misses of the four forms stay', () => {
  const c = compile('on', [], null)
  const misses = ['Basic usage', '$ pwd', 'key: id', 'password: null', 'secret: true', '--token-file ./t', 'https://example.com/a:b@c', 'password=', 'https://u@h']
  for (const t of misses) expect(maskText(c, t)).toBe(t)
  for (const t of misses.slice(0, 7)) expect(LEFT_ALONE).toContain(t)
})

test('a token in URL credentials masks once', () => {
  const c = compile('on', [], null)
  const url = 'https://bot:' + 'gh' + 'p_' + 'aB3'.repeat(12) + '@github.com/o/r.git'
  expect(maskText(c, url)).toBe('https://bot:‹key›@github.com/o/r.git')
  expect(maskText(c, 'postgres://admin:hunter2@db.example.com/x')).toBe('postgres://admin:‹key›@db.example.com/x')
  const user = 'https://' + 'gh' + 'p_' + 'aB3'.repeat(12) + ':x-oauth-basic@github.com'
  expect(maskText(c, user)).toBe('https://‹key›:‹key›@github.com')
})

test('Authorization of any scheme hides its credential, Proxy-Authorization too', () => {
  const c = compile('on', [], null)
  const cases: [string, string][] = [
    ['Authorization: Bot ' + 'abcd'.repeat(6), 'Authorization: Bot ‹key›'],
    ['authorization: Key abcd1234:efgh5678', 'authorization: Key ‹key›'],
    ['Authorization: ApiKey abcdef123456', 'Authorization: ApiKey ‹key›'],
    ['Authorization: SSWS 00abcdEFGH', 'Authorization: SSWS ‹key›'],
    ['Proxy-Authorization: Basic dXNlcjpwYXNz', 'Proxy-Authorization: Basic ‹key›'],
    ['Authorization: Bearer abc', 'Authorization: Bearer ‹key›'],
    ['Authorization: abcd1234 in the header', 'Authorization: ‹key› in the header'],
  ]
  for (const [text, masked] of cases) expect(maskText(c, text)).toBe(masked)
  expect(maskText(c, 'Authorization header missing')).toBe('Authorization header missing')
})

test('URL credentials with no user or an @ in the password hide the whole password, once', () => {
  const c = compile('on', [], null)
  const cases: [string, string][] = [
    ['redis://:hunter2@localhost:6379', 'redis://:‹key›@localhost:6379'],
    ['postgres://admin:p@ss@localhost', 'postgres://admin:‹key›@localhost'],
    ['ftp://anonymous:jane@example.com@ftp.example.com/', 'ftp://anonymous:‹key›@ftp.example.com/'],
  ]
  for (const [text, masked] of cases) {
    expect(maskText(c, text)).toBe(masked)
    expect(maskText(c, masked)).toBe(masked)
  }
})

test("HANDOFF's key class gains the forms", () => {
  expect(maskForFile('password=hunter2')).toBe('password=‹key›')
  expect(maskForFile('postgres://admin:hunter2@localhost')).toBe('postgres://admin:‹key›@localhost')
})

test('a 100 kB line of each form masks in under 50 ms', () => {
  const c = compile('on', [], null)
  const forms = ['password=hunter2 ', '--password hunter2 ', 'Authorization: Basic dXNlcjpwYXNz ', 'postgres://admin:hunter2@localhost ']
  for (const form of forms) {
    const text = form.repeat(Math.ceil(100_000 / form.length))
    maskText(c, text)
    const at = performance.now()
    maskText(c, text)
    expect({ form, fast: performance.now() - at < 50 }).toEqual({ form, fast: true })
  }
})

test('every email and phone sample is hidden', () => {
  const c = compile('on', [], null)
  for (const s of [...EMAILS, ...PHONES]) expect(maskText(c, s.text)).toBe(s.masked)
  expect(maskText(c, 'call (415) 555-0132 or mail ops@example.io')).toBe('call ‹phone› or mail ‹email›')
})

test('every left-alone sample is unchanged, the amount below strict only', () => {
  const on = compile('on', [], null)
  for (const t of LEFT_ALONE) expect(maskText(on, t)).toBe(t)
  const strict = compile('strict', [], '/Users/jane')
  for (const t of LEFT_ALONE.filter(t => !t.startsWith('$'))) expect(maskText(strict, t)).toBe(t)
})

test('strict hides home paths, the account and amounts', () => {
  const unix = compile('strict', [], '/Users/jane')
  expect(maskText(unix, '/Users/jane/src')).toBe('~/src')
  expect(maskText(unix, 'jane wrote it, not janet')).toBe('‹user› wrote it, not janet')
  for (const s of AMOUNTS) expect(maskText(unix, s.text)).toBe(s.masked)
  for (const s of strictSamples('/Users/jane')) expect(maskText(unix, s.text)).toBe(s.masked)
  const windows = compile('strict', [], 'C:\\Users\\jane')
  expect(maskText(windows, 'C:\\Users\\jane\\src')).toBe('~\\src')
  for (const s of strictSamples('C:\\Users\\jane')) expect(maskText(windows, s.text)).toBe(s.masked)
  // Below strict, none of these
  const on = compile('on', [], '/Users/jane')
  expect(maskText(on, '/Users/jane/src $3.12')).toBe('/Users/jane/src $3.12')
})

test('a home folder matches case-insensitively on Windows only', () => {
  expect(maskText(compile('strict', [], 'C:\\Users\\jane'), 'C:\\USERS\\JANE\\src')).toBe('~\\src')
  // The account still hides as a whole word, but the prefix is not the home on macOS and Linux
  expect(maskText(compile('strict', [], '/Users/jane'), '/USERS/JANE/src')).toBe('/USERS/‹user›/src')
})

// Git Bash on Windows sets HOME to /c/Users/jane while Claude Code and Windows tools print C:\Users\jane
test("a Git Bash home hides its Windows form too, and a Windows home its Git Bash form, either case", () => {
  const bash = compile('strict', [], '/c/Users/jane')
  expect(maskText(bash, 'C:\\Users\\jane\\src and C:/USERS/JANE/x and /c/Users/jane/y')).toBe('~\\src and ~/x and ~/y')
  const windows = compile('strict', [], 'C:\\Users\\jane')
  expect(maskText(windows, 'cd /c/Users/jane/src')).toBe('cd ~/src')
  // A macOS or Linux home has no Windows form: /Users/jane is no drive path
  expect(maskText(compile('strict', [], '/Users/jane'), 'U:/jane/x')).toBe('U:/‹user›/x')
})

test('a name under 3 characters is not hidden as the account', () => {
  expect(maskText(compile('strict', [], '/home/jo'), 'jo and /home/jo/x')).toBe('jo and ~/x')
})

test('private words hide inside longer words, case-insensitively', () => {
  const c = compile('on', ['Acme'], null)
  expect(maskText(c, 'AcmeCorp and acme-api')).toBe('‹private›Corp and ‹private›-api')
  // The longest word at a start wins
  expect(maskText(compile('on', ['ab', 'abcd'], null), 'xabcdx')).toBe('x‹private›x')
})

test('a private word key leaves a ‹key› token whole', () => {
  const c = compile('on', ['key'], null)
  expect(maskText(c, KEYS[2]!.text)).toBe('‹key›')
  expect(maskText(c, 'API_KEY=hunter2hunter2')).toBe('API_‹private›=‹key›')
})

test('off returns its input', () => {
  const c = compile('off', ['Acme'], '/Users/jane')
  const text = `Acme ${KEYS[0]!.text} /Users/jane`
  expect(maskText(c, text)).toBe(text)
})

test('one pass never re-scans a token', () => {
  const c = compile('on', ['email', 'phone'], null)
  expect(maskText(c, 'jane.doe@example.com +1 415 555 0132')).toBe('‹email› ‹phone›')
})

test('masking a masked string changes nothing', () => {
  const c = compile('strict', ['key', 'private', 'user', 'Acme'], '/Users/jane')
  const text = [...KEYS, ...EMAILS, ...PHONES, ...AMOUNTS].map(s => s.text).join(' | ') + ' Acme jane /Users/jane/x'
  const once = maskText(c, text)
  expect(once).not.toContain('Acme')
  expect(maskText(c, once)).toBe(once)
  expect(maskText(c, '‹email 2› and ‹user›')).toBe('‹email 2› and ‹user›')
})

// Linear reads about 10 (10.1 to 10.5 alone, 2026-11-04) and quadratic about 100. The suite's parallel test processes
// pushed a ratio timed one size after the other to 25.5, so the sizes are timed in turn, each its best of 7, and the
// bound sits between the noise and quadratic
test("a 1 MB line masks in under 40 times a 100 kB line's time", () => {
  const c = compile('on', Array.from({ length: 100 }, (_, i) => `wrd${i}q`), null)
  const small = base64(100_000)
  const big = base64(1_000_000)
  maskText(c, small)
  maskText(c, big)
  const once = (text: string): number => {
    const at = performance.now()
    maskText(c, text)
    return performance.now() - at
  }
  let bestSmall = Infinity
  let bestBig = Infinity
  for (let i = 0; i < 7; i++) {
    bestSmall = Math.min(bestSmall, once(small))
    bestBig = Math.min(bestBig, once(big))
  }
  expect(bestBig / bestSmall).toBeLessThan(40)
})

test('a second mask of the same string is the cached result', () => {
  withRec('on', [], null, () => {
    const text = `token ${KEYS[2]!.text}`
    const before = maskStats().passes
    expect(mask(text)).toBe('token ‹key›')
    expect(mask(text)).toBe('token ‹key›')
    expect(maskStats().passes - before).toBe(1)
  })
})

test('a level or word change empties the cache', () => {
  withRec('on', [], null, () => {
    expect(mask('Acme')).toBe('Acme')
    setRec('on', ['Acme'], null)
    expect(mask('Acme')).toBe('‹private›')
    expect(recLevel()).toBe('on')
  })
  expect(recLevel()).toBe('off')
  expect(mask('Acme')).toBe('Acme')
})

test('maskForFile hides keys, emails and phones and keeps private words and home paths', () => {
  const text = `Acme ${KEYS[0]!.text} jane.doe@example.com +1 415 555 0132 /Users/jane/src $3.12`
  const want = 'Acme ‹key› ‹email› ‹phone› /Users/jane/src $3.12'
  withRec('strict', ['Acme'], '/Users/jane', () => expect(maskForFile(text)).toBe(want))
  expect(maskForFile(text)).toBe(want)
})

test('fitLine masks before it cuts, and never splits a token', () => {
  withRec('on', [], null, () => {
    // Cut raw at 40, the email would show its first characters
    expect(fitLine(`${'x'.repeat(35)} jane.doe@example.com`, 40)).toBe(`${'x'.repeat(35)}…`)
    // Masked first, the line fits whole where the raw one would be cut inside the key
    expect(fitLine(`${'y'.repeat(50)} ${KEYS[2]!.text}`, 60)).toBe(`${'y'.repeat(50)} ‹key›`)
  })
})

test('oneLine stays raw with REC on, and widthOf measures the masked text', () => {
  withRec('on', ['Acme'], null, () => {
    expect(oneLine('jane.doe@example.com', 80)).toBe('jane.doe@example.com')
    expect(widthOf([{ text: 'Acme' }, { text: ' x' }])).toBe(11)
  })
  expect(widthOf([{ text: 'Acme' }, { text: ' x' }])).toBe(6)
})
