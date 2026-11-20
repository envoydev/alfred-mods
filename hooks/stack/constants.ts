// The stack folder's named values

// The largest token count a status file field may hold: a context window, the auto-compact point, the resume point
export const MAX_TOKENS = 10_000_000

// The smallest context window, and the smallest resume point, a status file may give
export const MIN_WINDOW = 1000

// The fill's toasts (spec 'The fill'), none carrying the prompt's text
export const STACK_TOASTS = {
  filled: "Alfred Code's resume prompt filled - Enter in the prompt box sends it",
  notEmpty: "Prompt not empty: clear it, then press f to fill Alfred Code's resume prompt",
  dialog: 'A dialog holds the keys: close it, then press f again',
  noBox: 'No prompt box here to fill',
  notFilled: "Alfred Code's resume prompt was not filled",
  unanswered: 'The app did not answer in time: press f again',
  gone: 'Alfred Code has no resume prompt now',
}

// A refusal's toast by the fill's refusal; one a later build adds reads as not filled
export const FILL_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['dialog', STACK_TOASTS.dialog],
  ['no_composer', STACK_TOASTS.noBox],
  ['unanswered', STACK_TOASTS.unanswered],
])
