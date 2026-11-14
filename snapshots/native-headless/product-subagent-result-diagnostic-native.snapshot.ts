/** Recorded product-subagent-result-diagnostic scenario replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/product-subagent-result-diagnostic')
const fixture = join(scene, 'session.v3.jsonl')

it('replays product subagent diagnostics through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('product-subagent-result-diagnostic: no recorded task')

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
      { name: 'rsh-native-subagent', path: 'rsh/Engine/subagent/native-subagent' },
      { name: 'rsh-tool-subagent', path: 'rsh/Engine/subagent/tool-subagent' },
      { name: 'rsh-native-jobs', path: 'rsh/Engine/core/native-jobs' },
      { name: 'rsh-native-tool-jobs', path: 'rsh/Engine/jobs/native-tool-jobs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      {
        name: 'snapshot-diagnostic-driver',
        files: {
          'package.json': "{\"name\":\"snapshot-diagnostic-driver\",\"version\":\"0.0.0\",\"type\":\"module\",\"exports\":{\"./native\":\"./native.mjs\",\"./package.json\":\"./package.json\"},\"dsh\":{\"native\":{\"apiVersion\":1,\"entry\":\"./native\",\"targets\":[\"host\"],\"requires\":[],\"optional\":[],\"provides\":[\"externalSubagentDriver\"]}}}",
          'native.mjs': "const results = [{\"remoteId\":\"snapshot-diagnostic-claude-fg\",\"diagnostic\":\"Product subagent failure (product: Claude Code; stage: query-run; category: limit)\",\"output\":\"partial assistant text\"},{\"remoteId\":\"snapshot-diagnostic-claude-bg\",\"diagnostic\":\"Product subagent failure (product: Claude Code; stage: query-run; category: limit)\",\"output\":\"\"},{\"remoteId\":\"snapshot-diagnostic-codex-fg\",\"diagnostic\":\"Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)\",\"output\":\"partial assistant text\"},{\"remoteId\":\"snapshot-diagnostic-codex-bg\",\"diagnostic\":\"Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)\",\"output\":\"\"}]\nlet starts = 0\nexport const plugin = {\n  apiVersion: 1,\n  name: 'snapshot-diagnostic-driver',\n  targets: ['host'],\n  requires: [],\n  provides: ['externalSubagentDriver'],\n  resolve: () => (context) => {\n    context.provide('externalSubagentDriver', {\n      name: 'snapshot-diagnostic',\n      routeFields: [],\n      capabilities: { persona: false, toolFilter: false, outputSchema: false },\n      async start() {\n        const item = results[starts++]\n        if (item === undefined) throw new Error('snapshot diagnostic driver expected exactly four starts')\n        return {\n          remoteId: item.remoteId,\n          result: Promise.resolve({\n            output: item.output.length === 0 ? [] : [{ type: 'text', text: item.output }],\n            diagnostic: item.diagnostic,\n            stopReason: 'error',\n          }),\n          async dispose() {},\n        }\n      },\n    })\n  },\n}",
        },
      },
    ],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Observe the diagnostic failures.', maxSteps: 16 } }
      }
      if (['code-runtime', 'time-context'].includes(row.id)) return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'prompts', plugin: '@redspark/rsh-native-prompt', scope: 'root' },
      { id: 'diagnostic-driver', plugin: 'snapshot-diagnostic-driver', scope: 'root' },
      { id: 'subagents', plugin: '@redspark/rsh-native-subagent', scope: 'root', config: { providerName: 'snapshot-diagnostic' } },
      { id: 'tool-subagent', plugin: '@redspark/rsh-tool-subagent', scope: 'root', config: {
        toolName: 'subagent_codex', maxDepth: 1, backgroundMode: 'one-shot',
      } },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('product-subagent-result-diagnostic: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const calls = events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : '')
        expect(calls.filter(name => name === 'subagent_codex')).toHaveLength(4)
        expect(calls.filter(name => name === 'job_output')).toHaveLength(2)
        const text = JSON.stringify(events)
        expect(text).toContain('Product subagent failure (product: Claude Code; stage: query-run; category: limit)')
        expect(text).toContain('Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)')
        expect(text).toContain('partial assistant text')
        expect(text).toContain('PARENT_OBSERVED_DIAGNOSTICS')
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
