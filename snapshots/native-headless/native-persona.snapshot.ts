/** End-to-end: a Native profile's personaPrefix reaches the model-visible prompt. */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { assembleNativeScenario, reexportPackage, sessionFixtureName } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/fs-read')
const fixture = join(scene, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const PERSONA = 'You are a concise snapshot agent working in {{cwd}}.'

it('renders the deployment persona into the logged system prompt', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('fs-read: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    workspaceFiles: { 'workspace/greeting.txt': 'greeting.txt' },
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-sandbox', path: 'rsh/Modules/Official/sandbox/sandbox' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Use the read tool.', maxSteps: 4 } }
      }
      if (['code-runtime', 'time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      // The scenario fixture profile composes no prompt row, so the persona arrives with it.
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root', config: { personaPrefix: PERSONA } },
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
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
      if (id === undefined) throw new Error('persona: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const system = events.find(event => event.type === 'system/message')
        if (system?.type !== 'system/message') throw new Error('persona: no system message')
        const text = JSON.stringify(system.data)
        // The cwd variable resolved, and no literal braces reached the model. The
        // logged text is JSON, so the workspace path appears with escaped separators.
        expect(text).toContain('You are a concise snapshot agent working in ')
        expect(text).not.toContain('{{cwd}}')
        expect(text).toContain(JSON.stringify(scenario.paths.workspace).slice(1, -1))
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
