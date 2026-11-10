/** Recorded hook-cc-invalid-matcher scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/hook-cc-invalid-matcher')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded hook-cc-invalid-matcher session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('hook-cc-invalid-matcher: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The recorded run carried a hooks.json whose PreToolUse matcher is an invalid
    // regular expression, so the bridge rejected the whole config and ran no hooks.
    workspaceFiles: { 'workspace/hooks.json': 'hooks.json' },
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },

      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
      { name: 'rsh-pwsh-local', path: 'rsh/Modules/Official/shell/pwsh-local' },
      { name: 'rsh-subprocess', path: 'rsh/Core/subprocess/subprocess' },
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // The loader resolves the exact package name a row declares and requires the manifest
      // name to match it, so the bridge is materialized under its published scoped name.
      {
        name: '@redspark/rsh-hooks-claude-code',
        files: {
          'package.json': JSON.stringify({
            name: '@redspark/rsh-hooks-claude-code', version: '1.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['shell'],
              optional: ['tools', 'requestContexts', 'activeSessions'], provides: [] } },
          }),
          'native.mjs': "export { plugin } from '@redspark/rsh-hooks-claude-code/native'\n",
        },
      },
    ],
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
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
      // The scenario's subject: a config that cannot be parsed registers nothing, so the
      // turn completes with no hook invocation recorded.
      // The bridge requires the shell service to run a hook command; this composition
      // supplies the cross-platform PowerShell provider.
      { id: 'pwsh-local', plugin: '@redspark/rsh-pwsh-local', scope: 'root' },
      { id: 'subprocess-local', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'hooks-claude-code', plugin: '@redspark/rsh-hooks-claude-code', scope: 'root',
        config: { configPath: join(paths.workspace, 'hooks.json') } },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('hook-cc-invalid-matcher: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The rejected config registered no hooks, so the turn records none.
        expect(events.filter(event => event.type === 'hook/invoked')).toEqual([])
        expect(events.filter(event => event.type === 'hook/result')).toEqual([])
        // The turn still completes normally.
        expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
