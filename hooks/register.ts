// The session-inspector hooks module. It registers no hook yet: the build starts after the Phase 0 probe's verdict
// is approved (docs/session-inspector-brief.md). Every hook it gains observes and draws; it never approves, denies or
// rewrites a tool call.
export function register(on: unknown): void {}
