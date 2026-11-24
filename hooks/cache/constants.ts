import type { RenderSurface } from 'claude-code'

// The surfaces where Claude Code compacts an idle conversation itself: an interactive terminal session, VS Code's chat
// panel and the desktop app's Code tab, when the session runs on the machine or over SSH (settings-reference, `idleCompaction`, read 2026-11-19). A cloud
// session drawn in the desktop app counts too, as no API tells it apart: its warning then comes at 3 minutes, not 5
export const IDLE_COMPACT_SURFACES: ReadonlySet<RenderSurface> = new Set<RenderSurface>(['terminal', 'vscode', 'desktop'])

// The longest one wait of the toast's timer: a toast due later re-reads when it is due at each hop, so no single wait
// spans an hour of the clock's ticks (a test clock answers a wait inside the 10 s hook budget)
export const TOAST_HOP_MS = 5 * 60_000
