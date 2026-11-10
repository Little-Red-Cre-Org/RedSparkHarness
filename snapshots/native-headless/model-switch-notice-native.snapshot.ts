/** Recorded model-switch-notice scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/model-switch-notice')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded model-switch-notice session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('model-switch-notice: no recorded task')

  const scenario = assembleNativeScenario({
    root,
    scene,
    // The recorded run read this file, then edited one token inside it.

    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-tool-todo', path: 'rsh/Modules/Official/todo/tool-todo' },
      { name: 'rsh-native-model-selection', path: 'rsh/Engine/llm/native-model-selection' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native', ['model', 'modelDirectory']),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-model-switch-notice-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-model-switch-notice-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-model-switch-notice-approval', targets: ['host'],",
            "  requires: ['approval'], provides: [],",
            '  resolve: () => context => {',
            "    const approval = context.require('approval')",
            "    context.effect(approval.registerAnswerer(() => 'allowed-once'))",
            '  },',
            '}',
          ].join('\n'),
        },
      },
      // The recording names two routes; the directory answers from the same replay catalog so a
      // switched model resolves without a live provider catalog.
      {
        name: 'native-replay-model-directory',
        files: {
          'package.json': JSON.stringify({
            name: 'native-replay-model-directory', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'],
              requires: ['model'], optional: [], provides: ['modelDirectory'] } },
          }),
          'native.mjs': [
            "const ROUTES = [{ id: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] }]",
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-replay-model-directory', targets: ['host'],",
            "  requires: ['model'], provides: ['modelDirectory'],",
            '  resolve: () => context => {',
            '    context.provide(\'modelDirectory\', {',
            '      providers: () => ROUTES.map(route => ({ id: route.id, name: route.id })),',
            '      catalog: async (defaults) => ({ default: defaults, routableProviders: ROUTES.map(r => r.id), groups: [], failures: [] }),',
            '      resolve: async (provider, id) => ({ provider, id, name: id, contextWindow: 1000000 }),',
            '    })',
            '  },',
            '}',
          ].join('\n'),
        },
      },
      // Switch the selected model after the first todo write, as the recording did.
      {
        name: 'native-model-switch-driver',
        files: {
          'package.json': JSON.stringify({
            name: 'native-model-switch-driver', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'],
              requires: ['modelSelection', 'activeSessions', 'tools'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            "const SELECTED = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }",
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-model-switch-driver', targets: ['host'],",
            "  requires: ['modelSelection', 'activeSessions', 'tools'], provides: [],",
            '  resolve: () => context => {',
            "    const selection = context.require('modelSelection')",
            "    const sessions = context.require('activeSessions')",
            "    const tools = context.require('tools')",
            '    context.effect(tools.interceptAfterCall(async (facts) => {',
            "      if (facts.name !== 'todo_write' || facts.result.isError) return { kind: 'pass' }",
            '      const owner = sessions.owner(facts.agent, facts.session)',
            '      if (owner === undefined) return { kind: \'pass\' }',
            '      const current = await selection.state(owner, facts.signal)',
            '      await selection.select(owner, { selected: SELECTED, expectedRevision: current.revision }, facts.signal)',
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
      { id: 'replay-directory', plugin: 'native-replay-model-directory', scope: 'root' },
      { id: 'model-selection', plugin: '@redspark/rsh-native-model-selection', scope: 'root' },
      { id: 'model-switch-driver', plugin: 'native-model-switch-driver', scope: 'root' },
      { id: 'approval-answerer', plugin: 'native-model-switch-notice-approval', scope: 'root' },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
      { id: 'tool-todo', plugin: '@redspark/rsh-tool-todo', scope: 'root', config: { allowParallelInProgress: false } },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('model-switch-notice: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The scenario's subject: after the todo write the selected model changes, so the
        // second request carries the switched route.
        const headers = events.filter(event => event.type === 'request/header')
        expect(headers).toHaveLength(2)
        const models = headers.map(header => header.type === 'request/header' ? header.data.header.config.model : undefined)
        expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
        const contexts = events.filter(event => event.type === 'request/context')
        expect(contexts.map(context => context.type === 'request/context' ? context.data.model : undefined))
          .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
        expect(events.filter(event => event.type === 'todo/write')).toHaveLength(1)

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
