/** Recorded partial-Landlock child exit replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/partial-landlock-child-failure')
const fixture = join(scene, 'session.v3.jsonl')
const notice = "landlock-run: partial enforcement (older Landlock ABI)"
const runner = "const NOTICE = \"landlock-run: partial enforcement (older Landlock ABI)\"\nexport const plugin = {\n  apiVersion: 1,\n  name: 'partial-landlock-sandbox',\n  targets: ['host'],\n  requires: [],\n  provides: ['sandbox'],\n  resolve: () => (context) => {\n    const confine = (argv) => ({\n      argv: [\"bash\", \"-c\", \"printf '%s\\\\n' '\" + NOTICE + \"' >&2; exec \\\"\" + \"$\" + \"@\\\"\", \"partial-landlock-run\", ...argv],\n      enforcement: 'partial',\n      denialSignatures: ['permission denied'],\n      runnerFailureRules: [{\n        allowedExitCodes: [125],\n        fatalSignatures: ['landlock-run: '],\n        informationalLines: [NOTICE],\n      }],\n    })\n    context.provide(\"sandbox\", { confine, confineChildProcess: confine })\n  },\n}"

it('replays the recorded partial-landlock child exit through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') {
    throw new Error('partial-landlock-child-failure: no recorded task')
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
        name: 'partial-landlock-sandbox',
        files: {
          'package.json': JSON.stringify({
            name: 'partial-landlock-sandbox', version: '0.0.0', type: 'module',
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
      { id: 'partial-landlock-sandbox', plugin: 'partial-landlock-sandbox', scope: 'root' },
      { id: 'bash-sandbox', plugin: '@redspark/rsh-bash-sandbox', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('partial-landlock-child-failure: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        const rendered = results[0]?.type === 'tool/result'
          ? results[0].data.message.content[0]?.content[0]?.text ?? '' : ''
        expect(rendered).toContain(notice)
        expect(rendered).toContain('[exit code: 1]')
        expect(rendered).not.toContain('SANDBOX_UNAVAILABLE')
        expect(rendered).not.toContain('sandbox runner itself failed')
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['bash'])
        const done = events.filter(event => event.type === 'assistant/message').some(event => {
          if (event.type !== 'assistant/message') return false
          return event.data.message.content.some(part => part.type === 'text' && part.text === 'CHILD_EXIT_PRESERVED')
        })
        expect(done).toBe(true)
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
