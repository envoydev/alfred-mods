// The fake samples REC's `/rec test` runs and the tests pin, one set per class (spec Acceptance). Every provider-shaped
// one is assembled from parts at runtime, so no file of this public repo holds a literal a secret scanner would flag.
export type Sample = { text: string; masked: string }

const whole = (text: string, token: string): Sample => ({ text, masked: token })
const key = (text: string): Sample => whole(text, '‹key›')

export const KEYS: Sample[] = [
  key('sk-' + 'ant-api03-' + 'Ab3d'.repeat(10)),
  key('sk-' + 'proj-' + 'Qx7z'.repeat(10)),
  key('gh' + 'p_' + 'aB3'.repeat(12)),
  key('github' + '_pat_' + '11' + 'AbC4'.repeat(15)),
  key('xo' + 'xb-' + '1234567890' + '-' + '0987654321' + '-' + 'aBcD'.repeat(6)),
  // AWS's own documented example key id
  key('AK' + 'IA' + 'IOSFODNN7' + 'EXAMPLE'),
  key('AI' + 'za' + 'Sy' + 'B'.repeat(33)),
  key('sk' + '_live_' + 'Ab12'.repeat(6)),
  key('ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'JzdWIiOiIxMjM0In0' + '.' + 'abcDEF123_-xyzXYZ789'),
  key('-----BEGIN ' + 'OPENSSH PRIV' + 'ATE KEY-----\n' + 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n' + '-----END ' + 'OPENSSH PRIV' + 'ATE KEY-----'),
  { text: 'Authorization: ' + 'Bearer ' + 'abcdefghijklmnop1234', masked: 'Authorization: Bearer ‹key›' },
  { text: 'API_KEY=' + 'hunter2hunter2', masked: 'API_KEY=‹key›' },
  { text: '"password": "' + 'correct-horse"', masked: '"password": "‹key›"' },
]

export const EMAILS: Sample[] = ['jane.doe@example.com', 'a+b@sub.example.co.uk', 'ops@example.io'].map(t => whole(t, '‹email›'))

export const PHONES: Sample[] = [
  '+1 415 555 0132', '+44 20 7946 0958', '(415) 555-0132', '415-555-0132', '+380 44 123 4567', '+4915123456789',
].map(t => whole(t, '‹phone›'))

// Shown at every level; the last, an amount, only below strict
export const LEFT_ALONE: string[] = [
  'c50c7aa', 'c50c7aa' + '0123456789abcdef0123456789abcdef0', '14:05', '2026-10-28', '(28.10 16:15)', '2.1.312',
  '180k cached', '1,234,567 tokens', 'localhost:8080', 'src/auth/refresh.ts', 'https://example.com/a?b=1',
  '123e4567-e89b-12d3-a456-426614174000', '12345678901', '10.100.200.150', '$3.12',
]

export const AMOUNTS: Sample[] = [
  { text: '$3.12', masked: '$•.••' }, { text: '≈ $1.44', masked: '≈ $•.••' }, { text: '$1,204.50', masked: '$•,•••.••' },
]

// Strict's home paths and account, from the home folder: the prefix with either separator, and the name alone
export function strictSamples(home: string): Sample[] {
  const name = home.split(/[\\/]/).filter(s => s !== '').pop() ?? ''
  return [
    { text: `${home.replace(/\\/g, '/')}/src`, masked: '~/src' },
    { text: `${home.replace(/\//g, '\\')}\\src`, masked: '~\\src' },
    ...(name.length >= 3 ? [{ text: `by ${name} today`, masked: 'by ‹user› today' }] : []),
  ]
}
