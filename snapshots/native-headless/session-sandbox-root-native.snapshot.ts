/** Recorded session-sandbox-root scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/session-sandbox-root')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded session-sandbox-root session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('session-sandbox-root: no recorded task')

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
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // The Native write tool asks its authority once per mutation. The recorded deployment
      // had no answerer, so this scenario supplies one that grants — the facts the scenario
      // proves are the standing policy and the written file, not a person's decision.
      {
        name: 'native-session-root-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-session-root-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-session-root-approval', targets: ['host'],",
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
        config: { mode: 'workspace-write', workspaceRoot: paths.workspace } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      // The recorded deployment carries no answerer, so its "ask" resolution never reached a
      // person; the write succeeded because the Session cwd replaces the process-level
      // sandbox fallback. Native `ask` without an answerer fails closed, so this scenario
      // keeps the same standing facts and makes the disabled-answerer case explicit.
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'ask' } },
      { id: 'approval-answerer', plugin: 'native-session-root-approval', scope: 'root' },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('session-sandbox-root: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The Native write tool resolves its exact target before ordinary approval and asks
        // its authority once per mutation — a capability the compatibility write tool only
        // exercises when it escalates. That pair is a documented Native fact the recording
        // does not carry; with prompts disabled it resolves without a person, and what the
        // scenario proves is that the standing workspace-write policy admits the write.
        expect(events.filter(event => event.type === 'native-approval/asked')).toHaveLength(1)
        expect(events.filter(event => event.type === 'native-approval/decided'))
          .toMatchObject([{ data: { policy: 'ask', outcome: 'allowed-once' } }])
        // The written file is the effect this scenario exists to prove: the standing
        // workspace-write policy admits a write inside the Session root and refuses nothing.
        const target = join(scenario.paths.workspace, 'session-root.txt')
        const written = existsSync(target) ? readFileSync(target, 'utf8')
          : `absent; workspace holds ${String(await readdir(scenario.paths.workspace))}`
        expect(written).toBe('session root')
        // The recorded policy facts must survive as the same events.
        expect(events.filter(event => event.type === 'sandbox/mode').map(event => event.type === 'sandbox/mode' ? event.data : undefined))
          .toEqual(recorded.filter(event => event.type === 'sandbox/mode').map(event => event.type === 'sandbox/mode' ? event.data : undefined))
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
