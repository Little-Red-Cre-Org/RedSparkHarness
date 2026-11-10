/** Recorded parallel-tool-calls scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/parallel-tool-calls')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded parallel-tool-calls session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('parallel-tool-calls: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The recorded step read two files in one step, in parallel.
    workspaceFiles: { 'workspace/a.txt': 'a.txt', 'workspace/b.txt': 'b.txt' },
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-parallel-tool-calls-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-parallel-tool-calls-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-parallel-tool-calls-approval', targets: ['host'],",
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
          systemPrompt: 'Use the read tool.', maxSteps: 3 } }
      }
      if (['code-runtime', 'time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
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
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'ask' } },
      { id: 'approval-answerer', plugin: 'native-parallel-tool-calls-approval', scope: 'root' },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('parallel-tool-calls: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // Both reads were admitted in the same step and both results were recorded.
        const calls = events.filter(event => event.type === 'tool/call')
        expect(calls).toHaveLength(2)
        expect(new Set(calls.map(event => event.type === 'tool/call' ? event.data.step : -1))).toEqual(new Set([1]))
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        for (const result of results) {
          expect(result).toMatchObject({ data: { message: { content: [{ isError: false }] } } })
        }
        const rendered = results.map((result) => result.type === 'tool/result'
          ? result.data.message.content[0]?.content[0]?.text ?? '' : '').join(String.fromCharCode(10))
        expect(rendered).toContain('alpha')
        expect(rendered).toContain('beta')

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
