// The trace a scripted session left on the base of the hooks restructure (2026-11-13): every later task leaves it as is,
// but the `prompt` record's two writes (a main turn's start and a start-over's reset), added 2026-11-19
export const GOLDEN: null | Record<string, string[]> = {
  state: [
    'rec', 'quiet', 'band', 'handoff', 'stack', 'handoff', 'usage', 'session', 'session', 'session', 'cache', 'plans',
    'stack', 'handoff', 'session', 'plans', 'session', 'credit', 'session', 'prompt', 'live', 'session', 'totals', 'cache', 'usage',
    'live', 'stats', 'live', 'session', 'session', 'agents', 'credit', 'turns', 'session', 'live', 'usage', 'usage', 'pace',
    'handoff', 'handoff', 'session', 'cache', 'view', 'failures', 'session', 'plans', 'tick', 'tick', 'tick', 'tick',
    'usage', 'tick', '-- clear', 'stats', 'failures', 'turns', 'live', 'usage', 'totals', 'session', 'view', 'pace',
    'agents', 'cache', 'tick', 'plans', 'credit', 'tasks', 'rec', 'quiet', 'handoff', 'stack', 'blockers', 'parts',
    'loops', 'prompt', 'rec', 'quiet', 'band', 'handoff', 'stack', 'handoff', 'plans', 'usage', 'session', 'session', 'session',
    'cache', 'session', 'session', 'plans'
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
