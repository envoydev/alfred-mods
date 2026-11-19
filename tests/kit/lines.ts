// The kit's status line as the engine frames it for a UserPromptSubmit hook: claude-kit's `.claude/kit/status-hook.mjs`
// run in a scratch project (measured 2026-11-19), with auto_run and auto_approve on in its settings file. Every expected
// value in the kit tests is read off these lines.
const FRAME = 'UserPromptSubmit hook additional context: '

// A prompt that saves nothing
export const LINE = `${FRAME}kit status (.claude/kit/status-hook.mjs): auto_run=on (.claude/kit/settings.json); scoring=on (default); pass_score=90 (default); auto_approve=on (.claude/kit/settings.json); plan_model=opus (the audit-planner agent's own); audit_model=opus (plan_model); review_model=opus (the plan-grader agent's own); implement_model=sonnet (the audit-editor agent's own); search_model=haiku (default);`

// The prompt 'scoring off', which the hook saved
export const LINE_SAVED = `${FRAME}kit status (.claude/kit/status-hook.mjs): auto_run=on (.claude/kit/settings.json); scoring=off (.claude/kit/settings.json); pass_score=90 (default); auto_approve=on (.claude/kit/settings.json); plan_model=opus (the audit-planner agent's own); audit_model=opus (plan_model); review_model=opus (the plan-grader agent's own); implement_model=sonnet (the audit-editor agent's own); search_model=haiku (default); saved: scoring=off in .claude/kit/settings.json;`

// The same prompt from a hook outside <root>/.claude/kit, which refuses the save
export const LINE_NOT_SAVED = `${FRAME}kit status (.claude/kit/status-hook.mjs): auto_run=off (default); scoring=on (default); pass_score=90 (default); auto_approve=off (default); plan_model=none (.claude/agents/audit-planner.md names no model - pass no model); audit_model=none (plan_model); review_model=none (.claude/agents/plan-grader.md names no model - pass no model); implement_model=none (.claude/agents/audit-editor.md names no model - pass no model); search_model=haiku (default); not saved - saving changes the file of the repo this script is installed in: run .claude/kit/settings.mjs there, not from a checkout;`
