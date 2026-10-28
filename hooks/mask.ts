import type { EngineInterface } from 'claude-code'

// The one seam every drawn string and every toast passes through. It changes nothing in Phase 1; REC (Phase 4)
// masks what is on screen here.
export function mask(text: string): string {
  return text
}

// Every toast of the mod goes through here, so it is masked like any drawn string.
export function toast($: EngineInterface, text: string): void {
  $.ui.toast(mask(text))
}
