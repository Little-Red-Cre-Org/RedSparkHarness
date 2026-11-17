/** End-to-end: Native profile persona rows reach the model-visible prompt. */
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
import type { NativeScenario, NativeScenarioPaths, NativeScenarioRow } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/fs-read')
const fixture = join(scene, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const PERSONA = 'You are a concise snapshot agent working in {{cwd}}.'
const APP_PROMPT = 'Use the read tool.'

/** The recorded task the replay model answers. */
function recordedTask(): string {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('fs-read: no recorded task')
  return input.data.content[0].text
}

/** Assemble the replay scenario with the given prompt rows installed on the root scope. */
function assemble(promptRows: (paths: NativeScenarioPaths) => readonly NativeScenarioRow[]): NativeScenario {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  return assembleNativeScenario({
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
          systemPrompt: APP_PROMPT, maxSteps: 4 } }
      }
      if (['code-runtime', 'time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      ...promptRows(paths),
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    ],
  })
}

/** Read the system message the scenario persisted. */
async function loggedSystemPrompt(scenario: NativeScenario): Promise<string> {
  const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
  try {
    const id = (await storage.list())[0]?.header.id
    if (id === undefined) throw new Error('persona: no persisted Session')
    const reader = await storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      const system = events.find(event => event.type === 'system/message')
      const content = system?.type === 'system/message' ? system.data.message.content[0] : undefined
      if (content?.type !== 'text') throw new Error('persona: no system message')
      return content.text
    } finally { await reader.close() }
  } finally { await storage.close() }
}

it('renders the deployment persona into the logged system prompt', async () => {
  // The scenario fixture profile composes no prompt row, so the persona arrives with it.
  const scenario = assemble(() => [
    { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root', config: { personaPrefix: PERSONA } },
  ])
  try {
    await scenario.run(recordedTask())
    const text = await loggedSystemPrompt(scenario)
    // The cwd variable resolved, and no literal braces reached the model.
    expect(text).toContain('You are a concise snapshot agent working in ')
    expect(text).not.toContain('{{cwd}}')
    expect(text).toContain(scenario.paths.workspace)
  } finally { scenario.dispose() }
})

it('renders the Native persona row into the logged system prompt', async () => {
  const scenario = assemble(() => [
    { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root' },
    { id: 'persona', plugin: '@redspark/rsh-native-persona', scope: 'root',
      config: { prefix: PERSONA, suffix: 'Your working directory is {{cwd}}.' } },
  ])
  try {
    await scenario.run(recordedTask())
    const text = await loggedSystemPrompt(scenario)
    expect(text).not.toContain('{{cwd}}')
    expect(text.startsWith(APP_PROMPT)).toBe(true)
    const prefix = text.indexOf('You are a concise snapshot agent working in ')
    expect(prefix).toBeGreaterThan(0)
    expect(text.indexOf('Your working directory is ')).toBeGreaterThan(prefix)
    expect(text).toContain(scenario.paths.workspace)
  } finally { scenario.dispose() }
})
