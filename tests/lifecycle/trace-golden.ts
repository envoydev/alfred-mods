// The trace a scripted session left on the base of the hooks restructure (2026-11-13): every later task leaves it as is
export const GOLDEN: null | Record<string, string[]> = {
  state: [
    'rec', 'quiet', 'band', 'handoff', 'stack', 'handoff', 'usage', 'meta', 'meta', 'meta', 'cache', 'plans',
    'stack', 'handoff', 'meta', 'plans', 'meta', 'credit', 'meta', 'live', 'meta', 'totals', 'cache', 'usage',
    'live', 'stats', 'live', 'meta', 'meta', 'agents', 'credit', 'turns', 'meta', 'live', 'usage', 'usage', 'pace',
    'handoff', 'handoff', 'meta', 'cache', 'view', 'failures', 'meta', 'plans', 'tick', 'tick', 'tick', 'tick',
    'usage', 'tick', '-- clear', 'stats', 'failures', 'turns', 'live', 'usage', 'totals', 'meta', 'view', 'pace',
    'agents', 'cache', 'tick', 'plans', 'credit', 'tasks', 'rec', 'quiet', 'handoff', 'stack', 'blockers', 'parts',
    'loops', 'rec', 'quiet', 'band', 'handoff', 'stack', 'handoff', 'plans', 'usage', 'meta', 'meta', 'meta',
    'cache', 'meta', 'meta', 'plans'
  ],
  toasts: [

  ],
  statuses: [
    '(clear)'
  ],
  store: [
    'set cost-last:s1', 'set cost:<day>:s1', 'set cost-last:s1', 'set usage:windows', 'set cost-last:s2'
  ],
  invalidates: [

  ],
  opened: [
    'inspect'
  ],
}
