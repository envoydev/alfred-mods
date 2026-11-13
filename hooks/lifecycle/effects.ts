// The lifecycle folder's effects: what it reads and writes through $

// The conversation the mod last started, by session id, and the start-over running. A /clear, a resume or a branch goes
// on under a new id: classic.SessionStart starts it over, and where a managed plugin keeps that hook from the mod, the
// tick or the next prompt does once it reads the new id. The id is null until session.start.
export const conversationMem = { id: null as string | null, starting: null as Promise<void> | null }

// The clock's minute the last tick saw: the full band's info line shows the session's time, which moves while idle
export const tickMem = { minute: -1 }


