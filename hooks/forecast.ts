// Forecasts from the readings so far: turns left before the context reaches 80%, a window's pace, a sparkline.
import type { PacePoint } from '../types'

const BLOCKS = '▁▂▃▄▅▆▇'

// From the mean growth of the last up to 5 turns; null with under 3 points, at or past the threshold, or no growth
export function turnsLeft(percents: number[], threshold = 80): number | null {
  const last = percents[percents.length - 1]
  if (percents.length < 3 || last === undefined || last >= threshold) return null
  const recent = percents.slice(-6)
  const deltas = recent.slice(1).map((p, i) => p - (recent[i] ?? p))
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length
  return mean > 0 ? Math.ceil((threshold - last) / mean) : null
}

// When a window reaches 100% at the rate from its first point to its last, if that comes before it resets
export function pace(points: PacePoint[], resetsAt: number | null, now: number): 'on-pace' | { limitAt: number } | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length < 3 || first === undefined || last === undefined || last.at <= first.at || now < last.at) return null
  const rise = last.percent - first.percent
  if (rise <= 0) return 'on-pace'
  const limitAt = last.at + (100 - last.percent) * (last.at - first.at) / rise
  return resetsAt === null || limitAt < resetsAt ? { limitAt } : 'on-pace'
}

export function spark(values: number[]): string {
  return values.map(v => BLOCKS[Math.max(0, Math.min(6, Math.floor(v * 7 / 100)))]).join('')
}

export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
