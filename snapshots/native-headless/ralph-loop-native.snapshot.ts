/** Recorded ralph-loop scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/ralph-loop')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded ralph-loop session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('ralph-loop: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // Two fresh Ralph rounds, each replayed from its own committed generation.
    childFixtures: [join(scene, 'session.1.v3.jsonl'), join(scene, 'session.2.v3.jsonl')],
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
      { name: 'rsh-workflow', path: 'rsh/Engine/workflow/workflow' },
      { name: 'rsh-workflow-worker-thread', path: 'rsh/Engine/workflow/workflow-worker-thread' },
      { name: 'rsh-tool-workflow', path: 'rsh/Engine/workflow/tool-workflow' },
      { name: 'rsh-tool-ralph', path: 'rsh/Engine/workflow/tool-ralph' },
      { name: 'rsh-agent-instructions', path: 'rsh/Engine/context/agent-instructions' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-ralph-loop-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-ralph-loop-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-ralph-loop-approval', targets: ['host'],",
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
      // The worker-thread workflow executor delegates through the subagent Provider.
      { id: 'subagents', plugin: '@redspark/rsh-native-subagent', scope: 'root', config: { providerName: 'spawn' } },
      { id: 'workflow', plugin: '@redspark/rsh-workflow', scope: 'root', config: {} },
      { id: 'workflow-worker-thread', plugin: '@redspark/rsh-workflow-worker-thread', scope: 'root',
        config: { subagentProvider: 'spawn' } },
      { id: 'tool-workflow', plugin: '@redspark/rsh-tool-workflow', scope: 'root', config: { provider: 'worker-thread' } },
      { id: 'tool-ralph', plugin: '@redspark/rsh-tool-ralph', scope: 'root',
        config: { workflowProvider: 'worker-thread', subagentProvider: 'spawn' } },

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
      if (id === undefined) throw new Error('ralph-loop: no persisted root Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // Two rounds ran and the worker reported completion with its structured summary.
        const results = events.filter(event => event.type === 'tool/result')
        expect(results.length).toBeGreaterThanOrEqual(1)
        const rendered = results.map((result) => result.type === 'tool/result'
          ? result.data.message.content[0]?.content[0]?.text ?? '' : '').join('\n')
        // Both rounds ran and the worker reported its terminal structured summary.
        expect(rendered).toContain('after 2 rounds')
        expect(rendered).toContain('"status": "complete"')
        expect(rendered).toContain('The Ralph snapshot objective is complete.')
        // Each round ran in its own fresh child Session, replayed from its own generation.
        const children = (await storage.list()).filter(entry => entry.header.delegationDepth > 0)
        expect(children).toHaveLength(2)
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
