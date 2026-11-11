/** Recorded missing-sandbox refusal replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/missing-sandbox-runner')
const fixture = join(scene, 'session.v3.jsonl')
const newline = String.fromCharCode(10)
const runner = [
  "import { join } from 'node:path'",
  'export const plugin = {',
  "  apiVersion: 1, name: 'missing-sandbox-runner', targets: ['host'],",
  "  requires: [], provides: ['sandbox'],",
  '  resolve: () => (context) => {',
  '    const confine = (argv, policy) => ({',
  "      argv: [join(policy.workspaceRoot, '.dsh-missing-sandbox-runner'), ...argv],",
  "      enforcement: 'full', denialSignatures: ['permission denied'],",
  "      runnerFailureRules: [{ fatalSignatures: ['snapshot-runner: '] }],",
  '    })',
  '    context.provide("sandbox", { confine, confineChildProcess: confine })',
  '  },',
  '}',
].join(newline)

it('replays the recorded missing-sandbox-runner session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') {
    throw new Error('missing-sandbox-runner: no recorded task')
  }
  const scenario = assembleNativeScenario({
    root,
    scene,
    modules: [
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
      { name: 'rsh-shell-env', path: 'rsh/Modules/Official/shell/shell-env' },
      { name: 'rsh-bash-sandbox', path: 'rsh/Modules/Official/shell/bash-sandbox' },
      { name: 'rsh-tool-bash', path: 'rsh/Modules/Official/shell/tool-bash' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      {
        name: 'missing-sandbox-runner',
        files: {
          'package.json': JSON.stringify({
            name: 'missing-sandbox-runner', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['sandbox'] } },
          }),
          'native.mjs': runner,
        },
      },
    ],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { ...row.config, cwd: paths.workspace, provider: 'deepseek-official',
          model: 'deepseek-v4-flash', systemPrompt: 'Use bash.', maxSteps: 3 } }
      }
      if (row.id === 'time-context') return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'subprocess', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'read-only', workspaceRoot: paths.workspace } },
      { id: 'missing-sandbox-runner', plugin: 'missing-sandbox-runner', scope: 'root' },
      { id: 'bash-sandbox', plugin: '@redspark/rsh-bash-sandbox', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing-sandbox-runner: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['bash', 'job_output'])
        const results = events.filter(event => event.type === 'tool/result').map(event => event.type === 'tool/result' ? JSON.stringify(event.data.message.content) : '')
        expect(results[0]).toContain('no sandbox backend is usable')
        expect(results[1]).toContain('unknown job')
        expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
