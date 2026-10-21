/** Goal behavior through installed tarball profiles and the supported CLI launcher. */
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

/** Installed-consumer fixture supplied by the packed application acceptance owner. */
export interface PackedGoalConsumer {
  readonly output: string
  /**
   * Invoke the installed supported dsh CLI with its Cordis-denying import hook.
   * @param args - profile arguments following the installed executable.
   * @param environment - isolated profile home and persistence paths.
   * @returns stdout after successful process settlement.
   */
  run(args: readonly string[], environment: Readonly<Record<string, string>>): string
}

interface RecordedEvent {
  readonly seq: number
  readonly type: string
  readonly data?: {
    readonly turn?: number
    readonly roundsStarted?: number
    readonly operation?: string
    readonly goal?: { readonly phase?: string; readonly blockedReason?: { readonly code?: string } }
    readonly source?: { readonly kind?: string; readonly revision?: number; readonly round?: number }
  }
}

/**
 * Exercise Goal completion and round exhaustion, then restore each parent in another installed CLI process.
 * @param consumer - independently installed tarball tree and supported launcher.
 */
export function verifyPackedGoalScenarios(consumer: PackedGoalConsumer): void {
  for (const scenario of ['completion', 'budget'] as const) {
    const home = join(consumer.output, `packed-goal-${scenario}-home`)
    const sessions = join(home, 'sessions')
    const profileName = `native-goal-${scenario}`
    const profile = join(home, 'profiles', profileName)
    const model = join(profile, 'node_modules/packed-goal-model')
    const audit = join(home, 'requests.jsonl')
    mkdirSync(model, { recursive: true })
    const maxRounds = scenario === 'budget' ? 2 : 1
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: `packed-goal-profile-${scenario}`, private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
      { id: 'application', plugin: '@deepseek-ai/dsh-native-headless', scope: 'root',
        config: { cwd: consumer.output, provider: 'fixture', model: 'goal', systemPrompt: 'Use the explicit Goal.', maxSteps: 4 } },
      { id: 'agents', plugin: '@deepseek-ai/dsh-native-agent', scope: 'root' },
      { id: 'execution', plugin: '@deepseek-ai/dsh-native-session-execution', scope: 'root' },
      { id: 'model-execution', plugin: '@deepseek-ai/dsh-native-model-execution', scope: 'root' },
      { id: 'tools', plugin: '@deepseek-ai/dsh-native-tools', scope: 'root' },
      { id: 'prompt', plugin: '@deepseek-ai/dsh-native-prompt', scope: 'root' },
      { id: 'goals', plugin: '@deepseek-ai/dsh-goal', scope: 'root', config: { defaultMaxGoalRounds: maxRounds } },
      { id: 'driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: 'root' },
      { id: 'goal-tools', plugin: '@deepseek-ai/dsh-tool-goal', scope: 'root' },
      { id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root', config: { cwd: consumer.output } },
      { id: 'storage', plugin: '@deepseek-ai/dsh-session-persistence-jsonl', scope: 'root',
        config: { root: sessions, compression: 'none' } },
      { id: 'model', plugin: 'packed-goal-model', scope: 'root' },
    ] }))
    writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'packed-goal-model', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } } }))
    writeFileSync(join(model, 'native.mjs'), `
      import { appendFileSync } from 'node:fs'
      export const plugin = { apiVersion: 1, name: 'packed-goal-model', targets: ['host'], requires: [], provides: ['model'],
        resolve: () => context => context.provide('model', {
          resolveModel: async (provider, id) => ({ provider, id, name: id }),
          async *stream(request) {
            appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ sessionId: request.sessionId,
              messages: request.messages.map(message => ({ role: message.role, content: message.content })) }) + '\\n')
            const blocks = request.messages.flatMap(message => message.content)
            const lastUser = request.messages.filter(message => message.role === 'user').at(-1)
            const text = lastUser?.content.filter(block => block.type === 'text').map(block => block.text).join('\\n') ?? ''
            const goals = blocks.filter(block => block.type === 'tool-result').flatMap(block => block.content)
              .filter(block => block.type === 'text').flatMap(block => {
                try { const value = JSON.parse(block.text); return value.goal === undefined ? [] : [value.goal] } catch { return [] }
              })
            const goal = goals.at(-1)
            let call
            if (!text.includes('inspect-final-goal') && goal === undefined) {
              call = { name: 'create_goal', arguments: { objective: 'Finish packed Goal work.', max_goal_rounds: ${maxRounds} } }
            } else if (${JSON.stringify(scenario)} === 'completion' && text.includes('<goal_round>') && goal?.phase === 'active') {
              call = { name: 'update_goal', arguments: { goal_id: goal.id, revision: goal.revision, action: 'complete' } }
            }
            if (call !== undefined) {
              yield { type: 'block-start', index: 0, blockType: 'tool-call' }
              yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: call.name, name: call.name,
                arguments: JSON.stringify(call.arguments) } }
              yield { type: 'finish', reason: { kind: 'tool-calls' } }
              return
            }
            const answer = text.includes('inspect-final-goal') ? 'packed Goal restored'
              : goal?.phase === 'complete' ? 'packed Goal complete'
              : text.includes('<goal_round>') ? 'packed Goal bounded round' : 'packed Goal armed'
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
        }) }
    `)
    const environment = { DSH_HOME: home }
    expect(consumer.run(['--profile', profileName, 'Create an explicit Goal for packed acceptance.'], environment).trim())
      .toBe(scenario === 'completion' ? 'packed Goal complete' : 'packed Goal bounded round')
    const paths = globSync('**/session.v3.jsonl', { cwd: sessions })
    expect(paths).toHaveLength(1)
    const path = paths[0]
    if (path === undefined) throw new Error('packed Goal omitted its root Session')
    const log = join(sessions, path)
    const lines = readFileSync(log, 'utf8').trim().split('\n')
    const header = JSON.parse(lines[0] ?? '') as { id: string; parentSession?: string }
    expect(header.parentSession).toBeUndefined()
    const firstEvents = lines.slice(1).map(line => JSON.parse(line) as RecordedEvent)
    expect(firstEvents.filter(event => event.type === 'turn/end').map(event => event.data?.turn))
      .toEqual(Array.from({ length: maxRounds + 1 }, (_, index) => index + 1))
    expect(firstEvents.filter(event => event.type === 'user/message' && event.data?.source?.kind === 'goal')
      .map(event => event.data?.source?.round)).toEqual(Array.from({ length: maxRounds }, (_, index) => index + 1))
    const terminal = firstEvents.filter(event => event.type === 'goal/change').at(-1)
    expect(terminal?.data).toMatchObject({ operation: scenario === 'completion' ? 'complete' : 'block', roundsStarted: maxRounds,
      goal: { phase: scenario === 'completion' ? 'complete' : 'blocked' } })
    if (scenario === 'budget') expect(terminal?.data?.goal?.blockedReason?.code).toBe('round-limit')
    expect(firstEvents.map(event => event.seq)).toEqual(firstEvents.map((_event, index) => index))
    expect(consumer.run(['--profile', profileName, '--resume', header.id, 'inspect-final-goal'], environment).trim())
      .toBe('packed Goal restored')
    const restored = readFileSync(log, 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line) as RecordedEvent)
    expect(restored.filter(event => event.type === 'turn/end')).toHaveLength(maxRounds + 2)
    expect(restored.filter(event => event.type === 'goal/change')).toHaveLength(2)
    expect(restored.filter(event => event.type === 'user/message' && event.data?.source?.kind === 'goal')).toHaveLength(maxRounds)
    expect(globSync('**/session.v3.jsonl', { cwd: sessions })).toHaveLength(1)
    const requests = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      sessionId: string
      messages: unknown
    })
    expect(requests).toHaveLength(5)
    expect(new Set(requests.map(request => request.sessionId))).toEqual(new Set([header.id]))
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain('Finish packed Goal work.')
  }
}
