// The band's two leading lines (spec 2026-11-23, D4): identity - `● REC` and the signed-in account - and modes - Alfred
// Code's banner, claude-kit's and the MCP item. Pure: values in, lines out.
import { cutMasked, fitLine, maskedText, widthOf } from '../core/format'
import { ORG_STRICT, PERSONAL } from '../account/constants'
import type { Line, Seg } from '../core/types'
import { KIT_SHORT, ORG_JOIN, ORG_LABEL, ORG_MAX_CELLS, ORG_UNKNOWN, ROW_JOIN } from './constants'
import type { BandInput, ModesKeep } from './types'

export const REC_MARK: Seg = { text: '● REC', tone: 'fail', bold: true }

const MARK_SEP: Seg = { text: ROW_JOIN, tone: 'dim' }
const joinItems = (items: Line[]): Line => items.filter(item => item.length > 0).flatMap((item, i) => (i === 0 ? item : [MARK_SEP, ...item]))

// A line cut to `max` cells and ending with an ellipsis, as drawn: measured and cut on the masked text, so a secret shows
// no prefix. A segment past the cut keeps its tone and the ones after it go; a cut on a segment's edge puts the
// ellipsis in place of the last cell.
function cutLine(line: Line, max: number): Line {
  if (widthOf(line) <= max) return line
  const out: Line = []
  let left = max
  let isCut = false
  for (const seg of line) {
    const width = widthOf([seg])
    if (width <= left) {
      out.push(seg)
      left -= width
      continue
    }
    if ('text' in seg && left > 0) {
      out.push({ ...seg, text: cutMasked(maskedText(seg.text), left) })
      isCut = true
    }
    break
  }
  const last = out.at(-1)
  if (isCut || last === undefined || !('text' in last)) return out
  return [...out.slice(0, -1), { ...last, text: `${maskedText(last.text).slice(0, -1)}…` }]
}

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

// Line 1: REC while it is on, then the account. Never cut for width.
export function identityLine(input: BandInput): Line {
  return joinItems([input.rec !== undefined && input.rec.level !== 'off' ? [REC_MARK] : [], orgMark(input)])
}

// Line 2: Alfred Code's banner, claude-kit's, then the MCP item, within the band's width. The kit banner yields first: its
// full form, then `kit`, then none. Alfred Code's banner is cut only when it and the MCP item alone overflow.
export function modesLine(input: BandInput): Line {
  const banner = input.banner ?? []
  const kit = input.kitBanner ?? []
  const mcp = input.mcp ?? []
  for (const form of kit.length === 0 ? [[]] : [kit, KIT_SHORT, []]) {
    const line = joinItems([banner, form, mcp])
    if (widthOf(line) <= input.columns) return line
  }
  if (banner.length === 0) return cutLine(mcp, input.columns)
  const tail: Line = mcp.length === 0 ? [] : [MARK_SEP, ...mcp]
  return cutLine([...cutLine(banner, Math.max(1, input.columns - widthOf(tail))), ...tail], input.columns)
}

// The lines that lead the band, each only when it holds something. `own`: modes on a line of their own; `joined`: after
// the identity on one line where the two fit, else none; `off`: none.
export function leadLines(input: BandInput, modes: ModesKeep): Line[] {
  const identity = identityLine(input)
  const own = modes === 'off' ? [] : modesLine(input)
  if (modes === 'own') return [identity, own].filter(line => line.length > 0)
  const joined = identity.length === 0 || own.length === 0 ? identity : [...identity, MARK_SEP, ...own]
  return joined.length > 0 ? [widthOf(joined) <= input.columns ? joined : identity] : []
}
