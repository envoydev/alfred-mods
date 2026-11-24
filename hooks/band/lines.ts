// The band's leading line (spec 2026-11-23, D4, as the user arranged it on 2026-11-24): `● REC`, the signed-in account and
// Claude Code's version. Pure: values in, lines out.
import { fitLine, widthOf } from '../core/format'
import { ORG_STRICT, PERSONAL } from '../account/constants'
import type { Line, Seg } from '../core/types'
import { CC_LABEL, ORG_JOIN, ORG_LABEL, ORG_MAX_CELLS, ORG_UNKNOWN, ROW_JOIN } from './constants'
import type { BandInput } from './types'

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

// Line 1: REC while it is on, then the account and Claude Code's version ('Acme | Team | CC 2.1.331', the user,
// 2026-11-24). Never cut for width: the version goes where the line would pass the band's width.
export function identityLine(input: BandInput): Line {
  const rec = input.rec !== undefined && input.rec.level !== 'off' ? [REC_MARK] : []
  const org = orgMark(input)
  const version = input.session.version
  const withVersion = version === undefined ? org : [...org, ...(org.length === 0 ? [] : [DIM_JOIN]), { text: `${CC_LABEL} ${version}`, tone: 'dim' as const }]
  const full = joinItems([rec, withVersion])
  return widthOf(full) <= input.columns ? full : joinItems([rec, org])
}

// The lines that lead the band: the identity line, when it holds something
export function leadLines(input: BandInput): Line[] {
  const identity = identityLine(input)
  return identity.length > 0 ? [identity] : []
}
