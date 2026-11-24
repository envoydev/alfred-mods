// The band's leading lines (spec 2026-11-23, D4, as the user arranged them on 2026-11-24): `● REC`, the signed-in account,
// Claude Code's version, the MCP item and the new failures, then the modes on. Pure: values in, lines out.
import { fitLine, widthOf } from '../core/format'
import { ORG_STRICT, PERSONAL } from '../account/constants'
import type { Line, Seg } from '../core/types'
import { CC_LABEL, ORG_JOIN, ORG_LABEL, ORG_MAX_CELLS, ORG_UNKNOWN, ROW_JOIN } from './constants'
import type { BandInput, ModesKeep } from './types'

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

const MARK_SEP: Seg = { text: ROW_JOIN, tone: 'dim' }
const DIM_JOIN: Seg = { text: ORG_JOIN, tone: 'dim' }
const joinItems = (items: Line[]): Line => items.filter(item => item.length > 0).flatMap((item, i) => (i === 0 ? item : [MARK_SEP, ...item]))

// The signed-in account's mark, as the Claude mobile app names it: '<company name> | Team' (or Enterprise), 'org | Personal'
// or 'org | unknown'. A company name is cut to 40 cells and draws '‹org›' under REC strict; one with no known kind
// reads its name alone. None without an account. The name is plain; the label, the bar and the kind are dim.
function orgMark(input: BandInput): Line {
  const account = input.account
  if (account === undefined) return []
  const dim = (text: string): Seg => ({ text, tone: 'dim' })
  if (account.org === null) return [dim(ORG_LABEL), dim(ORG_JOIN), dim(ORG_UNKNOWN)]
  if (account.kind === PERSONAL || ((account.kind === undefined || account.kind === null) && account.org === PERSONAL)) return [dim(ORG_LABEL), dim(ORG_JOIN), dim(PERSONAL)]
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

// The lines that lead the band, each only when it holds something: the identity, then the modes on a line of their own
// ('own'), or after the identity on line 1 where the two fit the width, else the identity alone ('joined')
export function leadLines(input: BandInput, modesKeep: ModesKeep, failures: Line = []): Line[] {
  const identity = identityLine(input, failures)
  const modes = input.modes ?? []
  if (modesKeep === 'own') return [identity, modes].filter(line => line.length > 0)
  const joined = joinItems([identity, modes])
  return joined.length === 0 ? [] : [widthOf(joined) <= input.columns ? joined : identity].filter(line => line.length > 0)
}
