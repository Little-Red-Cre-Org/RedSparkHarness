/** Recorded archify-auto-routing scenario replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/archify-auto-routing')
// This scenario retains a historical generation, so the replay input is the highest
// committed one rather than the current writer's version.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded archify-auto-routing session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  // This scenario tracks the current writer, so its own committed generation is the
  // expected output.
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('archify-auto-routing: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-skill', path: 'rsh/Modules/Official/skill/skill' },
      { name: 'rsh-archify', path: 'rsh/Modules/Official/skill/archify' },
      { name: 'rsh-request-context', path: 'rsh/Engine/context/request-context' },
      { name: 'rsh-shell-env', path: 'rsh/Modules/Official/shell/shell-env' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Answer the request.', maxSteps: 3 } }
      }
      if (['code-runtime', 'time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      // The recording's third message is Archify's automatic skill invocation.
      { id: 'skill', plugin: '@redspark/rsh-skill', scope: 'root', config: {} },
      { id: 'archify', plugin: '@redspark/rsh-archify', scope: 'root', config: {} },
      { id: 'request-context', plugin: '@redspark/rsh-request-context', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('archify-auto-routing: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.map(event => event.type)).toEqual(expected)
        // The routing decision is durable: the recorded turn needs no tool call.
        expect(events.filter(event => event.type === 'tool/call')).toEqual([])
        const assistant = events.filter(event => event.type === 'assistant/message')
        expect(assistant).toHaveLength(1)
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
