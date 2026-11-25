// The band's identity line (spec 2026-11-23, D4, as the user arranged it on 2026-11-24): `● REC`, the signed-in account,
// Claude Code's version, the MCP item and the new failures; and the modes lines, one per source (the user, 2026-11-25).
// Pure: values in, lines out.
import { fitLine, widthOf } from '../core/format'
import { ORG_STRICT, PERSONAL } from '../account/constants'
import type { Line, Seg } from '../core/types'
import { CC_LABEL, ORG_JOIN, ORG_LABEL, ORG_MAX_CELLS, ORG_UNKNOWN, ROW_JOIN, MODES_JOIN, SOURCE_LABELS, SOURCE_LABEL_CELLS } from './constants'
import type { BandInput, ModesKeep } from './types'

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

const MARK_SEP: Seg = { text: ROW_JOIN, tone: 'dim' }
const DIM_JOIN: Seg = { text: ORG_JOIN, tone: 'dim' }
const joinItems = (items: Line[]): Line => items.filter(item => item.length > 0).flatMap((item, i) => (i === 0 ? item : [MARK_SEP, ...item]))

// The signed-in account's mark: '<company name> | Team' (or Enterprise), 'Personal' with no label where there is no
// organization (the user, 2026-11-25), or 'org | unknown'. A company name is cut to 40 cells and draws '‹org›' under REC
// strict; one with no known kind reads its name alone. None without an account. A company name is plain; the rest is dim.
function orgMark(input: BandInput): Line {
  const account = input.account
  if (account === undefined) return []
  const dim = (text: string): Seg => ({ text, tone: 'dim' })
  if (account.org === null) return [dim(ORG_LABEL), dim(ORG_JOIN), dim(ORG_UNKNOWN)]
  if (account.kind === PERSONAL || ((account.kind === undefined || account.kind === null) && account.org === PERSONAL)) return [dim(PERSONAL)]
  const name = input.rec?.level === 'strict' ? ORG_STRICT : fitLine(account.org, ORG_MAX_CELLS)
  return account.kind === undefined || account.kind === null ? [{ text: name }] : [{ text: name }, dim(ORG_JOIN), dim(account.kind)]
}

// Line 1: REC while it is on, the account and Claude Code's version, the MCP item, then the new failures with their
// button ('Acme | Team | CC 2.1.330 │ mcp ✗ 1 · ✓ 10 │ ✗ 6 new 1: Inspect', the user, 2026-11-24). Where it would pass
// the band's width the version goes first, then the MCP item; REC, the account and the failures always stay.
export function identityLine(input: BandInput, failures: Line = []): Line {
  const rec = input.rec !== undefined && input.rec.level !== 'off' ? [REC_MARK] : []
  const org = orgMark(input)
  const version = input.session.version
  const withVersion = version === undefined ? org : [...org, ...(org.length === 0 ? [] : [DIM_JOIN]), { text: `${CC_LABEL} ${version}`, tone: 'dim' as const }]
  const mcp = input.mcp ?? []
  const forms = [joinItems([rec, withVersion, mcp, failures]), joinItems([rec, org, mcp, failures]), joinItems([rec, org, failures])]
  return forms.find(form => widthOf(form) <= input.columns) ?? forms[forms.length - 1] ?? []
}

const labelled = (label: string, line: Line): Line => [{ text: `${label} `, tone: 'dim' }, ...line]

// claude-kit's line: its modes, then its models where the two fit the width, else the models on a line under them
function kitLines(input: BandInput): Line[] {
  const modes = input.kitModes ?? []
  const models = input.models ?? []
  if (modes.length === 0) return models.length === 0 ? [] : [labelled(SOURCE_LABELS.kit, models)]
  if (models.length === 0) return [labelled(SOURCE_LABELS.kit, modes)]
  const beside = labelled(SOURCE_LABELS.kit, [...modes, { text: MODES_JOIN, tone: 'dim' }, ...models])
  return widthOf(beside) <= input.columns ? [beside] : [labelled(SOURCE_LABELS.kit, modes), [{ text: ' '.repeat(SOURCE_LABEL_CELLS - 1) }, ...models]]
}

// The modes lines (the user, 2026-11-25): 'alfred-code: <its modes>' and 'claude-kit: <its modes> · <its models>', each
// only when it holds something. Short of rows ('joined') the two share one line with no models, or the first that fits.
export function sourceLines(input: BandInput, keep: ModesKeep): Line[] {
  if (keep === 'none') return []
  const alfred = input.alfredModes ?? []
  const alfredLine = alfred.length === 0 ? [] : labelled(SOURCE_LABELS.alfredCode, alfred)
  if (keep === 'own') return [alfredLine, ...kitLines(input)].filter(line => line.length > 0)
  const kit = input.kitModes ?? []
  const kitLine = kit.length === 0 ? [] : labelled(SOURCE_LABELS.kit, kit)
  const form = [joinItems([alfredLine, kitLine]), alfredLine, kitLine].find(line => line.length > 0 && widthOf(line) <= input.columns)
  return form === undefined ? [] : [form]
}

// The line that leads the band: the identity, when it holds something
export function leadLines(input: BandInput, failures: Line = []): Line[] {
  const identity = identityLine(input, failures)
  return identity.length === 0 ? [] : [identity]
}
