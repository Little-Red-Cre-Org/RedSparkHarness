/** Recorded session-query-spill scenario replayed through the shipped native profile. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'
import { ensureShippedNativeProfile } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/session-query-spill')
const fixture = join(scene, 'session.v3.jsonl')
const quiet = new Set(['time-context', 'skills', 'skill-filesystem', 'tool-skill', 'skill-badge', 'archify'])

it('replays the recorded session-query-spill session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') {
    throw new Error('session-query-spill: no recorded task')
  }

  const priorHome = process.env.RSH_HOME
  const profileHome = mkdtempSync(join(tmpdir(), 'query-spill-profile-'))
  process.env.RSH_HOME = profileHome
  try {
    ensureShippedNativeProfile('headless')
  } finally {
    if (priorHome === undefined) delete process.env.RSH_HOME
    else process.env.RSH_HOME = priorHome
  }

  // Cordis logged permission/preset, sandbox/mode, and approval/policy before
  // the request, so the recorded read targets seq 10. Native headless does not
  // log those three, and the same request/header is seq 7. Keep the shared
  // override for the Cordis scenario; this file only retargets the first call.
  const override = JSON.parse(readFileSync(join(scene, 'replay.override.json'), 'utf8')) as {
    chunks: { argumentsDelta?: string, block?: { arguments?: string } }[]
  }[]
  const nativeSeq = '{"seq":7}'
  for (const chunk of override[0]?.chunks ?? []) {
    if (typeof chunk.argumentsDelta === 'string') chunk.argumentsDelta = chunk.argumentsDelta.replace('{"seq":10}', nativeSeq)
    if (typeof chunk.block?.arguments === 'string') chunk.block.arguments = chunk.block.arguments.replace('{"seq":10}', nativeSeq)
  }
  const overrideFile = join(profileHome, 'query-spill-override.json')
  writeFileSync(overrideFile, JSON.stringify(override))

  const scenario = assembleNativeScenario({
    root,
    scene,
    profileRoot: join(profileHome, 'profiles', 'headless'),
    modules: [
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
      { name: 'rsh-session-projection', path: 'rsh/Engine/session/session-projection' },
      { name: 'rsh-tool-session-query', path: 'rsh/Engine/session-query/tool-session-query' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    // Shipped headless provides sessionQuery but not the tools. Those rows exist
    // only on native-headless-query. This scene's recording calls them.
    extraRows: () => [
      { id: 'session-projection', plugin: '@redspark/rsh-session-projection', scope: 'root' },
      { id: 'tool-session-query', plugin: '@redspark/rsh-tool-session-query', scope: 'root' },
    ],
    composeRow: (row, paths) => {
      if (quiet.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') {
        return { ...row, config: { ...row.config, cwd: paths.workspace, provider: 'deepseek-official',
          model: 'deepseek-v4-flash', systemPrompt: 'Use session_event_read and bash.', maxSteps: 6 } }
      }
      if (row.id === 'approval') return { ...row, config: { policy: 'never' } }
      // The snapshot overlay forces a spill. 2000 leaves room for the notice
      // after a workspace path, and is still below a request/header body.
      if (row.id === 'spill-policy') return { ...row, config: { maxInlineBytes: 2000 } }
      if (row.id === 'spill-store') {
        return { ...row, config: { root: join(paths.workspace, '.spill'), cleanupPeriodDays: 0 } }
      }
      if (row.id === 'pi-ai') {
        return { ...row, plugin: 'rsh-llm-replay-native', config: {
          file: fixture,
          overrideFile,
          providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash', contextWindow: 1_000_000 }] }],
        } }
      }
      return row
    },
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('session-query-spill: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const results = events.filter(event => event.type === 'tool/result')
        const textOf = (index: number): string => {
          const event = results[index]
          if (event?.type !== 'tool/result') return ''
          const block = event.data.message.content[0]
          return block?.type === 'tool-result' && block.content[0]?.type === 'text' ? block.content[0].text : ''
        }
        expect(textOf(0)).toMatch(/Full formatted result stored at: .+-session_event_read\.txt\. Use read/)
        expect(textOf(1)).toContain('SPILL_CANONICAL_OK')
        const assistant = events.filter(event => event.type === 'assistant/message')
        const done = assistant.some(event => JSON.stringify(event).includes('DONE'))
        expect(done).toBe(true)
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
