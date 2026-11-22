// claude-kit's settings file as the kit keeps it (`.claude/kit/settings.json`, claude-kit 8af3151): all nine names, with
// auto_run and auto_approve on. Every expected value in the kit tests is read off it.
export const SETTINGS = {
  auto_run: 'on', auto_approve: 'on', plan_model: 'opus', audit_model: 'opus', review_model: 'opus', implement_model: 'sonnet', search_model: 'haiku',
  pass_score: 90, scoring: 'on',
}
export const SETTINGS_TEXT = `${JSON.stringify(SETTINGS, null, 2)}\n`
export const SETTINGS_PATH = '.claude/kit/settings.json'

// The same names as the mod keeps them once read
export const KIT_VALUES: Record<string, string | number> = { ...SETTINGS }
