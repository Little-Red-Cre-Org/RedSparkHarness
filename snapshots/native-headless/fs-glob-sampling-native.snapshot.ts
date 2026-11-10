/** Recorded fs-glob-sampling scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/fs-glob-sampling')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

// The recording's workspace is built with fixed modification times, which Windows cannot
// express; the Linux lane runs the scenario and Windows skips it.
const TREE: readonly [string, number][] = [
  [join('archive','a.ts'),1],[join('archive','b.ts'),2],[join('archive','c.ts'),3],
  [join('docs','guide.md'),4],[join('src','index.ts'),5],[join('test','spec.ts'),6],
  ['top.txt',7],['notes.md',8],
]

it.skipIf(process.platform === 'win32')('replays the recorded fs-glob-sampling session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('fs-glob-sampling: no recorded task')

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
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-fs-glob-sampling-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-fs-glob-sampling-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-fs-glob-sampling-approval', targets: ['host'],",
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
      { id: 'approval-answerer', plugin: 'native-fs-glob-sampling-approval', scope: 'root' },
      { id: 'files', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
    ],
  })
  for (const [relative, day] of TREE) {
    const target = join(scenario.paths.workspace, 'tree', relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'fixture\n')
    const stamp = new Date(2000, 0, 1, 0, 0, 0, day)
    utimesSync(target, stamp, stamp)
  }
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('fs-glob-sampling: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The glob sampled across the tree instead of listing it in modification order.
        // The recorded text also carries an absolute spill path under /tmp, which no
        // repository fixture can reproduce, so the assertions pin the stable facts.
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        const rendered = results[0]?.type === 'tool/result'
          ? results[0].data.message.content[0]?.content[0]?.text ?? '' : ''
        expect(rendered).toContain('tree/')
        expect(rendered).toContain('Showing 4 of 8 paths')

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
