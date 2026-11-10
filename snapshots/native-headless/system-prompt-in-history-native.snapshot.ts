/** Recorded system-prompt-in-history scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/system-prompt-in-history')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded system-prompt-in-history session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('system-prompt-in-history: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The recorded run read this file, then edited one token inside it.
    workspaceFiles: { 'workspace/task.txt': 'task.txt' },
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
        name: 'native-system-prompt-in-history-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-system-prompt-in-history-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-system-prompt-in-history-approval', targets: ['host'],",
            "  requires: ['approval'], provides: [],",
            '  resolve: () => context => {',
            "    const approval = context.require('approval')",
            "    context.effect(approval.registerAnswerer(() => 'allowed-once'))",
            '  },',
            '}',
          ].join('\n'),
        },
      },
      // Change the rendered prompt after the first successful read, so the next step
      // renders different prompt text on an in-history route.
      {
        name: 'native-in-history-prompt-update',
        files: {
          'package.json': JSON.stringify({
            name: 'native-in-history-prompt-update', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'],
              requires: ['promptSections', 'tools'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'let guidance = \'\'',
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-in-history-prompt-update', targets: ['host'],",
            "  requires: ['promptSections', 'tools'], provides: [],",
            '  resolve: () => context => {',
            "    const sections = context.require('promptSections')",
            "    const tools = context.require('tools')",
            '    context.effect(sections.register({',
            "      name: 'snapshot:in-history-update', order: 400, text: () => guidance,",
            '    }))',
            '    context.effect(tools.interceptAfterCall((facts) => {',
            "      if (facts.name === 'read' && !facts.result.isError) {",
            "        guidance = 'Snapshot guidance added after the first read: reply with the single word DONE.'",
            '      }',
            "      return { kind: 'pass' }",
            '    }))',
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
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded),
      // The recording's route declares in-history prompt updates.
      providers: [{ id: 'deepseek-official', models: [{
        id: 'deepseek-v4-flash', systemPromptUpdate: 'in-history',
      }] }] } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'ask' } },
      // Change the rendered prompt after the first successful read.
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: 'root' },
      { id: 'in-history-prompt-update', plugin: 'native-in-history-prompt-update', scope: 'root' },
      { id: 'approval-answerer', plugin: 'native-system-prompt-in-history-approval', scope: 'root' },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('system-prompt-in-history: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The scenario's subject: an in-history route appends the changed prompt after the
        // cached one instead of replacing the first system node.
        const systems = events.filter(event => event.type === 'system/message')
        expect(systems).toHaveLength(2)
        const first = systems[0]?.type === 'system/message' ? systems[0].data.message.content[0] : undefined
        const second = systems[1]?.type === 'system/message' ? systems[1].data.message.content[0] : undefined
        expect(first?.type).toBe('text')
        expect(second?.type).toBe('text')
        // The second record carries the guidance the fixture adds after the read.
        expect(second?.type === 'text' ? second.text : '').toContain('Snapshot guidance added after the first read')
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['read'])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
