/** Recorded ptc-python-turn scenario replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/ptc-python-turn')
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded ptc-python-turn session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('ptc-python-turn: no recorded task')

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
      { name: 'rsh-bash-local', path: 'rsh/Modules/Official/shell/bash-local' },
      { name: 'rsh-subprocess', path: 'rsh/Core/subprocess/subprocess' },
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
      { name: 'rsh-shell-env', path: 'rsh/Modules/Official/shell/shell-env' },
      { name: 'rsh-tool-bash', path: 'rsh/Modules/Official/shell/tool-bash' },
      { name: 'rsh-experimental-code-runtime-python', path: 'rsh/Modules/Community/experimental/code-runtime-python' },
      { name: 'rsh-tool-code-runtime', path: 'rsh/Modules/Official/code-runtime/tool-code-runtime' },
      { name: 'rsh-code-runtime-definition', path: 'rsh/Modules/Official/code-runtime/code-runtime-definition' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-pro',
          systemPrompt: 'Use run_code.', maxSteps: 6 } }
      }
      // The shipped row provides the TypeScript worker. This recording runs Python.
      if (row.id === 'code-runtime') return { ...row, disabled: true }
      if (['time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
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
      { id: 'bash-local', plugin: '@redspark/rsh-bash-local', scope: 'root' },
      { id: 'subprocess-local', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
      { id: 'code-runtime-python', plugin: '@redspark/rsh-experimental-code-runtime-python', scope: 'root',
        config: { pythonBin: '/usr/bin/python3' } },
      { id: 'tool-code-runtime', plugin: '@redspark/rsh-tool-code-runtime', scope: 'root', config: {} },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('ptc-python-turn: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['run_code'])
        const dispatch = events.filter(event => event.type === 'tool/ptc-dispatch')
        expect(dispatch).toHaveLength(2)
        for (const entry of dispatch) {
          expect(entry).toMatchObject({ data: { name: 'bash', isError: false } })
        }
        const rendered = events.filter(event => event.type === 'tool/result').map(result => result.type === 'tool/result'
          ? result.data.message.content[0]?.content[0]?.text ?? '' : '').join('\n')
        expect(rendered).toContain('captured output')
        expect(rendered).toContain('CODE_ONE+CODE_TWO')
        const assistant = events.filter(event => event.type === 'assistant/message').map(event => {
          if (event.type !== 'assistant/message') return ''
          return event.data.message.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('')
        })
        expect(assistant).toContain('CODE_ONE+CODE_TWO')
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
