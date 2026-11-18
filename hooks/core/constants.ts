// The named values the folders share

// The model families the mod names and colours, in the order the Agents tab counts them
export const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const

// A model id's family and its version's two numbers: 'claude-opus-5-5' is opus 5.5
export const MODEL_ID = new RegExp(`(${FAMILIES.join('|')})(?:-(\\d+)(?:-(\\d+))?)?`)

// A hotkey of one digit, which also answers from the empty prompt
export const DIGIT_HOTKEY = /^\d$/

