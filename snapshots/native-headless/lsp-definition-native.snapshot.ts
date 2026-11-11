/** Recorded LSP definition lookup replayed through a Native profile. */
import { cpSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/lsp-definition')
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded lsp-definition session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') {
    throw new Error('lsp-definition: no recorded task')
  }
  const scenario = assembleNativeScenario({
    root,
    scene,
    modules: [
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-lsp', path: 'rsh/Modules/Official/lsp/lsp' },
      { name: 'rsh-lsp-stdio', path: 'rsh/Modules/Official/lsp/lsp-stdio' },
      { name: 'rsh-tool-lsp', path: 'rsh/Modules/Official/lsp/tool-lsp' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { ...row.config, cwd: paths.workspace, provider: 'deepseek-official',
          model: 'deepseek-v4-flash', systemPrompt: 'Use the lsp tool.', maxSteps: 3 } }
      }
      if (row.id === 'time-context') return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: () => [
      { id: 'subprocess', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root' },
      { id: 'lsp', plugin: '@redspark/rsh-lsp', scope: 'root' },
      { id: 'lsp-stdio', plugin: '@redspark/rsh-lsp-stdio', scope: 'root', config: {
        servers: { fixture: { command: process.execPath, args: ['./lsp-server.mjs'],
          extensionToLanguage: { '.ts': 'typescript' } } },
      } },
      { id: 'tool-lsp', plugin: '@redspark/rsh-tool-lsp', scope: 'root', config: { maxLocations: 1 } },
    ],
  })
  cpSync(join(scene, 'workspace'), scenario.paths.workspace, { recursive: true })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('lsp-definition: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined)).toEqual(['lsp'])
        const result = events.find(event => event.type === 'tool/result')
        const text = result?.type === 'tool/result'
          ? JSON.stringify(result.data.message.content)
          : ''
        expect(text).toContain('subject.ts:1:7')
        expect(text).toContain('1 more location omitted')
        expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
