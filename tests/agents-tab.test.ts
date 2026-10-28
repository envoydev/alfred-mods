import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { PRESENTATION, SPAWN, engine, rows, spawns, step, stepEngine, stubAll } from './kit.ts'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { title: 'Inspect', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000, model: 'claude-haiku-5-5' }

const pane = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: PANE })
const inspect = ($: Engine, args: string) =>
  $.command.run({ command: 'inspect', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const complete = (turnId: string, more: object = {}) =>
  ({ answer: '', durationMs: 3000, isAborted: false, turnId, reason: 'answer' as const, ...more })
// Grep is not among this build's typed tools (its search runs through Bash), but other builds call it
const grep = (more: object = {}) => ({ tool: 'Grep', pattern: 'AuthService', ...more }) as never
const isGrep = (tool: string): boolean => tool === 'Grep'

for (const surface of SURFACES) {
  test(`a docked pane too narrow for six tabs wraps the bar after the third, every name whole (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    await inspect($, 'agents')

    // Fullscreen docks the pane at about 46 columns; one bar of six tabs needs 60
    const narrow = await $.ui.mount({ plugin: 'session-inspector', surface, component: 'Pane', requestId: 'inspect', props: { ...PANE, bodyColumns: 46 } })
    const lines = await rows(narrow)
    expect(lines[0]).toBe('Now Usage  Agents  ')
    expect(lines[1]).toBe('Tools Cache Timeline ')
    narrow.unmount()

    expect((await rows(await pane($, surface)))[0]).toBe('Now Usage  Agents  Tools Cache Timeline ')
  })

  test(`the Agents tab draws the main loop as the root and each agent under the one that started it (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['agent.spawn'])
    spawns(on, { 'Finding auth code': { agentId: 'a1' } })
    stepEngine(on, () => null)

    await $.turn.start({ text: 'q', turnId: 't1' })
    for (let i = 0; i < 9; i++) await $.tool.call({ tool: 'Read', file_path: `/w/f${i}.ts` })
    await step($, { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'Finding auth code' })
    await $.turn.complete(complete('x1', { agentId: 'a1', answer: 'done' }))
    await inspect($, 'agents')

    const lines = await rows(await pane($, surface))
    expect(lines).toContain('⟳ main chat · opus 5.5 · 9 tools')
    expect(lines.some(l => l.startsWith('└ ✓ Explore · haiku'))).toBe(true)
    expect(lines.some(l => l.trim() === 'doing: "Finding auth code"')).toBe(true)
  })

  test(`an agent started inside another agent sits under it (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['agent.spawn'])
    spawns(on, { lead: { agentId: 'a1' }, scout: { agentId: 'a2' } })

    await $.agent.spawn({ ...SPAWN, description: 'lead' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'scout', parentAgentId: 'a1' })
    await inspect($, 'agents')

    const lines = await rows(await pane($, surface))
    expect(lines.some(l => l.startsWith('└ ⟳ general-purpose · haiku'))).toBe(true)
    expect(lines.some(l => l.startsWith('  └ ⟳ Explore · haiku'))).toBe(true)
  })

  test(`an agent whose parent is unknown sits under the main loop (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)

    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', parentAgentId: 'zz' })
    await inspect($, 'agents')

    expect((await rows(await pane($, surface))).some(l => l.startsWith('└ ⟳ Explore · haiku'))).toBe(true)
  })

  test(`a running agent shows its action, context and tools with failures (${surface})`, async ($, on) => {
    const { clock } = stubAll(on)
    engine(on, ['tool.call'])
    stepEngine(on, () => USAGE)
    on('tool.call', async (_, e) => {
      if (isGrep(e.tool)) await clock.sleep(60_000)
      return e.tool === 'Bash' ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: 'ok', text: 'ok' }
    })

    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
    await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 3, agentId: 'a1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/b.ts', agentId: 'a1' })
    await $.tool.call({ tool: 'Bash', command: 'false', agentId: 'a1' })
    void $.tool.call(grep({ agentId: 'a1' }))
    await clock.settle()
    await inspect($, 'agents')

    const lines = await rows(await pane($, surface))
    expect(lines.some(l => l.startsWith('└ ⟳ Explore · haiku ◑ medium'))).toBe(true)
    expect(lines.some(l => l.trim() === '▸ Grep AuthService')).toBe(true)
    expect(lines.some(l => l.endsWith('ctx 31k   tools Read ×2 ✓ · Bash ×1 ✗'))).toBe(true)
  })

  test(`a finished agent shows its report's first line and Show report expands it (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)

    await $.agent.spawn(SPAWN)
    await $.turn.complete(complete('x1', { agentId: 'a1', answer: '12 files, 3 untested services\nmore detail' }))
    await inspect($, 'agents')
    const ui = await pane($, surface)

    expect((await rows(ui)).some(l => l.endsWith('result: 12 files, 3 untested services Show report'))).toBe(true)
    await ui.press({ key: 'report-a1' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('12 files, 3 untested services\nmore detail')
    expect((await rows(ui)).some(l => l.endsWith('Hide report'))).toBe(true)
  })

  test(`an agent report's control characters are not drawn (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)

    await $.agent.spawn(SPAWN)
    await $.turn.complete(complete('x1', { agentId: 'a1', answer: '\x1b[31mFAIL\x1b[0m one\r\ntwo' }))
    await inspect($, 'agents')
    const ui = await pane($, surface)
    await ui.press({ key: 'report-a1' })

    const json = JSON.stringify(await ui.drawn())
    expect(json).not.toMatch(/\\u001b/)
    expect(json).not.toMatch(/\\r/)
    expect((await rows(ui)).some(l => l.endsWith('result: FAIL one Hide report'))).toBe(true)
  })

  test(`skills fired closes the Agents tab and the Now tab's AGENTS section (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['tool.call'])
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('tool.call', async (_, e) => {
      if (e.tool === 'Skill') await $.skill.prompt({ skill: e.skill, text: 'x', frontmatter: {}, source: 'projectSettings' })
      return { result: 'ok', text: 'ok' }
    })

    await $.skill.prompt({ skill: 'watch', text: 'x', frontmatter: {}, source: 'projectSettings' })
    for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Skill', skill: 'plugin-authoring' })
    await inspect($, 'agents')
    const ui = await pane($, surface)

    const skills = 'skills fired: watch ×1 · plugin-authoring ×4'
    expect((await rows(ui)).at(-1)).toBe(skills)
    await ui.press({ key: 'tab-now' })
    expect(await rows(ui)).toContain(skills)
  })

  test(`the Now tab lists running agents under AGENTS (${surface})`, async ($, on) => {
    const { clock } = stubAll(on)
    engine(on, ['agent.spawn', 'tool.call'])
    spawns(on, { one: { agentId: 'a1' }, two: { agentId: 'a2' }, three: { agentId: 'a3' } })
    stepEngine(on, () => USAGE)
    on('tool.call', async () => {
      await clock.sleep(60_000)
      return { result: 'ok', text: 'ok' }
    })

    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'one' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Plan', description: 'two' })
    await $.agent.spawn({ ...SPAWN, description: 'three' })
    await step($, { turnId: 'x', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 3, agentId: 'a1' })
    void $.tool.call(grep({ agentId: 'a1' }))
    void $.tool.call({ tool: 'Read', file_path: '/w/src/auth/token.ts', agentId: 'a2' })
    await $.turn.complete(complete('x3', { agentId: 'a3' }))
    await clock.settle()
    await inspect($, 'now')

    const lines = await rows(await pane($, surface))
    expect(lines).toContain('AGENTS 2 running')
    expect(lines).toContain('⟳ Explore [haiku ◑ medium] ▸ Grep AuthService   ctx 31k')
    expect(lines).toContain('⟳ Plan [haiku] ▸ Read src/auth/token.ts')
    expect(lines.some(l => /general-purpose/.test(l))).toBe(false)
    expect(lines.indexOf('AGENTS 2 running')).toBeLessThan(lines.findIndex(l => l.startsWith('NEEDS A LOOK')))
  })

  test(`the header counts agents by model family (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on, ['agent.spawn'])
    spawns(on, { big: { agentId: 'a1', model: 'claude-opus-5-5' }, one: { agentId: 'a2' }, two: { agentId: 'a3' } })

    for (const description of ['big', 'one', 'two']) await $.agent.spawn({ ...SPAWN, description })
    await inspect($, 'agents')

    expect((await rows(await pane($, surface)))[1]).toBe('Agents (3)   opus 1 · haiku 2')
  })

  test(`the tab bar colours Usage and Agents (${surface})`, async ($, on) => {
    stubAll(on)
    engine(on)
    await inspect($, 'now')

    const texts = await (await pane($, surface)).findAll({ type: 'Text' })
    expect(texts.find(t => t.text === 'Usage')?.props).toMatchObject({ color: '#60a5fa', bold: true })
    expect(texts.find(t => t.text === 'Agents')?.props).toMatchObject({ color: '#f472b6', bold: true })
  })

  test(`the tab bar has no colour under NO_COLOR (${surface})`, async ($, on) => {
    stubAll(on, { env: { NO_COLOR: '1' } })
    engine(on)
    await inspect($, 'now')

    expect(JSON.stringify(await (await pane($, surface)).drawn())).not.toMatch(/"color"/)
  })

  test(`/inspect agents opens the Agents tab (${surface})`, async ($, on) => {
    const { opened } = stubAll(on)
    engine(on)

    expect((await inspect($, 'agents')).text).toBe('Opened the inspect pane.')
    expect(opened).toEqual(['inspect'])
    const lines = await rows(await pane($, surface))
    expect(lines).toContain('Agents (0)')
    expect(lines).toContain('No agents yet.')
  })
}
