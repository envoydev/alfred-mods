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

// The kit's stub of `$.tool.list()`, which the MCP state reads for the servers whose tools show: `names` is what the list
// holds now, a test changes it mid-test; a name starting `mcp__` is an MCP server's tool; `refuse` makes the call fail
export type ToolsStub = { names: string[]; calls: number; refuse: boolean }

export function stubTools(on: On, names: string[] = []): ToolsStub {
  const tools: ToolsStub = { names, calls: 0, refuse: false }
  on('tool.list', () => {
    tools.calls++
    if (tools.refuse) return { deny: 'test: tool list refused' }
    return { value: tools.names.map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })) }
  })
  return tools
}
