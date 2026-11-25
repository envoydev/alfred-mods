// The tools folder's named values

// The columns a row is drawn to when the event carries no viewport
export const DEFAULT_COLUMNS = 120

// The tools that write a file: a call of one moves the project's place and may change a plan
export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']

// The status a row the mod draws for a call still running reads
export const RUNNING_STATUS = 'running…'

// The status of a call that has not run yet: held at the permission dialog, or queued
export const WAITING_STATUS = 'waiting…'


// `next.origin.plugin` of a call the mod raises itself, such as the question `$.ui.ask` puts: no call of the session's
export const OWN_PLUGIN = 'alfred-mods'
