import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface, SessionUsage } from 'claude-code'

import { SPAWN, SPINNER, START, engine, rows, spawns, step, stepEngine, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const AT_17: SessionUsage = { startedAt: 0, context: { window: 200_000, tokens: 34_000, percent: 17 }, rateLimits: [] }
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000, model: 'claude-haiku-5-5' }
// Grep is not among this build's typed tools (its search runs through Bash), but other builds call it
const grep = (more: object = {}) => ({ tool: 'Grep', pattern: 'AuthService', ...more }) as never

const spinner = ($: Engine, surface: RenderSurface, requestId: string) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Spinner', requestId, props: SPINNER })

// Claude Code's own spinner: the word and the suffix; and every call held for a minute
function engineSpinner(on: On, clock: { sleep: (ms: number) => Promise<void> }): void {
  on('ui.render', { component: 'Spinner' }, (h$, e) => {
    const { Text } = h$.ui.resolve(e)
    return h(Text, null, e.props.word + e.props.suffix) as RenderElement
  })
  on('tool.call', async () => {
    await clock.sleep(60_000)
    return { result: 'ok', text: 'ok' }
  })
}

for (const surface of SURFACES) {
  test(`the main spinner shows its action, context and the agent count (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: AT_17 })
    engineSpinner(on, clock)
    engine(on, ['tool.call', 'agent.spawn'])
    spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' } })
    await $.session.start(START)
    await $.agent.spawn({ ...SPAWN, description: 'one' })
    await $.agent.spawn({ ...SPAWN, description: 'two' })
    void $.tool.call(grep())
    await clock.settle()

    expect(await rows(await spinner($, surface, 'main'))).toEqual(['Sauteing… Grep AuthService · 17% · 2 agents'])
  })

  test(`with nothing to add the spinner is the engine's own (${surface})`, async ($, on) => {
    const { clock } = stubAll(on)
    engineSpinner(on, clock)
    engine(on, ['tool.call'])

    expect(await rows(await spinner($, surface, 'main'))).toEqual(['Sauteing…'])
  })

  test(`an agent's spinner shows that agent's action and context (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: AT_17 })
    engineSpinner(on, clock)
    engine(on, ['tool.call'])
    stepEngine(on, () => USAGE)
    await $.agent.spawn(SPAWN)
    await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', messageCount: 3, agentId: 'a1' })
    void $.tool.call(grep({ agentId: 'a1' }))
    await clock.settle()

    expect(await rows(await spinner($, surface, 'a1'))).toEqual(['Sauteing… Grep AuthService · ctx 31k'])
  })

  test(`the spinner suffix is one clean line (${surface})`, async ($, on) => {
    const { clock } = stubAll(on, { usage: AT_17 })
    engineSpinner(on, clock)
    engine(on, ['tool.call'])
    await $.session.start(START)
    void $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run \x1b[31mred\x1b[0m tests\nmore' })
    await clock.settle()

    expect(await rows(await spinner($, surface, 'main'))).toEqual(['Sauteing… Bash Run red tests · 17%'])
  })

  test(`a long action is cut to 40 characters (${surface})`, async ($, on) => {
    const { clock } = stubAll(on)
    engineSpinner(on, clock)
    engine(on, ['tool.call'])
    void $.tool.call({ tool: 'Bash', command: 'npm test', description: 'x'.repeat(80) })
    await clock.settle()

    const [line] = await rows(await spinner($, surface, 'main'))
    const action = (line ?? '').slice('Sauteing… '.length)
    expect(action).toHaveLength(40)
    expect(action.endsWith('…')).toBe(true)
  })
}
