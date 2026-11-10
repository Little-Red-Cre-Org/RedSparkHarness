/** Recorded subagent-depth-two-rejection scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/subagent-depth-two-rejection')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded subagent-depth-two-rejection session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('subagent-depth-two-rejection: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The child Session replays from its own committed generation.
    // The depth-one child replays from its own generation.
    childFixtures: [join(scene, 'session.1.v3.jsonl')],
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-bash-local', path: 'rsh/Modules/Official/shell/bash-local' },
      { name: 'rsh-subprocess', path: 'rsh/Core/subprocess/subprocess' },
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
      { name: 'rsh-shell-env', path: 'rsh/Modules/Official/shell/shell-env' },
      { name: 'rsh-tool-bash', path: 'rsh/Modules/Official/shell/tool-bash' },
      { name: 'rsh-native-subagent', path: 'rsh/Engine/subagent/native-subagent' },
      { name: 'rsh-tool-subagent', path: 'rsh/Engine/subagent/tool-subagent' },
      { name: 'rsh-agent-instructions', path: 'rsh/Engine/context/agent-instructions' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-subagent-depth-two-rejection-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-subagent-depth-two-rejection-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-subagent-depth-two-rejection-approval', targets: ['host'],",
            "  requires: ['approval'], provides: [],",
            '  resolve: () => context => {',
            "    const approval = context.require('approval')",
            "    context.effect(approval.registerAnswerer(() => 'allowed-once'))",
            '  },',
            '}',
          ].join('\n'),
        },
      },
    ],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Use the read and write tools.', maxSteps: 6 } }
      }
      if (['code-runtime', 'time-context'].includes(row.id)) return { ...row, disabled: true }
  // The recorded call passes run_in_background, so the Jobs rows stay enabled.
  if (row.id === 'jobs' || row.id === 'tool-jobs') return { ...row, disabled: false }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      // The recording ran with prompts disabled; Native mutation tools ask their authority
      // once per attempt, so an answerer grants without reaching a person.
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      // The recorded removal runs through the bash tool.
      { id: 'bash-local', plugin: '@redspark/rsh-bash-local', scope: 'root' },
      { id: 'agent-instructions', plugin: '@redspark/rsh-agent-instructions', scope: 'root', config: { maxBytes: 65536 } },
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root', config: { personaPrefix: 'You are a coding assistant using the {{model}} model.' } },
      { id: 'subagents', plugin: '@redspark/rsh-native-subagent', scope: 'root', config: { providerName: 'spawn' } },
      { id: 'tool-subagent', plugin: '@redspark/rsh-tool-subagent', scope: 'root',
        // The recorded run allows two levels, so the second delegation is the one refused.
        config: { provider: 'spawn', toolName: 'subagent', backgroundMode: 'one-shot', maxDepth: 2 } },
      { id: 'subprocess-local', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      // A subagent scenario persists both the parent and its child; select the parent.
      const entries = await storage.list()
      const id = entries.find(entry => entry.header.delegationDepth === 0)?.header.id
      if (id === undefined) throw new Error('subagent-depth-two-rejection: no persisted root Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The parent's delegation succeeded; the child's own attempt was the refused one.
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        const rendered = results[0]?.type === 'tool/result'
          ? results[0].data.message.content[0]?.content[0]?.text ?? '' : ''
        expect(rendered).toBe('DEPTH_ONE_DONE')
        // The child's identity and mode are durable. The compatibility loop records them
        // on the parent as subagent/catalog; the Native application records the descriptor
        // inside the child's own log, which this scenario also replays.
        const child = (await storage.list()).find(entry => entry.header.delegationDepth > 0)
        expect(child).toBeDefined()
        expect(JSON.stringify(events)).toContain('"kind":"subagent"')
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
