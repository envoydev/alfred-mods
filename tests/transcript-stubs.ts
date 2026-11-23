// The kit's stub of `$.session.info()`, which answers the transcript file's path: a string, or none (an empty path, as
// a session that keeps no transcript on this machine answers), or a build that lacks the call, which rejects
import type { On } from 'claude-code'

export type TranscriptOptions = { transcriptPath?: string | null; sessionInfoThrows?: boolean }

export function stubTranscript(on: On, o: TranscriptOptions = {}): void {
  on('session.info', () => {
    if (o.sessionInfoThrows === true) return { deny: 'test: session.info missing' }
    return { value: { transcriptPath: o.transcriptPath ?? '' } as never }
  })
}
