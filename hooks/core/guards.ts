// The checks a value read from outside passes before it is used

// A plain record: an object, not null and not an array
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
