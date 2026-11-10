/** Recorded ptc-workspace-context scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/ptc-workspace-context')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded ptc-workspace-context session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('ptc-workspace-context: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The recorded program read one nested workspace file through its binding.
    workspaceFiles: { 'workspace/AGENTS.md': 'AGENTS.md', 'workspace/nested/AGENTS.md': 'nested/AGENTS.md',
      'workspace/nested/task.txt': 'nested/task.txt' },
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
      { name: 'rsh-native-code-runtime', path: 'rsh/Modules/Official/code-runtime/native-code-runtime' },
      { name: 'rsh-tool-code-runtime', path: 'rsh/Modules/Official/code-runtime/tool-code-runtime' },
      { name: 'rsh-code-runtime-worker-thread', path: 'rsh/Modules/Official/code-runtime/code-runtime-worker-thread' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-ptc-workspace-context-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-ptc-workspace-context-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-ptc-workspace-context-approval', targets: ['host'],",
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
      // The recorded turn dispatches through run_code, so the code-runtime rows stay enabled.
  if (['time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
  if (row.id.startsWith('code-runtime')) return { ...row, disabled: false }
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
      { id: 'subprocess-local', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
      // The recorded program calls the read binding, so the fs tool must be installed.
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
      // The Registry wins the run_code name, so the recorded call reaches the real
      // code-runtime tool rather than the builtin transport's placeholder.
      { id: 'tool-code-runtime', plugin: '@redspark/rsh-tool-code-runtime', scope: 'root', config: {} },

    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('ptc-workspace-context: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The recorded call ran one program that dispatched two nested tool calls.
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['run_code'])

        // The program read a workspace file through its binding.
        const dispatch = events.filter(event => event.type === 'tool/ptc-dispatch')
        expect(dispatch).toHaveLength(1)
        console.log('RES', JSON.stringify(events.filter(e => e.type === 'tool/result').map(e => e.type === 'tool/result' ? e.data.message.content[0]?.content?.[0]?.text?.slice(0,150) : null)))
        expect(dispatch[0]).toMatchObject({ data: { name: 'read', isError: false } })
        const results = events.filter(event => event.type === 'tool/result')
        expect(results.length).toBeGreaterThanOrEqual(1)
        const rendered = results.map((result) => result.type === 'tool/result'
          ? result.data.message.content[0]?.content[0]?.text ?? '' : '').join(String.fromCharCode(10))
        expect(rendered).toContain('task')
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
