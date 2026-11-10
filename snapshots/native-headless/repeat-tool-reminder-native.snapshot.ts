/** Recorded repeat-tool-reminder scenario replayed through a Native profile. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/repeat-tool-reminder')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded repeat-tool-reminder session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('repeat-tool-reminder: no recorded task')

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
      { name: 'rsh-tool-todo', path: 'rsh/Modules/Official/todo/tool-todo' },
      { name: 'rsh-repeat-tool-reminder', path: 'rsh/Modules/Official/guard/repeat-tool-reminder' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Use the todo tool.', maxSteps: 6 } }
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
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      // The recorded request ran with the shipped default: parallel in-progress items allowed.
      { id: 'todo', plugin: '@redspark/rsh-tool-todo', scope: 'root', config: { allowParallelInProgress: true } },
      // The settlement policy this scenario exists to prove; shipped defaults apply.
      { id: 'repeat-tool-reminder', plugin: '@redspark/rsh-repeat-tool-reminder', scope: 'root' },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('repeat-tool-reminder: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The reminder reaches the next step in both runtimes. The compatibility loop
        // stages the admitted message through the next-step inbox and claims it at the
        // following step boundary; the Native application appends the settlement context
        // directly before that boundary. Compare the admitted messages rather than the
        // mechanism that carried them.
        // Both runtimes admit the reminder, one step earlier than the compatibility
        // loop because the settlement context is appended as the result settles rather
        // than staged in the inbox. Every other fact is in the same order, so compare
        // the per-turn census and then the reminder itself.
        const census = (list: readonly { readonly type: string }[]): Record<string, number> => {
          const counts: Record<string, number> = {}
          for (const event of list) counts[event.type] = (counts[event.type] ?? 0) + 1
          return counts
        }
        const { 'agent/inbox/spliced': _ignored, ...nativeCensus } = census(events)
        const { 'agent/inbox/spliced': _ignoredToo, ...recordedCensus } = census(recorded)
        expect(nativeCensus).toEqual(recordedCensus)
        // The advisory reminder is the fact this scenario exists to prove: the
        // settlement policy admits one source-attributed message into the next step.
        const reminders = events.filter(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin' && event.data.source.plugin === 'repeat-tool-reminder')
        expect(reminders).toHaveLength(recorded.filter(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin' && event.data.source.plugin === 'repeat-tool-reminder').length)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
